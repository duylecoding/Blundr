import { useEffect, useRef, useState } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';

interface ChessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: [string, string];
  bestMoveArrow?: [string, string] | null;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

const VALID_KEYS: ReadonlyMap<string, Key> = (() => {
  const map = new Map<string, Key>();
  for (const file of FILES) {
    for (const rank of RANKS) {
      const square: Key = `${file}${rank}`;
      map.set(square, square);
    }
  }
  return map;
})();

function toKeyPair(pair?: [string, string] | null): [Key, Key] | undefined {
  if (!pair) {
    return undefined;
  }
  const orig = VALID_KEYS.get(pair[0]);
  const dest = VALID_KEYS.get(pair[1]);
  if (!orig || !dest) {
    return undefined;
  }
  return [orig, dest];
}

function snapBoardSize(width: number): number {
  if (width <= 0) {
    return 0;
  }
  const snapped = Math.floor(width / 8) * 8;
  return Math.max(8, snapped);
}

export function ChessBoard({
  fen,
  orientation,
  lastMove,
  bestMoveArrow,
}: ChessBoardProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const [boardSize, setBoardSize] = useState<number>(0);

  // Measure outer wrapper and snap inner board to an exact integer multiple of 8px
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

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

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(wrapper);

    return () => {
      observer.disconnect();
    };
  }, []);

  const isSized = boardSize > 0;

  // Initialize Chessground once the snapped integer-multiple-of-8px dimensions are ready
  useEffect(() => {
    if (!isSized) {
      return;
    }
    const el = containerRef.current;
    if (!el || apiRef.current) {
      return;
    }

    const lastMoveKeys = toKeyPair(lastMove);
    const arrowKeys = toKeyPair(bestMoveArrow);
    const autoShapes: DrawShape[] = arrowKeys
      ? [{ orig: arrowKeys[0], dest: arrowKeys[1], brush: 'green' }]
      : [];

    const initialConfig: Config = {
      fen,
      orientation,
      viewOnly: true,
      coordinates: true,
      lastMove: lastMoveKeys,
      animation: {
        enabled: true,
        duration: 180,
      },
      drawable: {
        enabled: false,
        visible: true,
        autoShapes,
        brushes: {
          green: {
            key: 'g',
            color: '#10b981',
            opacity: 0.92,
            lineWidth: 10,
          },
          red: {
            key: 'r',
            color: '#f43f5e',
            opacity: 0.9,
            lineWidth: 10,
          },
          blue: {
            key: 'b',
            color: '#38bdf8',
            opacity: 0.9,
            lineWidth: 10,
          },
          yellow: {
            key: 'y',
            color: '#facc15',
            opacity: 0.9,
            lineWidth: 10,
          },
        },
      },
    };

    const api = Chessground(el, initialConfig);
    apiRef.current = api;

    const rafId = window.requestAnimationFrame(() => {
      apiRef.current?.redrawAll();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      api.destroy();
      apiRef.current = null;
    };
    // Initialize once when first sized; subsequent updates flow through api.set() and redrawAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSized]);

  // Redraw Chessground whenever the snapped board size changes
  useEffect(() => {
    if (boardSize <= 0 || !apiRef.current) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      apiRef.current?.redrawAll();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [boardSize]);

  // Keep board position, orientation, lastMove, and arrows synced with props
  useEffect(() => {
    const api = apiRef.current;
    if (!api) {
      return;
    }

    const lastMoveKeys = toKeyPair(lastMove);
    const arrowKeys = toKeyPair(bestMoveArrow);
    const autoShapes: DrawShape[] = arrowKeys
      ? [{ orig: arrowKeys[0], dest: arrowKeys[1], brush: 'green' }]
      : [];

    api.set({
      fen,
      orientation,
      lastMove: lastMoveKeys,
      drawable: {
        autoShapes,
      },
    });
  }, [fen, orientation, lastMove, bestMoveArrow, isSized]);

  return (
    <div
      ref={wrapperRef}
      className="chess-board-wrap flex items-center justify-center"
    >
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
