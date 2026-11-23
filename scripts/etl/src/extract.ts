// Top-level orchestrator for the Blundr Lichess ETL pipeline:
// resolve archive -> stream & collect raw candidates -> Stockfish enrich -> write JSON.

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';
import type { Position, PositionDataset } from '../../../shared/types.js';
import { extractCandidatesFromGame, type RawCandidate } from './candidateFilter.js';
import { parseCliArgs, printHelp, type CliOptions } from './cli.js';
import {
  HTTP_LIMITS,
  LICHESS_DATABASE_HOST,
  LICHESS_LIST_URL,
  PROGRESS_LOG_INTERVAL,
  RAW_QUOTA_MULTIPLIER,
  STOCKFISH_DEFAULTS,
} from './constants.js';
import {
  BUCKET_KEYS, bucketKeyFor, buildDryRunBuckets, buildPositionDataset,
  createEmptyBuckets, createQuotas, verifyCandidateWithAnalysis,
  type RawBucketMap, type VerifiedBucketMap,
} from './datasetBuilder.js';
import { createZstdDecompressStream, parsePgnGame, passesFastPreFilter, streamPgnGames } from './pgnParser.js';
import { StockfishAnalyzer } from './stockfish.js';

export function pickLatestLichessUrl(listText: string): string {
  const urls: string[] = [];
  for (const rawLine of listText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      continue;
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== LICHESS_DATABASE_HOST ||
      !parsed.pathname.endsWith('.pgn.zst')
    ) {
      continue;
    }
    urls.push(parsed.toString());
  }
  if (urls.length === 0) {
    throw new Error(`No valid https://${LICHESS_DATABASE_HOST} .pgn.zst URLs found in Lichess database list.`);
  }
  const dateKey = (url: string): string => /(\d{4})-(\d{2})\.pgn\.zst$/.exec(url)?.slice(1, 3).join('-') ?? '';
  return [...urls].sort((a, b) => dateKey(b).localeCompare(dateKey(a)))[0]!;
}

