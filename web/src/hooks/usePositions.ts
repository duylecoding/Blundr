/**
 * Loads the static positions dataset with AbortController cleanup and retry support.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { POSITIONS_DATA_PATH } from '../config/constants';
import type { Position, PositionDataset } from '../types';

export function usePositions() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${POSITIONS_DATA_PATH}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while loading ${POSITIONS_DATA_PATH}`);
      }
      const data = (await response.json()) as Partial<PositionDataset>;
      if (!data || !Array.isArray(data.positions) || data.positions.length === 0) {
        throw new Error('Dataset contains no positions.');
      }
      setPositions(data.positions);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Unable to load puzzle dataset.');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => abortRef.current?.abort();
  }, [reload]);

  return { positions, loading, error, reload };
}
