import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import type {
  DifficultyTier,
  Position,
  PositionDataset,
} from '../../../shared/types.js';
import {
  classifyBucket,
  extractCandidatesFromGame,
  isTrivialFreeCapture,
  type RawCandidate,
} from './filter.js';
import {
  createZstdDecompressStream,
  parsePgnGame,
  passesFastPreFilter,
  streamPgnGames,
  type EvalScore,
} from './pgnParser.js';
import { StockfishAnalyzer } from './stockfish.js';

const LICHESS_LIST_URL = 'https://database.lichess.org/standard/list.txt';
const DEFAULT_SHUFFLE_SEED = 0x51a7e180;

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

type BucketKey = 'tier1' | 'tier2' | 'tier3' | 'equal';

interface RawBucketMap {
  tier1: RawCandidate[];
  tier2: RawCandidate[];
  tier3: RawCandidate[];
  equal: RawCandidate[];
}

interface VerifiedBucketMap {
  tier1: Position[];
  tier2: Position[];
  tier3: Position[];
  equal: Position[];
}

function defaultOutPath(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '..', '..', '..', 'web', 'public', 'data', 'positions.json');
}

function parsePositiveInt(flag: string, raw: string | undefined): number {
  if (raw === undefined) {
    throw new Error(`Missing value for ${flag}`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${flag}: "${raw}"`);
  }
  return parsed;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {
    minElo: 1800,
    perTier: 15,
    depth: 14,
    url: null,
    file: null,
    out: defaultOutPath(),
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
        opts.minElo = parsePositiveInt(arg, argv[i + 1]);
        i += 1;
        break;
      case '--per-tier':
        opts.perTier = parsePositiveInt(arg, argv[i + 1]);
        i += 1;
        break;
      case '--depth':
        opts.depth = parsePositiveInt(arg, argv[i + 1]);
        i += 1;
        break;
      case '--url':
        if (!argv[i + 1]) {
          throw new Error('Missing value for --url');
        }
        opts.url = argv[i + 1]!;
        i += 1;
        break;
      case '--file':
        if (!argv[i + 1]) {
          throw new Error('Missing value for --file');
        }
        opts.file = path.resolve(process.cwd(), argv[i + 1]!);
        i += 1;
        break;
      case '--out':
        if (!argv[i + 1]) {
          throw new Error('Missing value for --out');
        }
        opts.out = path.resolve(process.cwd(), argv[i + 1]!);
        i += 1;
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

function printHelp(): void {
  console.log(`Chess Puzzle Tinder — Lichess 1800+ ETL Pipeline

Usage:
  npm run extract -- [options]

Options:
  --min-elo <n>     Minimum Elo for both players (default: 1800)
  --per-tier <n>    Target advantage + equal count per tier; total = n * 6 (default: 15 -> 90 total)
  --depth <n>       Stockfish MultiPV=2 search depth (default: 14)
  --url <url>       Specific Lichess .pgn.zst URL (default: latest from database.lichess.org)
  --file <path>     Local .pgn.zst or .pgn file instead of streaming from Lichess
  --out <path>      Output dataset JSON path (default: ../../web/public/data/positions.json)
  --no-stockfish    Skip Stockfish analysis (dry-run / fast testing mode)
  -h, --help        Show this help message
`);
}

/**
 * Pick the most recent `.pgn.zst` archive URL from Lichess's standard/list.txt response.
 */
export function pickLatestLichessUrl(listText: string): string {
  const urls = listText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('http') && line.endsWith('.pgn.zst'));

  if (urls.length === 0) {
    throw new Error('No .pgn.zst URLs found in Lichess database list.');
  }

  const extractDateKey = (url: string): string => {
    const match = /(\d{4})-(\d{2})\.pgn\.zst$/.exec(url);
    return match ? `${match[1]}-${match[2]}` : '';
  };

  const sorted = [...urls].sort((a, b) =>
    extractDateKey(b).localeCompare(extractDateKey(a))
  );

  return sorted[0]!;
}

async function resolveSourceUrl(explicitUrl: string | null): Promise<string> {
  if (explicitUrl) {
    return explicitUrl;
  }

  console.log(`[ETL] Fetching latest archive list from ${LICHESS_LIST_URL}...`);
  const res = await fetch(LICHESS_LIST_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Lichess list (${res.status} ${res.statusText})`
    );
  }
  const text = await res.text();
  return pickLatestLichessUrl(text);
}