async function fetchTextWithLimit(
  url: string,
  maxBytes: number,
  timeoutMs: number
): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Failed to fetch Lichess list (${res.status} ${res.statusText})`);

  const contentLength = res.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel();
      throw new Error(`Lichess list response exceeds ${maxBytes} byte limit.`);
    }
  }
  if (!res.body) throw new Error(`Empty response body from ${url}`);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Lichess list response exceeded ${maxBytes} byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString('utf-8');
}

async function openArchiveStream(
  options: CliOptions,
  signal: AbortSignal
): Promise<{ byteStream: Readable; source: string; isZst: boolean }> {
  if (options.file) {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(options.file);
    } catch {
      throw new Error(`Input file does not exist: ${options.file}`);
    }
    if (!stats.isFile()) {
      throw new Error(`Input path is not a regular file: ${options.file}`);
    }
    return {
      byteStream: fs.createReadStream(options.file),
      source: path.basename(options.file),
      isZst: options.file.toLowerCase().endsWith('.zst'),
    };
  }

  let url = options.url;
  if (!url) {
    console.log(`[ETL] Fetching latest archive list from ${LICHESS_LIST_URL}...`);
    const listText = await fetchTextWithLimit(
      LICHESS_LIST_URL,
      HTTP_LIMITS.listMaxBytes,
      HTTP_LIMITS.listTimeoutMs
    );
    url = pickLatestLichessUrl(listText);
  }

  console.log(`[ETL] Streaming PGN archive: ${url}`);
  const connectController = new AbortController();
  const connectTimer = setTimeout(() => {
    connectController.abort(
      new Error(`Timed out after ${HTTP_LIMITS.connectTimeoutMs}ms connecting to ${url}`)
    );
  }, HTTP_LIMITS.connectTimeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.any([signal, connectController.signal]) });
  } finally {
    clearTimeout(connectTimer);
  }
  if (!res.ok || !res.body) throw new Error(`Failed to stream Lichess archive (${res.status} ${res.statusText})`);
  return {
    byteStream: Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
    source: url,
    isZst: url.toLowerCase().endsWith('.zst'),
  };
}

async function collectRawCandidates(options: CliOptions) {
  const rawQuotas = createQuotas(options.perTier, options.noStockfish ? 1 : RAW_QUOTA_MULTIPLIER);
  const rawBuckets: RawBucketMap = createEmptyBuckets<RawCandidate>();
  const seenFens = new Set<string>();
  const abortController = new AbortController();
  let abortedByQuota = false;

  const { byteStream, source, isZst } = await openArchiveStream(options, abortController.signal);
  const zstdStream = isZst ? createZstdDecompressStream() : null;
  if (zstdStream) {
    byteStream.on('error', (err: Error) => { if (!abortedByQuota) zstdStream.destroy(err); });
    zstdStream.on('error', () => {});
    byteStream.pipe(zstdStream);
  } else {
    byteStream.on('error', () => {});
  }

  let gamesScanned = 0;
  let gamesMatched = 0;
  try {
    for await (const rawGame of streamPgnGames(zstdStream ?? byteStream)) {
      gamesScanned += 1;
      if (gamesScanned % PROGRESS_LOG_INTERVAL === 0) {
        console.log(`[ETL] Scanned ${gamesScanned} games (matched ${gamesMatched}) | Raw T1:${rawBuckets.tier1.length}/${rawQuotas.tier1} T2:${rawBuckets.tier2.length}/${rawQuotas.tier2} T3:${rawBuckets.tier3.length}/${rawQuotas.tier3} Eq:${rawBuckets.equal.length}/${rawQuotas.equal}`);
      }
      if (!passesFastPreFilter(rawGame, options.minElo)) continue;
      const parsed = parsePgnGame(rawGame);
      if (!parsed) continue;
      gamesMatched += 1;

      for (const candidate of extractCandidatesFromGame(parsed, { minElo: options.minElo })) {
        const key = bucketKeyFor(candidate.bucket);
        const dedup = candidate.fen.split(/\s+/).slice(0, 4).join(' ');
        if (rawBuckets[key].length >= rawQuotas[key] || seenFens.has(dedup)) continue;
        seenFens.add(dedup);
        rawBuckets[key].push(candidate);
      }

      if (BUCKET_KEYS.every((k) => rawBuckets[k].length >= rawQuotas[k])) {
        abortedByQuota = true;
        console.log(`[ETL] Raw candidate quotas reached after ${gamesScanned} games. Aborting stream...`);
        abortController.abort();
        byteStream.destroy();
        zstdStream?.destroy();
        break;
      }
    }
  } catch (err) {
    if (!abortedByQuota) throw err;
  } finally {
    if (!byteStream.destroyed) byteStream.destroy();
    if (zstdStream && !zstdStream.destroyed) zstdStream.destroy();
  }
  return { rawBuckets, source, gamesScanned, gamesMatched };
}

async function enrichWithStockfish(rawBuckets: RawBucketMap, options: CliOptions): Promise<VerifiedBucketMap> {
  const targets = createQuotas(options.perTier);
  if (options.noStockfish) return buildDryRunBuckets(rawBuckets, targets);

  const verified = createEmptyBuckets<Position>();
  const analyzer = new StockfishAnalyzer();
  const seenIds = new Set<string>();
  let evaluated = 0;
  let rejectedEvalShift = 0;
  let rejectedFreeCapture = 0;

  const evaluate = async (raw: RawCandidate): Promise<void> => {
    if (seenIds.has(raw.id)) return;
    seenIds.add(raw.id);
    const analysis = await analyzer.analyze(raw.fen, { depth: options.depth, multiPv: STOCKFISH_DEFAULTS.multiPv });
    evaluated += 1;

    const result = verifyCandidateWithAnalysis(raw, analysis, (k) => verified[k].length >= targets[k]);
    if (result.status === 'accepted') verified[result.bucketKey].push(result.position);
    else if (result.status === 'rejected') {
      if (result.reason === 'free-capture') rejectedFreeCapture += 1;
      else rejectedEvalShift += 1;
    }
  };

  try {
    console.log(`[ETL] Running Stockfish depth=${options.depth} MultiPV=${STOCKFISH_DEFAULTS.multiPv} enrichment...`);
    const overflow: RawCandidate[] = [];
    for (const key of BUCKET_KEYS) {
      for (const raw of rawBuckets[key]) {
        if (verified[key].length >= targets[key]) overflow.push(raw);
        else await evaluate(raw);
      }
    }
    for (const raw of overflow) {
      if (BUCKET_KEYS.every((k) => verified[k].length >= targets[k])) break;
      await evaluate(raw);
    }
    console.log(`[ETL] Stockfish evaluated ${evaluated} positions (rejected: ${rejectedEvalShift} eval-shift, ${rejectedFreeCapture} trivial-free-capture)`);
  } finally {
    await analyzer.close();
  }
  return verified;
}

export async function runExtract(argv: readonly string[]): Promise<PositionDataset | null> {
  const options = parseCliArgs(argv);
  if (options.help) { printHelp(); return null; }

  const startedAt = Date.now();
  const { rawBuckets, source, gamesScanned, gamesMatched } = await collectRawCandidates(options);
  console.log(`[ETL] Collection complete: scanned=${gamesScanned}, elo+eval matched=${gamesMatched} | Raw T1:${rawBuckets.tier1.length} T2:${rawBuckets.tier2.length} T3:${rawBuckets.tier3.length} Eq:${rawBuckets.equal.length}`);

  const verified = await enrichWithStockfish(rawBuckets, options);
  const dataset = buildPositionDataset(verified, { source, minElo: options.minElo });

  await fsp.mkdir(path.dirname(options.out), { recursive: true });
  const tmpPath = `${options.out}.tmp.${process.pid}`;
  try {
    await fsp.writeFile(tmpPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf-8');
    await fsp.rename(tmpPath, options.out);
  } catch (err) {
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[ETL] Wrote ${dataset.counts.total} positions to ${options.out} in ${elapsedSec}s`);
  console.log(`[ETL] Summary -> Total: ${dataset.counts.total} (Adv: ${dataset.counts.advantage}, Eq: ${dataset.counts.equal}) | T1: ${dataset.counts.byTier[1].advantage}a/${dataset.counts.byTier[1].equal}e | T2: ${dataset.counts.byTier[2].advantage}a/${dataset.counts.byTier[2].equal}e | T3: ${dataset.counts.byTier[3].advantage}a/${dataset.counts.byTier[3].equal}e`);
  return dataset;
}

const mainArg = process.argv[1];
if (mainArg && path.resolve(mainArg) === path.resolve(fileURLToPath(import.meta.url))) {
  runExtract(process.argv.slice(2)).catch((err: unknown) => {
    console.error(`[ETL] Error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exitCode = 1;
  });
}
