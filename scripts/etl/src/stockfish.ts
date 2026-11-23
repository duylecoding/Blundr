// Manages a Stockfish UCI child process with serialized requests and timeout recovery
// (stop + isready handshake, falling back to a clean child respawn on hang).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { STOCKFISH_DEFAULTS } from './constants.js';
import {
  aggregateUciAnalysis,
  parseUciInfoLine,
  type StockfishAnalysis,
  type UciInfoLine,
} from './uciParser.js';

export interface AnalyzeOptions {
  depth?: number;
  multiPv?: number;
  timeoutMs?: number;
}

export interface StockfishAnalyzerOptions {
  entrypoint?: string;
  hashMb?: number;
  startupTimeoutMs?: number;
}

interface StockfishPackageJson {
  bin?: string | Record<string, string>;
  main?: string;
}

function findStockfishPackageDir(baseDir?: string): string | null {
  try {
    return path.dirname(createRequire(import.meta.url).resolve('stockfish/package.json'));
  } catch {
    let current = path.resolve(baseDir ?? process.cwd());
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = path.join(current, 'node_modules', 'stockfish');
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }
}

export function resolveStockfishEntrypoint(baseDir?: string): string {
  const pkgDir = findStockfishPackageDir(baseDir);
  if (!pkgDir) throw new Error('Could not locate `node_modules/stockfish`. Run `npm install` in `scripts/etl`.');

  const checked: string[] = [];
  const checkFile = (relPath: string): string | null => {
    const full = path.resolve(pkgDir, relPath);
    checked.push(full);
    return fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
  };

  const binWrapper = checkFile(path.join('bin', 'stockfish.js'));
  if (binWrapper) return binWrapper;

  let pkgJson: StockfishPackageJson = {};
  try {
    pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')) as StockfishPackageJson;
  } catch { /* ignore malformed or missing package.json */ }

  const binEntries = typeof pkgJson.bin === 'string'
    ? [pkgJson.bin]
    : pkgJson.bin ? Object.values(pkgJson.bin) : [];
  for (const binPath of binEntries) {
    if (binPath.endsWith('.js')) {
      const found = checkFile(binPath);
      if (found) return found;
    }
  }

  // Prefer single-threaded JS builds for predictable stability in Node child processes.
  const srcDir = path.join(pkgDir, 'src');
  if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
    const jsFiles = fs.readdirSync(srcDir)
      .filter((n) => n.endsWith('.js') && !n.endsWith('.worker.js') && n.startsWith('stockfish'));
    const matchers: Array<(n: string) => boolean> = [
      (n) => n.includes('lite-single') && !n.includes('no-simd'),
      (n) => n.includes('-single') && !n.includes('no-simd'),
      (n) => n.includes('single'),
      (n) => !n.includes('no-simd'),
      () => true,
    ];
    for (const match of matchers) {
      const found = jsFiles.find(match);
      if (found) return path.join(srcDir, found);
    }
  }

  const fallback = (typeof pkgJson.main === 'string' ? checkFile(pkgJson.main) : null) ?? checkFile('stockfish.js');
  if (fallback) return fallback;
  throw new Error(`No runnable JS entrypoint in "${pkgDir}". Checked: ${checked.join(', ')}`);
}

export class StockfishAnalyzer {
  private readonly entrypoint: string;
  private readonly hashMb: number;
  private readonly startupTimeoutMs: number;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private initPromise: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lineListeners = new Set<(line: string) => void>();
  private stderrChunks: string[] = [];
  private currentMultiPv: number | null = null;
  private closed = false;

