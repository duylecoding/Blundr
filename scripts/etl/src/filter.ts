import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import type { DifficultyTier } from '../../../shared/types.js';
import {
  normalizeEvalForSide,
  type EvalScore,
  type ParsedGame,
} from './pgnParser.js';

export const PIECE_VALUES: Readonly<Record<PieceSymbol, number>> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

export interface MaterialSummary {
  sideToMoveMaterial: number;
  opponentMaterial: number;
  /** sideToMoveMaterial - opponentMaterial */
  balance: number;
  /** Combined non-king material of both sides (in pawns) */
  totalNonKingMaterial: number;
}

export type CandidateBucket =
  | { kind: 'equal'; hasAdvantage: false }
  | { kind: 'advantage'; hasAdvantage: true; tier: DifficultyTier };

export interface RawCandidate {
  id: string;
  fen: string;
  lastMove: string;
  lastMoveSan: string;
  sideToMove: 'w' | 'b';
  bucket: CandidateBucket;
  evalBefore: number;
  evalAfter: number | null;
  mateIn: number | null;
  materialBalance: number;
  totalNonKingMaterial: number;
  moveNumber: number;
  ply: number;
  avgElo: number;
  gameUrl: string;
}

export interface ExtractCandidateOptions {
  minElo?: number;
  minMoveNumber?: number;
  maxMoveNumber?: number;
  maxCandidatesPerGame?: number;
  minPlyGap?: number;
  minNonKingMaterial?: number;
  maxMaterialImbalance?: number;
}

const UCI_MOVE_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

function round2(n: number): number {
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Calculate material balance (side-to-move minus opponent) and total non-king material
 * using standard piece values (P=1, N=3, B=3, R=5, Q=9).
 */
export function calculateMaterial(
  fenOrChess: string | Chess,
  sideToMoveOverride?: 'w' | 'b'
): MaterialSummary {
  const fen = typeof fenOrChess === 'string' ? fenOrChess : fenOrChess.fen();
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0] ?? '';
  const fenTurn: 'w' | 'b' = parts[1] === 'b' ? 'b' : 'w';
  const sideToMove = sideToMoveOverride ?? fenTurn;

  let whiteMaterial = 0;
  let blackMaterial = 0;

  for (let i = 0; i < placement.length; i += 1) {
    const ch = placement[i]!;
    if (ch === '/' || (ch >= '1' && ch <= '8')) {
      continue;
    }
    const lower = ch.toLowerCase() as PieceSymbol;
    const value = PIECE_VALUES[lower];
    if (value === undefined || value === 0) {
      continue;
    }
    if (ch >= 'A' && ch <= 'Z') {
      whiteMaterial += value;
    } else {
      blackMaterial += value;
    }
  }

  const sideToMoveMaterial = sideToMove === 'w' ? whiteMaterial : blackMaterial;
  const opponentMaterial = sideToMove === 'w' ? blackMaterial : whiteMaterial;

  return {
    sideToMoveMaterial,
    opponentMaterial,
    balance: sideToMoveMaterial - opponentMaterial,
    totalNonKingMaterial: whiteMaterial + blackMaterial,
  };
}

/**
 * Classify a position into Equal, Tier 1 (Easy), Tier 2 (Medium), or Tier 3 (Hard)
 * using side-to-move-normalized evaluations before and after the opponent's move.
 */
