import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type {
  DailyProgress,
  DailyStreak,
  DifficultyTier,
  GameMode,
  Position,
  PositionDataset,
  PracticeDailyProgress,
  PracticeStats,
} from './types';
import {
  findFirstUnansweredIndex,
  getDailyPuzzleNumber,
  getLocalDateKey,
  getMsUntilNextDay,
  PRACTICE_DAILY_LIMIT,
  selectDailyPositions,
  selectDailyPracticePositions,
} from './lib/daily';
import {
  getActiveDailyStreak,
  loadDailyProgress,
  loadDailyStreak,
  loadPracticeDailyProgress,
  loadPracticeStats,
  recordDailyAnswer,
  recordPracticeAnswer,
  recordPracticeDailyAnswer,
} from './lib/storage';
import { buildPvStates, isValidSquare, parseUciMove } from './lib/chessUtils';
import { Header } from './components/Header';
import { SwipeCard } from './components/SwipeCard';
import { FeedbackPanel } from './components/FeedbackPanel';
import { DailySummary } from './components/DailySummary';
import {
  PracticeControls,
  type TierProgressSummary,
} from './components/PracticeControls';
import { PracticeTierComplete } from './components/PracticeTierComplete';

function loadAllPracticeDailyProgress(
  dateKey: string
): Record<DifficultyTier, PracticeDailyProgress> {
  return {
    1: loadPracticeDailyProgress(dateKey, 1),
    2: loadPracticeDailyProgress(dateKey, 2),
    3: loadPracticeDailyProgress(dateKey, 3),
  };
}

