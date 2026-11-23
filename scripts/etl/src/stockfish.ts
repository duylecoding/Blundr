import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as readline from 'node:readline';

export interface UciInfoLine {
  depth: number;
  multiPv: number;
  /** Centipawn score from side-to-move perspective, or null if mate */
  evalCp: number | null;
  /** Mate in N moves from side-to-move perspective (positive = winning), or null */
  mateIn: number | null;
  /** Principal variation moves in UCI format */
  pv: string[];
}

export interface StockfishAnalysis {
  bestMove: string;
  /** Principal variation (up to 4 UCI moves) starting with bestMove */
  pv: string[];
  /** Eval in centipawns from side-to-move perspective, or null if forced mate */
  evalCp: number | null;
  /** Forced mate in N from side-to-move perspective (positive = winning), or null */
  mateIn: number | null;
  /** Second-best move eval in centipawns (MultiPV=2), or null */
  secondEvalCp: number | null;
  /** Second-best move mate in N (MultiPV=2), or null */
  secondMateIn: number | null;
  /** Eval gap in pawns between best move and second-best move, or null if unavailable */
  pvGap: number | null;
}

export interface AnalyzeOptions {
  depth?: number;
  multiPv?: number;
  timeoutMs?: number;
}

export interface StockfishAnalyzerOptions {
  /** Optional explicit path to the stockfish JS entrypoint */
  entrypoint?: string;
  /** Hash size in MB (default 32) */
  hashMb?: number;
  /** Startup timeout in ms (default 15000) */
  startupTimeoutMs?: number;
}

const UCI_MOVE_TOKEN_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const MATE_EQUIVALENT_CP = 1000;

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Parse a single UCI `info ...` output line into structured depth, MultiPV, score, and PV.
 * Skips aspiration bound lines (`lowerbound` / `upperbound`) and incomplete info lines.
 * Note: UCI `score cp` and `score mate` are already from the side-to-move perspective.
 */
export function parseUciInfoLine(line: string): UciInfoLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('info ')) {
    return null;
  }

  const tokens = trimmed.split(/\s+/);
  let depth: number | null = null;
  let multiPv = 1;
  let evalCp: number | null = null;
  let mateIn: number | null = null;
  let hasScore = false;
  let pvStartIdx = -1;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]!;

    if (token === 'lowerbound' || token === 'upperbound') {
      return null;
    }

    if (token === 'depth' && i + 1 < tokens.length) {
      const parsed = Number.parseInt(tokens[i + 1]!, 10);
      if (Number.isFinite(parsed)) {
        depth = parsed;
      }
      i += 1;
      continue;
    }

    if (token === 'multipv' && i + 1 < tokens.length) {
      const parsed = Number.parseInt(tokens[i + 1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 1) {
        multiPv = parsed;
      }
      i += 1;
      continue;
    }

    if (token === 'score' && i + 2 < tokens.length) {
      const kind = tokens[i + 1]!;
      const rawVal = Number.parseInt(tokens[i + 2]!, 10);
      if (kind === 'cp' && Number.isFinite(rawVal)) {
        evalCp = rawVal;
        mateIn = null;
        hasScore = true;
      } else if (kind === 'mate' && Number.isFinite(rawVal) && rawVal !== 0) {
        evalCp = null;
        mateIn = rawVal;
        hasScore = true;
      }
      i += 2;
      continue;
    }

    if (token === 'pv') {
      pvStartIdx = i + 1;
      break;
    }
  }

  if (depth === null || !hasScore || pvStartIdx === -1) {
    return null;
  }

  const pv: string[] = [];
  for (let i = pvStartIdx; i < tokens.length; i += 1) {
    const moveToken = tokens[i]!;
    if (!UCI_MOVE_TOKEN_RE.test(moveToken)) {
      break;
    }
    pv.push(moveToken);
  }

  if (pv.length === 0) {
    return null;
  }

  return { depth, multiPv, evalCp, mateIn, pv };
}

/**
 * Compute the evaluation gap (in pawns) between the best line and second-best line.
 */
