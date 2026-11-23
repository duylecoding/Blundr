/**
 * Re-exports shared dataset types and defines Blundr frontend UI and persistence types.
 */
export type {
  DifficultyTier,
  Position,
  PositionDataset,
} from '../../shared/types';

import type { DifficultyTier } from '../../shared/types';

export type GameMode = 'daily' | 'practice';

export type FeedbackOutcome = 'correct' | 'incorrect' | null;

export interface DailyAnswer {
  positionId: string;
  guessedAdvantage: boolean;
  correct: boolean;
}

export interface DailyProgress {
  dateKey: string;
  answers: DailyAnswer[];
  completed: boolean;
}

export interface PracticeDailyProgress {
  dateKey: string;
  tier: DifficultyTier;
  answers: DailyAnswer[];
  completed: boolean;
}

export interface DailyStreak {
  currentStreak: number;
  maxStreak: number;
  lastCompletedDateKey: string | null;
}

export interface PracticeStats {
  correct: number;
  total: number;
  truePositives: number;
  trueNegatives: number;
  falsePositives: number;
  falseNegatives: number;
  currentStreak: number;
  bestStreak: number;
}

export interface TierProgressSummary {
  answered: number;
  total: number;
  completed: boolean;
}
