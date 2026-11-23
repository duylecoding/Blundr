// Centralized thresholds, defaults, and external URLs for the Blundr Lichess ETL pipeline
// so tuning parameters stay consistent across parsing, filtering, Stockfish, and CLI layers.

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PieceSymbol } from 'chess.js';

export const LICHESS_LIST_URL = 'https://database.lichess.org/standard/list.txt';
export const LICHESS_BASE_URL = 'https://lichess.org';
export const LICHESS_SITE_HOST = 'lichess.org';
export const LICHESS_DATABASE_HOST = 'database.lichess.org';

export const DEFAULT_MIN_ELO = 1800;
export const DEFAULT_PER_TIER = 15;
export const DEFAULT_SHUFFLE_SEED = 0x51a7e180;
export const RAW_QUOTA_MULTIPLIER = 2;
export const PROGRESS_LOG_INTERVAL = 2000;

export const CLI_BOUNDS = {
  minElo: { min: 100, max: 4000 },
  perTier: { min: 1, max: 10_000 },
  depth: { min: 1, max: 30 },
} as const;

export const MAX_PGN_LINE_BYTES = 64 * 1024;
export const MAX_PGN_GAME_BYTES = 512 * 1024;
export const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

export const HTTP_LIMITS = {
  listTimeoutMs: 30_000,
  listMaxBytes: 1024 * 1024,
  connectTimeoutMs: 30_000,
} as const;

export const MOVE_WINDOW = {
  min: 10,
  max: 45,
} as const;

export const EVAL_THRESHOLDS = {
  priorMax: 0.4,
  equalMax: 0.3,
  tier1Min: 4.0,
  tier1MateMax: 2,
  tier2Min: 2.0,
  tier2Max: 4.0,
  tier3Min: 1.0,
  tier3Max: 2.0,
  tacticalPvGapMin: 1.2,
} as const;

export const PIECE_VALUES: Readonly<Record<PieceSymbol, number>> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

export const MIN_NON_KING_MATERIAL = 10;
export const MAX_MATERIAL_IMBALANCE = 1;
export const TRIVIAL_CAPTURE_MIN_VALUE = 3;
export const MAX_CANDIDATES_PER_GAME = 2;
export const MIN_PLY_GAP = 6;

export const STOCKFISH_DEFAULTS = {
  depth: 14,
  multiPv: 2,
  hashMb: 32,
  startupTimeoutMs: 15_000,
  searchTimeoutMs: 30_000,
  recoveryTimeoutMs: 2_000,
  quitTimeoutMs: 2_000,
  mateEquivalentCp: 1000,
  maxPvLength: 4,
} as const;

export const STOCKFISH_BOUNDS = {
  depth: { min: 1, max: 30 },
  multiPv: { min: 1, max: 5 },
  hashMb: { min: 1, max: 1024 },
  timeoutMs: { min: 100, max: 120_000 },
} as const;

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT_PATH = path.resolve(
  THIS_DIR,
  '..',
  '..',
  '..',
  'web',
  'public',
  'data',
  'positions.json'
);