export function computePvGap(
  best: { evalCp: number | null; mateIn: number | null },
  second: { evalCp: number | null; mateIn: number | null } | null
): number | null {
  if (!second) {
    return null;
  }

  // Both lines have centipawn scores
  if (best.evalCp !== null && second.evalCp !== null) {
    return round2(Math.max(0, (best.evalCp - second.evalCp) / 100));
  }

  // Both lines are forced mates for the same winning side
  if (
    best.mateIn !== null &&
    best.mateIn > 0 &&
    second.mateIn !== null &&
    second.mateIn > 0
  ) {
    return 0;
  }

  // Best line is a winning mate, second line is non-mate
  if (best.mateIn !== null && best.mateIn > 0 && second.evalCp !== null) {
    return round2(Math.max(0, (MATE_EQUIVALENT_CP - second.evalCp) / 100));
  }

  // Best line is a winning mate, second line gets mated
  if (
    best.mateIn !== null &&
    best.mateIn > 0 &&
    second.mateIn !== null &&
    second.mateIn < 0
  ) {
    return round2(MATE_EQUIVALENT_CP / 100);
  }

  // Best line is non-mate, second line gets mated
  if (best.evalCp !== null && second.mateIn !== null && second.mateIn < 0) {
    return round2(Math.max(0, (best.evalCp + MATE_EQUIVALENT_CP) / 100));
  }

  return null;
}

/**
 * Aggregate collected UCI `info` lines from a search into a final `StockfishAnalysis`.
 */
export function aggregateUciAnalysis(
  infoLines: readonly UciInfoLine[],
  bestMoveFromGo: string | null
): StockfishAnalysis {
  // Group latest info line per (depth, multiPv)
  const byDepth = new Map<number, Map<number, UciInfoLine>>();
  let maxDepth = -1;

  for (const info of infoLines) {
    let depthMap = byDepth.get(info.depth);
    if (!depthMap) {
      depthMap = new Map<number, UciInfoLine>();
      byDepth.set(info.depth, depthMap);
    }
    depthMap.set(info.multiPv, info);
    if (info.depth > maxDepth) {
      maxDepth = info.depth;
    }
  }

  // Pick the highest depth that has a multiPv=1 line
  let selectedDepth = maxDepth;
  while (selectedDepth >= 0 && !byDepth.get(selectedDepth)?.has(1)) {
    selectedDepth -= 1;
  }

  const topMap = selectedDepth >= 0 ? byDepth.get(selectedDepth) : undefined;
  const pv1 = topMap?.get(1) ?? null;

  // Prefer multiPv=2 at the same depth; fallback to highest depth that has multiPv=2
  let pv2 = topMap?.get(2) ?? null;
  if (!pv2) {
    for (let d = selectedDepth - 1; d >= 0; d -= 1) {
      const candidate = byDepth.get(d)?.get(2);
      if (candidate) {
        pv2 = candidate;
        break;
      }
    }
  }

  const sanitizedGoMove =
    bestMoveFromGo && UCI_MOVE_TOKEN_RE.test(bestMoveFromGo)
      ? bestMoveFromGo
      : null;

  const bestMove = sanitizedGoMove ?? pv1?.pv[0] ?? '';

  let pv: string[];
  if (pv1 && pv1.pv.length > 0 && (!bestMove || pv1.pv[0] === bestMove)) {
    pv = pv1.pv.slice(0, 4);
  } else if (bestMove) {
    pv = [bestMove];
  } else {
    pv = [];
  }

  const evalCp = pv1?.evalCp ?? null;
  const mateIn = pv1?.mateIn ?? null;
  const secondEvalCp = pv2?.evalCp ?? null;
  const secondMateIn = pv2?.mateIn ?? null;
  const pvGap = pv1
    ? computePvGap(
        { evalCp, mateIn },
        pv2 ? { evalCp: secondEvalCp, mateIn: secondMateIn } : null
      )
    : null;

  return {
    bestMove,
    pv,
    evalCp,
    mateIn,
    secondEvalCp,
    secondMateIn,
    pvGap,
  };
}

interface StockfishPackageJson {
  bin?: string | Record<string, string>;
  main?: string;
}

