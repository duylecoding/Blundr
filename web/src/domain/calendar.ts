/**
 * Local calendar date helpers for Daily 5 puzzle numbering and midnight countdowns.
 */
import { DAILY_EPOCH_DATE_KEY, MS_PER_DAY } from '../config/constants';

export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Parse as UTC midnight so DST transitions never cause off-by-one day arithmetic.
function parseDateKeyUtcMs(dateKey: string): number {
  const parts = dateKey.split('-').map(Number);
  const year = parts[0] ?? 2026;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return Date.UTC(year, month - 1, day);
}

export function getPreviousDateKey(dateKey: string): string {
  const prev = new Date(parseDateKeyUtcMs(dateKey) - MS_PER_DAY);
  const year = prev.getUTCFullYear();
  const month = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const day = String(prev.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDailyPuzzleNumber(dateKey: string): number {
  const diffDays = Math.floor(
    (parseDateKeyUtcMs(dateKey) - parseDateKeyUtcMs(DAILY_EPOCH_DATE_KEY)) / MS_PER_DAY
  );
  return Math.max(1, diffDays + 1);
}

export function getMsUntilNextDay(now: Date = new Date()): number {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return Math.max(0, nextMidnight.getTime() - now.getTime());
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}
