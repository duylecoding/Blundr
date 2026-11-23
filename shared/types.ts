export type DifficultyTier = 1 | 2 | 3;

export interface Position {
  /** Unique identifier, e.g. lichess_<gameId>_ply<n> */
  id: string;
  /** FEN after the opponent's last move (side to move is the player deciding) */
  fen: string;
  /** Opponent's last move in UCI format (e.g. "e7e5") */
  lastMove: string;
  /** Opponent's last move in SAN format (e.g. "e5") */
  lastMoveSan: string;
  /** Side to move ("w" or "b") */
  sideToMove: 'w' | 'b';
  /** Ground truth: true if side to move has a real advantage, false if equal */
  hasAdvantage: boolean;
  /** Difficulty tier (1 = Easy, 2 = Medium, 3 = Hard). Equal positions are assigned a tier for balanced bucketing */
  tier: DifficultyTier;
  /** Eval (pawns, from side-to-move perspective) before opponent's move */
  evalBefore: number;
  /** Eval (pawns, from side-to-move perspective) after opponent's move; null if forced mate */
  evalAfter: number | null;
  /** Forced mate in N moves for side to move (positive), or null */
  mateIn: number | null;
  /** Best move for side to move in UCI format (e.g. "d4e5") */
  bestMove: string;
  /** Principal variation (2-4 moves in UCI format) starting with bestMove */
  pv: string[];
  /** Eval gap in pawns between best move and second-best move (MultiPV=2), if available */
  pvGap: number | null;
  /** Whether the advantage is sharp/tactical (single winning move) vs positional */
  style: 'tactical' | 'positional' | 'equal';
  /** Material balance in pawns (side to move minus opponent) */
  materialBalance: number;
  /** Fullmove number in the original game */
  moveNumber: number;
  /** Average Elo of the two players in the source Lichess game */
  avgElo: number;
  /** Link to the original Lichess game at the exact ply */
  gameUrl: string;
}

export interface PositionDataset {
  version: number;
  generatedAt: string;
  source: string;
  minElo: number;
  counts: {
    total: number;
    advantage: number;
    equal: number;
    byTier: Record<DifficultyTier, { advantage: number; equal: number }>;
  };
  positions: Position[];
}
