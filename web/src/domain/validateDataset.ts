/**
 * Runtime schema validation for the static positions dataset and external Lichess URLs.
 * Rejects malformed records, unsafe URL schemes, and prototype-polluting keys before render.
 */
import { ALLOWED_GAME_URL_HOST, ALLOWED_GAME_URL_PROTOCOL } from '../config/constants';
import type { DifficultyTier, Position } from '../types';

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'] as const;
const VALID_STYLES = new Set<Position['style']>(['tactical', 'positional', 'equal']);
const VALID_SIDES = new Set<Position['sideToMove']>(['w', 'b']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasForbiddenOwnKey(record: Record<string, unknown>): boolean {
  return FORBIDDEN_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function getOwn(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isDifficultyTier(value: unknown): value is DifficultyTier {
  return value === 1 || value === 2 || value === 3;
}

function isPositionStyle(value: unknown): value is Position['style'] {
  return typeof value === 'string' && VALID_STYLES.has(value as Position['style']);
}

function isSideToMove(value: unknown): value is Position['sideToMove'] {
  return typeof value === 'string' && VALID_SIDES.has(value as Position['sideToMove']);
}

export function getSafeGameUrl(raw: unknown): string | null {
  if (!isNonEmptyString(raw)) return null;
  try {
    const url = new URL(raw.trim());
    if (
      url.protocol !== ALLOWED_GAME_URL_PROTOCOL ||
      url.hostname !== ALLOWED_GAME_URL_HOST ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function parsePosition(raw: unknown): Position | null {
  if (!isPlainRecord(raw) || hasForbiddenOwnKey(raw)) return null;

  const id = getOwn(raw, 'id');
  const fen = getOwn(raw, 'fen');
  const lastMove = getOwn(raw, 'lastMove');
  const lastMoveSan = getOwn(raw, 'lastMoveSan');
  const sideToMove = getOwn(raw, 'sideToMove');
  const hasAdvantage = getOwn(raw, 'hasAdvantage');
  const tier = getOwn(raw, 'tier');
  const evalBefore = getOwn(raw, 'evalBefore');
  const evalAfter = getOwn(raw, 'evalAfter');
  const mateIn = getOwn(raw, 'mateIn');
  const bestMove = getOwn(raw, 'bestMove');
  const pv = getOwn(raw, 'pv');
  const pvGap = getOwn(raw, 'pvGap');
  const style = getOwn(raw, 'style');
  const materialBalance = getOwn(raw, 'materialBalance');
  const moveNumber = getOwn(raw, 'moveNumber');
  const avgElo = getOwn(raw, 'avgElo');
  const safeGameUrl = getSafeGameUrl(getOwn(raw, 'gameUrl'));

  if (
    !isNonEmptyString(id) ||
    !isNonEmptyString(fen) ||
    !isNonEmptyString(lastMove) ||
    !isNonEmptyString(lastMoveSan) ||
    !isSideToMove(sideToMove) ||
    typeof hasAdvantage !== 'boolean' ||
    !isDifficultyTier(tier) ||
    !isFiniteNumber(evalBefore) ||
    !isNullableFiniteNumber(evalAfter) ||
    !isNullableFiniteNumber(mateIn) ||
    !isNonEmptyString(bestMove) ||
    !Array.isArray(pv) ||
    !pv.every(isNonEmptyString) ||
    !isNullableFiniteNumber(pvGap) ||
    !isPositionStyle(style) ||
    !isFiniteNumber(materialBalance) ||
    !isFiniteNumber(moveNumber) ||
    !isFiniteNumber(avgElo) ||
    safeGameUrl === null
  ) {
    return null;
  }

  return {
    id,
    fen,
    lastMove,
    lastMoveSan,
    sideToMove,
    hasAdvantage,
    tier,
    evalBefore,
    evalAfter,
    mateIn,
    bestMove,
    pv: [...pv],
    pvGap,
    style,
    materialBalance,
    moveNumber,
    avgElo,
    gameUrl: safeGameUrl,
  };
}

export function parsePositionDataset(raw: unknown): Position[] {
  if (!isPlainRecord(raw) || hasForbiddenOwnKey(raw)) {
    throw new Error('Dataset format is invalid.');
  }
  const rawPositions = getOwn(raw, 'positions');
  if (!Array.isArray(rawPositions)) {
    throw new Error('Dataset contains no positions.');
  }

  const valid: Position[] = [];
  for (const entry of rawPositions) {
    const parsed = parsePosition(entry);
    if (parsed !== null) {
      valid.push(parsed);
    }
  }

  if (valid.length === 0) {
    throw new Error('Dataset contains no valid positions.');
  }

  return valid;
}
