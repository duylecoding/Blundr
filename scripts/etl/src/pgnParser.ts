import type { Transform } from 'node:stream';
import * as zlib from 'node:zlib';

export interface EvalScore {
  /** Evaluation in pawns (e.g. 0.25, -1.4), or null if forced mate */
  pawns: number | null;
  /** Forced mate in N moves (positive = winning mate, negative = getting mated), or null */
  mateIn: number | null;
}

export interface ParsedMove {
  /** 1-based ply index (1 = White's 1st move, 2 = Black's 1st move, ...) */
  ply: number;
  /** Fullmove number (1, 2, 3, ...) */
  moveNumber: number;
  /** Side that played this move ('w' or 'b') */
  color: 'w' | 'b';
  /** Move in SAN notation (e.g. "Nf3", "e5", "O-O") */
  san: string;
  /** Lichess [%eval] after this move, always from White's perspective */
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

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Create a Node native Zstandard decompression transform stream (available in Node 22.15+/24+/26+).
 */
export function createZstdDecompressStream(): Transform {
  const zlibMod = zlib as unknown as ZlibWithZstd;
  if (typeof zlibMod.createZstdDecompress !== 'function') {
    throw new Error(
      `zlib.createZstdDecompress is not available in Node ${process.version}. Node 22.15+ (or Node 26+) is required.`
    );
  }
  return zlibMod.createZstdDecompress();
}

/**
 * Stream raw PGN game strings from a decompressed byte or text stream without loading
 * the entire archive into memory.
 */
export async function* streamPgnGames(
  stream: AsyncIterable<Uint8Array | string>
): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let remainder = '';
  let currentLines: string[] = [];
  let seenMoveText = false;

  const processLine = (rawLine: string): string | null => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      if (currentLines.length > 0) {
        currentLines.push('');
      }
      return null;
    }

    const isHeader = trimmed.startsWith('[');
    const isNewGameStart =
      currentLines.length > 0 &&
      (trimmed.startsWith('[Event ') || (seenMoveText && isHeader));

    if (isNewGameStart) {
      const completed = currentLines.join('\n').trim();
      currentLines = [line];
      seenMoveText = false;
      return completed.length > 0 ? completed : null;
    }

    if (!isHeader) {
      seenMoveText = true;
    }
    currentLines.push(line);
    return null;
  };

  for await (const chunk of stream) {
    const text =
      typeof chunk === 'string'
        ? chunk
        : decoder.decode(chunk, { stream: true });
    if (text.length === 0) {
      continue;
    }

    const combined = remainder + text;
    const lines = combined.split('\n');
    remainder = lines.pop() ?? '';

    for (const line of lines) {
      const game = processLine(line);
      if (game !== null) {
        yield game;
      }
    }
  }

  const tail = remainder + decoder.decode();
  if (tail.length > 0) {
    for (const line of tail.split('\n')) {
      const game = processLine(line);
      if (game !== null) {
        yield game;
      }
    }
  }

  if (currentLines.length > 0) {
    const lastGame = currentLines.join('\n').trim();
    if (lastGame.length > 0) {
      yield lastGame;
    }
  }
}

/**
 * Fast pre-filter run on raw PGN text BEFORE parsing moves or invoking chess.js.
 * Checks for [%eval annotations, standard chess rules, and Elo >= minElo for both players.
 */
export function passesFastPreFilter(rawGame: string, minElo: number): boolean {
  if (!rawGame.includes('[%eval ')) {
    return false;
  }

  if (rawGame.includes('[FEN "')) {
    return false;
  }

  const variantMatch = VARIANT_RE.exec(rawGame);
  if (variantMatch?.[1] && variantMatch[1].toLowerCase() !== 'standard') {
    return false;
  }

  const whiteMatch = WHITE_ELO_RE.exec(rawGame);
  const blackMatch = BLACK_ELO_RE.exec(rawGame);
  if (!whiteMatch?.[1] || !blackMatch?.[1]) {
    return false;
  }

  const whiteElo = Number.parseInt(whiteMatch[1], 10);
  const blackElo = Number.parseInt(blackMatch[1], 10);
  if (Number.isNaN(whiteElo) || Number.isNaN(blackElo)) {
    return false;
  }

  return whiteElo >= minElo && blackElo >= minElo;
}

/**
 * Parse a single Lichess [%eval ...] value token (e.g. "0.25", "-1.4", "#2", "#-1").
 */
export function parseEvalToken(raw: string): EvalScore | null {
  const token = raw.trim();
  if (token.length === 0) {
    return null;
  }

  if (token.startsWith('#')) {
    const mateVal = Number.parseInt(token.slice(1), 10);
    if (!Number.isFinite(mateVal) || mateVal === 0) {
      return null;
    }
    return { pawns: null, mateIn: mateVal };
  }

  const pawns = Number.parseFloat(token);
  if (!Number.isFinite(pawns)) {
    return null;
  }
  return { pawns: normalizeZero(pawns), mateIn: null };
}

/**
 * Extract a Lichess [%eval ...] annotation from a PGN comment block.
 */
export function extractEvalFromComment(comment: string): EvalScore | null {
  const match = EVAL_COMMENT_RE.exec(comment);
  if (!match?.[1]) {
    return null;
  }
  return parseEvalToken(match[1]);
}

/**
 * Convert a White-perspective evaluation (such as Lichess [%eval]) into the
 * perspective of the given side to move ('w' or 'b').
 */
