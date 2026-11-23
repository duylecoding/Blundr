import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import * as zlib from 'node:zlib';
import {
  buildGameUrl,
  calculateMaterial,
  classifyBucket,
  extractCandidatesFromGame,
  isTrivialFreeCapture,
} from '../src/candidateFilter.js';
import { parseCliArgs } from '../src/cli.js';
import {
  buildPositionDataset,
  classifyStyle,
  deterministicShuffle,
} from '../src/datasetBuilder.js';
import { pickLatestLichessUrl } from '../src/extract.js';
import {
  createByteLimitTransform,
  createZstdDecompressStream,
  extractEvalFromComment,
  normalizeEvalForSide,
  parseEvalToken,
  parsePgnGame,
  passesFastPreFilter,
  streamPgnGames,
} from '../src/pgnParser.js';
import { StockfishAnalyzer } from '../src/stockfish.js';
import {
  aggregateUciAnalysis,
  computePvGap,
  parseUciInfoLine,
  type UciInfoLine,
} from '../src/uciParser.js';
import type { Position } from '../../../shared/types.js';

const RUY_LOPEZ_MOVES = [
  'e4', 'e5',
  'Nf3', 'Nc6',
  'Bb5', 'a6',
  'Ba4', 'Nf6',
  'O-O', 'Be7',
  'Re1', 'b5',
  'Bb3', 'd6',
  'c3', 'O-O',
  'h3', 'Na5',
  'Bc2', 'c5',
  'd4', 'Qc7',
  'Nbd2', 'cxd4',
  'cxd4', 'Nc6',
  'Nb3', 'a5',
  'Be3', 'a4',
  'Nbd2', 'Bd7',
  'Rc1', 'Qb7',
];

function buildRuyLopezPgn(options: {
  whiteElo?: number;
  blackElo?: number;
  site?: string;
  evalOverrides?: Record<number, string>;
}): string {
  const whiteElo = options.whiteElo ?? 1950;
  const blackElo = options.blackElo ?? 1920;
  const site = options.site ?? 'https://lichess.org/AbCdEf12';
  const evalOverrides = options.evalOverrides ?? {};

  const tokens: string[] = [];
  for (let i = 0; i < RUY_LOPEZ_MOVES.length; i += 1) {
    const ply = i + 1;
    const moveNumber = Math.floor((ply + 1) / 2);
    const san = RUY_LOPEZ_MOVES[i]!;
    const evalStr = evalOverrides[ply] ?? '0.10';
    if (ply % 2 === 1) {
      tokens.push(`${moveNumber}. ${san} { [%eval ${evalStr}] }`);
    } else {
      tokens.push(`${moveNumber}... ${san} { [%eval ${evalStr}] }`);
    }
  }

  return [
    '[Event "Rated Blitz game"]',
    `[Site "${site}"]`,
    '[White "PlayerA"]',
    '[Black "PlayerB"]',
    `[WhiteElo "${whiteElo}"]`,
    `[BlackElo "${blackElo}"]`,
    '[Result "1-0"]',
    '',
    `${tokens.join(' ')} 1-0`,
  ].join('\n');
}

