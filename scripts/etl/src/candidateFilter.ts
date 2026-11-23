// Filters parsed Lichess games into spaced candidate positions by eval bucket, material balance,
// and trivial hanging-piece checks so Stockfish only evaluates promising positions.

import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import type { DifficultyTier } from '../../../shared/types.js';
import {
  DEFAULT_MIN_ELO, EVAL_THRESHOLDS, LICHESS_BASE_URL, LICHESS_SITE_HOST, MAX_CANDIDATES_PER_GAME,
  MAX_MATERIAL_IMBALANCE, MIN_NON_KING_MATERIAL, MIN_PLY_GAP, MOVE_WINDOW,
  PIECE_VALUES, TRIVIAL_CAPTURE_MIN_VALUE,
} from './constants.js';
import { normalizeEvalForSide, type EvalScore, type ParsedGame } from './pgnParser.js';

export interface MaterialSummary {
  sideToMoveMaterial: number;
  opponentMaterial: number;
  balance: number;
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

interface PreQualifiedPly {
  sideToMove: 'w' | 'b';
  evalBefore: number;
  evalAfter: number | null;
  mateIn: number | null;
  bucket: CandidateBucket;
}

const UCI_MOVE_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const SAFE_GAME_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function calculateMaterial(
  fenOrChess: string | Chess,
  sideToMoveOverride?: 'w' | 'b'
): MaterialSummary {
  const fen = typeof fenOrChess === 'string' ? fenOrChess : fenOrChess.fen();
  const [placement = '', turnToken] = fen.trim().split(/\s+/);
  const sideToMove = sideToMoveOverride ?? (turnToken === 'b' ? 'b' : 'w');

  let whiteMaterial = 0;
  let blackMaterial = 0;
  for (let i = 0; i < placement.length; i += 1) {
    const ch = placement[i]!;
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    const value = PIECE_VALUES[ch.toLowerCase() as PieceSymbol];
    if (!value) continue;
    if (ch >= 'A' && ch <= 'Z') whiteMaterial += value;
    else blackMaterial += value;
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

export function classifyBucket(evalBefore: EvalScore, evalAfter: EvalScore): CandidateBucket | null {
  if (evalBefore.mateIn !== null || evalBefore.pawns === null) return null;
  if (Math.abs(evalBefore.pawns) > EVAL_THRESHOLDS.priorMax) return null;

  if (
    Math.abs(evalBefore.pawns) <= EVAL_THRESHOLDS.equalMax &&
    evalAfter.mateIn === null &&
    evalAfter.pawns !== null &&
    Math.abs(evalAfter.pawns) <= EVAL_THRESHOLDS.equalMax
  ) {
    return { kind: 'equal', hasAdvantage: false };
  }

  const isTier1Mate =
    evalAfter.mateIn !== null && evalAfter.mateIn >= 1 && evalAfter.mateIn <= EVAL_THRESHOLDS.tier1MateMax;
  if (isTier1Mate || (evalAfter.mateIn === null && evalAfter.pawns !== null && evalAfter.pawns >= EVAL_THRESHOLDS.tier1Min)) {
    return { kind: 'advantage', hasAdvantage: true, tier: 1 };
  }

  if (evalAfter.mateIn !== null || evalAfter.pawns === null) return null;
  if (evalAfter.pawns >= EVAL_THRESHOLDS.tier2Min && evalAfter.pawns < EVAL_THRESHOLDS.tier2Max) {
    return { kind: 'advantage', hasAdvantage: true, tier: 2 };
  }
  if (evalAfter.pawns >= EVAL_THRESHOLDS.tier3Min && evalAfter.pawns < EVAL_THRESHOLDS.tier3Max) {
    return { kind: 'advantage', hasAdvantage: true, tier: 3 };
  }
  return null;
}

export function buildGameUrl(site: string, gameId: string, ply: number): string | null {
  const trimmed = site.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== LICHESS_SITE_HOST) {
    return null;
  }
  if (!SAFE_GAME_ID_RE.test(gameId) || !Number.isInteger(ply) || ply < 1) {
    return null;
  }
  return `${LICHESS_BASE_URL}/${gameId}#${ply}`;
}

function selectSpacedCandidates(
  qualifying: readonly RawCandidate[],
  maxCandidates: number,
  minPlyGap: number
): RawCandidate[] {
  if (qualifying.length <= 1) return [...qualifying];
  // Prioritize advantage candidates over equal positions so rare tactics are not crowded out.
  const ordered = [
    ...qualifying.filter((c) => c.bucket.hasAdvantage),
    ...qualifying.filter((c) => !c.bucket.hasAdvantage),
  ];
  const selected: RawCandidate[] = [];
  for (const candidate of ordered) {
    if (selected.length >= maxCandidates) break;
    if (selected.every((existing) => Math.abs(existing.ply - candidate.ply) >= minPlyGap)) {
      selected.push(candidate);
    }
  }
  return selected.sort((a, b) => a.ply - b.ply);
}

export function extractCandidatesFromGame(
  game: ParsedGame,
  options: ExtractCandidateOptions = {}
): RawCandidate[] {
  const {
    minElo = DEFAULT_MIN_ELO,
    minMoveNumber = MOVE_WINDOW.min,
    maxMoveNumber = MOVE_WINDOW.max,
    maxCandidatesPerGame = MAX_CANDIDATES_PER_GAME,
    minPlyGap = MIN_PLY_GAP,
    minNonKingMaterial = MIN_NON_KING_MATERIAL,
    maxMaterialImbalance = MAX_MATERIAL_IMBALANCE,
  } = options;

  if (game.whiteElo < minElo || game.blackElo < minElo) return [];
  if (!buildGameUrl(game.site, game.gameId, 1)) return [];

  // Pass 1: filter by move window and [%eval] before instantiating chess.js.
  const preQualified = new Map<number, PreQualifiedPly>();
  let maxNeededIndex = -1;
  for (let idx = 1; idx < game.moves.length; idx += 1) {
    const oppMove = game.moves[idx]!;
    if (oppMove.moveNumber < minMoveNumber) continue;
    if (oppMove.moveNumber > maxMoveNumber) break;

    const prevMove = game.moves[idx - 1]!;
    if (prevMove.evalWhite === null || oppMove.evalWhite === null) continue;

    const sideToMove: 'w' | 'b' = oppMove.color === 'w' ? 'b' : 'w';
    const evalBefore = normalizeEvalForSide(prevMove.evalWhite, sideToMove);
    const evalAfter = normalizeEvalForSide(oppMove.evalWhite, sideToMove);
    const bucket = classifyBucket(evalBefore, evalAfter);
    if (!bucket || evalBefore.pawns === null) continue;

    preQualified.set(idx, {
      sideToMove,
      evalBefore: round2(evalBefore.pawns),
      evalAfter: evalAfter.pawns !== null ? round2(evalAfter.pawns) : null,
      mateIn: evalAfter.mateIn,
      bucket,
    });
    maxNeededIndex = idx;
  }

  if (preQualified.size === 0) return [];

  // Pass 2: replay with chess.js up to the last qualifying ply to verify material and legality.
  const chess = new Chess();
  const qualifying: RawCandidate[] = [];
  for (let idx = 0; idx <= maxNeededIndex; idx += 1) {
    const move = game.moves[idx]!;
    let played;
    try { played = chess.move(move.san); } catch { break; }
    if (!played) break;

    const pre = preQualified.get(idx);
    if (!pre || chess.isGameOver() || chess.turn() !== pre.sideToMove) continue;

    const fen = chess.fen();
    const material = calculateMaterial(fen, pre.sideToMove);
    if (material.totalNonKingMaterial < minNonKingMaterial || Math.abs(material.balance) > maxMaterialImbalance) {
      continue;
    }

    const gameUrl = buildGameUrl(game.site, game.gameId, move.ply);
    if (!gameUrl) continue;

    qualifying.push({
      id: `lichess_${game.gameId}_ply${move.ply}`,
      fen,
      lastMove: `${played.from}${played.to}${played.promotion ?? ''}`,
      lastMoveSan: played.san,
      sideToMove: pre.sideToMove,
      bucket: pre.bucket,
      evalBefore: pre.evalBefore,
      evalAfter: pre.evalAfter,
      mateIn: pre.mateIn,
      materialBalance: material.balance,
      totalNonKingMaterial: material.totalNonKingMaterial,
      moveNumber: move.moveNumber,
      ply: move.ply,
      avgElo: game.avgElo,
      gameUrl,
    });
  }

  return selectSpacedCandidates(qualifying, maxCandidatesPerGame, minPlyGap);
}

export function isTrivialFreeCapture(fen: string, uciMove: string): boolean {
  const match = UCI_MOVE_RE.exec(uciMove.trim());
  if (!match?.[1] || !match[2]) return false;

  const [from, to, promotion] = [match[1] as Square, match[2] as Square, match[3] as 'q' | 'r' | 'b' | 'n' | undefined];
  let chess: Chess;
  try { chess = new Chess(fen); } catch { return false; }

  const targetPiece = chess.get(to);
  if (!targetPiece || PIECE_VALUES[targetPiece.type] < TRIVIAL_CAPTURE_MIN_VALUE) return false;
  try { if (!chess.move({ from, to, promotion })) return false; } catch { return false; }

  // Pseudo-legal attackers preserves tactics where the defender is pinned; empty means truly hanging.
  const opponentColor: Color = chess.turn();
  if (chess.attackers(to, opponentColor).length > 0) return false;
  return !chess.moves({ verbose: true }).some((m) => m.to === to);
}