export function normalizeEvalForSide(
  evalWhite: EvalScore,
  sideToMove: 'w' | 'b'
): EvalScore {
  if (sideToMove === 'w') {
    return {
      pawns: evalWhite.pawns !== null ? normalizeZero(evalWhite.pawns) : null,
      mateIn: evalWhite.mateIn !== null ? normalizeZero(evalWhite.mateIn) : null,
    };
  }

  return {
    pawns: evalWhite.pawns !== null ? normalizeZero(-evalWhite.pawns) : null,
    mateIn: evalWhite.mateIn !== null ? normalizeZero(-evalWhite.mateIn) : null,
  };
}

function extractGameId(site: string): string {
  const trimmed = site.trim();
  const lichessMatch = /lichess\.org\/(?:game\/)?([A-Za-z0-9]{8,12})/.exec(trimmed);
  if (lichessMatch?.[1]) {
    return lichessMatch[1];
  }

  const lastSegment = trimmed.split('/').filter(Boolean).pop() ?? 'unknown';
  const sanitized = lastSegment.replace(/[^A-Za-z0-9_-]/g, '');
  return sanitized.length > 0 ? sanitized : 'unknown';
}

function parseMovetext(movetext: string): ParsedMove[] {
  const moves: ParsedMove[] = [];
  let i = 0;
  const len = movetext.length;
  let parenDepth = 0;

  while (i < len) {
    const ch = movetext[i]!;

    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }

    // Semicolon rest-of-line comment
    if (ch === ';') {
      while (i < len && movetext[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    // Brace comment { ... }
    if (ch === '{') {
      const end = movetext.indexOf('}', i + 1);
      if (end === -1) {
        break;
      }
      if (parenDepth === 0 && moves.length > 0) {
        const lastMove = moves[moves.length - 1]!;
        if (lastMove.evalWhite === null) {
          const comment = movetext.slice(i + 1, end);
          lastMove.evalWhite = extractEvalFromComment(comment);
        }
      }
      i = end + 1;
      continue;
    }

    // Stray or nested closing brace (guard against infinite loop before token scan)
    if (ch === '}') {
      i += 1;
      continue;
    }

    // RAV variation start / end
    if (ch === '(') {
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      if (parenDepth > 0) {
        parenDepth -= 1;
      }
      i += 1;
      continue;
    }

    // Read a token until whitespace or delimiter
    const start = i;
    while (i < len) {
      const c = movetext[i]!;
      if (
        c === ' ' ||
        c === '\t' ||
        c === '\r' ||
        c === '\n' ||
        c === '{' ||
        c === '}' ||
        c === '(' ||
        c === ')' ||
        c === ';'
      ) {
        break;
      }
      i += 1;
    }

    if (parenDepth > 0) {
      continue;
    }

    const rawToken = movetext.slice(start, i);
    if (rawToken.length === 0) {
      continue;
    }

    // Result token terminates game
    if (RESULT_TOKENS.has(rawToken)) {
      break;
    }

    // Numeric Annotation Glyph ($1, $2, ...)
    if (rawToken.startsWith('$')) {
      continue;
    }

    // Strip leading move number prefix or standalone ellipsis (e.g. "1.", "12...", "...", "1.e4" -> "e4")
    const withoutMoveNum = rawToken.replace(/^(?:\d+\.+|\.+)/, '');
    if (withoutMoveNum.length === 0) {
      continue;
    }

    // Strip trailing annotation glyphs like !, ?, !?, ?!
    const san = withoutMoveNum.replace(/[!?]+$/, '');
    if (san.length === 0 || RESULT_TOKENS.has(san)) {
      continue;
    }

    const ply = moves.length + 1;
    const moveNumber = Math.floor((ply + 1) / 2);
    const color: 'w' | 'b' = ply % 2 === 1 ? 'w' : 'b';

    moves.push({
      ply,
      moveNumber,
      color,
      san,
      evalWhite: null,
    });
  }

  return moves;
}

/**
 * Parse a raw PGN game string into headers, Elo metadata, and move list with [%eval] scores.
 * Does not invoke chess.js; board replay is deferred to candidate filtering.
 */
export function parsePgnGame(rawGame: string): ParsedGame | null {
  const headers: Record<string, string> = {};
  const movetextLines: string[] = [];
  let inMoveText = false;

  for (const rawLine of rawGame.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!inMoveText && trimmed.startsWith('[')) {
      const match = HEADER_LINE_RE.exec(trimmed);
      if (match?.[1] && match[2] !== undefined) {
        headers[match[1]] = match[2].replace(/\\"/g, '"');
      }
      continue;
    }
    if (trimmed.length === 0 && !inMoveText) {
      continue;
    }
    inMoveText = true;
    movetextLines.push(rawLine);
  }

  const whiteElo = Number.parseInt(headers['WhiteElo'] ?? '', 10);
  const blackElo = Number.parseInt(headers['BlackElo'] ?? '', 10);
  if (Number.isNaN(whiteElo) || Number.isNaN(blackElo)) {
    return null;
  }

  const movetext = movetextLines.join(' ');
  const moves = parseMovetext(movetext);
  if (moves.length === 0) {
    return null;
  }

  const site = headers['Site'] ?? '';
  const gameId = extractGameId(site);
  const avgElo = Math.round((whiteElo + blackElo) / 2);

  return {
    headers,
    gameId,
    site,
    whiteElo,
    blackElo,
    avgElo,
    moves,
  };
}