describe('pgnParser: [%eval] parsing and perspective normalization', () => {
  it('parses numeric pawn evals and mate evals', () => {
    assert.deepEqual(parseEvalToken('0.25'), { pawns: 0.25, mateIn: null });
    assert.deepEqual(parseEvalToken('-1.4'), { pawns: -1.4, mateIn: null });
    assert.deepEqual(parseEvalToken('+0.00'), { pawns: 0, mateIn: null });
    assert.deepEqual(parseEvalToken('-0.0'), { pawns: 0, mateIn: null });
    assert.deepEqual(parseEvalToken('#2'), { pawns: null, mateIn: 2 });
    assert.deepEqual(parseEvalToken('#-1'), { pawns: null, mateIn: -1 });
    assert.deepEqual(parseEvalToken('#+3'), { pawns: null, mateIn: 3 });
    assert.equal(parseEvalToken(''), null);
    assert.equal(parseEvalToken('#0'), null);
    assert.equal(parseEvalToken('notanumber'), null);
  });

  it('extracts [%eval ...] from PGN comment blocks with clocks', () => {
    assert.deepEqual(
      extractEvalFromComment(' [%eval -2.35] [%clk 0:03:12] '),
      { pawns: -2.35, mateIn: null }
    );
    assert.deepEqual(
      extractEvalFromComment(' [%eval #-2] '),
      { pawns: null, mateIn: -2 }
    );
    assert.equal(extractEvalFromComment(' [%clk 0:05:00] '), null);
  });

  it('normalizes White-perspective [%eval] for both White and Black to move', () => {
    // Numeric score: White +2.50 -> +2.50 for White, -2.50 for Black
    assert.deepEqual(
      normalizeEvalForSide({ pawns: 2.5, mateIn: null }, 'w'),
      { pawns: 2.5, mateIn: null }
    );
    assert.deepEqual(
      normalizeEvalForSide({ pawns: 2.5, mateIn: null }, 'b'),
      { pawns: -2.5, mateIn: null }
    );

    // Negative White eval means Black is winning: -3.20 -> +3.20 for Black
    assert.deepEqual(
      normalizeEvalForSide({ pawns: -3.2, mateIn: null }, 'b'),
      { pawns: 3.2, mateIn: null }
    );

    // Mate: #-2 (Black mates in 2) -> mateIn: +2 for Black, -2 for White
    assert.deepEqual(
      normalizeEvalForSide({ pawns: null, mateIn: -2 }, 'b'),
      { pawns: null, mateIn: 2 }
    );
    assert.deepEqual(
      normalizeEvalForSide({ pawns: null, mateIn: -2 }, 'w'),
      { pawns: null, mateIn: -2 }
    );

    // Mate: #1 (White mates in 1) -> mateIn: +1 for White, -1 for Black
    assert.deepEqual(
      normalizeEvalForSide({ pawns: null, mateIn: 1 }, 'w'),
      { pawns: null, mateIn: 1 }
    );
    assert.deepEqual(
      normalizeEvalForSide({ pawns: null, mateIn: 1 }, 'b'),
      { pawns: null, mateIn: -1 }
    );
  });

  it('streams multiple PGN games across arbitrary chunk boundaries', async () => {
    const g1 = buildRuyLopezPgn({ site: 'https://lichess.org/GameOne1' });
    const g2 = buildRuyLopezPgn({ site: 'https://lichess.org/GameTwo2' });
    const full = `${g1}\n\n${g2}\n`;

    // Split into small 37-byte chunks to verify line/UTF-8 reassembly
    const encoder = new TextEncoder();
    const bytes = encoder.encode(full);
    async function* chunked(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < bytes.length; i += 37) {
        yield bytes.subarray(i, i + 37);
      }
    }

    const yielded: string[] = [];
    for await (const raw of streamPgnGames(chunked())) {
      yielded.push(raw);
    }

    assert.equal(yielded.length, 2);
    assert.ok(yielded[0]!.includes('GameOne1'));
    assert.ok(yielded[1]!.includes('GameTwo2'));
  });

  it('pre-filters by Elo, [%eval presence, and variant before move parsing', () => {
    const valid = buildRuyLopezPgn({ whiteElo: 1850, blackElo: 1800 });
    assert.equal(passesFastPreFilter(valid, 1800), true);
    assert.equal(passesFastPreFilter(valid, 1850), false);

    const lowElo = buildRuyLopezPgn({ whiteElo: 1799, blackElo: 2100 });
    assert.equal(passesFastPreFilter(lowElo, 1800), false);

    const noEval = valid.replaceAll('[%eval ', '[%clk ');
    assert.equal(passesFastPreFilter(noEval, 1800), false);

    const chess960 = valid.replace(
      '[Event "Rated Blitz game"]',
      '[Event "Rated Chess960 game"]\n[Variant "Chess960"]'
    );
    assert.equal(passesFastPreFilter(chess960, 1800), false);
  });

  it('handles stray/nested closing braces and standalone ellipsis tokens without hanging', () => {
    const pgn = [
      '[Event "Rated Blitz game"]',
      '[Site "https://lichess.org/StrayBrc1"]',
      '[WhiteElo "1900"]',
      '[BlackElo "1910"]',
      '',
      '1. e4 { [%eval 0.25] }} } ... e5 { [%eval 0.30] } 2. Nf3 } Nc6 { [%eval 0.20] } 1-0',
    ].join('\n');

    const parsed = parsePgnGame(pgn);
    assert.ok(parsed);
    assert.deepEqual(
      parsed.moves.map((m) => m.san),
      ['e4', 'e5', 'Nf3', 'Nc6']
    );
    assert.deepEqual(parsed.moves[0]!.evalWhite, { pawns: 0.25, mateIn: null });
    assert.deepEqual(parsed.moves[1]!.evalWhite, { pawns: 0.3, mateIn: null });
    assert.deepEqual(parsed.moves[3]!.evalWhite, { pawns: 0.2, mateIn: null });
  });
});

