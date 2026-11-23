import { beforeEach, describe, expect, it } from 'vitest';
import type { DifficultyTier, Position } from '../types';
import {
  buildShareText,
  DAILY_EPOCH_DATE_KEY,
  findFirstUnansweredIndex,
  formatCountdown,
  getDailyPuzzleNumber,
  getLocalDateKey,
  getMsUntilNextDay,
  PRACTICE_DAILY_LIMIT,
  selectDailyPositions,
  selectDailyPracticePositions,
} from '../lib/daily';
import {
  getActiveDailyStreak,
  loadDailyProgress,
  loadDailyStreak,
  loadPracticeDailyProgress,
  loadPracticeStats,
  recordDailyAnswer,
  recordPracticeAnswer,
  recordPracticeDailyAnswer,
  resetPracticeDeck,
  updateDailyStreakOnComplete,
  type StorageLike,
} from '../lib/storage';
import { buildPvStates, formatEval, parseUciMove } from '../lib/chessUtils';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
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

describe('daily.ts', () => {
  it('formats local date keys as YYYY-MM-DD', () => {
    const date = new Date(2026, 10, 22, 15, 30, 0); // Nov 22, 2026 local
    expect(getLocalDateKey(date)).toBe('2026-11-22');

    const earlyDate = new Date(2026, 0, 5, 8, 0, 0); // Jan 5, 2026 local
    expect(getLocalDateKey(earlyDate)).toBe('2026-01-05');
  });

  it('computes Daily Puzzle numbers starting at #1 on 2026-11-22', () => {
    expect(getDailyPuzzleNumber(DAILY_EPOCH_DATE_KEY)).toBe(1);
    expect(getDailyPuzzleNumber('2026-11-23')).toBe(2);
    expect(getDailyPuzzleNumber('2026-12-02')).toBe(11);
    // Earlier dates clamp cleanly to >= 1
    expect(getDailyPuzzleNumber('2026-11-21')).toBe(1);
    expect(getDailyPuzzleNumber('2025-01-01')).toBe(1);
  });

  it('selects 5 deterministic unique positions with mixed advantage/equal and ramping difficulty', () => {
    const dataset = makeFixturePositions(10);
    const reversed = [...dataset].reverse();

    const day1A = selectDailyPositions(dataset, '2026-11-22');
    const day1B = selectDailyPositions(reversed, '2026-11-22');
    const day2 = selectDailyPositions(dataset, '2026-11-23');

    expect(day1A).toHaveLength(5);
    expect(new Set(day1A.map((p) => p.id)).size).toBe(5);

    // Same date produces identical IDs regardless of input array order
    expect(day1A.map((p) => p.id)).toEqual(day1B.map((p) => p.id));

    // Different date produces a different set
    expect(day1A.map((p) => p.id)).not.toEqual(day2.map((p) => p.id));

    // Ramps difficulty from Tier 1 to Tier 3
    expect(day1A[0]?.tier).toBe(1);
    expect(day1A[4]?.tier).toBe(3);

    // Guarantees 2 or 3 Advantage positions across multiple days (never 0 or 5)
    for (let day = 1; day <= 20; day++) {
      const key = `2026-12-${String(day).padStart(2, '0')}`;
      const picked = selectDailyPositions(dataset, key);
      expect(picked).toHaveLength(5);
      expect(new Set(picked.map((p) => p.id)).size).toBe(5);
      const advCount = picked.filter((p) => p.hasAdvantage).length;
      expect(advCount === 2 || advCount === 3).toBe(true);
    }
  });

  it('gracefully handles datasets smaller than 5 positions', () => {
    const tiny = makeFixturePositions(1).slice(0, 3);
    const picked = selectDailyPositions(tiny, '2026-11-22');
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((p) => p.id)).size).toBe(3);
    expect(selectDailyPositions([], '2026-11-22')).toEqual([]);
  });

  it('builds Wordle-style share text cleanly', () => {
    const text = buildShareText(1, [true, true, false, true, true], 3);
    expect(text).toBe('Blundr #1 — 4/5 🔥3\n🟩🟩🟥🟩🟩');

    const noStreakText = buildShareText(12, [false, false, false, false, false], 0);
    expect(noStreakText).toBe('Blundr #12 — 0/5\n🟥🟥🟥🟥🟥');
  });

  it('calculates countdown to next local midnight and formats HH:MM:SS', () => {
    const almostMidnight = new Date(2026, 10, 22, 23, 59, 45, 0);
    const ms = getMsUntilNextDay(almostMidnight);
    expect(ms).toBe(15_000);
    expect(formatCountdown(ms)).toBe('00:00:15');
    expect(formatCountdown(3_661_000)).toBe('01:01:01');
    expect(formatCountdown(-500)).toBe('00:00:00');
  });

  it('finds the first unanswered index in dailyPositions safely', () => {
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

  it('selects deterministic per-tier daily practice positions excluding Daily 5 with balanced mix', () => {
    const dataset = makeFixturePositions(10);
    const reversed = [...dataset].reverse();
    const dateKey = '2026-11-22';

    const daily = selectDailyPositions(dataset, dateKey);
    const dailyIds = new Set(daily.map((p) => p.id));

    for (const tier of [1, 2, 3] as const) {
      const pickA = selectDailyPracticePositions(dataset, dateKey, tier, dailyIds);
      const pickB = selectDailyPracticePositions(reversed, dateKey, tier, dailyIds);
      const nextDay = selectDailyPracticePositions(dataset, '2026-11-23', tier, dailyIds);

      expect(pickA).toHaveLength(PRACTICE_DAILY_LIMIT);
      expect(new Set(pickA.map((p) => p.id)).size).toBe(PRACTICE_DAILY_LIMIT);

      // Deterministic regardless of input order
      expect(pickA.map((p) => p.id)).toEqual(pickB.map((p) => p.id));

      // Different day yields a different selection
      expect(pickA.map((p) => p.id)).not.toEqual(nextDay.map((p) => p.id));

      // Strictly matches tier and excludes all Daily 5 IDs
      expect(pickA.every((p) => p.tier === tier)).toBe(true);
      expect(pickA.every((p) => !dailyIds.has(p.id))).toBe(true);

      // Balanced Advantage/Equal mix (2 or 3 Advantage)
      const advCount = pickA.filter((p) => p.hasAdvantage).length;
      expect(advCount === 2 || advCount === 3).toBe(true);
    }

    // Distinct tiers on the same day never overlap
    const t1Ids = new Set(
      selectDailyPracticePositions(dataset, dateKey, 1, dailyIds).map((p) => p.id)
    );
    const t2Ids = selectDailyPracticePositions(dataset, dateKey, 2, dailyIds).map((p) => p.id);
    expect(t2Ids.every((id) => !t1Ids.has(id))).toBe(true);
  });
});