function findStockfishPackageDir(baseDir?: string): string | null {
  try {
    const req = createRequire(import.meta.url);
    const pkgJsonPath = req.resolve('stockfish/package.json');
    return path.dirname(pkgJsonPath);
  } catch {
    // Fall through to directory walk
  }

  const startDir = baseDir ?? process.cwd();
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(current, 'node_modules', 'stockfish');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

/**
 * Dynamically resolve the Node-runnable JS entrypoint inside `node_modules/stockfish`.
 * Supports stockfish v16, v17, and v18 package layouts.
 */
export function resolveStockfishEntrypoint(baseDir?: string): string {
  const pkgDir = findStockfishPackageDir(baseDir);
  if (!pkgDir) {
    throw new Error(
      'Could not locate `node_modules/stockfish`. Run `npm install` inside `scripts/etl` first.'
    );
  }

  const checked: string[] = [];
  const checkFile = (relPath: string): string | null => {
    const full = path.resolve(pkgDir, relPath);
    checked.push(full);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return full;
    }
    return null;
  };

  // 1. Check bin/stockfish.js (CLI wrapper in newer stockfish npm releases)
  const binWrapper = checkFile(path.join('bin', 'stockfish.js'));
  if (binWrapper) {
    return binWrapper;
  }

  // 2. Check package.json bin field (only .js scripts, skipping shell wrappers like ./stockfishjs)
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  let pkgJson: StockfishPackageJson = {};
  if (fs.existsSync(pkgJsonPath)) {
    try {
      pkgJson = JSON.parse(
        fs.readFileSync(pkgJsonPath, 'utf-8')
      ) as StockfishPackageJson;
    } catch {
      pkgJson = {};
    }
  }

  if (typeof pkgJson.bin === 'string' && pkgJson.bin.endsWith('.js')) {
    const found = checkFile(pkgJson.bin);
    if (found) {
      return found;
    }
  } else if (pkgJson.bin && typeof pkgJson.bin === 'object') {
    for (const binPath of Object.values(pkgJson.bin)) {
      if (!binPath.endsWith('.js')) {
        continue;
      }
      const found = checkFile(binPath);
      if (found) {
        return found;
      }
    }
  }

  // 3. Inspect src/ for single-threaded JS builds (most reliable in Node child processes)
  const srcDir = path.join(pkgDir, 'src');
  if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
    const jsFiles = fs
      .readdirSync(srcDir)
      .filter(
        (name) =>
          name.endsWith('.js') &&
          !name.endsWith('.worker.js') &&
          name.startsWith('stockfish')
      );

    const priorityMatchers: Array<(name: string) => boolean> = [
      (n) => n.includes('lite-single') && !n.includes('no-simd'),
      (n) => n.includes('-single') && !n.includes('no-simd'),
      (n) => n.includes('single'),
      (n) => !n.includes('no-simd'),
      () => true,
    ];

    for (const match of priorityMatchers) {
      const found = jsFiles.find(match);
      if (found) {
        return path.join(srcDir, found);
      }
    }
  }

  // 4. Check package.json main and root stockfish.js
  if (typeof pkgJson.main === 'string') {
    const found = checkFile(pkgJson.main);
    if (found) {
      return found;
    }
  }

  const rootJs = checkFile('stockfish.js');
  if (rootJs) {
    return rootJs;
  }

  throw new Error(
    `Found stockfish package at "${pkgDir}", but could not find a runnable JS entrypoint. Checked: ${checked.join(', ')}`
  );
}

/**
 * UCI wrapper around the `stockfish` npm package running as a Node child process.
 */
export class StockfishAnalyzer {
  private readonly entrypoint: string;
  private readonly hashMb: number;
  private readonly startupTimeoutMs: number;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private initPromise: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lineListeners: Set<(line: string) => void> = new Set();
  private stderrChunks: string[] = [];
  private currentMultiPv: number | null = null;
  private closed = false;