export function classifyBucket(
  evalBefore: EvalScore,
  evalAfter: EvalScore
): CandidateBucket | null {
  // Prior position must be numeric (not forced mate) and roughly equal
  if (evalBefore.mateIn !== null || evalBefore.pawns === null) {
    return null;
  }
  if (Math.abs(evalBefore.pawns) > 0.4) {
    return null;
  }

  // Equal: |evalBefore| <= 0.3, no mate, |evalAfter| <= 0.3
  if (
    Math.abs(evalBefore.pawns) <= 0.3 &&
    evalAfter.mateIn === null &&
    evalAfter.pawns !== null &&
    Math.abs(evalAfter.pawns) <= 0.3
  ) {
    return { kind: 'equal', hasAdvantage: false };
  }

  // Tier 1 Easy: mateIn in 1..2 OR evalAfter >= 4.0
  if (
    (evalAfter.mateIn !== null &&
      evalAfter.mateIn >= 1 &&
      evalAfter.mateIn <= 2) ||
    (evalAfter.mateIn === null &&
      evalAfter.pawns !== null &&
      evalAfter.pawns >= 4.0)
  ) {
    return { kind: 'advantage', hasAdvantage: true, tier: 1 };
  }

  // Tier 2 Medium: no mate, 2.0 <= evalAfter < 4.0
  if (
    evalAfter.mateIn === null &&
    evalAfter.pawns !== null &&
    evalAfter.pawns >= 2.0 &&
    evalAfter.pawns < 4.0
  ) {
    return { kind: 'advantage', hasAdvantage: true, tier: 2 };
  }

  // Tier 3 Hard: no mate, 1.0 <= evalAfter < 2.0
  if (
    evalAfter.mateIn === null &&
    evalAfter.pawns !== null &&
    evalAfter.pawns >= 1.0 &&
    evalAfter.pawns < 2.0
  ) {
    return { kind: 'advantage', hasAdvantage: true, tier: 3 };
  }

  return null;
}

interface PreQualifiedPly {
  moveIndex: number;
  sideToMove: 'w' | 'b';
  evalBefore: number;
  evalAfter: number | null;
  mateIn: number | null;
  bucket: CandidateBucket;
}

