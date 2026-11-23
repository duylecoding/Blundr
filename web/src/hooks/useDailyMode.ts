/**
 * Manages Daily 5 state, answers, streaks, summary inspection, and midnight rollover sync.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findFirstUnansweredIndex, selectDailyPositions } from '../domain/deck';
import {
  getActiveDailyStreak,
  loadDailyProgress,
  loadDailyStreak,
  recordDailyAnswer,
} from '../domain/storage';
import type { DailyProgress, DailyStreak, Position } from '../types';

interface DailyJustAnswered {
  positionId: string;
  guessedAdvantage: boolean;
}

export function useDailyMode(allPositions: readonly Position[], dateKey: string) {
  const [progress, setProgress] = useState<DailyProgress>(() =>
    loadDailyProgress(dateKey)
  );
  const [streak, setStreak] = useState<DailyStreak>(() => loadDailyStreak());
  const [index, setIndex] = useState(0);
  const [justAnswered, setJustAnswered] = useState<DailyJustAnswered | null>(null);
  const [inspectingIndex, setInspectingIndex] = useState<number | null>(null);

  const prevDateKeyRef = useRef(dateKey);
  const syncedDateRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevDateKeyRef.current === dateKey) return;
    prevDateKeyRef.current = dateKey;
    setProgress(loadDailyProgress(dateKey));
    setStreak(loadDailyStreak());
    setJustAnswered(null);
    setInspectingIndex(null);
    syncedDateRef.current = null;
  }, [dateKey]);

  const positions = useMemo(
    () => selectDailyPositions(allPositions, dateKey),
    [allPositions, dateKey]
  );

  const idSet = useMemo(() => new Set(positions.map((p) => p.id)), [positions]);

  // Guard by progress.dateKey so midnight rollover never computes an index against yesterday's answers.
  useEffect(() => {
    if (
      positions.length === 0 ||
      progress.dateKey !== dateKey ||
      syncedDateRef.current === dateKey
    ) {
      return;
    }
    syncedDateRef.current = dateKey;
    setIndex(findFirstUnansweredIndex(positions, progress.answers));
  }, [positions, progress.dateKey, progress.answers, dateKey]);

  const showSummary =
    progress.dateKey === dateKey &&
    progress.completed &&
    justAnswered === null &&
    inspectingIndex === null;

  const activeIndex = inspectingIndex !== null ? inspectingIndex : index;
  const currentPosition = showSummary ? null : (positions[activeIndex] ?? null);

  const answerMap = useMemo(
    () => new Map(progress.answers.map((a) => [a.positionId, a])),
    [progress.answers]
  );

  const feedbackGuess = useMemo<boolean | null>(() => {
    if (!currentPosition) return null;
    if (inspectingIndex !== null) {
      return answerMap.get(currentPosition.id)?.guessedAdvantage ?? null;
    }
    if (justAnswered && justAnswered.positionId === currentPosition.id) {
      return justAnswered.guessedAdvantage;
    }
    return null;
  }, [currentPosition, inspectingIndex, answerMap, justAnswered]);

  const answer = useCallback(
    (guessedAdvantage: boolean) => {
      if (!currentPosition) return;
      const correct = guessedAdvantage === currentPosition.hasAdvantage;
      const result = recordDailyAnswer(
        dateKey,
        { positionId: currentPosition.id, guessedAdvantage, correct },
        positions.length
      );
      setProgress(result.progress);
      setStreak(result.streak);
      setJustAnswered({ positionId: currentPosition.id, guessedAdvantage });
    },
    [currentPosition, dateKey, positions.length]
  );

  const advance = useCallback(() => {
    if (inspectingIndex !== null) {
      setInspectingIndex(null);
      if (!progress.completed) {
        setIndex(findFirstUnansweredIndex(positions, progress.answers));
      }
      return;
    }
    setJustAnswered(null);
    if (!progress.completed) {
      setIndex(findFirstUnansweredIndex(positions, progress.answers));
    }
  }, [inspectingIndex, progress.completed, progress.answers, positions]);

  const resetOnModeSwitch = useCallback(() => {
    setInspectingIndex(null);
    setJustAnswered(null);
    if (positions.length > 0 && !progress.completed) {
      setIndex(findFirstUnansweredIndex(positions, progress.answers));
    }
  }, [positions, progress.completed, progress.answers]);

  const playableIndex = useMemo(
    () =>
      progress.completed ? null : findFirstUnansweredIndex(positions, progress.answers),
    [progress.completed, positions, progress.answers]
  );

  const selectSlot = useCallback(
    (slotIdx: number) => {
      const target = positions[slotIdx];
      if (!target) return;
      if (answerMap.has(target.id)) {
        setJustAnswered(null);
        setInspectingIndex(slotIdx);
        return;
      }
      if (playableIndex !== null && slotIdx === playableIndex) {
        setJustAnswered(null);
        setInspectingIndex(null);
        setIndex(slotIdx);
      }
    },
    [positions, answerMap, playableIndex]
  );

  const nextLabel =
    inspectingIndex !== null
      ? progress.completed
        ? 'Back to Summary'
        : 'Resume Puzzle'
      : progress.completed || index >= positions.length - 1
        ? 'View Results'
        : 'Next Puzzle';

  return {
    positions,
    idSet,
    progress,
    streak,
    activeStreak: getActiveDailyStreak(streak, dateKey),
    activeIndex,
    playableIndex,
    currentPosition,
    showSummary,
    feedbackGuess,
    answerMap,
    nextLabel,
    slotLabel: `${activeIndex + 1}/${positions.length}`,
    answer,
    advance,
    inspect: setInspectingIndex,
    selectSlot,
    resetOnModeSwitch,
  };
}
