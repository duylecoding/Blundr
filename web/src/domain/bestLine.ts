/**
 * Engine evaluation formatting, UCI parsing, and chess.js principal-variation replay states.
 */
import { Chess } from 'chess.js';

export interface ParsedUciMove {
  from: string;
  to: string;
  promotion?: string;
}

export interface BestLineState {
  fen: string;
  lastMove?: [string, string];
  san?: string;
}

const SQUARE_REGEX = /^[a-h][1-8]$/;

export function isValidSquare(square: string): boolean {
  return SQUARE_REGEX.test(square);
}

export function formatEval(
  evalPawns: number | null,
  mateIn: number | null,
  sideToMove: 'w' | 'b'
): string {
  // Position evals are already oriented to sideToMove; keep parameter for explicit caller intent.
  void sideToMove;

  if (mateIn !== null) {
    if (mateIn > 0) return `M${mateIn}`;
    if (mateIn < 0) return `-M${Math.abs(mateIn)}`;
    return 'M0';
  }

  if (evalPawns === null || Number.isNaN(evalPawns) || Math.abs(evalPawns) < 0.05) {
    return '0.0';
  }

  const sign = evalPawns > 0 ? '+' : '-';
  return `${sign}${Math.abs(evalPawns).toFixed(1)}`;
}

export function parseUciMove(uci: string): ParsedUciMove {
  const cleaned = uci.trim().toLowerCase();
  const from = cleaned.slice(0, 2);
  const to = cleaned.slice(2, 4);
  const promotion = cleaned.length >= 5 ? cleaned.slice(4, 5) : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

export function getBestMoveArrow(bestMoveUci: string): [string, string] | null {
  if (bestMoveUci.length < 4) return null;
  const parsed = parseUciMove(bestMoveUci);
  if (!isValidSquare(parsed.from) || !isValidSquare(parsed.to)) {
    return null;
  }
  return [parsed.from, parsed.to];
}

export function buildBestLineStates(
  startFen: string,
  pv: readonly string[],
  initialLastMoveUci?: string
): BestLineState[] {
  const initialLastMove = initialLastMoveUci
    ? (getBestMoveArrow(initialLastMoveUci) ?? undefined)
    : undefined;
  const states: BestLineState[] = [{ fen: startFen, lastMove: initialLastMove }];

  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    return states;
  }

  for (const uci of pv) {
    if (uci.length < 4) break;
    const parsed = parseUciMove(uci);
    try {
      const result = chess.move({
        from: parsed.from,
        to: parsed.to,
        promotion: parsed.promotion,
      });
      if (!result) break;
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