  constructor(options: StockfishAnalyzerOptions = {}) {
    this.entrypoint = options.entrypoint ?? resolveStockfishEntrypoint();
    this.hashMb = options.hashMb ?? STOCKFISH_DEFAULTS.hashMb;
    this.startupTimeoutMs = options.startupTimeoutMs ?? STOCKFISH_DEFAULTS.startupTimeoutMs;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.closed) throw new Error('StockfishAnalyzer has already been closed.');
    if (this.proc && (this.proc.exitCode !== null || this.proc.killed)) this.resetProcess();
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
    this.rl?.close();
    this.rl = null;
    this.lineListeners.clear();
    if (proc && proc.exitCode === null && !proc.killed) {
      try { proc.kill(); } catch { /* ignore already-exited child */ }
    }
  }

  private async recoverAfterSearchFailure(): Promise<void> {
    if (this.closed || !this.proc || this.proc.exitCode !== null || this.proc.killed) {
      this.resetProcess();
      return;
    }
    const ms = STOCKFISH_DEFAULTS.recoveryTimeoutMs;
    try {
      this.send('stop');
      await this.waitForLine((l) => l.trim().startsWith('bestmove '), ms, 'bestmove (recovery)');
      this.send('isready');
      await this.waitForLine((l) => l.trim() === 'readyok', ms, 'readyok (recovery)');
    } catch {
      // Recovery timed out: kill child so the next request respawns a clean engine.
      this.resetProcess();
    }
  }

  private async startProcess(): Promise<void> {
    const child = spawn(process.execPath, [this.entrypoint], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = child;
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString('utf-8'));
      if (this.stderrChunks.length > 20) this.stderrChunks.shift();
    });
    child.once('error', (err) => this.stderrChunks.push(err.message));

    this.rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.rl.on('line', (line: string) => {
      for (const listener of this.lineListeners) listener(line);
    });

    this.send('uci');
    await this.waitForLine((l) => l.trim() === 'uciok', this.startupTimeoutMs, 'uciok');
    this.send('setoption name Threads value 1');
    this.send(`setoption name Hash value ${this.hashMb}`);
    this.send('isready');
    await this.waitForLine((l) => l.trim() === 'readyok', this.startupTimeoutMs, 'readyok');
  }

  private send(command: string): void {
    if (!this.proc || !this.proc.stdin.writable) throw new Error('Stockfish process is not running.');
    this.proc.stdin.write(`${command}\n`);
  }

  private waitForLine(predicate: (line: string) => boolean, timeoutMs: number, label: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = this.proc;
      if (!child) return reject(new Error(`Stockfish process unavailable while waiting for ${label}`));

      const cleanup = (): void => {
        clearTimeout(timer);
        this.lineListeners.delete(onLine);
        child.off('exit', onExit);
      };
      const onLine = (line: string): void => {
        if (predicate(line)) { cleanup(); resolve(line); }
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        cleanup();
        const stderr = this.stderrChunks.join('').trim();
        reject(new Error(`Stockfish exited unexpectedly (code=${code}, signal=${signal}) waiting for ${label}.${stderr ? ` Stderr: ${stderr}` : ''}`));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for Stockfish ${label}`));
      }, timeoutMs);

      this.lineListeners.add(onLine);
      child.once('exit', onExit);
    });
  }

  public analyze(fen: string, options: AnalyzeOptions = {}): Promise<StockfishAnalysis> {
    const depth = options.depth ?? STOCKFISH_DEFAULTS.depth;
    const multiPv = options.multiPv ?? STOCKFISH_DEFAULTS.multiPv;
    const timeoutMs = options.timeoutMs ?? STOCKFISH_DEFAULTS.searchTimeoutMs;

    const run = async (): Promise<StockfishAnalysis> => {
      await this.ensureInitialized();
      if (this.currentMultiPv !== multiPv) {
        this.send(`setoption name MultiPV value ${multiPv}`);
        this.currentMultiPv = multiPv;
        this.send('isready');
        await this.waitForLine((l) => l.trim() === 'readyok', timeoutMs, 'readyok');
      }

      const infoLines: UciInfoLine[] = [];
      const collector = (line: string): void => {
        const parsed = parseUciInfoLine(line);
        if (parsed) infoLines.push(parsed);
      };

      this.lineListeners.add(collector);
      try {
        this.send(`position fen ${fen}`);
        this.send(`go depth ${depth}`);
        const bestMoveLine = await this.waitForLine(
          (l) => l.trim().startsWith('bestmove '),
          timeoutMs,
          `bestmove (depth ${depth})`
        );
        return aggregateUciAnalysis(infoLines, bestMoveLine.trim().split(/\s+/)[1] ?? null);
      } catch (err) {
        this.lineListeners.delete(collector);
        await this.recoverAfterSearchFailure();
        throw err;
      } finally {
        this.lineListeners.delete(collector);
      }
    };

    const resultPromise = this.queue.then(run, run);
    this.queue = resultPromise.then(() => undefined, () => undefined);
    return resultPromise;
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const proc = this.proc;
    this.proc = null;
    this.rl?.close();
    this.rl = null;
    this.lineListeners.clear();
    if (!proc || proc.exitCode !== null || proc.killed) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (proc.exitCode === null && !proc.killed) proc.kill();
        resolve();
      }, STOCKFISH_DEFAULTS.quitTimeoutMs);

      proc.once('exit', () => { clearTimeout(timer); resolve(); });
      try {
        if (proc.stdin.writable) { proc.stdin.write('quit\n'); proc.stdin.end(); }
      } catch {
        proc.kill();
      }
    });
  }
}
