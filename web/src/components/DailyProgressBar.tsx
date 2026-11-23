/**
 * Interactive 5-slot progress bar for Daily 5 showing difficulty ramp (E/M/H) and jump-to-review.
 */
import { TIER_CONFIG } from '../config/constants';
import type { DailyAnswer, Position } from '../types';

interface DailyProgressBarProps {
  puzzleNumber: number;
  positions: readonly Position[];
  answerMap: ReadonlyMap<string, DailyAnswer>;
  activeIndex: number;
  playableIndex: number | null;
  onSelectSlot: (index: number) => void;
}

export function DailyProgressBar({
  puzzleNumber,
  positions,
  answerMap,
  activeIndex,
  playableIndex,
  onSelectSlot,
}: DailyProgressBarProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1">
      <div className="flex flex-1 items-center gap-1.5">
        {positions.map((pos, idx) => {
          const ans = answerMap.get(pos.id);
          const isCurrent = idx === activeIndex;
          const isPlayable = playableIndex !== null && idx === playableIndex;
          const canSelect = ans !== undefined || isPlayable;
          const tierMeta = TIER_CONFIG[pos.tier];

          const barClass = ans
            ? ans.correct
              ? 'bg-emerald-400'
              : 'bg-rose-400'
            : isCurrent || isPlayable
              ? 'bg-slate-400'
              : 'bg-slate-800';

          const statusLabel = ans
            ? ans.correct
              ? 'Correct'
              : 'Missed'
            : isPlayable
              ? 'Current'
              : 'Locked';

          const slotDescription = `Puzzle ${idx + 1} · ${tierMeta.label} (${statusLabel})`;

          return (
            <button
              key={pos.id}
              type="button"
              disabled={!canSelect}
              onClick={() => onSelectSlot(idx)}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={slotDescription}
              title={slotDescription}
              className={`group flex flex-1 flex-col items-center gap-0.5 py-0.5 focus:outline-none ${
                canSelect ? 'cursor-pointer' : 'cursor-default'
              }`}
            >
              <span className="flex h-2 w-full items-center">
                <span
                  className={`block w-full rounded-full transition-all ${barClass} ${
                    isCurrent
                      ? 'h-2 ring-2 ring-slate-200/60'
                      : canSelect
                        ? 'h-1.5 group-hover:h-2 group-hover:brightness-125 group-focus-visible:ring-2 group-focus-visible:ring-slate-200/70'
                        : 'h-1.5'
                  }`}
                />
              </span>
              <span
                aria-hidden="true"
                className={`text-[9px] font-bold leading-none tracking-wider ${
                  isCurrent
                    ? tierMeta.accentTextClass
                    : ans
                      ? `${tierMeta.accentTextClass} opacity-75`
                      : 'text-slate-500'
                }`}
              >
                {tierMeta.shortLabel}
              </span>
            </button>
          );
        })}
      </div>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-400">
        #{puzzleNumber}
      </span>
    </div>
  );
}