describe('filter: material calculation', () => {
  it('calculates starting position material accurately', () => {
    const startFen =
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const mat = calculateMaterial(startFen);
    // Each side: 8*1 + 2*3 + 2*3 + 2*5 + 1*9 = 39
    assert.equal(mat.sideToMoveMaterial, 39);
    assert.equal(mat.opponentMaterial, 39);
    assert.equal(mat.balance, 0);
    assert.equal(mat.totalNonKingMaterial, 78);
  });

  it('computes balance relative to side to move', () => {
    // White has Q (9) + P (1) = 10; Black has R (5) + N (3) = 8
    const fenWhite = '4k3/8/8/8/8/3n1r2/4P3/3QK3 w - - 0 1';
    const matW = calculateMaterial(fenWhite);
    assert.equal(matW.balance, 2);
    assert.equal(matW.totalNonKingMaterial, 18);

    const fenBlack = '4k3/8/8/8/8/3n1r2/4P3/3QK3 b - - 0 1';
    const matB = calculateMaterial(fenBlack);
    assert.equal(matB.balance, -2);
    assert.equal(matB.totalNonKingMaterial, 18);
  });

  it('detects bare king and pawn endgames with totalNonKingMaterial < 10', () => {
    const kpEndgame = '4k3/4pp2/8/8/8/8/4PP2/4K3 w - - 0 40';
    const mat = calculateMaterial(kpEndgame);
    assert.equal(mat.totalNonKingMaterial, 4);
    assert.equal(mat.balance, 0);
  });
});

