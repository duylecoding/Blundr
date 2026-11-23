// Converts verified candidates into typed Position entries, classifies tactical vs positional
// style, balances equal positions across tiers 1-3, and builds the final PositionDataset.

import { Chess } from 'chess.js';
import type { DifficultyTier, Position, PositionDataset } from '../../../shared/types.js';
import {
  classifyBucket,
  isTrivialFreeCapture,
  type CandidateBucket,
  type RawCandidate,
} from './candidateFilter.js';
import { DEFAULT_SHUFFLE_SEED, EVAL_THRESHOLDS } from './constants.js';
import type { EvalScore } from './pgnParser.js';
import type { StockfishAnalysis } from './uciParser.js';

export type BucketKey = 'tier1' | 'tier2' | 'tier3' | 'equal';
export const BUCKET_KEYS: readonly BucketKey[] = ['tier1', 'tier2', 'tier3', 'equal'];

export type RawBucketMap = Record<BucketKey, RawCandidate[]>;
export type VerifiedBucketMap = Record<BucketKey, Position[]>;

export type VerificationResult =
  | { status: 'accepted'; bucketKey: BucketKey; position: Position }
  | { status: 'skipped' }
  | { status: 'rejected'; reason: 'eval-shift' | 'free-capture' };

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export function createEmptyBuckets<T>(): Record<BucketKey, T[]> {
  return { tier1: [], tier2: [], tier3: [], equal: [] };
}

export function createQuotas(perTier: number, multiplier = 1): Record<BucketKey, number> {
  return {
    tier1: perTier * multiplier,
    tier2: perTier * multiplier,
    tier3: perTier * multiplier,
    equal: perTier * 3 * multiplier,
  };
}

export function bucketKeyFor(bucket: CandidateBucket): BucketKey {
  if (!bucket.hasAdvantage) return 'equal';
  return bucket.tier === 1 ? 'tier1' : bucket.tier === 2 ? 'tier2' : 'tier3';
}

