/**
 * Translates raw engine evals, mate distance, and PV gap into plain-English insights and eval bar geometry.
 */
import { ADVANTAGE_THRESHOLDS } from '../config/constants';
import type { Position } from '../types';
import { formatEval } from './bestLine';

export interface AdvantageSummary {
  headline: string;
  difficultyNote: string;
  evalBarPercent: number;
  fillLeftPercent: number;
  fillWidthPercent: number;
}

function buildHeadline(position: Position, evalStr: string): string {
  if (!position.hasAdvantage) {
    return `Dead Equal (${evalStr})`;
  }

  if (position.mateIn !== null && position.mateIn > 0) {
    return `Forced Mate in ${position.mateIn}`;
  }

  const score = position.evalAfter ?? 0;
  if (score >= ADVANTAGE_THRESHOLDS.crushingEval) {
    return `Crushing Edge (${evalStr})`;
  }
  if (score >= ADVANTAGE_THRESHOLDS.winningEval) {
    return `Winning Edge (${evalStr})`;
  }
  return `Subtle Edge (${evalStr})`;
}

function buildDifficultyNote(position: Position, firstMoveSan?: string): string {
  if (!position.hasAdvantage) {
    return 'No forcing edge — position stays balanced';
  }

  if (position.mateIn !== null && position.mateIn > 0) {
    return firstMoveSan
      ? `Forced mate — starts with ${firstMoveSan}`
      : 'Forced mate sequence on the board';
  }

  const gap = position.pvGap;
  if (gap === null) {
    return firstMoveSan ? `Best move: ${firstMoveSan}` : 'Winning line available';
  }

  if (gap >= ADVANTAGE_THRESHOLDS.onlyMovePvGap) {
    return firstMoveSan
      ? `Only move! ${firstMoveSan} is +${gap.toFixed(1)} over 2nd best`
      : `Only move! Best line is +${gap.toFixed(1)} over 2nd best`;
  }

  if (gap >= ADVANTAGE_THRESHOLDS.narrowTacticPvGap) {
    return firstMoveSan
      ? `Narrow tactic — ${firstMoveSan} beats 2nd best by +${gap.toFixed(1)}`
      : `Narrow tactic — best move beats 2nd best by +${gap.toFixed(1)}`;
  }

  return firstMoveSan
    ? `Positional — multiple moves work (${firstMoveSan})`
    : 'Positional — multiple moves work';
}

function computeEvalBarPercent(evalAfter: number | null, mateIn: number | null): number {
  const { evalBarCap, evalBarCenterPercent, evalBarMinPercent, evalBarMaxPercent } =
    ADVANTAGE_THRESHOLDS;
  if (mateIn !== null && mateIn > 0) {
    return evalBarMaxPercent;
  }
  if (mateIn !== null && mateIn < 0) {
    return evalBarMinPercent;
  }

  const score = evalAfter !== null && !Number.isNaN(evalAfter) ? evalAfter : 0;
  const clamped = Math.max(-evalBarCap, Math.min(evalBarCap, score));
  const halfSpan = evalBarMaxPercent - evalBarCenterPercent;
  const percent = evalBarCenterPercent + (clamped / evalBarCap) * halfSpan;
  return Math.round(Math.max(evalBarMinPercent, Math.min(evalBarMaxPercent, percent)));
}

function computeEvalBarGeometry(evalBarPercent: number): {
  fillLeftPercent: number;
  fillWidthPercent: number;
} {
  const {
    evalBarCenterPercent,
    evalBarNeutralWidthPercent,
    evalBarMinFillWidthPercent,
  } = ADVANTAGE_THRESHOLDS;
  const delta = evalBarPercent - evalBarCenterPercent;

  if (delta === 0) {
    return {
      fillLeftPercent: evalBarCenterPercent - evalBarNeutralWidthPercent / 2,
      fillWidthPercent: evalBarNeutralWidthPercent,
    };
  }

  if (delta > 0) {
    return {
      fillLeftPercent: evalBarCenterPercent,
      fillWidthPercent: Math.max(evalBarMinFillWidthPercent, delta),
    };
  }

  const fillWidthPercent = Math.max(evalBarMinFillWidthPercent, Math.abs(delta));
  return {
    fillLeftPercent: Math.max(0, evalBarCenterPercent - fillWidthPercent),
    fillWidthPercent,
  };
}

export function summarizePositionAdvantage(
  position: Position,
  firstMoveSan?: string
): AdvantageSummary {
  const evalStr = formatEval(position.evalAfter, position.mateIn, position.sideToMove);
  const evalBarPercent = computeEvalBarPercent(position.evalAfter, position.mateIn);
  const { fillLeftPercent, fillWidthPercent } = computeEvalBarGeometry(evalBarPercent);
  return {
    headline: buildHeadline(position, evalStr),
    difficultyNote: buildDifficultyNote(position, firstMoveSan),
    evalBarPercent,
    fillLeftPercent,
    fillWidthPercent,
  };
}
