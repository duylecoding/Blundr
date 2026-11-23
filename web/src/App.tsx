/**
 * Top-level Blundr shell composing Daily 5 and Practice hooks with swipe and review views.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnswerReview } from './components/AnswerReview';
import { DailyProgressBar } from './components/DailyProgressBar';
import { DailyResults } from './components/DailyResults';
import { DeckStatusView } from './components/DeckStatusView';
import { PracticeTabs } from './components/PracticeTabs';
import { SwipeButtons } from './components/SwipeButtons';
import { SwipeCard } from './components/SwipeCard';
import { TierComplete } from './components/TierComplete';
import { TopBar } from './components/TopBar';
import { LAYOUT_CAPS } from './config/constants';
import { buildBestLineStates, getBestMoveArrow } from './domain/bestLine';
import { getDailyPuzzleNumber } from './domain/calendar';
import { useDailyMode } from './hooks/useDailyMode';
import { useLocalDate } from './hooks/useLocalDate';
import { usePositions } from './hooks/usePositions';
import { usePracticeMode } from './hooks/usePracticeMode';
import { useSwipeKeys } from './hooks/useSwipeKeys';
import type { DifficultyTier, FeedbackOutcome, GameMode } from './types';

export function App() {
  const dateKey = useLocalDate();
  const puzzleNumber = useMemo(() => getDailyPuzzleNumber(dateKey), [dateKey]);
  const { positions, loading, error, reload } = usePositions();
  const [mode, setMode] = useState<GameMode>('daily');
  const [lineIndex, setLineIndex] = useState(0);

  const daily = useDailyMode(positions, dateKey);
  const practice = usePracticeMode(positions, dateKey, daily.idSet);
  const active = mode === 'daily' ? daily : practice;
  const { currentPosition, feedbackGuess, answer: activeAnswer, advance: activeAdvance } = active;
  const { resetOnModeSwitch: resetDaily, selectSlot: selectDailySlot } = daily;
  const { tier: activeTier, resetOnModeSwitch: resetPractice, selectTier } = practice;
  const isFeedbackOpen = feedbackGuess !== null;

  useEffect(() => setLineIndex(0), [currentPosition?.id, dateKey]);

  const lineStates = useMemo(
    () => (currentPosition ? buildBestLineStates(currentPosition.fen, currentPosition.pv, currentPosition.lastMove) : []),
    [currentPosition]
  );
  const displayed = lineStates[lineIndex] ?? lineStates[0];
  const bestMoveArrow = useMemo(
    () => (currentPosition && isFeedbackOpen && lineIndex === 0 ? getBestMoveArrow(currentPosition.bestMove) : null),
    [currentPosition, isFeedbackOpen, lineIndex]
  );

  const handleSwipe = useCallback((guessedAdv: boolean) => {
    if (!currentPosition || isFeedbackOpen) return;
    activeAnswer(guessedAdv);
    setLineIndex(0);
  }, [currentPosition, isFeedbackOpen, activeAnswer]);

  const handleNext = useCallback(() => {
    activeAdvance();
    setLineIndex(0);
  }, [activeAdvance]);

  const handleModeChange = useCallback((nextMode: GameMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    resetDaily();
    resetPractice();
    setLineIndex(0);
  }, [mode, resetDaily, resetPractice]);

  const handleTierChange = useCallback((tier: DifficultyTier) => {
    if (tier === activeTier) return;
    selectTier(tier);
    setLineIndex(0);
  }, [activeTier, selectTier]);

  const handleSelectDailySlot = useCallback((idx: number) => {
    selectDailySlot(idx);
    setLineIndex(0);
  }, [selectDailySlot]);

  useSwipeKeys({ enabled: !loading && !error && currentPosition !== null, isFeedbackOpen, onSwipe: handleSwipe, onNext: handleNext });

  const feedbackOutcome: FeedbackOutcome =
    currentPosition && feedbackGuess !== null
      ? feedbackGuess === currentPosition.hasAdvantage ? 'correct' : 'incorrect'
      : null;
  const cardCap = mode === 'daily' ? LAYOUT_CAPS.dailyCardCap : LAYOUT_CAPS.practiceCardCap;

  return (
    <div className={`mx-auto flex h-[100dvh] w-full ${LAYOUT_CAPS.appMaxWidth} flex-col overflow-hidden bg-[#0b1120] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-slate-100`}>
      <TopBar mode={mode} onModeChange={handleModeChange} streak={mode === 'daily' ? daily.activeStreak : practice.stats.currentStreak} dailyCompleted={daily.progress.completed} />

      {loading && <DeckStatusView status="loading" />}
      {!loading && error && <DeckStatusView status="error" message={error} onRetry={() => void reload()} />}

      {!loading && !error && (
        <>
          {mode === 'daily' && !daily.showSummary && daily.positions.length > 0 && (
            <DailyProgressBar
              puzzleNumber={puzzleNumber}
              positions={daily.positions}
              answerMap={daily.answerMap}
              activeIndex={daily.activeIndex}
              playableIndex={daily.playableIndex}
              onSelectSlot={handleSelectDailySlot}
            />
          )}
          {mode === 'practice' && (
            <PracticeTabs tier={practice.tier} onTierChange={handleTierChange} progressByTier={practice.tierSummaries} stats={practice.stats} />
          )}

          {mode === 'daily' && daily.showSummary ? (
            <DailyResults
              puzzleNumber={puzzleNumber}
              positions={daily.positions}
              answers={daily.progress.answers}
              streak={daily.streak}
              onInspectPuzzle={(idx) => { daily.inspect(idx); setLineIndex(0); }}
              onPlayPractice={() => handleModeChange('practice')}
            />
          ) : mode === 'practice' && practice.showTierComplete ? (
            <TierComplete
              tier={practice.tier}
              positions={practice.activePositions}
              answers={practice.activeProgress.answers}
              remainingByTier={practice.remainingByTier}
              onSelectTier={handleTierChange}
              onGoToDaily={() => handleModeChange('daily')}
            />
          ) : currentPosition ? (
            <main className="flex flex-1 flex-col justify-between gap-2 overflow-hidden px-3 pb-3 pt-0.5 min-h-0">
              <div className="flex flex-1 items-center justify-center min-h-0">
                <div key={currentPosition.id} className={`mx-auto w-full animate-card-in ${cardCap}`}>
                  <SwipeCard position={currentPosition} displayFen={displayed?.fen ?? currentPosition.fen} displayLastMove={displayed?.lastMove} bestMoveArrow={bestMoveArrow} disabled={isFeedbackOpen} slotLabel={active.slotLabel} showTier={mode === 'practice'} feedbackOutcome={feedbackOutcome} onSwipe={handleSwipe} />
                </div>
              </div>
              <div className="shrink-0">
                {isFeedbackOpen && feedbackGuess !== null ? (
                  <AnswerReview position={currentPosition} guessedAdvantage={feedbackGuess} lineStates={lineStates} lineIndex={lineIndex} onLineIndexChange={setLineIndex} onNext={handleNext} nextLabel={active.nextLabel} />
                ) : (
                  <SwipeButtons onSwipe={handleSwipe} />
                )}
              </div>
            </main>
          ) : (
            <DeckStatusView status="empty" />
          )}
        </>
      )}
    </div>
  );
}