describe('filter: candidate bucketing and game extraction', () => {
  it('classifies Equal, Tier 1, Tier 2, Tier 3, and rejects out-of-range evals', () => {
    // Equal: |before| <= 0.3 and |after| <= 0.3
    assert.deepEqual(
      classifyBucket({ pawns: 0.25, mateIn: null }, { pawns: -0.2, mateIn: null }),
      { kind: 'equal', hasAdvantage: false }
    );
    // |before| = 0.35 -> not equal (must be <= 0.3 for Equal)
    assert.equal(
      classifyBucket({ pawns: 0.35, mateIn: null }, { pawns: 0.1, mateIn: null }),
      null
    );

    // Tier 1: evalAfter >= 4.0 OR mateIn in 1..2
    assert.deepEqual(
      classifyBucket({ pawns: 0.4, mateIn: null }, { pawns: 4.0, mateIn: null }),
      { kind: 'advantage', hasAdvantage: true, tier: 1 }
    );
    assert.deepEqual(
      classifyBucket({ pawns: -0.35, mateIn: null }, { pawns: null, mateIn: 2 }),
      { kind: 'advantage', hasAdvantage: true, tier: 1 }
    );
    // Mate in 3 is outside Tier 1's 1..2 mate spec
    assert.equal(
      classifyBucket({ pawns: 0.0, mateIn: null }, { pawns: null, mateIn: 3 }),
      null
    );
    // Getting mated is rejected
    assert.equal(
      classifyBucket({ pawns: 0.0, mateIn: null }, { pawns: null, mateIn: -1 }),
      null
    );

    // Tier 2: 2.0 <= evalAfter < 4.0
    assert.deepEqual(
      classifyBucket({ pawns: 0.1, mateIn: null }, { pawns: 2.0, mateIn: null }),
      { kind: 'advantage', hasAdvantage: true, tier: 2 }
    );
    assert.deepEqual(
      classifyBucket({ pawns: 0.1, mateIn: null }, { pawns: 3.99, mateIn: null }),
      { kind: 'advantage', hasAdvantage: true, tier: 2 }
    );

    // Tier 3: 1.0 <= evalAfter < 2.0
    assert.deepEqual(
      classifyBucket({ pawns: -0.2, mateIn: null }, { pawns: 1.0, mateIn: null }),
      { kind: 'advantage', hasAdvantage: true, tier: 3 }
    );
    assert.deepEqual(
      classifyBucket({ pawns: -0.2, mateIn: null }, { pawns: 1.95, mateIn: null }),
      { kind: 'advantage', hasAdvantage: true, tier: 3 }
    );

    // Gray zone 0.31..0.99 rejected
    assert.equal(
      classifyBucket({ pawns: 0.1, mateIn: null }, { pawns: 0.75, mateIn: null }),
      null
    );

    // Prior state not equal (|evalBefore| > 0.4) rejected
    assert.equal(
      classifyBucket({ pawns: 0.45, mateIn: null }, { pawns: 5.0, mateIn: null }),
      null
    );
  });

  it('extracts Tier 1/2/3 advantages for both White and Black to move and enforces Elo & ply spacing', () => {
    // In RUY_LOPEZ_MOVES:
    // ply 21 = 11. d4 (White moves -> Black to move). If evalWhite jumps from 0.10 -> -2.80, Black has +2.80 (Tier 2).
    // ply 28 = 14... a5 (Black moves -> White to move). If evalWhite jumps from 0.20 -> +1.50, White has +1.50 (Tier 3).
    // Keep other move 10+ evals outside candidate windows (e.g. 0.70) so only our target plies match.
    const overrides: Record<number, string> = {};
    for (let p = 18; p <= 34; p += 1) {
      overrides[p] = '0.70';
    }
    overrides[20] = '0.10'; // prior to ply 21
    overrides[21] = '-2.80'; // after 11. d4 -> Black to move has +2.80 (Tier 2)
    overrides[27] = '0.20'; // prior to ply 28
    overrides[28] = '1.50'; // after 14... a5 -> White to move has +1.50 (Tier 3)

    const pgn = buildRuyLopezPgn({
      whiteElo: 1950,
      blackElo: 1850,
      evalOverrides: overrides,
    });
    const parsed = parsePgnGame(pgn);
    assert.ok(parsed);

    const candidates = extractCandidatesFromGame(parsed, { minElo: 1800 });
    assert.equal(candidates.length, 2);

    const first = candidates[0]!;
    assert.equal(first.ply, 21);
    assert.equal(first.sideToMove, 'b');
    assert.equal(first.lastMoveSan, 'd4');
    assert.equal(first.lastMove, 'd2d4');
    assert.equal(first.evalBefore, -0.1);
    assert.equal(first.evalAfter, 2.8);
    assert.deepEqual(first.bucket, { kind: 'advantage', hasAdvantage: true, tier: 2 });
    assert.equal(first.gameUrl, 'https://lichess.org/AbCdEf12#21');

    const second = candidates[1]!;
    assert.equal(second.ply, 28);
    assert.equal(second.sideToMove, 'w');
    assert.equal(second.lastMoveSan, 'a5');
    assert.equal(second.lastMove, 'a6a5');
    assert.equal(second.evalBefore, 0.2);
    assert.equal(second.evalAfter, 1.5);
    assert.deepEqual(second.bucket, { kind: 'advantage', hasAdvantage: true, tier: 3 });

    // Elo filter rejects same game when minElo > blackElo
    assert.equal(
      extractCandidatesFromGame(parsed, { minElo: 1900 }).length,
      0
    );
  });

  it('normalizes Lichess /game/<id> Site headers to canonical https://lichess.org/<id>#<ply>', () => {
    const pgn = buildRuyLopezPgn({
      site: 'https://lichess.org/game/IRImjKAF',
    });
    const parsed = parsePgnGame(pgn);
    assert.ok(parsed);
    assert.equal(parsed.gameId, 'IRImjKAF');

    const candidates = extractCandidatesFromGame(parsed, { minElo: 1800 });
    assert.ok(candidates.length > 0);
    assert.equal(
      candidates[0]!.gameUrl,
      `https://lichess.org/IRImjKAF#${candidates[0]!.ply}`
    );
  });

  it('caps candidates at 2 per game and keeps them at least 6 plies apart', () => {
    // All evals 0.10 -> every ply from move 10..17 qualifies as Equal
    const pgn = buildRuyLopezPgn({});
    const parsed = parsePgnGame(pgn);
    assert.ok(parsed);

    const candidates = extractCandidatesFromGame(parsed, { minElo: 1800 });
    assert.equal(candidates.length, 2);
    assert.ok(candidates[1]!.ply - candidates[0]!.ply >= 6);
  });

  it('rejects candidates when material imbalance exceeds 1 pawn', () => {
    // Construct a short legal game reaching move 10 where White is already down a full knight (imbalance = -3)
    const moves = [
      '1. e4 { [%eval 0.1] } 1... e5 { [%eval 0.1] }',
      '2. Nf3 { [%eval 0.1] } 2... Nc6 { [%eval 0.1] }',
      '3. Nxe5 { [%eval -3.0] } 3... Nxe5 { [%eval -3.0] }',
      '4. d4 { [%eval -3.0] } 4... Nc6 { [%eval -3.0] }',
      '5. c3 { [%eval -3.0] } 5... d6 { [%eval -3.0] }',
      '6. Bd3 { [%eval -3.0] } 6... Nf6 { [%eval -3.0] }',
      '7. O-O { [%eval -3.0] } 7... Be7 { [%eval -3.0] }',
      '8. Nd2 { [%eval -3.0] } 8... O-O { [%eval -3.0] }',
      '9. Re1 { [%eval -3.0] } 9... Re8 { [%eval 0.1] }',
      '10. Nf1 { [%eval 0.1] } 10... Bf8 { [%eval 2.5] } 1-0',
    ].join(' ');

    const pgn = [
      '[Event "Rated Blitz game"]',
      '[Site "https://lichess.org/Imbal123"]',
      '[WhiteElo "1900"]',
      '[BlackElo "1900"]',
      '',
      moves,
    ].join('\n');

    const parsed = parsePgnGame(pgn);
    assert.ok(parsed);
    const candidates = extractCandidatesFromGame(parsed, { minElo: 1800 });
    assert.equal(candidates.length, 0);
  });
});

