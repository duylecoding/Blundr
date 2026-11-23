/**
 * Safe localStorage persistence for Daily 5 progress, streaks, and daily Practice caps.
 */
import { DAILY_PUZZLE_COUNT, PRACTICE_DAILY_LIMIT, STORAGE_KEYS } from '../config/constants';
import type { DailyAnswer, DailyProgress, DailyStreak, DifficultyTier, PracticeDailyProgress, PracticeStats } from '../types';
import { getPreviousDateKey } from './calendar';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memoryFallback = new Map<string, string>();
const fallbackStorage: StorageLike = {
  getItem: (key) => memoryFallback.get(key) ?? null,
  setItem: (key, value) => void memoryFallback.set(key, value),
  removeItem: (key) => void memoryFallback.delete(key),
};

function getSafeStorage(override?: StorageLike): StorageLike {
  if (override) return override;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEYS.probeKey, '1');
      window.localStorage.removeItem(STORAGE_KEYS.probeKey);
      return window.localStorage;
    }
  } catch {
    // Private browsing or blocked storage falls back to in-memory storage.
  }
  return fallbackStorage;
}

function readJson<T>(key: string, storage?: StorageLike): T | null {
  try {
    const raw = getSafeStorage(storage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T, storage?: StorageLike): void {
  try {
    getSafeStorage(storage).setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota or privacy errors without interrupting play.
  }
}

const toNum = (v: unknown): number => (typeof v === 'number' ? v : 0);
const practiceDailyKey = (dateKey: string, tier: DifficultyTier): string =>
  `${STORAGE_KEYS.practiceDailyPrefix}${dateKey}_t${tier}`;

function parseAnswers(raw: unknown): DailyAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is DailyAnswer =>
      typeof item === 'object' && item !== null &&
      typeof item.positionId === 'string' &&
      typeof item.guessedAdvantage === 'boolean' &&
      typeof item.correct === 'boolean'
  );
}

export function loadDailyProgress(dateKey: string, storage?: StorageLike): DailyProgress {
  const stored = readJson<Partial<DailyProgress>>(`${STORAGE_KEYS.dailyProgressPrefix}${dateKey}`, storage);
  if (!stored || !Array.isArray(stored.answers)) return { dateKey, answers: [], completed: false };
  return { dateKey, answers: parseAnswers(stored.answers), completed: Boolean(stored.completed) };
}

export function loadDailyStreak(storage?: StorageLike): DailyStreak {
  const s = readJson<Partial<DailyStreak>>(STORAGE_KEYS.dailyStreak, storage);
  return {
    currentStreak: toNum(s?.currentStreak),
    maxStreak: toNum(s?.maxStreak),
    lastCompletedDateKey: typeof s?.lastCompletedDateKey === 'string' ? s.lastCompletedDateKey : null,
  };
}

export function updateDailyStreakOnComplete(dateKey: string, storage?: StorageLike): DailyStreak {
  const current = loadDailyStreak(storage);
  if (current.lastCompletedDateKey === dateKey) return current;
  const nextStreak = current.lastCompletedDateKey === getPreviousDateKey(dateKey) ? current.currentStreak + 1 : 1;
  const updated: DailyStreak = {
    currentStreak: nextStreak,
    maxStreak: Math.max(current.maxStreak, nextStreak),
    lastCompletedDateKey: dateKey,
  };
  writeJson(STORAGE_KEYS.dailyStreak, updated, storage);
  return updated;
}

export function getActiveDailyStreak(streak: DailyStreak, todayDateKey: string): number {
  if (!streak.lastCompletedDateKey) return 0;
  return streak.lastCompletedDateKey === todayDateKey || streak.lastCompletedDateKey === getPreviousDateKey(todayDateKey)
    ? streak.currentStreak
    : 0;
}

