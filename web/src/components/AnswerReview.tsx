/**
 * Post-swipe verdict, visual advantage meter + finding-difficulty insight, Best Line stepper, and Next action.
 */
import { ArrowRight, CheckCircle2, ExternalLink, RotateCcw, XCircle } from 'lucide-react';
import { LAYOUT_CAPS, STYLE_BADGE_CONFIG, TIER_CONFIG } from '../config/constants';
import { summarizePositionAdvantage } from '../domain/advantageSummary';
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
  const totalMoves = Math.max(0, lineStates.length - 1);
  const currentSan = lineStates[lineIndex]?.san;
  const firstMoveSan = lineStates[1]?.san;
  const summary = summarizePositionAdvantage(position, firstMoveSan);

  const tierMeta = TIER_CONFIG[position.tier];
  const styleMeta = STYLE_BADGE_CONFIG[position.style];
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
  const fillColor = position.hasAdvantage ? 'bg-emerald-400' : 'bg-sky-400';

  return (
    <div
      className={`flex ${LAYOUT_CAPS.dockMinHeight} flex-col justify-between gap-1.5 rounded-2xl bg-slate-900/95 p-2.5 ring-1 ring-slate-800 shadow-lg`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {isCorrect ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-500/30">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Correct
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-300 ring-1 ring-rose-500/30">
              <XCircle className="h-3.5 w-3.5" />
              Missed
            </span>
          )}
          <span
            className={`text-xs sm:text-sm font-bold truncate ${
              position.hasAdvantage ? 'text-emerald-300' : 'text-sky-300'
            }`}
          >
            {summary.headline}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${tierMeta.badgeClass}`}>
            {tierMeta.label}
          </span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${styleMeta.className}`}>
            {styleMeta.label}
          </span>
        </div>
      </div>

      <div className="space-y-1 rounded-xl bg-slate-950/70 px-2.5 py-1.5 ring-1 ring-slate-800/80">
        <div className="flex items-center gap-2">
          <div
            className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800"
            role="meter"
            aria-label="Position advantage meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.evalBarPercent}
            aria-valuetext={summary.headline}
          >
            <span
              className={`absolute top-0 bottom-0 rounded-full transition-all duration-500 ease-out ${fillColor}`}
              style={{
                left: `${summary.fillLeftPercent}%`,
                width: `${summary.fillWidthPercent}%`,
              }}
            />
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-slate-300/60"
            />
          </div>
          <span className="shrink-0 whitespace-nowrap font-mono text-[10px] font-semibold text-slate-300">
            {evalBeforeStr} → {evalAfterStr}
          </span>
        </div>
        <p className="truncate text-[11px] font-medium text-slate-300" title={summary.difficultyNote}>
          {summary.difficultyNote}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/80 px-2.5 py-1 ring-1 ring-emerald-500/30">
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
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onLineIndexChange(Math.max(0, lineIndex - 1))}
            disabled={!canStepBack}
            aria-label="Previous move"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-xs font-bold text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-slate-800"
          >
            ◀
          </button>
          <button
            type="button"
            onClick={() => onLineIndexChange(Math.min(totalMoves, lineIndex + 1))}
            disabled={!canStepForward}
            aria-label="Step forward in best line"
            className="h-7 rounded-lg bg-emerald-500/20 px-2.5 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-400/50 transition hover:bg-emerald-500/30 disabled:bg-slate-800 disabled:text-slate-400 disabled:ring-slate-700 disabled:opacity-35"
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
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-3 text-xs font-semibold text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700"
          >
            Lichess
            <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
          </a>
        )}
        <button
          type="button"
          onClick={onNext}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-slate-950 shadow-md shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-[0.98]"
        >
          {nextLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