describe('filter: isTrivialFreeCapture', () => {
  it('detects an undefended hanging knight', () => {
    const fen = '4k3/pp4pp/8/3n4/8/8/PP4PP/3QK3 w - - 0 1';
    assert.equal(isTrivialFreeCapture(fen, 'd1d5'), true);
  });

  it('detects an undefended hanging queen', () => {
    const fen = '4k3/pp4pp/8/q7/8/8/1P4PP/R3K3 w - - 0 1';
    assert.equal(isTrivialFreeCapture(fen, 'a1a5'), true);
  });

  it('allows capturing a defended piece (non-trivial tactical capture)', () => {
    // Black knight on d5 is defended by pawn on e6
    const fen = '4k3/pp3ppp/4p3/3n4/8/8/PP4PP/3QK3 w - - 0 1';
    assert.equal(isTrivialFreeCapture(fen, 'd1d5'), false);
  });

  it('allows capturing a piece whose defender is pinned (pin tactic)', () => {
    // Black rook on c5 is defended by knight on d7, which is pinned to e8 by Bb5
    const fen = '4k3/3n2pp/8/1Br5/8/8/PP4PP/2Q1K3 w - - 0 1';
    assert.equal(isTrivialFreeCapture(fen, 'c1c5'), false);
  });

  it('allows capturing an undefended pawn (value < 3)', () => {
    const fen = '4k3/pp4pp/8/3p4/8/8/PP4PP/3QK3 w - - 0 1';
    assert.equal(isTrivialFreeCapture(fen, 'd1d5'), false);
  });

  it('allows quiet positional moves', () => {
    const fen = '4k3/pp4pp/8/3n4/8/8/PP4PP/3QK3 w - - 0 1';
    assert.equal(isTrivialFreeCapture(fen, 'd1d4'), false);
  });
});

describe('stockfish: UCI info parsing and MultiPV=2 aggregation', () => {
  it('parses MultiPV=2 cp and mate info lines and skips bound lines', () => {
    const cpLine =
      'info depth 14 seldepth 20 multipv 1 score cp 245 nodes 123456 nps 500000 time 246 pv d4e5 f6e4 c2e4 d6e5 e1e4';
    assert.deepEqual(parseUciInfoLine(cpLine), {
      depth: 14,
      multiPv: 1,
      evalCp: 245,
      mateIn: null,
      pv: ['d4e5', 'f6e4', 'c2e4', 'd6e5', 'e1e4'],
    });

    const mateLine =
      'info depth 14 seldepth 4 multipv 1 score mate 2 nodes 4000 pv d1h5 g7g6 h5g6';
    assert.deepEqual(parseUciInfoLine(mateLine), {
      depth: 14,
      multiPv: 1,
      evalCp: null,
      mateIn: 2,
      pv: ['d1h5', 'g7g6', 'h5g6'],
    });

    // Aspiration bound lines should be ignored
    const boundLine =
      'info depth 14 seldepth 20 multipv 1 score cp 280 lowerbound nodes 50000 pv d4e5';
    assert.equal(parseUciInfoLine(boundLine), null);

    // Non-info or currmove lines should return null
    assert.equal(parseUciInfoLine('info depth 14 currmove d4e5 currmovenumber 1'), null);
    assert.equal(parseUciInfoLine('bestmove d4e5 ponder f6e4'), null);
  });

  it('aggregates MultiPV=2 lines into StockfishAnalysis with pvGap and 4-move PV cap', () => {
    const rawLines = [
      'info depth 12 multipv 1 score cp 210 pv d4e5 f6e4 c2e4',
      'info depth 12 multipv 2 score cp 60 pv d4d5 c6b8',
      'info depth 14 multipv 1 score cp 265 pv d4e5 f6e4 c2e4 d6e5 e1e4 f7f5',
      'info depth 14 multipv 2 score cp 85 pv d4d5 c6b8 d2f1',
    ];
    const parsed = rawLines
      .map(parseUciInfoLine)
      .filter((x): x is UciInfoLine => x !== null);

    const analysis = aggregateUciAnalysis(parsed, 'd4e5');
    assert.equal(analysis.bestMove, 'd4e5');
    assert.deepEqual(analysis.pv, ['d4e5', 'f6e4', 'c2e4', 'd6e5']);
    assert.equal(analysis.evalCp, 265);
    assert.equal(analysis.mateIn, null);
    assert.equal(analysis.secondEvalCp, 85);
    assert.equal(analysis.secondMateIn, null);
    assert.equal(analysis.pvGap, 1.8);
  });

  it('computes pvGap for mate vs non-mate lines', () => {
    assert.equal(
      computePvGap(
        { evalCp: null, mateIn: 2 },
        { evalCp: 50, mateIn: null }
      ),
      9.5
    );
    assert.equal(
      computePvGap(
        { evalCp: null, mateIn: 1 },
        { evalCp: null, mateIn: 2 }
      ),
      0
    );
    assert.equal(
      computePvGap({ evalCp: 180, mateIn: null }, null),
      null
    );
  });
});

