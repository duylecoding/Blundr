/**
 * Post-swipe answer verdict, eval swing, unmistakable Best Line stepper, and Next action.
 */
import { ArrowRight, CheckCircle2, ExternalLink, RotateCcw, XCircle } from 'lucide-react';
import { LAYOUT_CAPS, STYLE_BADGE_CONFIG } from '../config/constants';
import { formatEval, type BestLineState } from '../domain/bestLine';
import { getSafeGameUrl } from '../domain/validateDataset';
import type { Position } from '../types';

interface AnswerReviewProps {
  position: Position;
  guessedAdvantage: boolean;
  lineStates: readonly BestLineState[];
  lineIndex: number;
  onLineIndexChange: (nextIndex: number) => void;
  onNext: () => void;
  nextLabel: string;
}

export function AnswerReview({
  position,
  guessedAdvantage,
  lineStates,
  lineIndex,
  onLineIndexChange,
  onNext,
  nextLabel,
}: AnswerReviewProps) {
  const isCorrect = guessedAdvantage === position.hasAdvantage;
  const evalBeforeStr = formatEval(position.evalBefore, null, position.sideToMove);
  const evalAfterStr = formatEval(position.evalAfter, position.mateIn, position.sideToMove);

  const verdictLabel =
    position.mateIn !== null
      ? `Forced Mate (${evalAfterStr})`
      : position.hasAdvantage
        ? `Advantage (${evalAfterStr})`
        : `Equal (${evalAfterStr})`;

  const styleMeta = STYLE_BADGE_CONFIG[position.style];
  const totalMoves = Math.max(0, lineStates.length - 1);
  const currentSan = lineStates[lineIndex]?.san;
  const firstMoveSan = lineStates[1]?.san;
  const moveReadout =
    totalMoves === 0
      ? 'Start'
      : lineIndex === 0
        ? firstMoveSan
          ? `0/${totalMoves} · ${firstMoveSan}`
          : `0/${totalMoves}`
        : `${lineIndex}/${totalMoves} · ${currentSan ?? ''}`;

  const canStepBack = lineIndex > 0;
  const canStepForward = lineIndex < totalMoves;
  const safeGameUrl = getSafeGameUrl(position.gameUrl);

  return (
    <div
      className={`flex ${LAYOUT_CAPS.dockMinHeight} flex-col justify-between gap-2 rounded-2xl bg-slate-900/95 p-3 ring-1 ring-slate-800 shadow-lg`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {isCorrect ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/30">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Correct
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-300 ring-1 ring-rose-500/30">
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

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden min-[400px]:inline whitespace-nowrap rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
            {evalBeforeStr}→{evalAfterStr}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${styleMeta.className}`}
          >
            {styleMeta.label}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/80 px-2.5 py-1.5 ring-1 ring-emerald-500/30">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-emerald-400">
            Best line
          </span>
          <span className="truncate rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-100">
            {moveReadout}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onLineIndexChange(0)}
            disabled={!canStepBack}
            aria-label="Reset best line"
            title="Reset line"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onLineIndexChange(Math.max(0, lineIndex - 1))}
            disabled={!canStepBack}
            aria-label="Previous move"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-xs font-bold text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-slate-800"
          >
            ◀
          </button>
          <button
            type="button"
            onClick={() => onLineIndexChange(Math.min(totalMoves, lineIndex + 1))}
            disabled={!canStepForward}
            aria-label="Step forward in best line"
            className="h-8 rounded-lg bg-emerald-500/20 px-2.5 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-400/50 transition hover:bg-emerald-500/30 disabled:bg-slate-800 disabled:text-slate-400 disabled:ring-slate-700 disabled:opacity-35"
          >
            Step ▶
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {safeGameUrl && (
          <a
            href={safeGameUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-3 text-xs font-semibold text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700"
          >
            Lichess
            <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
          </a>
        )}
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
