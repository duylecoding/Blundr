/**
 * Loading skeleton, dataset error screen, and empty-tier fallback states.
 */
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { LAYOUT_CAPS } from '../config/constants';

type DeckStatusViewProps =
  | { status: 'loading' }
  | { status: 'error'; message: string; onRetry: () => void }
  | { status: 'empty' };

export function DeckStatusView(props: DeckStatusViewProps) {
  if (props.status === 'loading') {
    return (
      <main className="flex flex-1 flex-col justify-between px-3 pb-3 pt-2 min-h-0">
        <div className="flex flex-1 items-center justify-center min-h-0">
          <div
            className={`mx-auto w-full ${LAYOUT_CAPS.dailyCardCap} rounded-2xl bg-slate-900/80 p-2.5 ring-1 ring-slate-800`}
          >
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
        <div className={`grid ${LAYOUT_CAPS.dockMinHeight} grid-cols-2 gap-3 pt-3`}>
          <div className="h-16 animate-pulse rounded-2xl bg-slate-900 ring-1 ring-slate-800" />
          <div className="h-16 animate-pulse rounded-2xl bg-slate-900 ring-1 ring-slate-800" />
        </div>
      </main>
    );
  }

  if (props.status === 'error') {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="w-full rounded-2xl bg-slate-900/95 p-6 ring-1 ring-slate-800 shadow-xl">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
          <h2 className="mt-3 text-base font-bold text-slate-100">Dataset Unavailable</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{props.message}</p>
          <p className="mt-2 text-[11px] text-slate-500">
            Check your connection and try reloading the puzzle deck.
          </p>
          <button
            type="button"
            onClick={props.onRetry}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try Again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="w-full rounded-2xl bg-slate-900/95 p-6 ring-1 ring-slate-800 shadow-xl">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
        <h2 className="mt-3 text-base font-bold text-slate-100">
          No Practice Positions Available
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
          There are no extra positions available for this difficulty right now. Try another
          difficulty tab above.
        </p>
      </div>
    </main>
  );
}
