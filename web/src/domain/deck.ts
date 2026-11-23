/**
 * Deterministic seeded puzzle selection for Daily 5 and per-difficulty daily Practice decks.
 */
import { DAILY_PUZZLE_COUNT, PRACTICE_DAILY_LIMIT } from '../config/constants';
import type { DailyAnswer, DifficultyTier, Position } from '../types';

export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithRng<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

// Sort by UTF-16 code units instead of localeCompare so all locales pick identical decks.
function sortByCodeUnitId(positions: readonly Position[]): Position[] {
  return [...positions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function pickRandom<T>(pool: readonly T[], rng: () => number): T | undefined {
  return pool.length > 0 ? pool[Math.floor(rng() * pool.length)] : undefined;
}

function buildAdvantageFlags(
  targetCount: number,
  fullCount: number,
  rng: () => number
): boolean[] {
  const advTarget =
    targetCount === fullCount
      ? rng() < 0.5 ? 2 : 3
      : targetCount <= 1
        ? rng() < 0.5 ? 1 : 0
        : Math.max(1, Math.min(targetCount - 1, Math.round(targetCount / 2)));
  return shuffleWithRng(
    Array.from({ length: targetCount }, (_, i) => i < advTarget),
    rng
  );
}

export function selectDailyPositions(
  positions: readonly Position[],
  dateKey: string
): Position[] {
  if (positions.length === 0) return [];

  const targetCount = Math.min(DAILY_PUZZLE_COUNT, positions.length);
  const rng = mulberry32(hashString(`blundr:${dateKey}`));
  const sorted = sortByCodeUnitId(positions);
  const shuffledFlags = buildAdvantageFlags(targetCount, DAILY_PUZZLE_COUNT, rng);

  const tierRamp: readonly DifficultyTier[] =
    rng() < 0.5 ? [1, 1, 2, 2, 3] : [1, 2, 2, 3, 3];
  const tierFallbacks: Record<DifficultyTier, readonly DifficultyTier[]> = {
    1: [1, 2, 3],
    2: [2, 1, 3],
    3: [3, 2, 1],
  };

  const usedIds = new Set<string>();
  const selected: Position[] = [];

  for (let slot = 0; slot < targetCount; slot++) {
    const wantAdv = shuffledFlags[slot] ?? false;
    const targetTier = tierRamp[slot] ?? 2;
    const prefs = tierFallbacks[targetTier];
    let chosen: Position | undefined;

    for (const tier of prefs) {
      chosen = pickRandom(
        sorted.filter((p) => !usedIds.has(p.id) && p.hasAdvantage === wantAdv && p.tier === tier),
        rng
      );
      if (chosen) break;
    }
    if (!chosen) {
      for (const tier of prefs) {
        chosen = pickRandom(sorted.filter((p) => !usedIds.has(p.id) && p.tier === tier), rng);
        if (chosen) break;
      }
    }
    if (!chosen) {
      chosen = pickRandom(sorted.filter((p) => !usedIds.has(p.id)), rng);
    }
    if (chosen) {
      usedIds.add(chosen.id);
      selected.push(chosen);
    }
  }

  // Enforce non-decreasing difficulty even when sparse datasets trigger tier fallbacks.
  return selected.sort((a, b) => a.tier - b.tier);
}

export function selectDailyPracticePositions(
  positions: readonly Position[],
  dateKey: string,
  tier: DifficultyTier,
  excludeIds: ReadonlySet<string>,
  count: number = PRACTICE_DAILY_LIMIT
): Position[] {
  if (positions.length === 0 || count <= 0) return [];

  const eligible = sortByCodeUnitId(
    positions.filter((p) => p.tier === tier && !excludeIds.has(p.id))
  );
  if (eligible.length === 0) return [];

  const targetCount = Math.min(count, eligible.length);
  const rng = mulberry32(hashString(`blundr:practice:${dateKey}:t${tier}`));
  const shuffledFlags = buildAdvantageFlags(targetCount, PRACTICE_DAILY_LIMIT, rng);

  const usedIds = new Set<string>();
  const selected: Position[] = [];

  for (let slot = 0; slot < targetCount; slot++) {
    const wantAdv = shuffledFlags[slot] ?? false;
    const matching = eligible.filter((p) => !usedIds.has(p.id) && p.hasAdvantage === wantAdv);
    const chosen = pickRandom(
      matching.length > 0 ? matching : eligible.filter((p) => !usedIds.has(p.id)),
      rng
    );
    if (chosen) {
      usedIds.add(chosen.id);
      selected.push(chosen);
    }
  }

  return selected;
}

export function findFirstUnansweredIndex(
  positions: readonly Position[],
  answers: readonly DailyAnswer[]
): number {
  if (positions.length === 0) return 0;
  const answeredIds = new Set(answers.map((a) => a.positionId));
  const idx = positions.findIndex((p) => !answeredIds.has(p.id));
  return idx >= 0 ? idx : positions.length - 1;
}
