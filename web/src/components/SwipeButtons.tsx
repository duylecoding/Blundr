/**
 * Bottom swipe action buttons (Equal / Advantage) and keyboard shortcut hint.
 */
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { LAYOUT_CAPS } from '../config/constants';

interface SwipeButtonsProps {
  onSwipe: (guessedAdvantage: boolean) => void;
}

export function SwipeButtons({ onSwipe }: SwipeButtonsProps) {
  return (
    <div className={`flex ${LAYOUT_CAPS.dockMinHeight} flex-col justify-center gap-2.5`}>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onSwipe(false)}
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
          onClick={() => onSwipe(true)}
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
  );
}
