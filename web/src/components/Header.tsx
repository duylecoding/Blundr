import { Flame } from 'lucide-react';
import type { GameMode } from '../types';

interface HeaderProps {
  mode: GameMode;
  onModeChange: (mode: GameMode) => void;
  streak: number;
  dailyCompleted: boolean;
}

export function Header({ mode, onModeChange, streak, dailyCompleted }: HeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
      {/* Compact Brand */}
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
            Blundr
          </h1>
          <p className="text-[10px] font-medium text-slate-400 truncate">
            Advantage or Equal?
          </p>
        </div>
      </div>

      {/* Mode Segmented Control */}
      <div
        role="tablist"
        aria-label="Game mode"
        className="flex items-center rounded-full bg-slate-900/90 p-0.5 ring-1 ring-slate-800"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'daily'}
          onClick={() => onModeChange('daily')}
          className={`relative rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
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
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            mode === 'practice'
              ? 'bg-sky-500 text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Practice
        </button>
      </div>

      {/* Streak Pill */}
      <div
        className="flex shrink-0 items-center gap-1 rounded-full bg-slate-900/90 px-2.5 py-1 text-xs font-bold ring-1 ring-slate-800"
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
    </header>
  );
}
