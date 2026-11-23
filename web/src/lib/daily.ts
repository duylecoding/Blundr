import type { DailyAnswer, DifficultyTier, Position } from '../types';

export const DAILY_EPOCH_DATE_KEY = '2026-11-22';
export const DAILY_PUZZLE_COUNT = 5;
export const PRACTICE_DAILY_LIMIT = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns local calendar date formatted as YYYY-MM-DD.
 */
export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD key into a UTC midnight timestamp to avoid DST drift.
 */
function parseDateKeyUtcMs(dateKey: string): number {
  const parts = dateKey.split('-').map(Number);
  const year = parts[0] ?? 2026;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return Date.UTC(year, month - 1, day);
}

/**
 * Returns the YYYY-MM-DD string for the day immediately before dateKey.
 */
export function getPreviousDateKey(dateKey: string): string {
  const prev = new Date(parseDateKeyUtcMs(dateKey) - MS_PER_DAY);
  const year = prev.getUTCFullYear();
  const month = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const day = String(prev.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the 1-based Daily Puzzle number starting at #1 on 2026-11-22.
 * Earlier dates are gracefully clamped to 1.
 */
export function getDailyPuzzleNumber(dateKey: string): number {
  const diffDays = Math.floor(
    (parseDateKeyUtcMs(dateKey) - parseDateKeyUtcMs(DAILY_EPOCH_DATE_KEY)) / MS_PER_DAY
  );
  return Math.max(1, diffDays + 1);
}

/**
 * Deterministic 32-bit FNV-1a string hash.
 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic Mulberry32 PRNG yielding values in [0, 1).
 */
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
    const current = copy[i];
    const target = copy[j];
    if (current !== undefined && target !== undefined) {
      copy[i] = target;
      copy[j] = current;
    }
  }
  return copy;
}

/**
 * Deterministically selects 5 unique daily positions for a given dateKey:
 * - Difficulty ramps from Tier 1 up to Tier 3 across slots 1..5.
 * - Unpredictable mix of 2 or 3 Advantage positions shuffled across slots.
 * - Gracefully falls back when a dataset is small or skewed.
 */
export function selectDailyPositions(
  positions: readonly Position[],
  dateKey: string
): Position[] {
  if (positions.length === 0) {
    return [];
  }

  const targetCount = Math.min(DAILY_PUZZLE_COUNT, positions.length);
  const rng = mulberry32(hashString(`blundr:${dateKey}`));

  // Sort deterministically by UTF-16 code units so locale never affects selection.
  const sorted = [...positions].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  // Decide 2 or 3 advantage puzzles for a 5-card daily set (never 0 or 5 when possible).
  const advantageTarget =
    targetCount === DAILY_PUZZLE_COUNT
      ? rng() < 0.5
        ? 2
        : 3
      : Math.max(1, Math.min(targetCount - 1, Math.round(targetCount / 2)));

  const advantageFlags: boolean[] = Array.from({ length: targetCount }, (_, idx) => idx < advantageTarget);
  const shuffledFlags = shuffleWithRng(advantageFlags, rng);

  // Ramping preferred tier order per slot (slots 0..4)
  const slot1Pref: readonly DifficultyTier[] = rng() < 0.5 ? [1, 2, 3] : [2, 1, 3];
  const slot3Pref: readonly DifficultyTier[] = rng() < 0.5 ? [2, 3, 1] : [3, 2, 1];
  const tierPreferences: ReadonlyArray<readonly DifficultyTier[]> = [
    [1, 2, 3],
    slot1Pref,
    [2, 1, 3],
    slot3Pref,
    [3, 2, 1],
  ];

  const usedIds = new Set<string>();
  const selected: Position[] = [];

  for (let slot = 0; slot < targetCount; slot++) {
    const wantAdvantage = shuffledFlags[slot] ?? false;
    const preferredTiers = tierPreferences[slot] ?? [2, 1, 3];

    let chosen: Position | undefined;

    // Pass 1: Match both desired advantage polarity and preferred tier order.
    for (const tier of preferredTiers) {
      const candidates = sorted.filter(
        (p) => !usedIds.has(p.id) && p.hasAdvantage === wantAdvantage && p.tier === tier
      );
      if (candidates.length > 0) {
        chosen = candidates[Math.floor(rng() * candidates.length)];
        break;
      }
    }

    // Pass 2: Fallback to any unused position matching preferred tier order.
    if (!chosen) {
      for (const tier of preferredTiers) {
        const candidates = sorted.filter((p) => !usedIds.has(p.id) && p.tier === tier);
        if (candidates.length > 0) {
          chosen = candidates[Math.floor(rng() * candidates.length)];
          break;
        }
      }
    }

    // Pass 3: Ultimate fallback to any unused position.
    if (!chosen) {
      const remaining = sorted.filter((p) => !usedIds.has(p.id));
      if (remaining.length > 0) {
        chosen = remaining[Math.floor(rng() * remaining.length)];
      }
    }

    if (chosen) {
      usedIds.add(chosen.id);
      selected.push(chosen);
    }
  }

  return selected;
}

