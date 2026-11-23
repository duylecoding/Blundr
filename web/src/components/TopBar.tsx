/**
 * App header with Blundr branding, Daily/Practice mode switcher, share button, and active streak badge.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Flame, Share2 } from 'lucide-react';
import { APP_NAME, COPY_FEEDBACK_MS } from '../config/constants';
import { shareSiteWithFriends } from '../domain/share';
import type { GameMode } from '../types';

interface TopBarProps {
  mode: GameMode;
  onModeChange: (mode: GameMode) => void;
  streak: number;
  dailyCompleted: boolean;
}

export function TopBar({ mode, onModeChange, streak, dailyCompleted }: TopBarProps) {
  const [shareFeedback, setShareFeedback] = useState<'copied' | 'shared' | null>(null);
  const timerRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const handleShareSite = async () => {
    const outcome = await shareSiteWithFriends();
    if (!isMountedRef.current || outcome === 'failed') return;
    setShareFeedback(outcome);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setShareFeedback(null);
      timerRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  const shareLabel =
    shareFeedback === 'copied'
      ? 'Link copied!'
      : shareFeedback === 'shared'
        ? 'Shared!'
        : 'Share Blundr with friends';

  return (
    <header className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800/90 ring-1 ring-slate-700/80 shadow-sm">
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt=""
            className="h-6 w-6"
            aria-hidden="true"
          />
        </div>
        <div className="leading-tight truncate">
          <h1 className="text-sm font-bold tracking-tight text-slate-100 truncate">
            {APP_NAME}
          </h1>
          <p className="hidden sm:block text-[10px] font-medium text-slate-400 truncate">
            Advantage or Equal?
          </p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Game mode"
        className="flex shrink-0 items-center rounded-full bg-slate-900/90 p-0.5 ring-1 ring-slate-800"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'daily'}
          onClick={() => onModeChange('daily')}
          className={`relative whitespace-nowrap rounded-full px-2.5 sm:px-3 py-1 text-xs font-semibold transition-colors ${
            mode === 'daily'
              ? 'bg-emerald-500 text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Daily 5
          {dailyCompleted && mode !== 'daily' && (
            <span
              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle"
              aria-label="Daily completed"
            />
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'practice'}
          onClick={() => onModeChange('practice')}
          className={`whitespace-nowrap rounded-full px-2.5 sm:px-3 py-1 text-xs font-semibold transition-colors ${
            mode === 'practice'
              ? 'bg-sky-500 text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Practice
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => void handleShareSite()}
          aria-label={shareLabel}
          title={shareLabel}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/90 text-slate-400 ring-1 ring-slate-800 transition hover:bg-slate-800 hover:text-slate-100 active:scale-95"
        >
          {shareFeedback !== null ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Share2 className="h-3.5 w-3.5" />
          )}
        </button>

        <div
          className="flex items-center gap-1 rounded-full bg-slate-900/90 px-2.5 py-1 text-xs font-bold ring-1 ring-slate-800"
          title={mode === 'daily' ? 'Daily Streak' : 'Practice Streak'}
        >
          <Flame
            className={`h-3.5 w-3.5 ${
              streak > 0 ? 'fill-amber-400 text-amber-400' : 'text-slate-500'
            }`}
          />
          <span className={streak > 0 ? 'text-amber-300' : 'text-slate-400'}>
            {streak}
          </span>
        </div>
      </div>
    </header>
  );
}
