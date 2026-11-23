// Parses CLI flags and renders usage help for the Blundr Lichess ETL pipeline,
// keeping argument validation isolated from pipeline orchestration.

import * as path from 'node:path';
import {
  CLI_BOUNDS,
  DEFAULT_MIN_ELO,
  DEFAULT_OUT_PATH,
  DEFAULT_PER_TIER,
  LICHESS_DATABASE_HOST,
  STOCKFISH_DEFAULTS,
} from './constants.js';

export interface CliOptions {
  minElo: number;
  perTier: number;
  depth: number;
  url: string | null;
  file: string | null;
  out: string;
  noStockfish: boolean;
  help: boolean;
}

const STRICT_DIGITS_RE = /^\d+$/;

function parsePositiveInt(
  flag: string,
  raw: string | undefined,
  bounds: { readonly min: number; readonly max: number }
): number {
  if (raw === undefined) {
    throw new Error(`Missing value for ${flag}`);
  }
  if (!STRICT_DIGITS_RE.test(raw)) {
    throw new Error(`Invalid positive integer for ${flag}: "${raw}"`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new Error(
      `Value for ${flag} must be in ${bounds.min}..${bounds.max}, got "${raw}"`
    );
  }
  return parsed;
}

function requireValue(flag: string, raw: string | undefined): string {
  if (!raw) {
    throw new Error(`Missing value for ${flag}`);
  }
  return raw;
}

export function validateLichessArchiveUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid archive URL: "${raw}"`);
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== LICHESS_DATABASE_HOST) {
    throw new Error(`Archive URL must use https://${LICHESS_DATABASE_HOST}: "${raw}"`);
  }
  return parsed.toString();
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {
    minElo: DEFAULT_MIN_ELO,
    perTier: DEFAULT_PER_TIER,
    depth: STOCKFISH_DEFAULTS.depth,
    url: null,
    file: null,
    out: DEFAULT_OUT_PATH,
    noStockfish: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--min-elo':
        opts.minElo = parsePositiveInt(arg, argv[++i], CLI_BOUNDS.minElo);
        break;
      case '--per-tier':
        opts.perTier = parsePositiveInt(arg, argv[++i], CLI_BOUNDS.perTier);
        break;
      case '--depth':
        opts.depth = parsePositiveInt(arg, argv[++i], CLI_BOUNDS.depth);
        break;
      case '--url':
        opts.url = validateLichessArchiveUrl(requireValue(arg, argv[++i]));
        break;
      case '--file':
        opts.file = path.resolve(process.cwd(), requireValue(arg, argv[++i]));
        break;
      case '--out':
        opts.out = path.resolve(process.cwd(), requireValue(arg, argv[++i]));
        break;
      case '--no-stockfish':
        opts.noStockfish = true;
        break;
      default:
        throw new Error(`Unknown CLI argument: "${arg}"`);
    }
  }

  return opts;
}

export function printHelp(): void {
  console.log(`Blundr — Lichess ${DEFAULT_MIN_ELO}+ ETL Pipeline

Usage:
  npm run extract -- [options]

Options:
  --min-elo <n>     Minimum Elo for both players (default: ${DEFAULT_MIN_ELO})
  --per-tier <n>    Target advantage + equal count per tier; total = n * 6 (default: ${DEFAULT_PER_TIER} -> ${DEFAULT_PER_TIER * 6} total)
  --depth <n>       Stockfish MultiPV=${STOCKFISH_DEFAULTS.multiPv} search depth (default: ${STOCKFISH_DEFAULTS.depth})
  --url <url>       Specific Lichess .pgn.zst URL (default: latest from database.lichess.org)
  --file <path>     Local .pgn.zst or .pgn file instead of streaming from Lichess
  --out <path>      Output dataset JSON path (default: ../../web/public/data/positions.json)
  --no-stockfish    Skip Stockfish analysis (dry-run / fast testing mode)
  -h, --help        Show this help message
`);
}