describe('extract: CLI, style, URL picking, and dataset assembly', () => {
  it('picks the most recent .pgn.zst URL from Lichess list.txt', () => {
    const listText = [
      'https://database.lichess.org/standard/lichess_db_standard_rated_2025-11.pgn.zst',
      'https://database.lichess.org/standard/lichess_db_standard_rated_2026-02.pgn.zst',
      'https://database.lichess.org/standard/lichess_db_standard_rated_2026-01.pgn.zst',
    ].join('\n');
    assert.equal(
      pickLatestLichessUrl(listText),
      'https://database.lichess.org/standard/lichess_db_standard_rated_2026-02.pgn.zst'
    );
  });

  it('classifies tactical vs positional vs equal style accurately', () => {
    assert.equal(classifyStyle(false, null, 2.5), 'equal');
    assert.equal(classifyStyle(true, 2, null), 'tactical');
    assert.equal(classifyStyle(true, null, 1.2), 'tactical');
    assert.equal(classifyStyle(true, null, 1.19), 'positional');
    assert.equal(classifyStyle(true, null, null), 'positional');
  });

  it('parses CLI flags and defaults', () => {
    const defaults = parseCliArgs([]);
    assert.equal(defaults.minElo, 1800);
    assert.equal(defaults.perTier, 15);
    assert.equal(defaults.depth, 14);
    assert.equal(defaults.noStockfish, false);

    const custom = parseCliArgs([
      '--min-elo', '2000',
      '--per-tier', '10',
      '--depth', '12',
      '--no-stockfish',
    ]);
    assert.equal(custom.minElo, 2000);
    assert.equal(custom.perTier, 10);
    assert.equal(custom.depth, 12);
    assert.equal(custom.noStockfish, true);
  });

  it('builds a balanced PositionDataset with equal positions split evenly across tiers 1/2/3 and deterministic shuffle', () => {
    const makeStub = (id: string, hasAdvantage: boolean, tier: 1 | 2 | 3): Position => ({
      id,
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      lastMove: 'e2e4',
      lastMoveSan: 'e4',
      sideToMove: 'b',
      hasAdvantage,
      tier,
      evalBefore: 0.1,
      evalAfter: hasAdvantage ? 2.5 : 0.05,
      mateIn: null,
      bestMove: 'e7e5',
      pv: ['e7e5', 'g1f3'],
      pvGap: hasAdvantage ? 1.5 : 0.1,
      style: hasAdvantage ? 'tactical' : 'equal',
      materialBalance: 0,
      moveNumber: 15,
      avgElo: 1950,
      gameUrl: `https://lichess.org/${id}#30`,
    });

    const verified = {
      tier1: [makeStub('a1', true, 1), makeStub('a2', true, 1)],
      tier2: [makeStub('b1', true, 2), makeStub('b2', true, 2)],
      tier3: [makeStub('c1', true, 3), makeStub('c2', true, 3)],
      equal: [
        makeStub('e1', false, 1),
        makeStub('e2', false, 1),
        makeStub('e3', false, 1),
        makeStub('e4', false, 1),
        makeStub('e5', false, 1),
        makeStub('e6', false, 1),
      ],
    };

    const ds1 = buildPositionDataset(verified, {
      source: 'test.pgn',
      minElo: 1800,
      generatedAt: '2026-11-22T00:00:00.000Z',
    });
    const ds2 = buildPositionDataset(verified, {
      source: 'test.pgn',
      minElo: 1800,
      generatedAt: '2026-11-22T00:00:00.000Z',
    });

    assert.equal(ds1.counts.total, 12);
    assert.equal(ds1.counts.advantage, 6);
    assert.equal(ds1.counts.equal, 6);
    assert.deepEqual(ds1.counts.byTier[1], { advantage: 2, equal: 2 });
    assert.deepEqual(ds1.counts.byTier[2], { advantage: 2, equal: 2 });
    assert.deepEqual(ds1.counts.byTier[3], { advantage: 2, equal: 2 });

    // Deterministic shuffle produces identical ordering
    assert.deepEqual(
      ds1.positions.map((p) => p.id),
      ds2.positions.map((p) => p.id)
    );
    assert.deepEqual(
      deterministicShuffle([1, 2, 3, 4, 5], 42),
      deterministicShuffle([1, 2, 3, 4, 5], 42)
    );
  });
});