export function recordDailyAnswer(
  dateKey: string,
  answer: DailyAnswer,
  targetCount: number = DAILY_PUZZLE_COUNT,
  storage?: StorageLike
): { progress: DailyProgress; streak: DailyStreak } {
  const existing = loadDailyProgress(dateKey, storage);
  const answers = existing.answers.some((a) => a.positionId === answer.positionId)
    ? existing.answers
    : [...existing.answers, answer];
  const completed = existing.completed || answers.length >= targetCount;
  const progress: DailyProgress = { dateKey, answers, completed };
  writeJson(`${STORAGE_KEYS.dailyProgressPrefix}${dateKey}`, progress, storage);
  const streak = completed ? updateDailyStreakOnComplete(dateKey, storage) : loadDailyStreak(storage);
  return { progress, streak };
}

export function loadPracticeStats(storage?: StorageLike): PracticeStats {
  const s = readJson<Partial<PracticeStats>>(STORAGE_KEYS.practiceStats, storage);
  return {
    correct: toNum(s?.correct), total: toNum(s?.total),
    truePositives: toNum(s?.truePositives), trueNegatives: toNum(s?.trueNegatives),
    falsePositives: toNum(s?.falsePositives), falseNegatives: toNum(s?.falseNegatives),
    currentStreak: toNum(s?.currentStreak), bestStreak: toNum(s?.bestStreak),
  };
}

export function recordPracticeAnswer(
  hasAdvantage: boolean, guessedAdvantage: boolean, storage?: StorageLike
): PracticeStats {
  const prev = loadPracticeStats(storage);
  const correct = hasAdvantage === guessedAdvantage;
  const nextStreak = correct ? prev.currentStreak + 1 : 0;
  const updated: PracticeStats = {
    correct: prev.correct + (correct ? 1 : 0), total: prev.total + 1,
    truePositives: prev.truePositives + (hasAdvantage && guessedAdvantage ? 1 : 0),
    trueNegatives: prev.trueNegatives + (!hasAdvantage && !guessedAdvantage ? 1 : 0),
    falsePositives: prev.falsePositives + (!hasAdvantage && guessedAdvantage ? 1 : 0),
    falseNegatives: prev.falseNegatives + (hasAdvantage && !guessedAdvantage ? 1 : 0),
    currentStreak: nextStreak, bestStreak: Math.max(prev.bestStreak, nextStreak),
  };
  writeJson(STORAGE_KEYS.practiceStats, updated, storage);
  return updated;
}

export function loadPracticeDailyProgress(dateKey: string, tier: DifficultyTier, storage?: StorageLike): PracticeDailyProgress {
  const stored = readJson<Partial<PracticeDailyProgress>>(practiceDailyKey(dateKey, tier), storage);
  if (!stored || !Array.isArray(stored.answers)) return { dateKey, tier, answers: [], completed: false };
  const answers = parseAnswers(stored.answers).slice(0, PRACTICE_DAILY_LIMIT);
  return { dateKey, tier, answers, completed: Boolean(stored.completed) || answers.length >= PRACTICE_DAILY_LIMIT };
}

export function loadAllPracticeDailyProgress(dateKey: string, storage?: StorageLike): Record<DifficultyTier, PracticeDailyProgress> {
  return { 1: loadPracticeDailyProgress(dateKey, 1, storage), 2: loadPracticeDailyProgress(dateKey, 2, storage), 3: loadPracticeDailyProgress(dateKey, 3, storage) };
}

export function recordPracticeDailyAnswer(
  dateKey: string, tier: DifficultyTier, answer: DailyAnswer,
  targetCount: number = PRACTICE_DAILY_LIMIT, storage?: StorageLike
): { progress: PracticeDailyProgress; isNew: boolean } {
  const cap = Math.min(targetCount, PRACTICE_DAILY_LIMIT);
  const existing = loadPracticeDailyProgress(dateKey, tier, storage);
  if (existing.completed || existing.answers.length >= cap || existing.answers.some((a) => a.positionId === answer.positionId)) {
    return { progress: existing, isNew: false };
  }
  const answers = [...existing.answers, answer];
  const progress: PracticeDailyProgress = { dateKey, tier, answers, completed: answers.length >= cap };
  writeJson(practiceDailyKey(dateKey, tier), progress, storage);
  return { progress, isNew: true };
}
