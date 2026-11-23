/**
 * Unit tests covering calendar, deterministic deck selection, storage caps, share text, and best-line replay.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DAILY_EPOCH_DATE_KEY,
  PRACTICE_DAILY_LIMIT,
  STORAGE_KEYS,
} from '../config/constants';
import {
  buildBestLineStates,
  formatEval,
  getBestMoveArrow,
  isValidSquare,
  parseUciMove,
} from '../domain/bestLine';
import {
  formatCountdown,
  getDailyPuzzleNumber,
  getLocalDateKey,
  getMsUntilNextDay,
  getPreviousDateKey,
} from '../domain/calendar';
import {
  findFirstUnansweredIndex,
  selectDailyPositions,
  selectDailyPracticePositions,
} from '../domain/deck';
import { buildShareText } from '../domain/share';
import {
  getActiveDailyStreak,
  loadDailyProgress,
  loadDailyStreak,
  loadPracticeDailyProgress,
  loadPracticeStats,
  recordDailyAnswer,
  recordPracticeAnswer,
  recordPracticeDailyAnswer,
  updateDailyStreakOnComplete,
  type StorageLike,
} from '../domain/storage';
import type { DifficultyTier, Position } from '../types';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function makeFixturePositions(perBucket = 8): Position[] {
  const positions: Position[] = [];
  const tiers: DifficultyTier[] = [1, 2, 3];

  for (const tier of tiers) {
    for (const hasAdvantage of [true, false]) {
      for (let i = 0; i < perBucket; i++) {
        const idx = positions.length + 1;
        positions.push({
          id: `lichess_game${idx}_ply20`,
          fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
          lastMove: 'g1f3',
          lastMoveSan: 'Nf3',
          sideToMove: idx % 2 === 0 ? 'w' : 'b',
          hasAdvantage,
          tier,
          evalBefore: 0.1,
          evalAfter: hasAdvantage ? 2.4 : 0.05,
          mateIn: null,
          bestMove: 'b8c6',
          pv: ['b8c6', 'f1b5', 'a7a6'],
          pvGap: hasAdvantage ? 1.8 : 0.1,
          style: hasAdvantage ? 'tactical' : 'equal',
          materialBalance: 0,
          moveNumber: 10,
          avgElo: 1850 + idx,
          gameUrl: `https://lichess.org/game${idx}#20`,
        });
      }
    }
  }
  return positions;
}

describe('calendar.ts', () => {
  it('formats local date keys and computes previous dates across month boundaries', () => {
    expect(getLocalDateKey(new Date(2026, 10, 22, 15, 30, 0))).toBe('2026-11-22');
    expect(getLocalDateKey(new Date(2026, 0, 5, 8, 0, 0))).toBe('2026-01-05');
    expect(getPreviousDateKey('2026-03-01')).toBe('2026-02-28');
    expect(getPreviousDateKey('2026-01-01')).toBe('2025-12-31');
  });

  it('computes Daily Puzzle numbers starting at #1 on the epoch date', () => {
    expect(getDailyPuzzleNumber(DAILY_EPOCH_DATE_KEY)).toBe(1);
    expect(getDailyPuzzleNumber('2026-11-23')).toBe(2);
    expect(getDailyPuzzleNumber('2026-12-02')).toBe(11);
    expect(getDailyPuzzleNumber('2026-11-21')).toBe(1);
  });

  it('calculates countdown to next local midnight and formats HH:MM:SS', () => {
    const ms = getMsUntilNextDay(new Date(2026, 10, 22, 23, 59, 45, 0));
    expect(ms).toBe(15_000);
    expect(formatCountdown(ms)).toBe('00:00:15');
    expect(formatCountdown(3_661_000)).toBe('01:01:01');
    expect(formatCountdown(-500)).toBe('00:00:00');
  });
});

describe('deck.ts', () => {
  it('selects 5 deterministic unique Daily positions with ramping difficulty and balanced mix', () => {
    const dataset = makeFixturePositions(10);
    const day1A = selectDailyPositions(dataset, '2026-11-22');
    const day1B = selectDailyPositions([...dataset].reverse(), '2026-11-22');
    const day2 = selectDailyPositions(dataset, '2026-11-23');

    expect(day1A).toHaveLength(5);
    expect(new Set(day1A.map((p) => p.id)).size).toBe(5);
    expect(day1A.map((p) => p.id)).toEqual(day1B.map((p) => p.id));
    expect(day1A.map((p) => p.id)).not.toEqual(day2.map((p) => p.id));
    expect(day1A[0]?.tier).toBe(1);
    expect(day1A[4]?.tier).toBe(3);

    for (let day = 1; day <= 20; day++) {
      const picked = selectDailyPositions(dataset, `2026-12-${String(day).padStart(2, '0')}`);
      const advCount = picked.filter((p) => p.hasAdvantage).length;
      expect(picked).toHaveLength(5);
      expect(advCount === 2 || advCount === 3).toBe(true);
    }
  });

  it('handles small or empty datasets gracefully', () => {
    const tiny = makeFixturePositions(1).slice(0, 3);
    const picked = selectDailyPositions(tiny, '2026-11-22');
    expect(picked).toHaveLength(3);
    expect(selectDailyPositions([], '2026-11-22')).toEqual([]);
  });

  it('selects deterministic per-tier Practice decks excluding Daily 5 IDs', () => {
    const dataset = makeFixturePositions(10);
    const dateKey = '2026-11-22';
    const dailyIds = new Set(selectDailyPositions(dataset, dateKey).map((p) => p.id));

    for (const tier of [1, 2, 3] as const) {
      const pickA = selectDailyPracticePositions(dataset, dateKey, tier, dailyIds);
      const pickB = selectDailyPracticePositions([...dataset].reverse(), dateKey, tier, dailyIds);
      const nextDay = selectDailyPracticePositions(dataset, '2026-11-23', tier, dailyIds);

      expect(pickA).toHaveLength(PRACTICE_DAILY_LIMIT);
      expect(pickA.map((p) => p.id)).toEqual(pickB.map((p) => p.id));
      expect(pickA.map((p) => p.id)).not.toEqual(nextDay.map((p) => p.id));
      expect(pickA.every((p) => p.tier === tier && !dailyIds.has(p.id))).toBe(true);
      const advCount = pickA.filter((p) => p.hasAdvantage).length;
      expect(advCount === 2 || advCount === 3).toBe(true);
    }
  });

  it('finds the first unanswered index safely', () => {
    const daily = makeFixturePositions(2).slice(0, 5);
    expect(findFirstUnansweredIndex(daily, [])).toBe(0);
    expect(
      findFirstUnansweredIndex(daily, [
        { positionId: daily[0]!.id, guessedAdvantage: true, correct: true },
        { positionId: daily[2]!.id, guessedAdvantage: false, correct: true },
      ])
    ).toBe(1);
    expect(
      findFirstUnansweredIndex(
        daily,
        daily.map((p) => ({ positionId: p.id, guessedAdvantage: true, correct: true }))
      )
    ).toBe(4);
    expect(findFirstUnansweredIndex([], [])).toBe(0);
  });
});

describe('storage.ts', () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it('handles daily streak rollover, idempotency, and missed-day resets', () => {
    const s1 = updateDailyStreakOnComplete('2026-11-22', storage);
    expect(s1).toEqual({ currentStreak: 1, maxStreak: 1, lastCompletedDateKey: '2026-11-22' });
    expect(updateDailyStreakOnComplete('2026-11-22', storage)).toEqual(s1);

    const s2 = updateDailyStreakOnComplete('2026-11-23', storage);
    expect(s2).toEqual({ currentStreak: 2, maxStreak: 2, lastCompletedDateKey: '2026-11-23' });
    expect(getActiveDailyStreak(s2, '2026-11-24')).toBe(2);
    expect(getActiveDailyStreak(s2, '2026-11-25')).toBe(0);

    const sGap = updateDailyStreakOnComplete('2026-11-25', storage);
    expect(sGap).toEqual({ currentStreak: 1, maxStreak: 2, lastCompletedDateKey: '2026-11-25' });
    expect(loadDailyStreak(storage)).toEqual(sGap);
  });

  it('records Daily 5 answers, deduplicates, and completes on the 5th answer', () => {
    const dateKey = '2026-11-22';
    for (let i = 1; i <= 4; i++) {
      const res = recordDailyAnswer(
        dateKey,
        { positionId: `p${i}`, guessedAdvantage: true, correct: i % 2 === 1 },
        5,
        storage
      );
      expect(res.progress.completed).toBe(false);
    }

    const dup = recordDailyAnswer(
      dateKey,
      { positionId: 'p1', guessedAdvantage: false, correct: false },
      5,
      storage
    );
    expect(dup.progress.answers).toHaveLength(4);

    const finalRes = recordDailyAnswer(
      dateKey,
      { positionId: 'p5', guessedAdvantage: false, correct: true },
      5,
      storage
    );
    expect(finalRes.progress.completed).toBe(true);
    expect(finalRes.streak.currentStreak).toBe(1);
    expect(loadDailyProgress(dateKey, storage).answers).toHaveLength(5);
  });

  it('tracks practice confusion matrix and streaks under blundr: keys', () => {
    recordPracticeAnswer(true, true, storage);
    recordPracticeAnswer(false, false, storage);
    recordPracticeAnswer(false, true, storage);
    const stats = recordPracticeAnswer(true, false, storage);

    expect(stats).toEqual({
      total: 4,
      correct: 2,
      truePositives: 1,
      trueNegatives: 1,
      falsePositives: 1,
      falseNegatives: 1,
      currentStreak: 0,
      bestStreak: 2,
    });
    expect(storage.getItem(STORAGE_KEYS.practiceStats)).not.toBeNull();
    expect(loadPracticeStats(storage)).toEqual(stats);
  });

  it('enforces the 5-card daily cap per Practice tier and resets on the next dateKey', () => {
    const today = '2026-11-22';
    for (let i = 1; i <= PRACTICE_DAILY_LIMIT; i++) {
      const res = recordPracticeDailyAnswer(
        today,
        1,
        { positionId: `t1_p${i}`, guessedAdvantage: true, correct: true },
        PRACTICE_DAILY_LIMIT,
        storage
      );
      expect(res.isNew).toBe(true);
      expect(res.progress.completed).toBe(i === PRACTICE_DAILY_LIMIT);
    }

    // 6th answer is rejected at the storage layer
    const extra = recordPracticeDailyAnswer(
      today,
      1,
      { positionId: 't1_p6', guessedAdvantage: true, correct: true },
      PRACTICE_DAILY_LIMIT,
      storage
    );
    expect(extra.isNew).toBe(false);
    expect(extra.progress.answers).toHaveLength(PRACTICE_DAILY_LIMIT);
    expect(storage.getItem(`${STORAGE_KEYS.practiceDailyPrefix}${today}_t1`)).not.toBeNull();
    expect(loadPracticeDailyProgress(today, 2, storage).answers).toEqual([]);
    expect(loadPracticeDailyProgress('2026-11-23', 1, storage).answers).toEqual([]);
  });
});

describe('share.ts', () => {
  it('builds Wordle-style Blundr share cards with and without streak', () => {
    expect(buildShareText(1, [true, true, false, true, true], 3)).toBe(
      'Blundr #1 — 4/5 🔥3\n🟩🟩🟥🟩🟩'
    );
    expect(buildShareText(12, [false, false, false, false, false], 0)).toBe(
      'Blundr #12 — 0/5\n🟥🟥🟥🟥🟥'
    );
  });
});

describe('bestLine.ts', () => {
  it('formats evaluations, validates squares, and parses UCI moves', () => {
    expect(formatEval(2.44, null, 'w')).toBe('+2.4');
    expect(formatEval(-1.26, null, 'b')).toBe('-1.3');
    expect(formatEval(0.02, null, 'w')).toBe('0.0');
    expect(formatEval(null, 2, 'w')).toBe('M2');
    expect(formatEval(null, -3, 'b')).toBe('-M3');
    expect(isValidSquare('e4')).toBe(true);
    expect(isValidSquare('i9')).toBe(false);
    expect(parseUciMove('e7e8Q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
    expect(getBestMoveArrow('d4e5')).toEqual(['d4', 'e5']);
    expect(getBestMoveArrow('invalid')).toBeNull();
  });

  it('builds legal chess.js best-line replay states and stops cleanly on illegal moves', () => {
    const startFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const states = buildBestLineStates(startFen, ['f1b5', 'a7a6', 'b5a4'], 'b8c6');

    expect(states).toHaveLength(4);
    expect(states[0]).toEqual({ fen: startFen, lastMove: ['b8', 'c6'] });
    expect(states[1]?.san).toBe('Bb5');
    expect(states[2]?.san).toBe('a6');
    expect(states[3]?.san).toBe('Ba4');

    const partial = buildBestLineStates(startFen, ['f1b5', 'e1e8']);
    expect(partial).toHaveLength(2);
    expect(partial[1]?.san).toBe('Bb5');
  });
});
