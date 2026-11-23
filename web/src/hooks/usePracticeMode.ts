/**
 * Manages daily 5-per-difficulty Practice state, lifetime stats, and tier/mode switching.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRACTICE_DAILY_LIMIT } from '../config/constants';
import { findFirstUnansweredIndex, selectDailyPracticePositions } from '../domain/deck';
import {
  loadAllPracticeDailyProgress,
  loadPracticeStats,
  recordPracticeAnswer,
  recordPracticeDailyAnswer,
} from '../domain/storage';
import type {
  DifficultyTier,
  Position,
  PracticeDailyProgress,
  PracticeStats,
  TierProgressSummary,
} from '../types';

interface PracticeJustAnswered {
  tier: DifficultyTier;
  positionId: string;
  guessedAdvantage: boolean;
}

const mapTiers = <T,>(fn: (tier: DifficultyTier) => T): Record<DifficultyTier, T> => ({
  1: fn(1),
  2: fn(2),
  3: fn(3),
});

export function usePracticeMode(
  allPositions: readonly Position[],
  dateKey: string,
  excludeIds: ReadonlySet<string>
) {
  const [stats, setStats] = useState<PracticeStats>(() => loadPracticeStats());
  const [tier, setTier] = useState<DifficultyTier>(1);
  const [progressByTier, setProgressByTier] = useState<Record<DifficultyTier, PracticeDailyProgress>>(
    () => loadAllPracticeDailyProgress(dateKey)
  );
  const [indexByTier, setIndexByTier] = useState<Record<DifficultyTier, number>>({ 1: 0, 2: 0, 3: 0 });
  const [justAnswered, setJustAnswered] = useState<PracticeJustAnswered | null>(null);

  const prevDateKeyRef = useRef(dateKey);
  const syncedDateRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevDateKeyRef.current === dateKey) return;
    prevDateKeyRef.current = dateKey;
    setProgressByTier(loadAllPracticeDailyProgress(dateKey));
    setJustAnswered(null);
    syncedDateRef.current = null;
  }, [dateKey]);

  const positionsByTier = useMemo(
    () => mapTiers((t) => selectDailyPracticePositions(allPositions, dateKey, t, excludeIds)),
    [allPositions, dateKey, excludeIds]
  );

  // Wait for both dataset load and midnight progress reload before syncing resume indices.
  useEffect(() => {
    if (allPositions.length === 0 || progressByTier[1].dateKey !== dateKey || syncedDateRef.current === dateKey) {
      return;
    }
    syncedDateRef.current = dateKey;
    setIndexByTier(mapTiers((t) => findFirstUnansweredIndex(positionsByTier[t], progressByTier[t].answers)));
  }, [allPositions.length, positionsByTier, progressByTier, dateKey]);

  const activePositions = positionsByTier[tier];
  const activeProgress = progressByTier[tier];
  const activeIndex = indexByTier[tier];

  const showTierComplete =
    activeProgress.dateKey === dateKey &&
    activePositions.length > 0 &&
    activeProgress.completed &&
    justAnswered === null;
  const currentPosition = showTierComplete ? null : (activePositions[activeIndex] ?? null);
  const feedbackGuess =
    currentPosition && justAnswered && justAnswered.tier === tier && justAnswered.positionId === currentPosition.id
      ? justAnswered.guessedAdvantage
      : null;

  const tierSummaries = useMemo<Record<DifficultyTier, TierProgressSummary>>(
    () =>
      mapTiers((t) => ({
        answered: progressByTier[t].answers.length,
        total: positionsByTier[t].length || PRACTICE_DAILY_LIMIT,
        completed: progressByTier[t].completed,
      })),
    [progressByTier, positionsByTier]
  );

  const remainingByTier = useMemo(
    () =>
      mapTiers((t) =>
        progressByTier[t].completed ? 0 : Math.max(0, positionsByTier[t].length - progressByTier[t].answers.length)
      ),
    [progressByTier, positionsByTier]
  );

  const answer = useCallback((guessedAdvantage: boolean) => {
    if (!currentPosition) return;
    const correct = guessedAdvantage === currentPosition.hasAdvantage;
    const { progress, isNew } = recordPracticeDailyAnswer(
      dateKey,
      tier,
      { positionId: currentPosition.id, guessedAdvantage, correct },
      activePositions.length
    );
    setProgressByTier((prev) => ({ ...prev, [tier]: progress }));
    if (isNew) {
      setStats(recordPracticeAnswer(currentPosition.hasAdvantage, guessedAdvantage));
    }
    setJustAnswered({ tier, positionId: currentPosition.id, guessedAdvantage });
  }, [currentPosition, dateKey, tier, activePositions.length]);

  const advance = useCallback(() => {
    setJustAnswered(null);
    if (!activeProgress.completed) {
      const nextIdx = findFirstUnansweredIndex(activePositions, activeProgress.answers);
      setIndexByTier((prev) => ({ ...prev, [tier]: nextIdx }));
    }
  }, [activeProgress.completed, activeProgress.answers, activePositions, tier]);

  const selectTier = useCallback((nextTier: DifficultyTier) => {
    if (nextTier === tier) return;
    setTier(nextTier);
    setJustAnswered(null);
    const nextIdx = findFirstUnansweredIndex(positionsByTier[nextTier], progressByTier[nextTier].answers);
    setIndexByTier((prev) => ({ ...prev, [nextTier]: nextIdx }));
  }, [tier, positionsByTier, progressByTier]);

  const resetOnModeSwitch = useCallback(() => {
    setJustAnswered(null);
    setIndexByTier(mapTiers((t) => findFirstUnansweredIndex(positionsByTier[t], progressByTier[t].answers)));
  }, [positionsByTier, progressByTier]);

  return {
    tier,
    stats,
    activePositions,
    activeProgress,
    currentPosition,
    showTierComplete,
    feedbackGuess,
    tierSummaries,
    remainingByTier,
    nextLabel: activeProgress.completed || activeIndex >= activePositions.length - 1 ? 'Finish Tier' : 'Next Position',
    slotLabel: `${activeIndex + 1}/${activePositions.length}`,
    answer,
    advance,
    selectTier,
    resetOnModeSwitch,
  };
}
