import { useEffect } from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'framer-motion';
import type { Position } from '../types';
import { ChessBoard } from './ChessBoard';

interface SwipeCardProps {
  position: Position;
  displayFen: string;
  displayLastMove?: [string, string];
  bestMoveArrow?: [string, string] | null;
  disabled: boolean;
  /** Daily slot label e.g. "1/5", or null in Practice mode */
  slotLabel: string | null;
  /** Whether to show tier pill (shown in Practice mode) */
  showTier: boolean;
  /** Highlight border once answered */
  feedbackOutcome: 'correct' | 'incorrect' | null;
  onSwipe: (guessedAdvantage: boolean) => void;
}

const SWIPE_DISTANCE_THRESHOLD = 84;
const SWIPE_VELOCITY_THRESHOLD = 460;

const TIER_META: Record<1 | 2 | 3, { label: string; className: string }> = {
  1: {
    label: 'Easy',
    className: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  },
  2: {
    label: 'Medium',
    className: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  },
  3: {
    label: 'Hard',
    className: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  },
};

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
    if (disabled) {
      animate(x, 0, {
        type: 'spring',
        stiffness: 420,
        damping: 32,
      });
    }
  }, [disabled, x]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (disabled) {
      return;
    }
    const swipedRight =
      info.offset.x > SWIPE_DISTANCE_THRESHOLD ||
      (info.offset.x > 30 && info.velocity.x > SWIPE_VELOCITY_THRESHOLD);
    const swipedLeft =
      info.offset.x < -SWIPE_DISTANCE_THRESHOLD ||
      (info.offset.x < -30 && info.velocity.x < -SWIPE_VELOCITY_THRESHOLD);

    // Snap smoothly back to center so the player can inspect the board & PV on reveal
    animate(x, 0, {
      type: 'spring',
      stiffness: 420,
      damping: 32,
    });

    if (swipedRight) {
      onSwipe(true);
    } else if (swipedLeft) {
      onSwipe(false);
    }
  };

  const isWhiteToMove = position.sideToMove === 'w';
  const orientation = isWhiteToMove ? 'white' : 'black';
  const lastMoveDisplay = isWhiteToMove
    ? `...${position.lastMoveSan}`
    : position.lastMoveSan;
  const tierInfo = TIER_META[position.tier];

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
      dragElastic={0.82}
      onDragEnd={handleDragEnd}
      whileTap={disabled ? undefined : { cursor: 'grabbing' }}
      className={`relative w-full rounded-2xl bg-slate-900/95 p-2.5 shadow-2xl transition-shadow select-none ${
        disabled ? 'cursor-default' : 'cursor-grab'
      } ${cardRingClass}`}
    >
      {/* Compact Metadata Bar */}
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-block h-3 w-3 shrink-0 rounded-full ring-2 ${
              isWhiteToMove
                ? 'bg-slate-100 ring-slate-400/60'
                : 'bg-slate-950 ring-slate-400'
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
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tierInfo.className}`}
            >
              {tierInfo.label}
            </span>
          )}
          <span className="text-[11px] font-medium text-slate-400">
            ~{Math.round(position.avgElo)}
          </span>
        </div>
      </div>

      {/* Board + Swipe Overlays */}
      <div className="relative overflow-hidden rounded-xl">
        <ChessBoard
          fen={displayFen}
          orientation={orientation}
          lastMove={displayLastMove}
          bestMoveArrow={bestMoveArrow}
        />

        {/* Subtle directional glow */}
        {!disabled && (
          <>
            <motion.div
              style={{ opacity: rightGlowOpacity }}
              className="pointer-events-none absolute inset-0 bg-emerald-500"
            />
            <motion.div
              style={{ opacity: leftGlowOpacity }}
              className="pointer-events-none absolute inset-0 bg-sky-500"
            />

            {/* ADVANTAGE Stamp (swipe right) */}
            <motion.div
              style={{ opacity: advantageOpacity }}
              className="pointer-events-none absolute top-5 left-5 -rotate-12 rounded-xl border-[3px] border-emerald-400 bg-slate-950/85 px-3.5 py-1.5 shadow-lg backdrop-blur-sm"
            >
              <span className="text-lg font-black tracking-wider text-emerald-400">
                ADVANTAGE
              </span>
            </motion.div>

            {/* EQUAL Stamp (swipe left) */}
            <motion.div
              style={{ opacity: equalOpacity }}
              className="pointer-events-none absolute top-5 right-5 rotate-12 rounded-xl border-[3px] border-sky-400 bg-slate-950/85 px-3.5 py-1.5 shadow-lg backdrop-blur-sm"
            >
              <span className="text-lg font-black tracking-wider text-sky-400">
                EQUAL
              </span>
            </motion.div>
          </>
        )}
      </div>
    </motion.div>
  );
}
