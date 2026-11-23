// Streams and parses Lichess zstd PGN games into moves and [%eval] annotations without
// instantiating chess.js, enabling fast Elo/eval pre-filtering on multi-GB archives.

import type { Transform } from 'node:stream';
import * as zlib from 'node:zlib';

export interface EvalScore {
  pawns: number | null;
  mateIn: number | null;
}

export interface ParsedMove {
  ply: number;
  moveNumber: number;
  color: 'w' | 'b';
  san: string;
  // Lichess [%eval] is always reported from White's perspective.
  evalWhite: EvalScore | null;
}

export interface ParsedGame {
  headers: Record<string, string>;
  gameId: string;
  site: string;
  whiteElo: number;
  blackElo: number;
  avgElo: number;
  moves: ParsedMove[];
}

interface ZlibWithZstd {
  createZstdDecompress?: () => Transform;
}

const WHITE_ELO_RE = /\[WhiteElo\s+"(\d+)"\]/;
const BLACK_ELO_RE = /\[BlackElo\s+"(\d+)"\]/;
const VARIANT_RE = /\[Variant\s+"([^"]+)"\]/;
const HEADER_LINE_RE = /^\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"\\])*)"\]$/;
const EVAL_COMMENT_RE = /\[%eval\s+([^\]]+)\]/;
const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*']);
const DELIMITERS = new Set([' ', '\t', '\r', '\n', '{', '}', '(', ')', ';']);

const normalizeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

export function createZstdDecompressStream(): Transform {
  const zlibMod = zlib as unknown as ZlibWithZstd;
  if (typeof zlibMod.createZstdDecompress !== 'function') {
    throw new Error(
      `zlib.createZstdDecompress is not available in Node ${process.version}. Node 22.15+ is required.`
    );
  }
  return zlibMod.createZstdDecompress();
}

export async function* streamPgnGames(
  stream: AsyncIterable<Uint8Array | string>
): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let remainder = '';
  let currentLines: string[] = [];
  let seenMoveText = false;

  const pushLine = (rawLine: string): string | null => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (currentLines.length > 0) currentLines.push('');
      return null;
    }

    const isHeader = trimmed.startsWith('[');
    if (currentLines.length > 0 && (trimmed.startsWith('[Event ') || (seenMoveText && isHeader))) {
      const completed = currentLines.join('\n').trim();
      currentLines = [line];
      seenMoveText = false;
      return completed.length > 0 ? completed : null;
    }

    if (!isHeader) seenMoveText = true;
    currentLines.push(line);
    return null;
  };

  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    if (text.length === 0) continue;
    const lines = (remainder + text).split('\n');
    remainder = lines.pop() ?? '';
    for (const line of lines) {
      const game = pushLine(line);
      if (game !== null) yield game;
    }
  }

  for (const line of (remainder + decoder.decode()).split('\n')) {
    const game = pushLine(line);
    if (game !== null) yield game;
  }

  const lastGame = currentLines.join('\n').trim();
  if (lastGame.length > 0) yield lastGame;
}

export function passesFastPreFilter(rawGame: string, minElo: number): boolean {
  if (!rawGame.includes('[%eval ') || rawGame.includes('[FEN "')) return false;

  const variant = VARIANT_RE.exec(rawGame)?.[1];
  if (variant && variant.toLowerCase() !== 'standard') return false;

  const whiteRaw = WHITE_ELO_RE.exec(rawGame)?.[1];
  const blackRaw = BLACK_ELO_RE.exec(rawGame)?.[1];
  if (!whiteRaw || !blackRaw) return false;

  const whiteElo = Number.parseInt(whiteRaw, 10);
  const blackElo = Number.parseInt(blackRaw, 10);
  return !Number.isNaN(whiteElo) && !Number.isNaN(blackElo) && whiteElo >= minElo && blackElo >= minElo;
}

export function parseEvalToken(raw: string): EvalScore | null {
  const token = raw.trim();
  if (token.length === 0) return null;

  if (token.startsWith('#')) {
    const mateVal = Number.parseInt(token.slice(1), 10);
    return Number.isFinite(mateVal) && mateVal !== 0 ? { pawns: null, mateIn: mateVal } : null;
  }

  const pawns = Number.parseFloat(token);
  return Number.isFinite(pawns) ? { pawns: normalizeZero(pawns), mateIn: null } : null;
}