describe('storage.ts', () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it('handles daily streak rollover, idempotency, and reset on missed days', () => {
    // First completion -> streak 1
    const s1 = updateDailyStreakOnComplete('2026-11-22', storage);
    expect(s1).toEqual({
      currentStreak: 1,
      maxStreak: 1,
      lastCompletedDateKey: '2026-11-22',
    });

    // Re-completing same day -> preserved
    const s1Again = updateDailyStreakOnComplete('2026-11-22', storage);
    expect(s1Again).toEqual(s1);

    // Consecutive next day -> increments to 2
    const s2 = updateDailyStreakOnComplete('2026-11-23', storage);
    expect(s2).toEqual({
      currentStreak: 2,
      maxStreak: 2,
      lastCompletedDateKey: '2026-11-23',
    });

    // Active streak check on next day before completing -> still 2
    expect(getActiveDailyStreak(s2, '2026-11-24')).toBe(2);
    // Active streak check after skipping a day -> 0
    expect(getActiveDailyStreak(s2, '2026-11-25')).toBe(0);

    // Completing after a missed day resets currentStreak to 1, preserves maxStreak 2
    const sAfterGap = updateDailyStreakOnComplete('2026-11-25', storage);
    expect(sAfterGap).toEqual({
      currentStreak: 1,
      maxStreak: 2,
      lastCompletedDateKey: '2026-11-25',
    });

    expect(loadDailyStreak(storage)).toEqual(sAfterGap);
  });

  it('records daily answers and completes on the 5th answer', () => {
    const dateKey = '2026-11-22';
    for (let i = 1; i <= 4; i++) {
      const res = recordDailyAnswer(
        dateKey,
        { positionId: `p${i}`, guessedAdvantage: true, correct: i % 2 === 1 },
        5,
        storage
      );
      expect(res.progress.completed).toBe(false);
      expect(res.streak.currentStreak).toBe(0);
    }

    // Duplicate answer is ignored
    const dup = recordDailyAnswer(
      dateKey,
      { positionId: 'p1', guessedAdvantage: false, correct: false },
      5,
      storage
    );
    expect(dup.progress.answers).toHaveLength(4);

    // 5th answer marks completed and starts streak
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

  it('tracks practice confusion matrix, streaks, and deck reset', () => {
    recordPracticeAnswer('a1', true, true, storage); // TP -> streak 1
    recordPracticeAnswer('a2', false, false, storage); // TN -> streak 2
    recordPracticeAnswer('a3', false, true, storage); // FP -> streak 0
    const stats = recordPracticeAnswer('a4', true, false, storage); // FN -> streak 0

    expect(stats.total).toBe(4);
    expect(stats.correct).toBe(2);
    expect(stats.truePositives).toBe(1);
    expect(stats.trueNegatives).toBe(1);
    expect(stats.falsePositives).toBe(1);
    expect(stats.falseNegatives).toBe(1);
    expect(stats.currentStreak).toBe(0);
    expect(stats.bestStreak).toBe(2);
    expect(stats.seenIds).toHaveLength(4);

    const reset = resetPracticeDeck(storage);
    expect(reset.seenIds).toEqual([]);
    expect(reset.total).toBe(4);
    expect(loadPracticeStats(storage).seenIds).toEqual([]);
  });

  it('caps and persists per-day per-tier practice progress and resets on next dateKey', () => {
    const today = '2026-11-22';
    const tomorrow = '2026-11-23';

    expect(loadPracticeDailyProgress(today, 1, storage)).toEqual({
      dateKey: today,
      tier: 1,
      answers: [],
      completed: false,
    });

    for (let i = 1; i <= 4; i++) {
      const res = recordPracticeDailyAnswer(
        today,
        1,
        { positionId: `t1_p${i}`, guessedAdvantage: true, correct: i % 2 === 1 },
        PRACTICE_DAILY_LIMIT,
        storage
      );
      expect(res.isNew).toBe(true);
      expect(res.progress.completed).toBe(false);
      expect(res.progress.answers).toHaveLength(i);
    }

    // Duplicate answer is ignored (deduplicated)
    const dup = recordPracticeDailyAnswer(
      today,
      1,
      { positionId: 't1_p1', guessedAdvantage: false, correct: false },
      PRACTICE_DAILY_LIMIT,
      storage
    );
    expect(dup.isNew).toBe(false);
    expect(dup.progress.answers).toHaveLength(4);

    // 5th answer completes Tier 1 for today
    const done = recordPracticeDailyAnswer(
      today,
      1,
      { positionId: 't1_p5', guessedAdvantage: false, correct: true },
      PRACTICE_DAILY_LIMIT,
      storage
    );
    expect(done.isNew).toBe(true);
    expect(done.progress.completed).toBe(true);
    expect(done.progress.answers).toHaveLength(5);

    // Persisted under blundr_practice_daily_<dateKey>_t<tier>
    expect(storage.getItem(`blundr_practice_daily_${today}_t1`)).not.toBeNull();

    // Tier 2 on the same day is independent and still fresh
    expect(loadPracticeDailyProgress(today, 2, storage)).toEqual({
      dateKey: today,
      tier: 2,
      answers: [],
      completed: false,
    });

    // Next day resets Tier 1 cleanly
    expect(loadPracticeDailyProgress(tomorrow, 1, storage)).toEqual({
      dateKey: tomorrow,
      tier: 1,
      answers: [],
      completed: false,
    });
  });
});

describe('chessUtils.ts', () => {
  it('formats evaluations and forced mates cleanly', () => {
    expect(formatEval(2.44, null, 'w')).toBe('+2.4');
    expect(formatEval(-1.26, null, 'b')).toBe('-1.3');
    expect(formatEval(0.02, null, 'w')).toBe('0.0');
    expect(formatEval(-0.04, null, 'b')).toBe('0.0');
    expect(formatEval(null, 2, 'w')).toBe('M2');
    expect(formatEval(null, -3, 'b')).toBe('-M3');
    expect(formatEval(null, null, 'w')).toBe('0.0');
  });

  it('parses UCI moves with optional promotion', () => {
    expect(parseUciMove('d4e5')).toEqual({ from: 'd4', to: 'e5' });
    expect(parseUciMove('e7e8Q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
  });

  it('builds valid PV states with SAN labels using chess.js', () => {
    // Scholar's mate setup: Black just played Nf6?? allowing Qxf7#? Let's use a crisp legal sequence.
    // After 1. e4 e5 2. Nf3 Nc6, White plays 3. Bb5 a6 4. Ba4
    const startFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const states = buildPvStates(startFen, ['f1b5', 'a7a6', 'b5a4'], 'b8c6');

    expect(states).toHaveLength(4);
    expect(states[0]).toEqual({
      fen: startFen,
      lastMove: ['b8', 'c6'],
    });
    expect(states[1]?.san).toBe('Bb5');
    expect(states[1]?.lastMove).toEqual(['f1', 'b5']);
    expect(states[2]?.san).toBe('a6');
    expect(states[2]?.lastMove).toEqual(['a7', 'a6']);
    expect(states[3]?.san).toBe('Ba4');
    expect(states[3]?.lastMove).toEqual(['b5', 'a4']);

    // Stops gracefully if an illegal move appears in PV
    const partial = buildPvStates(startFen, ['f1b5', 'e1e8']);
    expect(partial).toHaveLength(2);
    expect(partial[1]?.san).toBe('Bb5');
  });
});