describe('security hardening: URLs, UCI validation, PGN bounds, prototype safety, and CLI', () => {
  it('buildGameUrl rejects non-Lichess/HTTP sites and emits canonical https://lichess.org/<id>#<ply>', () => {
    assert.equal(
      buildGameUrl('https://lichess.org/AbCdEf12', 'AbCdEf12', 21),
      'https://lichess.org/AbCdEf12#21'
    );
    assert.equal(
      buildGameUrl('https://lichess.org/game/IRImjKAF', 'IRImjKAF', 14),
      'https://lichess.org/IRImjKAF#14'
    );

    // Reject HTTP, non-Lichess hosts, substring spoofing, javascript:, and invalid URLs
    assert.equal(buildGameUrl('http://lichess.org/AbCdEf12', 'AbCdEf12', 21), null);
    assert.equal(buildGameUrl('https://evil.com/AbCdEf12', 'AbCdEf12', 21), null);
    assert.equal(buildGameUrl('https://evil.com/lichess.org/AbCdEf12', 'AbCdEf12', 21), null);
    assert.equal(buildGameUrl('https://lichess.org.evil.com/AbCdEf12', 'AbCdEf12', 21), null);
    assert.equal(buildGameUrl('javascript:alert(1)', 'AbCdEf12', 21), null);
    assert.equal(buildGameUrl('not-a-url', 'AbCdEf12', 21), null);

    const evilPgn = buildRuyLopezPgn({ site: 'http://evil.com/AbCdEf12' });
    const parsedEvil = parsePgnGame(evilPgn);
    assert.ok(parsedEvil);
    assert.equal(extractCandidatesFromGame(parsedEvil, { minElo: 1800 }).length, 0);
  });

  it('StockfishAnalyzer rejects FENs with newlines/invalid format and out-of-range options', async () => {
    assert.throws(() => new StockfishAnalyzer({ entrypoint: 'stub.js', hashMb: 0 }), RangeError);
    assert.throws(() => new StockfishAnalyzer({ entrypoint: 'stub.js', hashMb: 2048 }), RangeError);
    assert.throws(() => new StockfishAnalyzer({ entrypoint: 'stub.js', hashMb: 16.5 }), RangeError);
    assert.throws(() => new StockfishAnalyzer({ entrypoint: 'stub.js', startupTimeoutMs: 50 }), RangeError);
    assert.throws(() => new StockfishAnalyzer({ entrypoint: 'stub.js', startupTimeoutMs: 200_000 }), RangeError);

    const analyzer = new StockfishAnalyzer({ entrypoint: 'stub.js' });
    const validFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

    await assert.rejects(
      analyzer.analyze(`${validFen}\nsetoption name Hash value 9999`),
      /Invalid FEN/
    );
    await assert.rejects(analyzer.analyze(`${validFen}\rgo movetime 1`), /Invalid FEN/);
    await assert.rejects(analyzer.analyze(`${validFen}\0`), /Invalid FEN/);
    await assert.rejects(analyzer.analyze('not a valid fen'), /Invalid FEN/);
    await assert.rejects(
      analyzer.analyze('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b  e3 0 1'),
      /Invalid FEN/
    );

    await assert.rejects(analyzer.analyze(validFen, { depth: 0 }), RangeError);
    await assert.rejects(analyzer.analyze(validFen, { depth: 31 }), RangeError);
    await assert.rejects(analyzer.analyze(validFen, { multiPv: 0 }), RangeError);
    await assert.rejects(analyzer.analyze(validFen, { multiPv: 6 }), RangeError);
    await assert.rejects(analyzer.analyze(validFen, { timeoutMs: 99 }), RangeError);
    await assert.rejects(analyzer.analyze(validFen, { timeoutMs: 120_001 }), RangeError);

    await analyzer.close();
  });

  it('parsePgnGame uses null-prototype headers, ignores __proto__/constructor, and strips trailing !? linearly', () => {
    const bangRun = '!'.repeat(50_000);
    const pgn = [
      '[Event "Rated Blitz game"]',
      '[Site "https://lichess.org/Proto123"]',
      '[__proto__ "polluted"]',
      '[constructor "shadowed"]',
      '[WhiteElo "1950"]',
      '[BlackElo "1920"]',
      '',
      `1. e4!? { [%eval 0.20] } 1... e5${bangRun} { [%eval 0.25] } 2. Nf3?! Nc6!! 1-0`,
    ].join('\n');

    const started = performance.now();
    const parsed = parsePgnGame(pgn);
    const elapsedMs = performance.now() - started;

    assert.ok(parsed);
    assert.equal(Object.getPrototypeOf(parsed.headers), null);
    assert.equal(parsed.headers['__proto__'], undefined);
    assert.equal(parsed.headers['constructor'], undefined);
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
    assert.deepEqual(
      parsed.moves.map((m) => m.san),
      ['e4', 'e5', 'Nf3', 'Nc6']
    );
    assert.ok(elapsedMs < 500, `Expected linear annotation stripping, took ${elapsedMs}ms`);
  });

  it('streamPgnGames skips oversized lines and games while yielding subsequent valid games', async () => {
    const valid1 = buildRuyLopezPgn({ site: 'https://lichess.org/Valid001' });
    const oversizedLineGame = [
      '[Event "Oversized line game"]',
      `[Site "https://lichess.org/BigLine1"]`,
      `1. e4 { ${'x'.repeat(250)} } 1-0`,
    ].join('\n');
    const valid2 = [
      '[Event "Small valid game"]',
      '[Site "https://lichess.org/Valid002"]',
      '[WhiteElo "1900"]',
      '[BlackElo "1900"]',
      '',
      '1. e4 e5 1-0',
    ].join('\n');

    async function* lineTestStream(): AsyncGenerator<string> {
      yield `${oversizedLineGame}\n\n${valid2}\n`;
    }
    const afterOversizedLine: string[] = [];
    for await (const raw of streamPgnGames(lineTestStream(), { maxLineBytes: 120, maxGameBytes: 4096 })) {
      afterOversizedLine.push(raw);
    }
    assert.equal(afterOversizedLine.length, 1);
    assert.ok(afterOversizedLine[0]!.includes('Valid002'));

    async function* gameTestStream(): AsyncGenerator<string> {
      yield `${valid1}\n\n${valid2}\n`;
    }
    const afterOversizedGame: string[] = [];
    for await (const raw of streamPgnGames(gameTestStream(), { maxLineBytes: 4096, maxGameBytes: 300 })) {
      afterOversizedGame.push(raw);
    }
    assert.equal(afterOversizedGame.length, 1);
    assert.ok(afterOversizedGame[0]!.includes('Valid002'));
  });

  it('createByteLimitTransform and createZstdDecompressStream enforce the decompressed byte ceiling', async () => {
    const limiter = createByteLimitTransform(16);
    const source = Readable.from([Buffer.alloc(10, 65), Buffer.alloc(10, 66)]);
    source.pipe(limiter);

    await assert.rejects(async () => {
      for await (const _chunk of limiter) {
        // consume stream until limit triggers
      }
    }, /exceeded limit of 16 bytes/);

    const zlibWithZstd = zlib as unknown as { zstdCompressSync?: (buf: Buffer) => Buffer };
    if (typeof zlibWithZstd.zstdCompressSync === 'function') {
      const compressed = zlibWithZstd.zstdCompressSync(Buffer.alloc(1024, 65));
      const zstdStream = createZstdDecompressStream(128);
      Readable.from([compressed]).pipe(zstdStream);

      await assert.rejects(async () => {
        for await (const _chunk of zstdStream) {
          // consume until zstd bomb limit triggers
        }
      }, /exceeded limit of 128 bytes/);
    }
  });

  it('parseCliArgs rejects malformed integers, out-of-bounds values, HTTP URLs, and non-Lichess hosts', () => {
    assert.throws(() => parseCliArgs(['--depth', '14abc']), /Invalid positive integer/);
    assert.throws(() => parseCliArgs(['--min-elo', '99']), /must be in 100\.\.4000/);
    assert.throws(() => parseCliArgs(['--min-elo', '4001']), /must be in 100\.\.4000/);
    assert.throws(() => parseCliArgs(['--per-tier', '0']), /must be in 1\.\.10000/);
    assert.throws(() => parseCliArgs(['--per-tier', '10001']), /must be in 1\.\.10000/);
    assert.throws(() => parseCliArgs(['--depth', '31']), /must be in 1\.\.30/);
    assert.throws(
      () => parseCliArgs(['--url', 'http://database.lichess.org/standard/lichess_db_standard_rated_2026-02.pgn.zst']),
      /https:\/\/database\.lichess\.org/
    );
    assert.throws(
      () => parseCliArgs(['--url', 'https://evil.com/standard/lichess_db_standard_rated_2026-02.pgn.zst']),
      /https:\/\/database\.lichess\.org/
    );
    assert.throws(
      () => parseCliArgs(['--url', 'https://database.lichess.org.evil.com/a.pgn.zst']),
      /https:\/\/database\.lichess\.org/
    );

    const validUrl = 'https://database.lichess.org/standard/lichess_db_standard_rated_2026-02.pgn.zst';
    assert.equal(parseCliArgs(['--url', validUrl]).url, validUrl);
  });

  it('pickLatestLichessUrl rejects http:// and non-Lichess hosts', () => {
    assert.throws(
      () =>
        pickLatestLichessUrl(
          'http://database.lichess.org/standard/lichess_db_standard_rated_2026-02.pgn.zst'
        ),
      /No valid https:\/\/database\.lichess\.org/
    );
    assert.throws(
      () =>
        pickLatestLichessUrl(
          'https://evil.com/standard/lichess_db_standard_rated_2026-02.pgn.zst'
        ),
      /No valid https:\/\/database\.lichess\.org/
    );

    const mixedList = [
      'http://database.lichess.org/standard/lichess_db_standard_rated_2099-12.pgn.zst',
      'https://evil.com/standard/lichess_db_standard_rated_2099-11.pgn.zst',
      'https://database.lichess.org/standard/lichess_db_standard_rated_2026-02.pgn.zst',
    ].join('\n');
    assert.equal(
      pickLatestLichessUrl(mixedList),
      'https://database.lichess.org/standard/lichess_db_standard_rated_2026-02.pgn.zst'
    );
  });
});