export function extractEvalFromComment(comment: string): EvalScore | null {
  const match = EVAL_COMMENT_RE.exec(comment);
  return match?.[1] ? parseEvalToken(match[1]) : null;
}

// Lichess [%eval] is always White's perspective; negate scores when Black is to move.
export function normalizeEvalForSide(evalWhite: EvalScore, sideToMove: 'w' | 'b'): EvalScore {
  const sign = sideToMove === 'w' ? 1 : -1;
  return {
    pawns: evalWhite.pawns !== null ? normalizeZero(sign * evalWhite.pawns) : null,
    mateIn: evalWhite.mateIn !== null ? normalizeZero(sign * evalWhite.mateIn) : null,
  };
}

function extractGameId(site: string): string {
  const trimmed = site.trim();
  const lichessMatch = /lichess\.org\/(?:game\/)?([A-Za-z0-9]{8,12})/.exec(trimmed);
  if (lichessMatch?.[1]) return lichessMatch[1];

  const sanitized = (trimmed.split('/').filter(Boolean).pop() ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '');
  return sanitized.length > 0 ? sanitized : 'unknown';
}

function parseMovetext(movetext: string): ParsedMove[] {
  const moves: ParsedMove[] = [];
  let i = 0;
  let parenDepth = 0;

  while (i < movetext.length) {
    const ch = movetext[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i += 1; continue; }
    if (ch === ';') { while (i < movetext.length && movetext[i] !== '\n') i += 1; continue; }
    if (ch === '{') {
      const end = movetext.indexOf('}', i + 1);
      if (end === -1) break;
      const lastMove = parenDepth === 0 ? moves[moves.length - 1] : undefined;
      if (lastMove && lastMove.evalWhite === null) {
        lastMove.evalWhite = extractEvalFromComment(movetext.slice(i + 1, end));
      }
      i = end + 1;
      continue;
    }
    // Skip stray/nested closing braces before token scan to prevent an infinite loop.
    if (ch === '}') { i += 1; continue; }
    if (ch === '(') { parenDepth += 1; i += 1; continue; }
    if (ch === ')') { if (parenDepth > 0) parenDepth -= 1; i += 1; continue; }

    const start = i;
    while (i < movetext.length && !DELIMITERS.has(movetext[i]!)) i += 1;
    if (parenDepth > 0) continue;

    const rawToken = movetext.slice(start, i);
    if (rawToken.length === 0 || rawToken.startsWith('$')) continue;
    if (RESULT_TOKENS.has(rawToken)) break;

    // Strip leading move numbers ("12.", "12...", "1.e4") and standalone "..." tokens.
    const san = rawToken.replace(/^(?:\d+\.+|\.+)/, '').replace(/[!?]+$/, '');
    if (san.length === 0 || RESULT_TOKENS.has(san)) continue;

    const ply = moves.length + 1;
    moves.push({ ply, moveNumber: Math.floor((ply + 1) / 2), color: ply % 2 === 1 ? 'w' : 'b', san, evalWhite: null });
  }
  return moves;
}

export function parsePgnGame(rawGame: string): ParsedGame | null {
  const headers: Record<string, string> = {};
  const movetextLines: string[] = [];
  let inMoveText = false;

  for (const rawLine of rawGame.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!inMoveText && trimmed.startsWith('[')) {
      const match = HEADER_LINE_RE.exec(trimmed);
      if (match?.[1] && match[2] !== undefined) headers[match[1]] = match[2].replace(/\\"/g, '"');
      continue;
    }
    if (!inMoveText && trimmed.length === 0) continue;
    inMoveText = true;
    movetextLines.push(rawLine);
  }

  const whiteElo = Number.parseInt(headers['WhiteElo'] ?? '', 10);
  const blackElo = Number.parseInt(headers['BlackElo'] ?? '', 10);
  if (Number.isNaN(whiteElo) || Number.isNaN(blackElo)) return null;

  const moves = parseMovetext(movetextLines.join(' '));
  if (moves.length === 0) return null;

  const site = headers['Site'] ?? '';
  return { headers, gameId: extractGameId(site), site, whiteElo, blackElo, avgElo: Math.round((whiteElo + blackElo) / 2), moves };
}
