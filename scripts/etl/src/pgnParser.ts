// Streams and parses Lichess zstd PGN games into moves and [%eval] annotations without
// instantiating chess.js, enabling fast Elo/eval pre-filtering on multi-GB archives.

import { Duplex, Transform, type TransformCallback } from 'node:stream';
import * as zlib from 'node:zlib';
import {
  MAX_DECOMPRESSED_BYTES,
  MAX_PGN_GAME_BYTES,
  MAX_PGN_LINE_BYTES,
} from './constants.js';

export interface StreamPgnOptions {
  maxLineBytes?: number;
  maxGameBytes?: number;
}

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
const FORBIDDEN_HEADER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const normalizeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

export function createByteLimitTransform(maxBytes: number = MAX_DECOMPRESSED_BYTES): Transform {
  let totalBytes = 0;
  return new Transform({
    transform(
      chunk: Buffer | Uint8Array | string,
      encoding: BufferEncoding,
      callback: TransformCallback
    ): void {
      const chunkBytes =
        typeof chunk === 'string' ? Buffer.byteLength(chunk, encoding) : chunk.byteLength;
      totalBytes += chunkBytes;
      if (totalBytes > maxBytes) {
        callback(new Error(`Decompressed stream exceeded limit of ${maxBytes} bytes.`));
        return;
      }
      callback(null, chunk);
    },
  });
}

export function createZstdDecompressStream(
  maxDecompressedBytes: number = MAX_DECOMPRESSED_BYTES
): Duplex {
  const zlibMod = zlib as unknown as ZlibWithZstd;
  if (typeof zlibMod.createZstdDecompress !== 'function') {
    throw new Error(
      `zlib.createZstdDecompress is not available in Node ${process.version}. Node 22.15+ is required.`
    );
  }
  const zstd = zlibMod.createZstdDecompress();
  const limiter = createByteLimitTransform(maxDecompressedBytes);
  zstd.pipe(limiter);
  zstd.on('error', (err: Error) => limiter.destroy(err));
  limiter.on('close', () => {
    if (!zstd.destroyed) zstd.destroy();
  });
  return Duplex.from({ writable: zstd, readable: limiter });
}

export async function* streamPgnGames(
  stream: AsyncIterable<Uint8Array | string>,
  options: StreamPgnOptions = {}
): AsyncGenerator<string> {
  const maxLineBytes = options.maxLineBytes ?? MAX_PGN_LINE_BYTES;
  const maxGameBytes = options.maxGameBytes ?? MAX_PGN_GAME_BYTES;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let remainder = '';
  let remainderBytes = 0;
  let droppingOversizedLine = false;
  let currentLines: string[] = [];
  let currentGameBytes = 0;
  let droppingOversizedGame = false;
  let seenMoveText = false;

  const dropCurrentGame = (): void => {
    droppingOversizedGame = true;
    currentLines = [];
    currentGameBytes = 0;
  };

  const pushLine = (rawLine: string): string | null => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trim();
    const isHeader = trimmed.startsWith('[');

    if (droppingOversizedGame) {
      if (trimmed.length === 0) return null;
      if (trimmed.startsWith('[Event ') || (seenMoveText && isHeader)) {
        const lineBytes = Buffer.byteLength(line, 'utf-8');
        if (lineBytes > maxGameBytes) return null;
        droppingOversizedGame = false;
        currentLines = [line];
        currentGameBytes = lineBytes;
        seenMoveText = false;
        return null;
      }
      if (!isHeader) seenMoveText = true;
      return null;
    }

    if (trimmed.length === 0) {
      if (currentLines.length > 0) {
        currentGameBytes += 1;
        if (currentGameBytes > maxGameBytes) dropCurrentGame();
        else currentLines.push('');
      }
      return null;
    }

    if (currentLines.length > 0 && (trimmed.startsWith('[Event ') || (seenMoveText && isHeader))) {
      const completed = currentLines.join('\n').trim();
      const lineBytes = Buffer.byteLength(line, 'utf-8');
      if (lineBytes > maxGameBytes) {
        dropCurrentGame();
        seenMoveText = false;
      } else {
        currentLines = [line];
        currentGameBytes = lineBytes;
        seenMoveText = false;
      }
      return completed.length > 0 ? completed : null;
    }

    const addedBytes = Buffer.byteLength(line, 'utf-8') + (currentLines.length > 0 ? 1 : 0);
    if (currentGameBytes + addedBytes > maxGameBytes) {
      dropCurrentGame();
      if (!isHeader) seenMoveText = true;
      return null;
    }

    if (!isHeader) seenMoveText = true;
    currentLines.push(line);
    currentGameBytes += addedBytes;
    return null;
  };

  function* consumeText(text: string): Generator<string> {
    let offset = 0;
    while (offset < text.length) {
      const nlIdx = text.indexOf('\n', offset);
      if (nlIdx === -1) {
        const segment = text.slice(offset);
        if (!droppingOversizedLine) {
          const segBytes = Buffer.byteLength(segment, 'utf-8');
          if (remainderBytes + segBytes > maxLineBytes) {
            remainder = '';
            remainderBytes = 0;
            droppingOversizedLine = true;
            dropCurrentGame();
          } else {
            remainder += segment;
            remainderBytes += segBytes;
          }
        }
        break;
      }

      const segment = text.slice(offset, nlIdx);
      offset = nlIdx + 1;

      if (droppingOversizedLine) {
        droppingOversizedLine = false;
        continue;
      }

      const segBytes = Buffer.byteLength(segment, 'utf-8');
      if (remainderBytes + segBytes > maxLineBytes) {
        remainder = '';
        remainderBytes = 0;
        dropCurrentGame();
        continue;
      }

      const line = remainder.length > 0 ? remainder + segment : segment;
      remainder = '';
      remainderBytes = 0;
      const game = pushLine(line);
      if (game !== null) yield game;
    }
  }

  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    if (text.length === 0) continue;
    yield* consumeText(text);
  }

  const tail = decoder.decode();
  if (tail.length > 0) yield* consumeText(tail);
  if (!droppingOversizedLine && remainder.length > 0) {
    const game = pushLine(remainder);
    if (game !== null) yield game;
  }

  if (!droppingOversizedGame) {
    const lastGame = currentLines.join('\n').trim();
    if (lastGame.length > 0) yield lastGame;
  }
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

function stripTrailingAnnotations(token: string): string {
  let end = token.length;
  while (end > 0) {
    const ch = token[end - 1];
    if (ch !== '!' && ch !== '?') break;
    end -= 1;
  }
  return end === token.length ? token : token.slice(0, end);
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

    // Strip leading move numbers ("12.", "12...", "1.e4") and trailing "!?" annotations linearly.
    const san = stripTrailingAnnotations(rawToken.replace(/^(?:\d+\.+|\.+)/, ''));
    if (san.length === 0 || RESULT_TOKENS.has(san)) continue;

    const ply = moves.length + 1;
    moves.push({ ply, moveNumber: Math.floor((ply + 1) / 2), color: ply % 2 === 1 ? 'w' : 'b', san, evalWhite: null });
  }
  return moves;
}

export function parsePgnGame(rawGame: string): ParsedGame | null {
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  const movetextLines: string[] = [];
  let inMoveText = false;

  for (const rawLine of rawGame.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!inMoveText && trimmed.startsWith('[')) {
      const match = HEADER_LINE_RE.exec(trimmed);
      if (match?.[1] && match[2] !== undefined && !FORBIDDEN_HEADER_KEYS.has(match[1])) {
        headers[match[1]] = match[2].replace(/\\"/g, '"');
      }
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
