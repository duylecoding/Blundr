/**
 * Interactive swipeable chess card with metadata header, directional stamps, and BoardView.
 */
import { useEffect } from 'react';
import { animate, motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { SWIPE_CONFIG, TIER_CONFIG } from '../config/constants';
import type { FeedbackOutcome, Position } from '../types';
import { BoardView } from './BoardView';

interface SwipeCardProps {
  position: Position;
  displayFen: string;
  displayLastMove?: [string, string];
  bestMoveArrow?: [string, string] | null;
  disabled: boolean;
  slotLabel: string | null;
  showTier: boolean;
  feedbackOutcome: FeedbackOutcome;
  onSwipe: (guessedAdvantage: boolean) => void;
}

export function SwipeCard({
  position,
  displayFen,
  displayLastMove,
  bestMoveArrow,
  disabled,
  slotLabel,
  showTier,
  feedbackOutcome,
  onSwipe,
}: SwipeCardProps) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-10, 0, 10]);
  const advantageOpacity = useTransform(x, [22, 105], [0, 1]);
  const equalOpacity = useTransform(x, [-105, -22], [1, 0]);
  const rightGlowOpacity = useTransform(x, [10, 120], [0, 0.32]);
  const leftGlowOpacity = useTransform(x, [-120, -10], [0.32, 0]);

  useEffect(() => {
    x.set(0);
  }, [position.id, x]);

  useEffect(() => {
    if (disabled) animate(x, 0, SWIPE_CONFIG.spring);
  }, [disabled, x]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (disabled) return;
    const { distanceThreshold, velocityMinOffset, velocityThreshold, spring } = SWIPE_CONFIG;
    const swipedRight =
      info.offset.x > distanceThreshold ||
      (info.offset.x > velocityMinOffset && info.velocity.x > velocityThreshold);
    const swipedLeft =
      info.offset.x < -distanceThreshold ||
      (info.offset.x < -velocityMinOffset && info.velocity.x < -velocityThreshold);

    // Recenter immediately so the player can inspect the board and best line after swiping.
    animate(x, 0, spring);
    if (swipedRight) onSwipe(true);
    else if (swipedLeft) onSwipe(false);
  };

  const isWhiteToMove = position.sideToMove === 'w';
  const lastMoveDisplay = isWhiteToMove ? `...${position.lastMoveSan}` : position.lastMoveSan;
  const tierMeta = TIER_CONFIG[position.tier];
  const cardRingClass =
    feedbackOutcome === 'correct'
      ? 'ring-2 ring-emerald-400/80 shadow-emerald-500/10'
      : feedbackOutcome === 'incorrect'
        ? 'ring-2 ring-rose-400/80 shadow-rose-500/10'
        : 'ring-1 ring-slate-700/80';

  return (
    <motion.div
      style={{ x, rotate }}
      drag={disabled ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={SWIPE_CONFIG.dragElastic}
      onDragEnd={handleDragEnd}
      whileTap={disabled ? undefined : { cursor: 'grabbing' }}
      className={`relative w-full rounded-2xl bg-slate-900/95 p-2.5 shadow-2xl transition-shadow select-none ${
        disabled ? 'cursor-default' : 'cursor-grab'
      } ${cardRingClass}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-block h-3 w-3 shrink-0 rounded-full ring-2 ${
              isWhiteToMove ? 'bg-slate-100 ring-slate-400/60' : 'bg-slate-950 ring-slate-400'
            }`}
            aria-hidden="true"
          />
          <span className="font-semibold text-slate-100 truncate">
            {isWhiteToMove ? 'White to move' : 'Black to move'}
          </span>
          <span className="shrink-0 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] font-medium text-amber-300">
            Last: {lastMoveDisplay}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {slotLabel && (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-200 ring-1 ring-slate-700">
              {slotLabel}
            </span>
          )}
          {showTier && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tierMeta.badgeClass}`}>
              {tierMeta.label}
            </span>
          )}
          <span className="text-[11px] font-medium text-slate-400">~{Math.round(position.avgElo)}</span>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl">
        <BoardView
          fen={displayFen}
          orientation={isWhiteToMove ? 'white' : 'black'}
          lastMove={displayLastMove}
          bestMoveArrow={bestMoveArrow}
        />

        {!disabled && (
          <>
            <motion.div style={{ opacity: rightGlowOpacity }} className="pointer-events-none absolute inset-0 bg-emerald-500" />
            <motion.div style={{ opacity: leftGlowOpacity }} className="pointer-events-none absolute inset-0 bg-sky-500" />
            <motion.div
              style={{ opacity: advantageOpacity }}
              className="pointer-events-none absolute top-5 left-5 -rotate-12 rounded-xl border-[3px] border-emerald-400 bg-slate-950/85 px-3.5 py-1.5 shadow-lg backdrop-blur-sm"
            >
              <span className="text-lg font-black tracking-wider text-emerald-400">ADVANTAGE</span>
            </motion.div>
            <motion.div
              style={{ opacity: equalOpacity }}
              className="pointer-events-none absolute top-5 right-5 rotate-12 rounded-xl border-[3px] border-sky-400 bg-slate-950/85 px-3.5 py-1.5 shadow-lg backdrop-blur-sm"
            >
              <span className="text-lg font-black tracking-wider text-sky-400">EQUAL</span>
            </motion.div>
          </>
        )}
      </div>
    </motion.div>
  );
}
