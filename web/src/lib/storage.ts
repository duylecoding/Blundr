import type {
  DailyAnswer,
  DailyProgress,
  DailyStreak,
  DifficultyTier,
  PracticeDailyProgress,
  PracticeStats,
} from '../types';
import {
  DAILY_PUZZLE_COUNT,
  getPreviousDateKey,
  PRACTICE_DAILY_LIMIT,
} from './daily';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DAILY_PROGRESS_PREFIX = 'cpt:daily:v1:';
const DAILY_STREAK_KEY = 'cpt:streak:v1';
const PRACTICE_STATS_KEY = 'cpt:practice:v1';

function getPracticeDailyKey(dateKey: string, tier: DifficultyTier): string {
  return `blundr_practice_daily_${dateKey}_t${tier}`;
}

const memoryFallback = new Map<string, string>();

const fallbackStorage: StorageLike = {
  getItem: (key) => memoryFallback.get(key) ?? null,
  setItem: (key, value) => {
    memoryFallback.set(key, value);
  },
  removeItem: (key) => {
    memoryFallback.delete(key);
  },
};

function getSafeStorage(override?: StorageLike): StorageLike {
  if (override) {
    return override;
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probeKey = '__cpt_probe__';
      window.localStorage.setItem(probeKey, '1');
      window.localStorage.removeItem(probeKey);
      return window.localStorage;
    }
  } catch {
    // Private browsing or blocked storage — fall back gracefully.
  }
  return fallbackStorage;
}

