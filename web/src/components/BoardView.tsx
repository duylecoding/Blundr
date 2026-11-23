/**
 * Thin read-only Chessground board showing a position, last-move highlight, and best-move arrow.
 */
import { useEffect, useRef, useState } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawBrushes, DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { BOARD_CONFIG } from '../config/constants';
import { isValidSquare } from '../domain/bestLine';

interface BoardViewProps {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: [string, string];
  bestMoveArrow?: [string, string] | null;
}

function isBoardKey(square: string): square is Key {
  return isValidSquare(square);
}

function toKeyPair(pair?: [string, string] | null): [Key, Key] | undefined {
  if (!pair || !isBoardKey(pair[0]) || !isBoardKey(pair[1])) {
    return undefined;
  }
  return [pair[0], pair[1]];
}

function toArrowShapes(pair?: [string, string] | null): DrawShape[] {
  const keys = toKeyPair(pair);
  return keys ? [{ orig: keys[0], dest: keys[1], brush: 'green' }] : [];
}

// Chessground positions pieces on an 8x8 pixel grid; snapping to 8px multiples prevents sub-pixel drift.
function snapBoardSize(width: number): number {
  if (width <= 0) return 0;
  const grid = BOARD_CONFIG.gridSquares;
  return Math.max(grid, Math.floor(width / grid) * grid);
}

export function BoardView({
  fen,
  orientation,
  lastMove,
  bestMoveArrow,
}: BoardViewProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const [boardSize, setBoardSize] = useState(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const measure = () => {
      const next = snapBoardSize(wrapper.clientWidth);
      if (next > 0) {
        setBoardSize((prev) => (prev === next ? prev : next));
      }
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const isSized = boardSize > 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!isSized || !el || apiRef.current) return;

    const config: Config = {
      fen,
      orientation,
      viewOnly: true,
      coordinates: true,
      lastMove: toKeyPair(lastMove),
      animation: { enabled: true, duration: BOARD_CONFIG.animationDurationMs },
      drawable: {
        enabled: false,
        visible: true,
        autoShapes: toArrowShapes(bestMoveArrow),
        // Chessground deep-merges partial brush overrides onto its defaults at runtime.
        brushes: { green: BOARD_CONFIG.bestMoveBrush } as DrawBrushes,
      },
    };

    const api = Chessground(el, config);
    apiRef.current = api;

    // Defer redraw to the next paint frame so Chessground measures finalized layout bounds.
    const rafId = window.requestAnimationFrame(() => apiRef.current?.redrawAll());
    return () => {
      window.cancelAnimationFrame(rafId);
      api.destroy();
      apiRef.current = null;
    };
    // Mount Chessground once when first sized; prop updates flow through api.set() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSized]);

  useEffect(() => {
    if (boardSize <= 0 || !apiRef.current) return;
    const rafId = window.requestAnimationFrame(() => apiRef.current?.redrawAll());
    return () => window.cancelAnimationFrame(rafId);
  }, [boardSize]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.set({
      fen,
      orientation,
      lastMove: toKeyPair(lastMove),
      drawable: { autoShapes: toArrowShapes(bestMoveArrow) },
    });
  }, [fen, orientation, lastMove, bestMoveArrow, isSized]);

  return (
    <div ref={wrapperRef} className="chess-board-wrap flex items-center justify-center">
      <div
        ref={containerRef}
        style={
          boardSize > 0
            ? { width: `${boardSize}px`, height: `${boardSize}px` }
            : { width: '100%', height: '100%' }
        }
      />
    </div>
  );
}
