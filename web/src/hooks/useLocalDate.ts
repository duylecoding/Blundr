/**
 * Tracks the local YYYY-MM-DD calendar key across midnight rollovers and exposes a live countdown.
 */
import { useEffect, useState } from 'react';
import { COUNTDOWN_TICK_MS, MIDNIGHT_ROLLOVER_BUFFER_MS } from '../config/constants';
import { formatCountdown, getLocalDateKey, getMsUntilNextDay } from '../domain/calendar';

export function useLocalDate(): string {
  const [dateKey, setDateKey] = useState<string>(() => getLocalDateKey());

  useEffect(() => {
    const syncDateKey = () => {
      const latest = getLocalDateKey();
      setDateKey((prev) => (prev === latest ? prev : latest));
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncDateKey();
      }
    };

    // Schedule slightly past local midnight so timers firing a few ms early still see the new day.
    const midnightTimer = window.setTimeout(
      syncDateKey,
      getMsUntilNextDay() + MIDNIGHT_ROLLOVER_BUFFER_MS
    );

    window.addEventListener('focus', syncDateKey);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearTimeout(midnightTimer);
      window.removeEventListener('focus', syncDateKey);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [dateKey]);

  return dateKey;
}

export function useMidnightCountdown(): string {
  const [countdown, setCountdown] = useState<string>(() =>
    formatCountdown(getMsUntilNextDay())
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCountdown(formatCountdown(getMsUntilNextDay()));
    }, COUNTDOWN_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  return countdown;
}
