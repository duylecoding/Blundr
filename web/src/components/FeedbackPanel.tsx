import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  SkipBack,
  XCircle,
} from 'lucide-react';
import type { Position } from '../types';
import { formatEval, type PvState } from '../lib/chessUtils';

interface FeedbackPanelProps {
  position: Position;
  guessedAdvantage: boolean;
  pvStates: readonly PvState[];
  pvIndex: number;
  onPvIndexChange: (nextIndex: number) => void;
  onNext: () => void;
  nextLabel: string;
}

const STYLE_BADGE: Record<Position['style'], { label: string; className: string }> = {
  tactical: {
    label: 'Tactical',
    className: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  },
  positional: {
    label: 'Positional',
    className: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  },
  equal: {
    label: 'Equal',
    className: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  },
};

export function FeedbackPanel({
  position,
  guessedAdvantage,
  pvStates,
  pvIndex,
  onPvIndexChange,
  onNext,
  nextLabel,
}: FeedbackPanelProps) {
  const isCorrect = guessedAdvantage === position.hasAdvantage;
  const evalBeforeStr = formatEval(position.evalBefore, null, position.sideToMove);
  const evalAfterStr = formatEval(position.evalAfter, position.mateIn, position.sideToMove);

  const verdictLabel =
    position.mateIn !== null
      ? `Forced Mate (${evalAfterStr})`
      : position.hasAdvantage
        ? `Advantage (${evalAfterStr})`
        : `Equal (${evalAfterStr})`;

  const styleInfo = STYLE_BADGE[position.style];
  const totalMoves = Math.max(0, pvStates.length - 1);
  const currentStep = pvStates[pvIndex];
  const stepLabel =
    pvIndex === 0
      ? totalMoves > 0
        ? `0/${totalMoves}`
        : 'Start'
      : `${pvIndex}/${totalMoves} ${currentStep?.san ?? ''}`;

  const canStepBack = pvIndex > 0;
  const canStepForward = pvIndex < totalMoves;

  return (
    <div className="flex min-h-[146px] flex-col justify-between rounded-2xl bg-slate-900/95 p-3 ring-1 ring-slate-800 shadow-lg">
      {/* Top Row: Result + Verdict + Style */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isCorrect ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/30">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Correct
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-bold text-rose-300 ring-1 ring-rose-500/30">
              <XCircle className="h-3.5 w-3.5" />
              Missed
            </span>
          )}
          <span
            className={`text-sm font-bold truncate ${
              position.hasAdvantage ? 'text-emerald-300' : 'text-sky-300'
            }`}
          >
            {verdictLabel}
          </span>
        </div>

        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${styleInfo.className}`}
        >
          {styleInfo.label}
        </span>
      </div>

      {/* Middle Row: Swing + Interactive PV Stepper */}
      <div className="flex items-center justify-between gap-2 py-1.5 min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
          <span className="hidden min-[390px]:inline text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
            Swing
          </span>
          <span className="whitespace-nowrap rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-200">
            {evalBeforeStr} → {evalAfterStr}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onPvIndexChange(0)}
            disabled={!canStepBack}
            aria-label="Reset line to start"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-slate-800"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onPvIndexChange(Math.max(0, pvIndex - 1))}
            disabled={!canStepBack}
            aria-label="Previous move"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-slate-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[66px] whitespace-nowrap text-center font-mono text-[11px] font-semibold text-slate-200">
            {stepLabel}
          </span>
          <button
            type="button"
            onClick={() => onPvIndexChange(Math.min(totalMoves, pvIndex + 1))}
            disabled={!canStepForward}
            aria-label="Next move"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-slate-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Bottom Row: Lichess Link + Primary Next Action */}
      <div className="flex items-center gap-2">
        <a
          href={position.gameUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-3 text-xs font-semibold text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700"
        >
          Lichess
          <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
        </a>
        <button
          type="button"
          onClick={onNext}
          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-slate-950 shadow-md shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-[0.98]"
        >
          {nextLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