export function App() {
  const [dateKey, setDateKey] = useState<string>(() => getLocalDateKey());
  const puzzleNumber = useMemo(() => getDailyPuzzleNumber(dateKey), [dateKey]);

  // Dataset loading state
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Navigation & mode state
  const [mode, setMode] = useState<GameMode>('daily');

  // Daily 5 state
  const [dailyProgress, setDailyProgress] = useState<DailyProgress>(() =>
    loadDailyProgress(dateKey)
  );
  const [dailyStreak, setDailyStreak] = useState<DailyStreak>(() => loadDailyStreak());
  const [dailyIndex, setDailyIndex] = useState<number>(0);
  const [dailyJustAnswered, setDailyJustAnswered] = useState<{
    positionId: string;
    guessedAdvantage: boolean;
  } | null>(null);
  const [inspectingDailyIndex, setInspectingDailyIndex] = useState<number | null>(null);

  // Practice mode state (5 tries per difficulty per day)
  const [practiceStats, setPracticeStats] = useState<PracticeStats>(() =>
    loadPracticeStats()
  );
  const [practiceTier, setPracticeTier] = useState<DifficultyTier>(1);
  const [practiceProgressByTier, setPracticeProgressByTier] = useState<
    Record<DifficultyTier, PracticeDailyProgress>
  >(() => loadAllPracticeDailyProgress(dateKey));
  const [practiceIndexByTier, setPracticeIndexByTier] = useState<
    Record<DifficultyTier, number>
  >({ 1: 0, 2: 0, 3: 0 });
  const [practiceJustAnswered, setPracticeJustAnswered] = useState<{
    tier: DifficultyTier;
    positionId: string;
    guessedAdvantage: boolean;
  } | null>(null);

  const hasSyncedInitialIndicesRef = useRef<string | null>(null);

  // PV Stepper index (0 = initial position after opponent's move)
  const [pvIndex, setPvIndex] = useState(0);

  // Midnight rollover watcher: visibilitychange + focus + scheduled midnight timeout
  useEffect(() => {
    const syncDateKey = () => {
      const latest = getLocalDateKey();
      setDateKey((prev) => (prev === latest ? prev : latest));
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncDateKey();
      }
    };

    const msUntilMidnight = getMsUntilNextDay() + 1000;
    const midnightTimer = window.setTimeout(syncDateKey, msUntilMidnight);

    window.addEventListener('focus', syncDateKey);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearTimeout(midnightTimer);
      window.removeEventListener('focus', syncDateKey);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [dateKey]);

  // Reload daily + practice daily progress whenever dateKey rolls over
  const prevDateKeyRef = useRef<string>(dateKey);
  useEffect(() => {
    if (prevDateKeyRef.current === dateKey) {
      return;
    }
    prevDateKeyRef.current = dateKey;
    setDailyProgress(loadDailyProgress(dateKey));
    setDailyStreak(loadDailyStreak());
    setDailyJustAnswered(null);
    setInspectingDailyIndex(null);
    setPracticeProgressByTier(loadAllPracticeDailyProgress(dateKey));
    setPracticeJustAnswered(null);
    setPvIndex(0);
    hasSyncedInitialIndicesRef.current = null;
  }, [dateKey]);

  const loadDataset = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}data/positions.json`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while loading positions.json`);
      }
      const data = (await response.json()) as Partial<PositionDataset>;
      if (!data || !Array.isArray(data.positions) || data.positions.length === 0) {
        throw new Error('Dataset contains no positions.');
      }
      setPositions(data.positions);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Unable to load puzzle dataset.';
      setLoadError(message);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadDataset();
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [loadDataset]);

  const dailyPositions = useMemo(
    () => selectDailyPositions(positions, dateKey),
    [positions, dateKey]
  );

  const dailyIdSet = useMemo(
    () => new Set(dailyPositions.map((p) => p.id)),
    [dailyPositions]
  );

  const practicePositionsByTier = useMemo<Record<DifficultyTier, Position[]>>(
    () => ({
      1: selectDailyPracticePositions(positions, dateKey, 1, dailyIdSet),
      2: selectDailyPracticePositions(positions, dateKey, 2, dailyIdSet),
      3: selectDailyPracticePositions(positions, dateKey, 3, dailyIdSet),
    }),
    [positions, dateKey, dailyIdSet]
  );

  // Sync initial resume indices for Daily 5 and all 3 Practice tiers once positions load or date changes
  useEffect(() => {
    if (
      dailyPositions.length === 0 ||
      dailyProgress.dateKey !== dateKey ||
      practiceProgressByTier[1].dateKey !== dateKey
    ) {
      return;
    }
    if (hasSyncedInitialIndicesRef.current !== dateKey) {
      hasSyncedInitialIndicesRef.current = dateKey;
      setDailyIndex(findFirstUnansweredIndex(dailyPositions, dailyProgress.answers));
      setPracticeIndexByTier({
        1: findFirstUnansweredIndex(
          practicePositionsByTier[1],
          practiceProgressByTier[1].answers
        ),
        2: findFirstUnansweredIndex(
          practicePositionsByTier[2],
          practiceProgressByTier[2].answers
        ),
        3: findFirstUnansweredIndex(
          practicePositionsByTier[3],
          practiceProgressByTier[3].answers
        ),
      });
    }
  }, [
    dailyPositions,
    dailyProgress.dateKey,
    dailyProgress.answers,
    practicePositionsByTier,
    practiceProgressByTier,
    dateKey,
  ]);

  const activePracticePositions = practicePositionsByTier[practiceTier];
  const activePracticeProgress = practiceProgressByTier[practiceTier];
  const activePracticeIndex = practiceIndexByTier[practiceTier];

  const practiceTierSummaries = useMemo<Record<DifficultyTier, TierProgressSummary>>(
    () => ({
      1: {
        answered: practiceProgressByTier[1].answers.length,
        total: practicePositionsByTier[1].length || PRACTICE_DAILY_LIMIT,
        completed: practiceProgressByTier[1].completed,
      },
      2: {
        answered: practiceProgressByTier[2].answers.length,
        total: practicePositionsByTier[2].length || PRACTICE_DAILY_LIMIT,
        completed: practiceProgressByTier[2].completed,
      },
      3: {
        answered: practiceProgressByTier[3].answers.length,
        total: practicePositionsByTier[3].length || PRACTICE_DAILY_LIMIT,
        completed: practiceProgressByTier[3].completed,
      },
    }),
    [practiceProgressByTier, practicePositionsByTier]
  );

  const remainingPracticeByTier = useMemo<Record<DifficultyTier, number>>(
    () => ({
      1: practiceProgressByTier[1].completed
        ? 0
        : Math.max(
            0,
            practicePositionsByTier[1].length - practiceProgressByTier[1].answers.length
          ),
      2: practiceProgressByTier[2].completed
        ? 0
        : Math.max(
            0,
            practicePositionsByTier[2].length - practiceProgressByTier[2].answers.length
          ),
      3: practiceProgressByTier[3].completed
        ? 0
        : Math.max(
            0,
            practicePositionsByTier[3].length - practiceProgressByTier[3].answers.length
          ),
    }),
    [practiceProgressByTier, practicePositionsByTier]
  );

  // Resolve what is currently displayed
  const showDailySummary =
    mode === 'daily' &&
    dailyProgress.completed &&
    dailyJustAnswered === null &&
    inspectingDailyIndex === null;

  const showPracticeTierComplete =
    mode === 'practice' &&
    activePracticePositions.length > 0 &&
    activePracticeProgress.completed &&
    practiceJustAnswered === null;

  const activeDailyIndex =
    inspectingDailyIndex !== null ? inspectingDailyIndex : dailyIndex;

  const currentPosition: Position | null = useMemo(() => {
    if (mode === 'daily') {
      if (showDailySummary) {
        return null;
      }
      return dailyPositions[activeDailyIndex] ?? null;
    }
    if (showPracticeTierComplete) {
      return null;
    }
    return activePracticePositions[activePracticeIndex] ?? null;
  }, [
    mode,
    showDailySummary,
    dailyPositions,
    activeDailyIndex,
    showPracticeTierComplete,
    activePracticePositions,
    activePracticeIndex,
  ]);

  // Determine whether feedback is currently open and what guess was made
  const activeFeedbackGuess: boolean | null = useMemo(() => {
    if (!currentPosition) {
      return null;
    }
    if (mode === 'daily') {
      if (inspectingDailyIndex !== null) {
        const stored = dailyProgress.answers.find(
          (a) => a.positionId === currentPosition.id
        );
        return stored ? stored.guessedAdvantage : null;
      }
      if (dailyJustAnswered && dailyJustAnswered.positionId === currentPosition.id) {
        return dailyJustAnswered.guessedAdvantage;
      }
      return null;
    }
    if (
      practiceJustAnswered &&
      practiceJustAnswered.tier === practiceTier &&
      practiceJustAnswered.positionId === currentPosition.id
    ) {
      return practiceJustAnswered.guessedAdvantage;
    }
    return null;
  }, [
    currentPosition,
    mode,
    inspectingDailyIndex,
    dailyProgress.answers,
    dailyJustAnswered,
    practiceJustAnswered,
    practiceTier,
  ]);

  const isFeedbackOpen = activeFeedbackGuess !== null;

  // Reset PV stepper when card changes
  useEffect(() => {
    setPvIndex(0);
  }, [currentPosition?.id]);

  const pvStates = useMemo(() => {
    if (!currentPosition) {
      return [];
    }
    return buildPvStates(
      currentPosition.fen,
      currentPosition.pv,
      currentPosition.lastMove
    );
  }, [currentPosition]);

  const displayedState = pvStates[pvIndex] ?? pvStates[0];

  const bestMoveArrow: [string, string] | null = useMemo(() => {
    if (!currentPosition || !isFeedbackOpen || pvIndex !== 0) {
      return null;
    }
    if (currentPosition.bestMove.length < 4) {
      return null;
    }
    const parsed = parseUciMove(currentPosition.bestMove);
    if (!isValidSquare(parsed.from) || !isValidSquare(parsed.to)) {
      return null;
    }
    return [parsed.from, parsed.to];
  }, [currentPosition, isFeedbackOpen, pvIndex]);

  const handleSwipe = useCallback(
    (guessedAdvantage: boolean) => {
      if (!currentPosition || isFeedbackOpen) {
        return;
      }

      if (mode === 'daily') {
        const correct = guessedAdvantage === currentPosition.hasAdvantage;
        const { progress, streak } = recordDailyAnswer(
          dateKey,
          {
            positionId: currentPosition.id,
            guessedAdvantage,
            correct,
          },
          dailyPositions.length
        );
        setDailyProgress(progress);
        setDailyStreak(streak);
        setDailyJustAnswered({
          positionId: currentPosition.id,
          guessedAdvantage,
        });
        setPvIndex(0);
      } else {
        const correct = guessedAdvantage === currentPosition.hasAdvantage;
        const { progress, isNew } = recordPracticeDailyAnswer(
          dateKey,
          practiceTier,
          {
            positionId: currentPosition.id,
            guessedAdvantage,
            correct,
          },
          activePracticePositions.length
        );
        setPracticeProgressByTier((prev) => ({
          ...prev,
          [practiceTier]: progress,
        }));
        if (isNew) {
          const updatedStats = recordPracticeAnswer(
            currentPosition.id,
            currentPosition.hasAdvantage,
            guessedAdvantage
          );
          setPracticeStats(updatedStats);
        }
        setPracticeJustAnswered({
          tier: practiceTier,
          positionId: currentPosition.id,
          guessedAdvantage,
        });
        setPvIndex(0);
      }
    },
    [
      currentPosition,
      isFeedbackOpen,
      mode,
      dateKey,
      dailyPositions.length,
      practiceTier,
      activePracticePositions.length,
    ]
  );

  const handleNext = useCallback(() => {
    if (mode === 'daily') {
      if (inspectingDailyIndex !== null) {
        setInspectingDailyIndex(null);
        setPvIndex(0);
        return;
      }
      setDailyJustAnswered(null);
      setPvIndex(0);
      if (!dailyProgress.completed) {
        setDailyIndex(findFirstUnansweredIndex(dailyPositions, dailyProgress.answers));
      }
    } else {
      setPracticeJustAnswered(null);
      setPvIndex(0);
      if (!activePracticeProgress.completed) {
        const nextIdx = findFirstUnansweredIndex(
          activePracticePositions,
          activePracticeProgress.answers
        );
        setPracticeIndexByTier((prev) => ({
          ...prev,
          [practiceTier]: nextIdx,
        }));
      }
    }
  }, [
    mode,
    inspectingDailyIndex,
    dailyProgress.completed,
    dailyProgress.answers,
    dailyPositions,
    activePracticeProgress.completed,
    activePracticeProgress.answers,
    activePracticePositions,
    practiceTier,
  ]);

  const handlePracticeTierChange = useCallback(
    (nextTier: DifficultyTier) => {
      setPracticeTier(nextTier);
      setPracticeJustAnswered(null);
      setPvIndex(0);
      const nextIdx = findFirstUnansweredIndex(
        practicePositionsByTier[nextTier],
        practiceProgressByTier[nextTier].answers
      );
      setPracticeIndexByTier((prev) => ({
        ...prev,
        [nextTier]: nextIdx,
      }));
    },
    [practicePositionsByTier, practiceProgressByTier]
  );

  const handleModeChange = useCallback(
    (nextMode: GameMode) => {
      setMode(nextMode);
      setInspectingDailyIndex(null);
      setDailyJustAnswered(null);
      setPracticeJustAnswered(null);
      setPvIndex(0);
      if (dailyPositions.length > 0 && !dailyProgress.completed) {
        setDailyIndex(findFirstUnansweredIndex(dailyPositions, dailyProgress.answers));
      }
      setPracticeIndexByTier({
        1: findFirstUnansweredIndex(
          practicePositionsByTier[1],
          practiceProgressByTier[1].answers
        ),
        2: findFirstUnansweredIndex(
          practicePositionsByTier[2],
          practiceProgressByTier[2].answers
        ),
        3: findFirstUnansweredIndex(
          practicePositionsByTier[3],
          practiceProgressByTier[3].answers
        ),
      });
    },
    [
      dailyPositions,
      dailyProgress.completed,
      dailyProgress.answers,
      practicePositionsByTier,
      practiceProgressByTier,
    ]
  );

  // Keyboard shortcuts: ArrowLeft / a = Equal, ArrowRight / d = Advantage, Enter / Space = Next
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (
        target &&
        (target.closest('input, textarea, select') !== null ||
          (target instanceof HTMLElement && target.isContentEditable))
      ) {
        return;
      }
      if (loading || loadError || !currentPosition) {
        return;
      }

      if (!isFeedbackOpen) {
        if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
          event.preventDefault();
          handleSwipe(false);
        } else if (
          event.key === 'ArrowRight' ||
          event.key === 'd' ||
          event.key === 'D'
        ) {
          event.preventDefault();
          handleSwipe(true);
        }
      } else if (event.key === 'Enter' || event.key === ' ') {
        if (target?.closest('button, a, select, [role="tab"]')) {
          return;
        }
        event.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading, loadError, currentPosition, isFeedbackOpen, handleSwipe, handleNext]);

  const headerStreak =
    mode === 'daily'
      ? getActiveDailyStreak(dailyStreak, dateKey)
      : practiceStats.currentStreak;

  const dailyAnswerMap = useMemo(
    () => new Map(dailyProgress.answers.map((a) => [a.positionId, a])),
    [dailyProgress.answers]
  );

  const nextButtonLabel = useMemo(() => {
    if (mode === 'daily') {
      if (inspectingDailyIndex !== null) {
        return 'Back to Summary';
      }
      if (dailyProgress.completed || dailyIndex >= dailyPositions.length - 1) {
        return 'View Results';
      }
      return 'Next Puzzle';
    }
    if (
      activePracticeProgress.completed ||
      activePracticeIndex >= activePracticePositions.length - 1
    ) {
      return 'Finish Tier';
    }
    return 'Next Position';
  }, [
    mode,
    inspectingDailyIndex,
    dailyProgress.completed,
    dailyIndex,
    dailyPositions.length,
    activePracticeProgress.completed,
    activePracticeIndex,
    activePracticePositions.length,
  ]);

  const feedbackOutcome: 'correct' | 'incorrect' | null =
    currentPosition && activeFeedbackGuess !== null
      ? activeFeedbackGuess === currentPosition.hasAdvantage
        ? 'correct'
        : 'incorrect'
      : null;

  // Height-aware card width cap so short Android viewports never clip and desktop feels balanced
  const cardSizeCapClass =
    mode === 'daily'
      ? 'max-w-[min(100%,calc(100dvh-268px))] md:max-w-[min(520px,calc(100dvh-248px))]'
      : 'max-w-[min(100%,calc(100dvh-318px))] md:max-w-[min(520px,calc(100dvh-292px))]';

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-md md:max-w-[580px] flex-col overflow-hidden bg-[#0b1120] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-slate-100">
      <Header
        mode={mode}
        onModeChange={handleModeChange}
        streak={headerStreak}
        dailyCompleted={dailyProgress.completed}
      />

      {/* Loading Skeleton */}
      {loading && (
        <main className="flex flex-1 flex-col justify-between px-3 pb-3 pt-2 min-h-0">
          <div className="flex flex-1 items-center justify-center min-h-0">
            <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-268px))] md:max-w-[min(520px,calc(100dvh-248px))] rounded-2xl bg-slate-900/80 p-2.5 ring-1 ring-slate-800">
              <div className="mb-2 flex items-center justify-between">
                <div className="h-4 w-36 animate-pulse rounded bg-slate-800" />
                <div className="h-4 w-16 animate-pulse rounded bg-slate-800" />
              </div>
              <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl bg-slate-800/70">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
                <span className="text-xs font-semibold tracking-wide text-slate-300">
                  Loading positions...
                </span>
              </div>
            </div>
          </div>
          <div className="grid min-h-[146px] grid-cols-2 gap-3 pt-3">
            <div className="h-16 animate-pulse rounded-2xl bg-slate-900 ring-1 ring-slate-800" />
            <div className="h-16 animate-pulse rounded-2xl bg-slate-900 ring-1 ring-slate-800" />
          </div>
        </main>
      )}

      {/* Error State */}
      {!loading && loadError && (
        <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="w-full rounded-2xl bg-slate-900/95 p-6 ring-1 ring-slate-800 shadow-xl">
            <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
            <h2 className="mt-3 text-base font-bold text-slate-100">
              Dataset Unavailable
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              {loadError}
            </p>
            <p className="mt-2 text-[11px] text-slate-500">
              Ensure <code className="text-slate-300">data/positions.json</code> is
              present in <code className="text-slate-300">web/public/data/</code>.
            </p>
            <button
              type="button"
              onClick={() => void loadDataset()}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try Again
            </button>
          </div>
        </main>
      )}

      {/* Main Content */}
      {!loading && !loadError && (
        <>
          {/* Daily Progress Bar (hidden on Summary) */}
          {mode === 'daily' && !showDailySummary && dailyPositions.length > 0 && (
            <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1.5">
              <div className="flex flex-1 items-center gap-1.5">
                {dailyPositions.map((pos, idx) => {
                  const ans = dailyAnswerMap.get(pos.id);
                  const isCurrent = idx === activeDailyIndex;
                  const barClass = ans
                    ? ans.correct
                      ? 'bg-emerald-400'
                      : 'bg-rose-400'
                    : isCurrent
                      ? 'bg-slate-400'
                      : 'bg-slate-800';
                  return (
                    <div
                      key={pos.id}
                      className={`h-1.5 flex-1 rounded-full transition-all ${barClass} ${
                        isCurrent ? 'ring-2 ring-slate-200/40' : ''
                      }`}
                    />
                  );
                })}
              </div>
              <span className="text-[11px] font-semibold text-slate-400">
                #{puzzleNumber}
              </span>
            </div>
          )}

          {/* Practice Difficulty Tabs + Lifetime Stats Bar */}
          {mode === 'practice' && (
            <PracticeControls
              tierFilter={practiceTier}
              onTierFilterChange={handlePracticeTierChange}
              progressByTier={practiceTierSummaries}
              stats={practiceStats}
            />
          )}

          {/* Daily Summary View */}
          {showDailySummary ? (
            <DailySummary
              puzzleNumber={puzzleNumber}
              positions={dailyPositions}
              answers={dailyProgress.answers}
              streak={dailyStreak}
              onInspectPuzzle={(idx) => {
                setInspectingDailyIndex(idx);
                setPvIndex(0);
              }}
              onPlayPractice={() => handleModeChange('practice')}
            />
          ) : showPracticeTierComplete ? (
            /* Practice Difficulty Complete View */
            <PracticeTierComplete
              tier={practiceTier}
              positions={activePracticePositions}
              answers={activePracticeProgress.answers}
              remainingByTier={remainingPracticeByTier}
              onSelectTier={handlePracticeTierChange}
              onGoToDaily={() => handleModeChange('daily')}
            />
          ) : currentPosition ? (
            /* Active Card + Bottom Action/Feedback Dock */
            <main className="flex flex-1 flex-col justify-between gap-2 overflow-hidden px-3 pb-3 pt-0.5 min-h-0">
              <div className="flex flex-1 items-center justify-center min-h-0">
                <div
                  key={currentPosition.id}
                  className={`mx-auto w-full animate-card-in ${cardSizeCapClass}`}
                >
                  <SwipeCard
                    position={currentPosition}
                    displayFen={displayedState?.fen ?? currentPosition.fen}
                    displayLastMove={displayedState?.lastMove}
                    bestMoveArrow={bestMoveArrow}
                    disabled={isFeedbackOpen}
                    slotLabel={
                      mode === 'daily'
                        ? `${activeDailyIndex + 1}/${dailyPositions.length}`
                        : `${activePracticeIndex + 1}/${activePracticePositions.length}`
                    }
                    showTier={mode === 'practice'}
                    feedbackOutcome={feedbackOutcome}
                    onSwipe={handleSwipe}
                  />
                </div>
              </div>

              {/* Stable-Height Bottom Dock */}
              <div className="shrink-0">
                {isFeedbackOpen && activeFeedbackGuess !== null ? (
                  <FeedbackPanel
                    position={currentPosition}
                    guessedAdvantage={activeFeedbackGuess}
                    pvStates={pvStates}
                    pvIndex={pvIndex}
                    onPvIndexChange={setPvIndex}
                    onNext={handleNext}
                    nextLabel={nextButtonLabel}
                  />
                ) : (
                  <div className="flex min-h-[146px] flex-col justify-center gap-2.5">
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => handleSwipe(false)}
                        className="group flex h-16 flex-col items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40 shadow-lg shadow-sky-950/30 transition hover:bg-sky-500/25 active:scale-[0.97]"
                      >
                        <div className="flex items-center gap-1.5 text-base font-extrabold tracking-tight">
                          <ArrowLeft className="h-5 w-5 transition-transform group-hover:-translate-x-0.5" />
                          Equal
                        </div>
                        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300/70">
                          Swipe Left
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSwipe(true)}
                        className="group flex h-16 flex-col items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-500/25 active:scale-[0.97]"
                      >
                        <div className="flex items-center gap-1.5 text-base font-extrabold tracking-tight">
                          Advantage
                          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
                        </div>
                        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300/70">
                          Swipe Right
                        </span>
                      </button>
                    </div>

                    <p className="text-center text-[11px] font-medium text-slate-500">
                      Drag the board or use{' '}
                      <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                        ←
                      </kbd>{' '}
                      /{' '}
                      <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                        →
                      </kbd>
                    </p>
                  </div>
                )}
              </div>
            </main>
          ) : (
            /* Empty Tier Fallback */
            <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="w-full rounded-2xl bg-slate-900/95 p-6 ring-1 ring-slate-800 shadow-xl">
                <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
                <h2 className="mt-3 text-base font-bold text-slate-100">
                  No Practice Positions Available
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  There are no extra positions available for this difficulty right now.
                  Try another difficulty tab above.
                </p>
              </div>
            </main>
          )}
        </>
      )}
    </div>
  );
}