export function classifyStyle(
  hasAdvantage: boolean,
  mateIn: number | null,
  pvGap: number | null
): 'tactical' | 'positional' | 'equal' {
  if (!hasAdvantage) {
    return 'equal';
  }
  if (mateIn !== null || (pvGap !== null && pvGap >= 1.2)) {
    return 'tactical';
  }
  return 'positional';
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deterministicShuffle<T>(
  items: readonly T[],
  seed: number = DEFAULT_SHUFFLE_SEED
): T[] {
  const copy = [...items];
  const rand = mulberry32(seed);
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

function round2(n: number): number {
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function fenDedupKey(fen: string): string {
  return fen.split(/\s+/).slice(0, 4).join(' ');
}

function bucketKeyFor(bucket: RawCandidate['bucket']): BucketKey {
  if (!bucket.hasAdvantage) {
    return 'equal';
  }
  if (bucket.tier === 1) return 'tier1';
  if (bucket.tier === 2) return 'tier2';
  return 'tier3';
}

function tierFromBucketKey(key: BucketKey): DifficultyTier {
  if (key === 'tier1') return 1;
  if (key === 'tier2') return 2;
  return 3;
}

async function collectRawCandidates(
  options: CliOptions
): Promise<{ rawBuckets: RawBucketMap; source: string; gamesScanned: number; gamesMatched: number }> {
  const rawMultiplier = options.noStockfish ? 1 : 2;
  const rawQuotas: Record<BucketKey, number> = {
    tier1: options.perTier * rawMultiplier,
    tier2: options.perTier * rawMultiplier,
    tier3: options.perTier * rawMultiplier,
    equal: options.perTier * 3 * rawMultiplier,
  };

  const rawBuckets: RawBucketMap = {
    tier1: [],
    tier2: [],
    tier3: [],
    equal: [],
  };

  const seenFens = new Set<string>();
  const allQuotasMet = (): boolean =>
    rawBuckets.tier1.length >= rawQuotas.tier1 &&
    rawBuckets.tier2.length >= rawQuotas.tier2 &&
    rawBuckets.tier3.length >= rawQuotas.tier3 &&
    rawBuckets.equal.length >= rawQuotas.equal;

  const abortController = new AbortController();
  let abortedByQuota = false;
  let source = '';
  let byteStream: Readable;
  let isZst = false;

  if (options.file) {
    if (!fs.existsSync(options.file)) {
      throw new Error(`Input file does not exist: ${options.file}`);
    }
    source = path.basename(options.file);
    isZst = options.file.toLowerCase().endsWith('.zst');
    byteStream = fs.createReadStream(options.file);
  } else {
    const url = await resolveSourceUrl(options.url);
    source = url;
    isZst = url.toLowerCase().endsWith('.zst');
    console.log(`[ETL] Streaming PGN archive: ${url}`);
    const response = await fetch(url, { signal: abortController.signal });
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to stream Lichess archive (${response.status} ${response.statusText})`
      );
    }
    byteStream = Readable.fromWeb(
      response.body as unknown as WebReadableStream<Uint8Array>
    );
  }

  let textSource: AsyncIterable<Uint8Array | string> = byteStream;
  let zstdStream: ReturnType<typeof createZstdDecompressStream> | null = null;

  if (isZst) {
    zstdStream = createZstdDecompressStream();
    byteStream.on('error', (err) => {
      if (!abortedByQuota) {
        zstdStream?.destroy(err);
      }
    });
    zstdStream.on('error', () => {
      // Handled by consumer loop unless abortedByQuota is true
    });
    byteStream.pipe(zstdStream);
    textSource = zstdStream;
  } else {
    byteStream.on('error', () => {
      // Handled by consumer loop unless abortedByQuota is true
    });
  }

  let gamesScanned = 0;
  let gamesMatched = 0;

  try {
    for await (const rawGame of streamPgnGames(textSource)) {
      gamesScanned += 1;

      if (gamesScanned % 2000 === 0) {
        console.log(
          `[ETL] Scanned ${gamesScanned} games (matched ${gamesMatched}) | Raw T1:${rawBuckets.tier1.length}/${rawQuotas.tier1} T2:${rawBuckets.tier2.length}/${rawQuotas.tier2} T3:${rawBuckets.tier3.length}/${rawQuotas.tier3} Eq:${rawBuckets.equal.length}/${rawQuotas.equal}`
        );
      }

      if (!passesFastPreFilter(rawGame, options.minElo)) {
        continue;
      }

      const parsed = parsePgnGame(rawGame);
      if (!parsed) {
        continue;
      }
      gamesMatched += 1;

      const candidates = extractCandidatesFromGame(parsed, {
        minElo: options.minElo,
      });

      for (const candidate of candidates) {
        const key = bucketKeyFor(candidate.bucket);
        if (rawBuckets[key].length >= rawQuotas[key]) {
          continue;
        }
        const dedup = fenDedupKey(candidate.fen);
        if (seenFens.has(dedup)) {
          continue;
        }
        seenFens.add(dedup);
        rawBuckets[key].push(candidate);
      }

      if (allQuotasMet()) {
        abortedByQuota = true;
        console.log(
          `[ETL] Raw candidate quotas reached after ${gamesScanned} games. Aborting stream cleanly...`
        );
        abortController.abort();
        byteStream.destroy();
        zstdStream?.destroy();
        break;
      }
    }
  } catch (err) {
    if (!abortedByQuota) {
      throw err;
    }
  } finally {
    if (!byteStream.destroyed) {
      byteStream.destroy();
    }
    if (zstdStream && !zstdStream.destroyed) {
      zstdStream.destroy();
    }
  }

  return { rawBuckets, source, gamesScanned, gamesMatched };
}

function buildDryRunPosition(raw: RawCandidate): Position | null {
  const chess = new Chess(raw.fen);
  const legalMoves = chess.moves({ verbose: true });
  const firstMove = legalMoves[0];
  if (!firstMove) {
    return null;
  }
  const bestMove = `${firstMove.from}${firstMove.to}${firstMove.promotion ?? ''}`;
  const hasAdvantage = raw.bucket.hasAdvantage;
  const tier: DifficultyTier = raw.bucket.hasAdvantage ? raw.bucket.tier : 1;

  return {
    id: raw.id,
    fen: raw.fen,
    lastMove: raw.lastMove,
    lastMoveSan: raw.lastMoveSan,
    sideToMove: raw.sideToMove,
    hasAdvantage,
    tier,
    evalBefore: raw.evalBefore,
    evalAfter: raw.evalAfter,
    mateIn: raw.mateIn,
    bestMove,
    pv: [bestMove],
    pvGap: null,
    style: classifyStyle(hasAdvantage, raw.mateIn, null),
    materialBalance: raw.materialBalance,
    moveNumber: raw.moveNumber,
    avgElo: raw.avgElo,
    gameUrl: raw.gameUrl,
  };
}

async function enrichWithStockfish(
  rawBuckets: RawBucketMap,
  options: CliOptions
): Promise<VerifiedBucketMap> {
  const targets: Record<BucketKey, number> = {
    tier1: options.perTier,
    tier2: options.perTier,
    tier3: options.perTier,
    equal: options.perTier * 3,
  };

  const verified: VerifiedBucketMap = {
    tier1: [],
    tier2: [],
    tier3: [],
    equal: [],
  };

  if (options.noStockfish) {
    for (const key of ['tier1', 'tier2', 'tier3', 'equal'] as const) {
      for (const raw of rawBuckets[key]) {
        if (verified[key].length >= targets[key]) {
          break;
        }
        const pos = buildDryRunPosition(raw);
        if (pos) {
          verified[key].push(pos);
        }
      }
    }
    return verified;
  }

  const analyzer = new StockfishAnalyzer();
  const seenIds = new Set<string>();
  let evaluated = 0;
  let rejectedFreeCapture = 0;
  let rejectedEvalShift = 0;

  const evaluateCandidate = async (raw: RawCandidate): Promise<void> => {
    if (seenIds.has(raw.id)) {
      return;
    }
    seenIds.add(raw.id);

    const analysis = await analyzer.analyze(raw.fen, {
      depth: options.depth,
      multiPv: 2,
    });
    evaluated += 1;

    if (!analysis.bestMove) {
      rejectedEvalShift += 1;
      return;
    }

    const sfEvalAfter: EvalScore = {
      pawns:
        analysis.mateIn === null && analysis.evalCp !== null
          ? round2(analysis.evalCp / 100)
          : null,
      mateIn: analysis.mateIn,
    };

    const reVerifiedBucket = classifyBucket(
      { pawns: raw.evalBefore, mateIn: null },
      sfEvalAfter
    );
    if (!reVerifiedBucket) {
      rejectedEvalShift += 1;
      return;
    }

    const targetKey = bucketKeyFor(reVerifiedBucket);
    if (verified[targetKey].length >= targets[targetKey]) {
      return;
    }

    // Reject obvious undefended hanging-piece mouse-slips on Tier 2 and Tier 3
    if (
      reVerifiedBucket.hasAdvantage &&
      (reVerifiedBucket.tier === 2 || reVerifiedBucket.tier === 3) &&
      isTrivialFreeCapture(raw.fen, analysis.bestMove)
    ) {
      rejectedFreeCapture += 1;
      return;
    }

    const tier: DifficultyTier = reVerifiedBucket.hasAdvantage
      ? reVerifiedBucket.tier
      : tierFromBucketKey(targetKey);

    const position: Position = {
      id: raw.id,
      fen: raw.fen,
      lastMove: raw.lastMove,
      lastMoveSan: raw.lastMoveSan,
      sideToMove: raw.sideToMove,
      hasAdvantage: reVerifiedBucket.hasAdvantage,
      tier,
      evalBefore: raw.evalBefore,
      evalAfter: sfEvalAfter.pawns,
      mateIn: sfEvalAfter.mateIn,
      bestMove: analysis.bestMove,
      pv: analysis.pv.length > 0 ? analysis.pv : [analysis.bestMove],
      pvGap: analysis.pvGap,
      style: classifyStyle(
        reVerifiedBucket.hasAdvantage,
        sfEvalAfter.mateIn,
        analysis.pvGap
      ),
      materialBalance: raw.materialBalance,
      moveNumber: raw.moveNumber,
      avgElo: raw.avgElo,
      gameUrl: raw.gameUrl,
    };

    verified[targetKey].push(position);
  };

  try {
    console.log(
      `[ETL] Running Stockfish depth=${options.depth} MultiPV=2 enrichment...`
    );

    const overflow: RawCandidate[] = [];
    const bucketOrder: BucketKey[] = ['tier1', 'tier2', 'tier3', 'equal'];

    // Pass 1: evaluate each bucket's candidates until that bucket hits its target
    for (const key of bucketOrder) {
      for (const raw of rawBuckets[key]) {
        if (verified[key].length >= targets[key]) {
          overflow.push(raw);
          continue;
        }
        await evaluateCandidate(raw);
      }
    }

    // Pass 2: if any bucket is still under target, drain overflow candidates
    const anyUnderTarget = (): boolean =>
      verified.tier1.length < targets.tier1 ||
      verified.tier2.length < targets.tier2 ||
      verified.tier3.length < targets.tier3 ||
      verified.equal.length < targets.equal;

    if (anyUnderTarget()) {
      for (const raw of overflow) {
        if (!anyUnderTarget()) {
          break;
        }
        await evaluateCandidate(raw);
      }
    }

    console.log(
      `[ETL] Stockfish evaluated ${evaluated} positions (rejected: ${rejectedEvalShift} eval-shift, ${rejectedFreeCapture} trivial-free-capture)`
    );
  } finally {
    await analyzer.close();
  }

  return verified;
}

/**
 * Assign equal positions evenly across Tiers 1, 2, and 3, shuffle deterministically,
 * and build the final PositionDataset conforming to shared/types.ts.
 */
export function buildPositionDataset(
  verified: VerifiedBucketMap,
  meta: { source: string; minElo: number; generatedAt?: string; seed?: number }
): PositionDataset {
  const tiers: readonly DifficultyTier[] = [1, 2, 3];
  const assignedEquals: Position[] = verified.equal.map((pos, index) => ({
    ...pos,
    hasAdvantage: false,
    tier: tiers[index % 3]!,
    style: 'equal',
  }));

  const combined: Position[] = [
    ...verified.tier1.map((p) => ({ ...p, hasAdvantage: true, tier: 1 as const })),
    ...verified.tier2.map((p) => ({ ...p, hasAdvantage: true, tier: 2 as const })),
    ...verified.tier3.map((p) => ({ ...p, hasAdvantage: true, tier: 3 as const })),
    ...assignedEquals,
  ];

  const shuffled = deterministicShuffle(
    combined,
    meta.seed ?? DEFAULT_SHUFFLE_SEED
  );

  const byTier: Record<DifficultyTier, { advantage: number; equal: number }> = {
    1: { advantage: 0, equal: 0 },
    2: { advantage: 0, equal: 0 },
    3: { advantage: 0, equal: 0 },
  };

  let advantageCount = 0;
  let equalCount = 0;

  for (const pos of shuffled) {
    if (pos.hasAdvantage) {
      advantageCount += 1;
      byTier[pos.tier].advantage += 1;
    } else {
      equalCount += 1;
      byTier[pos.tier].equal += 1;
    }
  }

  return {
    version: 1,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    source: meta.source,
    minElo: meta.minElo,
    counts: {
      total: shuffled.length,
      advantage: advantageCount,
      equal: equalCount,
      byTier,
    },
    positions: shuffled,
  };
}

export async function runExtract(argv: readonly string[]): Promise<PositionDataset | null> {
  const options = parseCliArgs(argv);
  if (options.help) {
    printHelp();
    return null;
  }

  const startedAt = Date.now();
  const { rawBuckets, source, gamesScanned, gamesMatched } =
    await collectRawCandidates(options);

  console.log(
    `[ETL] Collection complete: scanned=${gamesScanned}, elo+eval matched=${gamesMatched} | Raw T1:${rawBuckets.tier1.length} T2:${rawBuckets.tier2.length} T3:${rawBuckets.tier3.length} Eq:${rawBuckets.equal.length}`
  );

  const verified = await enrichWithStockfish(rawBuckets, options);
  const dataset = buildPositionDataset(verified, {
    source,
    minElo: options.minElo,
  });

  await fsp.mkdir(path.dirname(options.out), { recursive: true });
  await fsp.writeFile(
    options.out,
    `${JSON.stringify(dataset, null, 2)}\n`,
    'utf-8'
  );

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[ETL] Wrote ${dataset.counts.total} positions to ${options.out} in ${elapsedSec}s`);
  console.log(
    `[ETL] Summary -> Total: ${dataset.counts.total} (Adv: ${dataset.counts.advantage}, Eq: ${dataset.counts.equal}) | T1: ${dataset.counts.byTier[1].advantage}a/${dataset.counts.byTier[1].equal}e | T2: ${dataset.counts.byTier[2].advantage}a/${dataset.counts.byTier[2].equal}e | T3: ${dataset.counts.byTier[3].advantage}a/${dataset.counts.byTier[3].equal}e`
  );

  return dataset;
}

function isExecutedDirectly(): boolean {
  const mainArg = process.argv[1];
  if (!mainArg) {
    return false;
  }
  return path.resolve(mainArg) === path.resolve(fileURLToPath(import.meta.url));
}

if (isExecutedDirectly()) {
  runExtract(process.argv.slice(2)).catch((err: unknown) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[ETL] Error: ${message}`);
    process.exitCode = 1;
  });
}