/**
 * Deterministically selects up to `count` unique practice positions for a given dateKey and tier,
 * excluding any IDs in `excludeIds` (e.g. today's Daily 5).
 * Guarantees an unpredictable 2-3 Advantage / 2-3 Equal mix when available.
 */
export function selectDailyPracticePositions(
  positions: readonly Position[],
  dateKey: string,
  tier: DifficultyTier,
  excludeIds: ReadonlySet<string>,
  count: number = PRACTICE_DAILY_LIMIT
): Position[] {
  if (positions.length === 0 || count <= 0) {
    return [];
  }

  // Filter by tier + exclusions, then sort by UTF-16 code units for cross-locale determinism.
  const eligible = positions
    .filter((p) => p.tier === tier && !excludeIds.has(p.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (eligible.length === 0) {
    return [];
  }

  const targetCount = Math.min(count, eligible.length);
  const rng = mulberry32(hashString(`blundr:practice:${dateKey}:t${tier}`));

  const advantageTarget =
    targetCount === PRACTICE_DAILY_LIMIT
      ? rng() < 0.5
        ? 2
        : 3
      : targetCount <= 1
        ? rng() < 0.5
          ? 1
          : 0
        : Math.max(1, Math.min(targetCount - 1, Math.round(targetCount / 2)));

  const advantageFlags: boolean[] = Array.from(
    { length: targetCount },
    (_, idx) => idx < advantageTarget
  );
  const shuffledFlags = shuffleWithRng(advantageFlags, rng);

  const usedIds = new Set<string>();
  const selected: Position[] = [];

  for (let slot = 0; slot < targetCount; slot++) {
    const wantAdvantage = shuffledFlags[slot] ?? false;

    let chosen: Position | undefined;

    // Pass 1: Match desired Advantage/Equal polarity.
    const matching = eligible.filter(
      (p) => !usedIds.has(p.id) && p.hasAdvantage === wantAdvantage
    );
    if (matching.length > 0) {
      chosen = matching[Math.floor(rng() * matching.length)];
    }

    // Pass 2: Fallback to any remaining eligible position in this tier.
    if (!chosen) {
      const remaining = eligible.filter((p) => !usedIds.has(p.id));
      if (remaining.length > 0) {
        chosen = remaining[Math.floor(rng() * remaining.length)];
      }
    }

    if (chosen) {
      usedIds.add(chosen.id);
      selected.push(chosen);
    }
  }

  return selected;
}

/**
 * Builds a Wordle-style share block for the completed Daily 5.
 */
export function buildShareText(
  puzzleNumber: number,
  results: readonly boolean[],
  streak: number
): string {
  const score = results.filter(Boolean).length;
  const total = results.length;
  const squares = results.map((ok) => (ok ? '🟩' : '🟥')).join('');
  const streakSuffix = streak > 0 ? ` 🔥${streak}` : '';
  return `Blundr #${puzzleNumber} — ${score}/${total}${streakSuffix}\n${squares}`;
}

/**
 * Returns milliseconds remaining until the next local midnight.
 */
export function getMsUntilNextDay(now: Date = new Date()): number {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return Math.max(0, nextMidnight.getTime() - now.getTime());
}

/**
 * Returns the index of the first position in dailyPositions whose ID is not yet
 * recorded in answers. Falls back safely to the last valid index when all are answered.
 */
export function findFirstUnansweredIndex(
  dailyPositions: readonly Position[],
  answers: readonly DailyAnswer[]
): number {
  if (dailyPositions.length === 0) {
    return 0;
  }
  const answeredIds = new Set(answers.map((a) => a.positionId));
  const idx = dailyPositions.findIndex((p) => !answeredIds.has(p.id));
  return idx >= 0 ? idx : dailyPositions.length - 1;
}

/**
 * Formats milliseconds as HH:MM:SS.
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}