function readJson<T>(key: string, storage?: StorageLike): T | null {
  try {
    const raw = getSafeStorage(storage).getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T, storage?: StorageLike): void {
  try {
    getSafeStorage(storage).setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota or privacy errors cleanly.
  }
}

export function createEmptyDailyProgress(dateKey: string): DailyProgress {
  return {
    dateKey,
    answers: [],
    completed: false,
  };
}

export function loadDailyProgress(dateKey: string, storage?: StorageLike): DailyProgress {
  const stored = readJson<Partial<DailyProgress>>(`${DAILY_PROGRESS_PREFIX}${dateKey}`, storage);
  if (!stored || !Array.isArray(stored.answers)) {
    return createEmptyDailyProgress(dateKey);
  }
  const answers: DailyAnswer[] = stored.answers.filter(
    (item): item is DailyAnswer =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.positionId === 'string' &&
      typeof item.guessedAdvantage === 'boolean' &&
      typeof item.correct === 'boolean'
  );
  return {
    dateKey,
    answers,
    completed: Boolean(stored.completed),
  };
}

export function saveDailyProgress(progress: DailyProgress, storage?: StorageLike): void {
  writeJson(`${DAILY_PROGRESS_PREFIX}${progress.dateKey}`, progress, storage);
}

export function createEmptyDailyStreak(): DailyStreak {
  return {
    currentStreak: 0,
    maxStreak: 0,
    lastCompletedDateKey: null,
  };
}

export function loadDailyStreak(storage?: StorageLike): DailyStreak {
  const stored = readJson<Partial<DailyStreak>>(DAILY_STREAK_KEY, storage);
  if (!stored) {
    return createEmptyDailyStreak();
  }
  return {
    currentStreak: typeof stored.currentStreak === 'number' ? stored.currentStreak : 0,
    maxStreak: typeof stored.maxStreak === 'number' ? stored.maxStreak : 0,
    lastCompletedDateKey:
      typeof stored.lastCompletedDateKey === 'string' ? stored.lastCompletedDateKey : null,
  };
}

export function saveDailyStreak(streak: DailyStreak, storage?: StorageLike): void {
  writeJson(DAILY_STREAK_KEY, streak, storage);
}

/**
 * Updates daily streak upon completing today's Daily 5:
 * - Same day as lastCompletedDateKey -> preserved (idempotent).
 * - Immediately after lastCompletedDateKey (yesterday) -> increments streak.
 * - Older or first completion -> resets streak to 1.
 */
export function updateDailyStreakOnComplete(
  dateKey: string,
  storage?: StorageLike
): DailyStreak {
  const current = loadDailyStreak(storage);

  if (current.lastCompletedDateKey === dateKey) {
    return current;
  }

  const yesterdayKey = getPreviousDateKey(dateKey);
  const nextCurrentStreak =
    current.lastCompletedDateKey === yesterdayKey ? current.currentStreak + 1 : 1;

  const updated: DailyStreak = {
    currentStreak: nextCurrentStreak,
    maxStreak: Math.max(current.maxStreak, nextCurrentStreak),
    lastCompletedDateKey: dateKey,
  };

  saveDailyStreak(updated, storage);
  return updated;
}

/**
 * Returns active streak count for display (0 if neither today nor yesterday was completed).
 */
export function getActiveDailyStreak(streak: DailyStreak, todayDateKey: string): number {
  if (!streak.lastCompletedDateKey) {
    return 0;
  }
  if (
    streak.lastCompletedDateKey === todayDateKey ||
    streak.lastCompletedDateKey === getPreviousDateKey(todayDateKey)
  ) {
    return streak.currentStreak;
  }
  return 0;
}

/**
 * Appends an answer for today's Daily 5 (deduplicating by positionId) and updates streak when finished.
 */
export function recordDailyAnswer(
  dateKey: string,
  answer: DailyAnswer,
  targetCount: number = DAILY_PUZZLE_COUNT,
  storage?: StorageLike
): { progress: DailyProgress; streak: DailyStreak } {
  const existing = loadDailyProgress(dateKey, storage);
  const alreadyRecorded = existing.answers.some((a) => a.positionId === answer.positionId);

  const nextAnswers = alreadyRecorded ? existing.answers : [...existing.answers, answer];
  const isNowCompleted = existing.completed || nextAnswers.length >= targetCount;

  const progress: DailyProgress = {
    dateKey,
    answers: nextAnswers,
    completed: isNowCompleted,
  };
  saveDailyProgress(progress, storage);

  const streak = isNowCompleted
    ? updateDailyStreakOnComplete(dateKey, storage)
    : loadDailyStreak(storage);

  return { progress, streak };
}

export function createEmptyPracticeStats(): PracticeStats {
  return {
    seenIds: [],
    correct: 0,
    total: 0,
    truePositives: 0,
    trueNegatives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    currentStreak: 0,
    bestStreak: 0,
  };
}

export function loadPracticeStats(storage?: StorageLike): PracticeStats {
  const stored = readJson<Partial<PracticeStats>>(PRACTICE_STATS_KEY, storage);
  if (!stored) {
    return createEmptyPracticeStats();
  }
  return {
    seenIds: Array.isArray(stored.seenIds)
      ? stored.seenIds.filter((id): id is string => typeof id === 'string')
      : [],
    correct: typeof stored.correct === 'number' ? stored.correct : 0,
    total: typeof stored.total === 'number' ? stored.total : 0,
    truePositives: typeof stored.truePositives === 'number' ? stored.truePositives : 0,
    trueNegatives: typeof stored.trueNegatives === 'number' ? stored.trueNegatives : 0,
    falsePositives: typeof stored.falsePositives === 'number' ? stored.falsePositives : 0,
    falseNegatives: typeof stored.falseNegatives === 'number' ? stored.falseNegatives : 0,
    currentStreak: typeof stored.currentStreak === 'number' ? stored.currentStreak : 0,
    bestStreak: typeof stored.bestStreak === 'number' ? stored.bestStreak : 0,
  };
}

export function savePracticeStats(stats: PracticeStats, storage?: StorageLike): void {
  writeJson(PRACTICE_STATS_KEY, stats, storage);
}

export function recordPracticeAnswer(
  positionId: string,
  hasAdvantage: boolean,
  guessedAdvantage: boolean,
  storage?: StorageLike
): PracticeStats {
  const prev = loadPracticeStats(storage);
  const correct = hasAdvantage === guessedAdvantage;
  const nextStreak = correct ? prev.currentStreak + 1 : 0;

  const seenSet = new Set(prev.seenIds);
  seenSet.add(positionId);

  const updated: PracticeStats = {
    seenIds: Array.from(seenSet),
    correct: prev.correct + (correct ? 1 : 0),
    total: prev.total + 1,
    truePositives: prev.truePositives + (hasAdvantage && guessedAdvantage ? 1 : 0),
    trueNegatives: prev.trueNegatives + (!hasAdvantage && !guessedAdvantage ? 1 : 0),
    falsePositives: prev.falsePositives + (!hasAdvantage && guessedAdvantage ? 1 : 0),
    falseNegatives: prev.falseNegatives + (hasAdvantage && !guessedAdvantage ? 1 : 0),
    currentStreak: nextStreak,
    bestStreak: Math.max(prev.bestStreak, nextStreak),
  };

  savePracticeStats(updated, storage);
  return updated;
}

export function resetPracticeDeck(storage?: StorageLike): PracticeStats {
  const prev = loadPracticeStats(storage);
  const updated: PracticeStats = {
    ...prev,
    seenIds: [],
  };
  savePracticeStats(updated, storage);
  return updated;
}

export function createEmptyPracticeDailyProgress(
  dateKey: string,
  tier: DifficultyTier
): PracticeDailyProgress {
  return {
    dateKey,
    tier,
    answers: [],
    completed: false,
  };
}

export function loadPracticeDailyProgress(
  dateKey: string,
  tier: DifficultyTier,
  storage?: StorageLike
): PracticeDailyProgress {
  const stored = readJson<Partial<PracticeDailyProgress>>(
    getPracticeDailyKey(dateKey, tier),
    storage
  );
  if (!stored || !Array.isArray(stored.answers)) {
    return createEmptyPracticeDailyProgress(dateKey, tier);
  }
  const answers: DailyAnswer[] = stored.answers.filter(
    (item): item is DailyAnswer =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.positionId === 'string' &&
      typeof item.guessedAdvantage === 'boolean' &&
      typeof item.correct === 'boolean'
  );
  return {
    dateKey,
    tier,
    answers,
    completed: Boolean(stored.completed),
  };
}

export function savePracticeDailyProgress(
  progress: PracticeDailyProgress,
  storage?: StorageLike
): void {
  writeJson(getPracticeDailyKey(progress.dateKey, progress.tier), progress, storage);
}

/**
 * Records a Practice answer for a specific dateKey + difficulty tier,
 * deduplicating by positionId and marking completed at targetCount.
 */
export function recordPracticeDailyAnswer(
  dateKey: string,
  tier: DifficultyTier,
  answer: DailyAnswer,
  targetCount: number = PRACTICE_DAILY_LIMIT,
  storage?: StorageLike
): { progress: PracticeDailyProgress; isNew: boolean } {
  const existing = loadPracticeDailyProgress(dateKey, tier, storage);
  const alreadyRecorded = existing.answers.some((a) => a.positionId === answer.positionId);

  if (alreadyRecorded || existing.completed || existing.answers.length >= targetCount) {
    return { progress: existing, isNew: false };
  }

  const nextAnswers = [...existing.answers, answer];
  const isNowCompleted = existing.completed || nextAnswers.length >= targetCount;

  const progress: PracticeDailyProgress = {
    dateKey,
    tier,
    answers: nextAnswers,
    completed: isNowCompleted,
  };
  savePracticeDailyProgress(progress, storage);

  return { progress, isNew: true };
}