  constructor(options: StockfishAnalyzerOptions = {}) {
    this.entrypoint = options.entrypoint ?? resolveStockfishEntrypoint();
    this.hashMb = options.hashMb ?? 32;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15_000;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.closed) {
      throw new Error('StockfishAnalyzer has already been closed.');
    }
    if (this.proc && (this.proc.exitCode !== null || this.proc.killed)) {
      this.resetProcess();
    }
    if (!this.initPromise) {
      this.initPromise = this.startProcess().catch((err) => {
        this.resetProcess();
        throw err;
      });
    }
    await this.initPromise;
  }

  private resetProcess(): void {
    const proc = this.proc;
    this.proc = null;
    this.initPromise = null;
    this.currentMultiPv = null;

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this.lineListeners.clear();

    if (proc && proc.exitCode === null && !proc.killed) {
      try {
        proc.kill();
      } catch {
        // Ignore kill error on already-exiting child process
      }
    }
  }

  private async recoverAfterSearchFailure(): Promise<void> {
    if (
      this.closed ||
      !this.proc ||
      this.proc.exitCode !== null ||
      this.proc.killed
    ) {
      this.resetProcess();
      return;
    }

    const recoveryTimeoutMs = 2_000;
    try {
      this.send('stop');
      await this.waitForLine(
        (line) => line.trim().startsWith('bestmove '),
        recoveryTimeoutMs,
        'bestmove (recovery)'
      );
      this.send('isready');
      await this.waitForLine(
        (line) => line.trim() === 'readyok',
        recoveryTimeoutMs,
        'readyok (recovery)'
      );
    } catch {
      // Recovery failed or timed out: kill child process so the next call respawns cleanly
      this.resetProcess();
    }
  }

  private async startProcess(): Promise<void> {
    const child = spawn(process.execPath, [this.entrypoint], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = child;

    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString('utf-8'));
      if (this.stderrChunks.length > 20) {
        this.stderrChunks.shift();
      }
    });

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    this.rl = rl;

    rl.on('line', (line: string) => {
      for (const listener of this.lineListeners) {
        listener(line);
      }
    });

    child.once('error', (err) => {
      this.stderrChunks.push(err.message);
    });

    this.send('uci');
    await this.waitForLine(
      (line) => line.trim() === 'uciok',
      this.startupTimeoutMs,
      'uciok'
    );

    this.send('setoption name Threads value 1');
    this.send(`setoption name Hash value ${this.hashMb}`);
    this.send('isready');
    await this.waitForLine(
      (line) => line.trim() === 'readyok',
      this.startupTimeoutMs,
      'readyok'
    );
  }

  private send(command: string): void {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error('Stockfish process is not running.');
    }
    this.proc.stdin.write(`${command}\n`);
  }

  private waitForLine(
    predicate: (line: string) => boolean,
    timeoutMs: number,
    label: string
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = this.proc;
      if (!child) {
        reject(new Error(`Stockfish process unavailable while waiting for ${label}`));
        return;
      }

      const cleanup = (): void => {
        clearTimeout(timer);
        this.lineListeners.delete(onLine);
        child.off('exit', onExit);
      };

      const onLine = (line: string): void => {
        if (predicate(line)) {
          cleanup();
          resolve(line);
        }
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        cleanup();
        const stderr = this.stderrChunks.join('').trim();
        reject(
          new Error(
            `Stockfish exited unexpectedly (code=${code}, signal=${signal}) while waiting for ${label}.${stderr ? ` Stderr: ${stderr}` : ''}`
          )
        );
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for Stockfish ${label}`));
      }, timeoutMs);

      this.lineListeners.add(onLine);
      child.once('exit', onExit);
    });
  }

  /**
   * Analyze a FEN position to the requested depth and MultiPV.
   * Returns scores normalized to the side-to-move perspective.
   */
  public analyze(
    fen: string,
    options: AnalyzeOptions = {}
  ): Promise<StockfishAnalysis> {
    const depth = options.depth ?? 14;
    const multiPv = options.multiPv ?? 2;
    const timeoutMs = options.timeoutMs ?? 30_000;

    const run = async (): Promise<StockfishAnalysis> => {
      await this.ensureInitialized();

      if (this.currentMultiPv !== multiPv) {
        this.send(`setoption name MultiPV value ${multiPv}`);
        this.currentMultiPv = multiPv;
        this.send('isready');
        await this.waitForLine(
          (line) => line.trim() === 'readyok',
          timeoutMs,
          'readyok'
        );
      }

      const infoLines: UciInfoLine[] = [];
      const collector = (line: string): void => {
        const parsed = parseUciInfoLine(line);
        if (parsed) {
          infoLines.push(parsed);
        }
      };

      this.lineListeners.add(collector);
      try {
        this.send(`position fen ${fen}`);
        this.send(`go depth ${depth}`);
        const bestMoveLine = await this.waitForLine(
          (line) => line.trim().startsWith('bestmove '),
          timeoutMs,
          `bestmove (depth ${depth})`
        );
        const parts = bestMoveLine.trim().split(/\s+/);
        const bestMoveToken = parts[1] ?? null;
        return aggregateUciAnalysis(infoLines, bestMoveToken);
      } catch (err) {
        this.lineListeners.delete(collector);
        await this.recoverAfterSearchFailure();
        throw err;
      } finally {
        this.lineListeners.delete(collector);
      }
    };

    const resultPromise = this.queue.then(run, run);
    this.queue = resultPromise.then(
      () => undefined,
      () => undefined
    );
    return resultPromise;
  }

  /**
   * Cleanly terminate the Stockfish child process.
   */
  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    const proc = this.proc;
    this.proc = null;

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this.lineListeners.clear();

    if (!proc || proc.exitCode !== null || proc.killed) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (proc.exitCode === null && !proc.killed) {
          proc.kill();
        }
        resolve();
      }, 2000);

      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      try {
        if (proc.stdin.writable) {
          proc.stdin.write('quit\n');
          proc.stdin.end();
        }
      } catch {
        proc.kill();
      }
    });
  }
}
