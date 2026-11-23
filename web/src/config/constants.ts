/**
 * Centralized configuration for Blundr game limits, tier styling, swipe physics,
 * storage keys, board settings, and responsive layout caps.
 */
import type { DifficultyTier, Position } from '../types';

export const APP_NAME = 'Blundr';

export const DAILY_EPOCH_DATE_KEY = '2026-11-22';
export const DAILY_PUZZLE_COUNT = 5;
export const PRACTICE_DAILY_LIMIT = 5;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const MIDNIGHT_ROLLOVER_BUFFER_MS = 1000;
export const COUNTDOWN_TICK_MS = 1000;
export const COPY_FEEDBACK_MS = 2200;

export const POSITIONS_DATA_PATH = 'data/positions.json';

export const ALL_TIERS: readonly DifficultyTier[] = [1, 2, 3];

export const STORAGE_KEYS = {
  dailyProgressPrefix: 'blundr:daily:v1:',
  dailyStreak: 'blundr:streak:v1',
  practiceStats: 'blundr:practice:v1',
  practiceDailyPrefix: 'blundr:practice-daily:v1:',
  probeKey: '__blundr_probe__',
} as const;

export const SWIPE_CONFIG = {
  distanceThreshold: 84,
  velocityThreshold: 460,
  velocityMinOffset: 30,
  dragElastic: 0.82,
  spring: {
    type: 'spring' as const,
    stiffness: 420,
    damping: 32,
  },
} as const;

export const BOARD_CONFIG = {
  gridSquares: 8,
  animationDurationMs: 180,
  bestMoveBrush: {
    key: 'g',
    color: '#10b981',
    opacity: 0.92,
    lineWidth: 10,
  },
} as const;

export interface TierStyleMeta {
  label: string;
  badgeClass: string;
  tabActiveClass: string;
  accentTextClass: string;
}

export const TIER_CONFIG: Record<DifficultyTier, TierStyleMeta> = {
  1: {
    label: 'Easy',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    tabActiveClass: 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/50',
    accentTextClass: 'text-emerald-400',
  },
  2: {
    label: 'Medium',
    badgeClass: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    tabActiveClass: 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/50',
    accentTextClass: 'text-amber-400',
  },
  3: {
    label: 'Hard',
    badgeClass: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    tabActiveClass: 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/50',
    accentTextClass: 'text-rose-400',
  },
};

export const STYLE_BADGE_CONFIG: Record<
  Position['style'],
  { label: string; className: string }
> = {
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

export const LAYOUT_CAPS = {
  appMaxWidth: 'max-w-md md:max-w-[580px]',
  // Height-aware caps keep short mobile viewports unclipped and desktop cards balanced
  dailyCardCap:
    'max-w-[min(100%,calc(100dvh-268px))] md:max-w-[min(520px,calc(100dvh-248px))]',
  practiceCardCap:
    'max-w-[min(100%,calc(100dvh-318px))] md:max-w-[min(520px,calc(100dvh-292px))]',
  dockMinHeight: 'min-h-[146px]',
} as const;