function buildGameUrl(site: string, gameId: string, ply: number): string {
  const trimmed = site.trim();
  if (trimmed.includes('lichess.org/')) {
    return `https://lichess.org/${gameId}#${ply}`;
  }
  const base =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed.replace(/#.*$/, '')
      : `https://lichess.org/${gameId}`;
  return `${base}#${ply}`;
}

/**
 * Extract up to 2 spaced candidate positions from a parsed game.
 * Only instantiates chess.js if at least one ply passes the eval & move-number filter.
 */
export function extractCandidatesFromGame(
  game: ParsedGame,
  options: ExtractCandidateOptions = {}
): RawCandidate[] {
  const minElo = options.minElo ?? 1800;
  const minMoveNumber = options.minMoveNumber ?? 10;
  const maxMoveNumber = options.maxMoveNumber ?? 45;
  const maxCandidatesPerGame = options.maxCandidatesPerGame ?? 2;
  const minPlyGap = options.minPlyGap ?? 6;
  const minNonKingMaterial = options.minNonKingMaterial ?? 10;
  const maxMaterialImbalance = options.maxMaterialImbalance ?? 1;

  if (game.whiteElo < minElo || game.blackElo < minElo) {
    return [];
  }

  // Pass 1 (cheap): identify plies that pass move-number and eval-bucket filters
  const preQualified = new Map<number, PreQualifiedPly>();
  let maxNeededIndex = -1;

  for (let idx = 1; idx < game.moves.length; idx += 1) {
    const oppMove = game.moves[idx]!;
    if (oppMove.moveNumber < minMoveNumber) {
      continue;
    }
    if (oppMove.moveNumber > maxMoveNumber) {
      break;
    }

    const prevMove = game.moves[idx - 1]!;
    if (prevMove.evalWhite === null || oppMove.evalWhite === null) {
      continue;
    }

    // Side deciding AFTER opponent's move
    const sideToMove: 'w' | 'b' = oppMove.color === 'w' ? 'b' : 'w';
    const evalBefore = normalizeEvalForSide(prevMove.evalWhite, sideToMove);
    const evalAfter = normalizeEvalForSide(oppMove.evalWhite, sideToMove);

    const bucket = classifyBucket(evalBefore, evalAfter);
    if (bucket === null || evalBefore.pawns === null) {
      continue;
    }

    preQualified.set(idx, {
      moveIndex: idx,
      sideToMove,
      evalBefore: round2(evalBefore.pawns),
      evalAfter: evalAfter.pawns !== null ? round2(evalAfter.pawns) : null,
      mateIn: evalAfter.mateIn,
      bucket,
    });
    maxNeededIndex = idx;
  }

  if (preQualified.size === 0) {
    return [];
  }

  // Pass 2: replay moves with chess.js up to maxNeededIndex and verify material + legality
  const chess = new Chess();
  const qualifying: RawCandidate[] = [];

  for (let idx = 0; idx <= maxNeededIndex; idx += 1) {
    const move = game.moves[idx]!;
    let played;
    try {
      played = chess.move(move.san);
    } catch {
      // Malformed or illegal SAN in source PGN: abandon remaining moves of this game
      break;
    }
    if (!played) {
      break;
    }

    const pre = preQualified.get(idx);
    if (!pre) {
      continue;
    }

    if (chess.isGameOver()) {
      continue;
    }

    const sideToMove = chess.turn();
    if (sideToMove !== pre.sideToMove) {
      continue;
    }

    const fen = chess.fen();
    const material = calculateMaterial(fen, sideToMove);
    if (material.totalNonKingMaterial < minNonKingMaterial) {
      continue;
    }
    if (Math.abs(material.balance) > maxMaterialImbalance) {
      continue;
    }

    const lastMoveUci = `${played.from}${played.to}${played.promotion ?? ''}`;
    qualifying.push({
      id: `lichess_${game.gameId}_ply${move.ply}`,
      fen,
      lastMove: lastMoveUci,
      lastMoveSan: played.san,
      sideToMove,
      bucket: pre.bucket,
      evalBefore: pre.evalBefore,
      evalAfter: pre.evalAfter,
      mateIn: pre.mateIn,
      materialBalance: material.balance,
      totalNonKingMaterial: material.totalNonKingMaterial,
      moveNumber: move.moveNumber,
      ply: move.ply,
      avgElo: game.avgElo,
      gameUrl: buildGameUrl(game.site, game.gameId, move.ply),
    });
  }

  if (qualifying.length <= 1) {
    return qualifying;
  }

  // Select up to maxCandidatesPerGame spaced by at least minPlyGap.
  // Prioritize advantage candidates over equal candidates so rare tactics aren't shadowed.
  const ordered = [
    ...qualifying.filter((c) => c.bucket.hasAdvantage),
    ...qualifying.filter((c) => !c.bucket.hasAdvantage),
  ];

  const selected: RawCandidate[] = [];
  for (const candidate of ordered) {
    if (selected.length >= maxCandidatesPerGame) {
      break;
    }
    const tooClose = selected.some(
      (existing) => Math.abs(existing.ply - candidate.ply) < minPlyGap
    );
    if (!tooClose) {
      selected.push(candidate);
    }
  }

  selected.sort((a, b) => a.ply - b.ply);
  return selected;
}

/**
 * Returns true if `uciMove` captures a non-pawn piece (value >= 3) on a square
 * that has ZERO defenders from the opponent. Used to reject obvious hanging-piece
 * mouse-slips on Tier 2 and Tier 3 puzzles while preserving tactical captures,
 * pinned-defender tactics, and quiet positional moves.
 */
export function isTrivialFreeCapture(fen: string, uciMove: string): boolean {
  const match = UCI_MOVE_RE.exec(uciMove.trim());
  if (!match?.[1] || !match[2]) {
    return false;
  }

  const from = match[1] as Square;
  const to = match[2] as Square;
  const promotion = match[3] as 'q' | 'r' | 'b' | 'n' | undefined;

  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return false;
  }

  const targetPiece = chess.get(to);
  if (!targetPiece) {
    // Quiet move (or en passant, which only captures a pawn)
    return false;
  }

  // Only reject capturing an undefended non-pawn piece (N, B, R, Q)
  if (PIECE_VALUES[targetPiece.type] < 3) {
    return false;
  }

  try {
    const moveResult = chess.move({ from, to, promotion });
    if (!moveResult) {
      return false;
    }
  } catch {
    return false;
  }

  // After our capture on `to`, it is now the opponent's turn.
  const opponentColor: Color = chess.turn();

  // Check if ANY opponent piece attacks (defends) the capture square `to`.
  // Using pseudo-legal attackers preserves tactical motifs where the defender is pinned
  // or where the capture gives check; if attackers is empty, the piece was truly hanging.
  const defenders = chess.attackers(to, opponentColor);
  if (defenders.length > 0) {
    return false;
  }

  // Double-check legal recaptures on `to` as well (defensive sanity check).
  const hasLegalRecapture = chess
    .moves({ verbose: true })
    .some((m) => m.to === to);

  return !hasLegalRecapture;
}
