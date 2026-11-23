import { Chess } from 'chess.js';

export interface ParsedUciMove {
  from: string;
  to: string;
  promotion?: string;
}

export interface PvState {
  fen: string;
  lastMove?: [string, string];
  san?: string;
}

const SQUARE_REGEX = /^[a-h][1-8]$/;

export function isValidSquare(square: string): boolean {
  return SQUARE_REGEX.test(square);
}

/**
 * Formats evaluation clearly from the side-to-move perspective (e.g. "+2.4", "M2", "0.0").
 * Note: evalPawns and mateIn in the Position schema are already oriented to sideToMove.
 */
export function formatEval(
  evalPawns: number | null,
  mateIn: number | null,
  sideToMove: 'w' | 'b'
): string {
  // sideToMove is part of the public contract for perspective-aware formatting
  void sideToMove;

  if (mateIn !== null) {
    if (mateIn > 0) {
      return `M${mateIn}`;
    }
    if (mateIn < 0) {
      return `-M${Math.abs(mateIn)}`;
    }
    return 'M0';
  }

  if (evalPawns === null || Number.isNaN(evalPawns)) {
    return '0.0';
  }

  if (Math.abs(evalPawns) < 0.05) {
    return '0.0';
  }

  const sign = evalPawns > 0 ? '+' : '-';
  return `${sign}${Math.abs(evalPawns).toFixed(1)}`;
}

/**
 * Parses a UCI move string (e.g. "d4e5" or "e7e8q") into from/to/promotion.
 */
export function parseUciMove(uci: string): ParsedUciMove {
  const cleaned = uci.trim().toLowerCase();
  const from = cleaned.slice(0, 2);
  const to = cleaned.slice(2, 4);
  const promo = cleaned.length >= 5 ? cleaned.slice(4, 5) : undefined;
  return promo ? { from, to, promotion: promo } : { from, to };
}

/**
 * Builds an array of board states starting at the initial position (index 0)
 * followed by each legal move in the engine principal variation (PV).
 */
export function buildPvStates(
  startFen: string,
  pv: readonly string[],
  initialLastMoveUci?: string
): PvState[] {
  const states: PvState[] = [];

  let initialLastMove: [string, string] | undefined;
  if (initialLastMoveUci && initialLastMoveUci.length >= 4) {
    const parsedInitial = parseUciMove(initialLastMoveUci);
    if (isValidSquare(parsedInitial.from) && isValidSquare(parsedInitial.to)) {
      initialLastMove = [parsedInitial.from, parsedInitial.to];
    }
  }

  states.push({
    fen: startFen,
    lastMove: initialLastMove,
  });

  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    return states;
  }

  for (const uci of pv) {
    if (uci.length < 4) {
      break;
    }
    const parsed = parseUciMove(uci);
    try {
      const result = chess.move({
        from: parsed.from,
        to: parsed.to,
        promotion: parsed.promotion,
      });
      if (!result) {
        break;
      }
      states.push({
        fen: chess.fen(),
        lastMove: [parsed.from, parsed.to],
        san: result.san,
      });
    } catch {
      break;
    }
  }

  return states;
}
