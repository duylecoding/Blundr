/**
 * Interactive 5-slot progress bar for Daily 5; clicking any answered slot jumps straight to its review.
 */
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

          return (
            <button
              key={pos.id}
              type="button"
              disabled={!canSelect}
              onClick={() => onSelectSlot(idx)}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`Puzzle ${idx + 1} (${statusLabel})`}
              title={canSelect ? `Jump to puzzle ${idx + 1}` : undefined}
              className={`group flex flex-1 items-center py-1.5 focus:outline-none ${
                canSelect ? 'cursor-pointer' : 'cursor-default'
              }`}
            >
              <span
                className={`block h-1.5 w-full rounded-full transition-all ${barClass} ${
                  isCurrent
                    ? 'h-2 ring-2 ring-slate-200/60'
                    : canSelect
                      ? 'group-hover:h-2 group-hover:brightness-125 group-focus-visible:ring-2 group-focus-visible:ring-slate-200/70'
                      : ''
                }`}
              />
            </button>
          );
        })}
      </div>
      <span className="text-[11px] font-semibold text-slate-400">#{puzzleNumber}</span>
    </div>
  );
}
