// Pure UCI `info` line parser and MultiPV=2 aggregator for Stockfish output,
// separated from child-process management so scoring logic stays easy to unit test.

import { STOCKFISH_DEFAULTS } from './constants.js';

export interface UciInfoLine {
  depth: number;
  multiPv: number;
  // UCI score cp/mate is already reported from the side-to-move perspective.
  evalCp: number | null;
  mateIn: number | null;
  pv: string[];
}

export interface StockfishAnalysis {
  bestMove: string;
  pv: string[];
  evalCp: number | null;
  mateIn: number | null;
  secondEvalCp: number | null;
  secondMateIn: number | null;
  pvGap: number | null;
}

const UCI_MOVE_TOKEN_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function parseUciInfoLine(line: string): UciInfoLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('info ')) return null;

  const tokens = trimmed.split(/\s+/);
  let depth: number | null = null;
  let multiPv = 1;
  let evalCp: number | null = null;
  let mateIn: number | null = null;
  let hasScore = false;
  let pvStartIdx = -1;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]!;

    // Ignore aspiration search bounds so only exact scores feed into aggregation.
    if (token === 'lowerbound' || token === 'upperbound') return null;

    if (token === 'depth' && i + 1 < tokens.length) {
      const parsed = Number.parseInt(tokens[++i]!, 10);
      if (Number.isFinite(parsed)) depth = parsed;
      continue;
    }

    if (token === 'multipv' && i + 1 < tokens.length) {
      const parsed = Number.parseInt(tokens[++i]!, 10);
      if (Number.isFinite(parsed) && parsed >= 1) multiPv = parsed;
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

  if (depth === null || !hasScore || pvStartIdx === -1) return null;

  const pv: string[] = [];
  for (let i = pvStartIdx; i < tokens.length; i += 1) {
    const moveToken = tokens[i]!;
    if (!UCI_MOVE_TOKEN_RE.test(moveToken)) break;
    pv.push(moveToken);
  }

  return pv.length > 0 ? { depth, multiPv, evalCp, mateIn, pv } : null;
}

export function computePvGap(
  best: { evalCp: number | null; mateIn: number | null },
  second: { evalCp: number | null; mateIn: number | null } | null
): number | null {
  if (!second) return null;

  const mateCp = STOCKFISH_DEFAULTS.mateEquivalentCp;

  if (best.evalCp !== null && second.evalCp !== null) {
    return round2(Math.max(0, (best.evalCp - second.evalCp) / 100));
  }
  if (best.mateIn !== null && best.mateIn > 0 && second.mateIn !== null && second.mateIn > 0) {
    return 0;
  }
  if (best.mateIn !== null && best.mateIn > 0 && second.evalCp !== null) {
    return round2(Math.max(0, (mateCp - second.evalCp) / 100));
  }
  if (best.mateIn !== null && best.mateIn > 0 && second.mateIn !== null && second.mateIn < 0) {
    return round2(mateCp / 100);
  }
  if (best.evalCp !== null && second.mateIn !== null && second.mateIn < 0) {
    return round2(Math.max(0, (best.evalCp + mateCp) / 100));
  }

  return null;
}

export function aggregateUciAnalysis(
  infoLines: readonly UciInfoLine[],
  bestMoveFromGo: string | null
): StockfishAnalysis {
  const byDepth = new Map<number, Map<number, UciInfoLine>>();
  let maxDepth = -1;

  for (const info of infoLines) {
    let depthMap = byDepth.get(info.depth);
    if (!depthMap) {
      depthMap = new Map<number, UciInfoLine>();
      byDepth.set(info.depth, depthMap);
    }
    depthMap.set(info.multiPv, info);
    if (info.depth > maxDepth) maxDepth = info.depth;
  }

  let selectedDepth = maxDepth;
  while (selectedDepth >= 0 && !byDepth.get(selectedDepth)?.has(1)) {
    selectedDepth -= 1;
  }

  const topMap = selectedDepth >= 0 ? byDepth.get(selectedDepth) : undefined;
  const pv1 = topMap?.get(1) ?? null;

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
    bestMoveFromGo && UCI_MOVE_TOKEN_RE.test(bestMoveFromGo) ? bestMoveFromGo : null;
  const bestMove = sanitizedGoMove ?? pv1?.pv[0] ?? '';

  const pv =
    pv1 && pv1.pv.length > 0 && (!bestMove || pv1.pv[0] === bestMove)
      ? pv1.pv.slice(0, STOCKFISH_DEFAULTS.maxPvLength)
      : bestMove
        ? [bestMove]
        : [];

  const evalCp = pv1?.evalCp ?? null;
  const mateIn = pv1?.mateIn ?? null;
  const secondEvalCp = pv2?.evalCp ?? null;
  const secondMateIn = pv2?.mateIn ?? null;
  const pvGap = pv1
    ? computePvGap({ evalCp, mateIn }, pv2 ? { evalCp: secondEvalCp, mateIn: secondMateIn } : null)
    : null;

  return { bestMove, pv, evalCp, mateIn, secondEvalCp, secondMateIn, pvGap };
}