export function classifyStyle(
  hasAdvantage: boolean,
  mateIn: number | null,
  pvGap: number | null
): 'tactical' | 'positional' | 'equal' {
  if (!hasAdvantage) return 'equal';
  if (mateIn !== null || (pvGap !== null && pvGap >= EVAL_THRESHOLDS.tacticalPvGapMin)) {
    return 'tactical';
  }
  return 'positional';
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deterministicShuffle<T>(
  items: readonly T[],
  seed: number = DEFAULT_SHUFFLE_SEED
): T[] {
  const copy = [...items];
  const rand = mulberry32(seed);
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function buildDryRunBuckets(
  rawBuckets: RawBucketMap,
  targets: Record<BucketKey, number>
): VerifiedBucketMap {
  const verified = createEmptyBuckets<Position>();
  for (const key of BUCKET_KEYS) {
    for (const raw of rawBuckets[key]) {
      if (verified[key].length >= targets[key]) break;
      const firstMove = new Chess(raw.fen).moves({ verbose: true })[0];
      if (!firstMove) continue;
      const bestMove = `${firstMove.from}${firstMove.to}${firstMove.promotion ?? ''}`;
      verified[key].push({
        id: raw.id,
        fen: raw.fen,
        lastMove: raw.lastMove,
        lastMoveSan: raw.lastMoveSan,
        sideToMove: raw.sideToMove,
        hasAdvantage: raw.bucket.hasAdvantage,
        tier: raw.bucket.hasAdvantage ? raw.bucket.tier : 1,
        evalBefore: raw.evalBefore,
        evalAfter: raw.evalAfter,
        mateIn: raw.mateIn,
        bestMove,
        pv: [bestMove],
        pvGap: null,
        style: classifyStyle(raw.bucket.hasAdvantage, raw.mateIn, null),
        materialBalance: raw.materialBalance,
        moveNumber: raw.moveNumber,
        avgElo: raw.avgElo,
        gameUrl: raw.gameUrl,
      });
    }
  }
  return verified;
}

export function verifyCandidateWithAnalysis(
  raw: RawCandidate,
  analysis: StockfishAnalysis,
  isBucketFull: (key: BucketKey) => boolean
): VerificationResult {
  if (!analysis.bestMove) return { status: 'rejected', reason: 'eval-shift' };

  const sfEvalAfter: EvalScore = {
    pawns: analysis.mateIn === null && analysis.evalCp !== null ? round2(analysis.evalCp / 100) : null,
    mateIn: analysis.mateIn,
  };
  const reVerified = classifyBucket({ pawns: raw.evalBefore, mateIn: null }, sfEvalAfter);
  if (!reVerified) return { status: 'rejected', reason: 'eval-shift' };

  const bucketKey = bucketKeyFor(reVerified);
  if (isBucketFull(bucketKey)) return { status: 'skipped' };

  // Reject undefended hanging-piece mouse-slips on Tier 2 and Tier 3 puzzles.
  if (
    reVerified.hasAdvantage &&
    (reVerified.tier === 2 || reVerified.tier === 3) &&
    isTrivialFreeCapture(raw.fen, analysis.bestMove)
  ) {
    return { status: 'rejected', reason: 'free-capture' };
  }

  return {
    status: 'accepted',
    bucketKey,
    position: {
      id: raw.id,
      fen: raw.fen,
      lastMove: raw.lastMove,
      lastMoveSan: raw.lastMoveSan,
      sideToMove: raw.sideToMove,
      hasAdvantage: reVerified.hasAdvantage,
      tier: reVerified.hasAdvantage ? reVerified.tier : 3,
      evalBefore: raw.evalBefore,
      evalAfter: sfEvalAfter.pawns,
      mateIn: sfEvalAfter.mateIn,
      bestMove: analysis.bestMove,
      pv: analysis.pv.length > 0 ? analysis.pv : [analysis.bestMove],
      pvGap: analysis.pvGap,
      style: classifyStyle(reVerified.hasAdvantage, sfEvalAfter.mateIn, analysis.pvGap),
      materialBalance: raw.materialBalance,
      moveNumber: raw.moveNumber,
      avgElo: raw.avgElo,
      gameUrl: raw.gameUrl,
    },
  };
}

export function buildPositionDataset(
  verified: VerifiedBucketMap,
  meta: { source: string; minElo: number; generatedAt?: string; seed?: number }
): PositionDataset {
  const tiers: readonly DifficultyTier[] = [1, 2, 3];
  const combined: Position[] = [
    ...verified.tier1.map((p) => ({ ...p, hasAdvantage: true, tier: 1 as const })),
    ...verified.tier2.map((p) => ({ ...p, hasAdvantage: true, tier: 2 as const })),
    ...verified.tier3.map((p) => ({ ...p, hasAdvantage: true, tier: 3 as const })),
    ...verified.equal.map((pos, index) => ({
      ...pos,
      hasAdvantage: false,
      tier: tiers[index % 3]!,
      style: 'equal' as const,
    })),
  ];

  const shuffled = deterministicShuffle(combined, meta.seed ?? DEFAULT_SHUFFLE_SEED);
  const byTier: Record<DifficultyTier, { advantage: number; equal: number }> = {
    1: { advantage: 0, equal: 0 },
    2: { advantage: 0, equal: 0 },
    3: { advantage: 0, equal: 0 },
  };

  let advantage = 0;
  let equal = 0;
  for (const pos of shuffled) {
    if (pos.hasAdvantage) { advantage += 1; byTier[pos.tier].advantage += 1; }
    else { equal += 1; byTier[pos.tier].equal += 1; }
  }

  return {
    version: 1,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    source: meta.source,
    minElo: meta.minElo,
    counts: { total: shuffled.length, advantage, equal, byTier },
    positions: shuffled,
  };
}
