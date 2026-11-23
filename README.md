# Blundr

A mobile-first chess training web app (installable as an Android PWA) built around real-game awareness: instead of knowing a winning tactic always exists, swipe **Right (Advantage)** or **Left (Equal)** to judge whether your opponent's last move actually blundered an edge.

## Features

- **Daily 5 (Wordle-style):** 5 deterministic positions per day (`YYYY-MM-DD`) ramping from Easy to Hard with an unpredictable Advantage/Equal mix, daily streak tracking, and a one-tap copyable emoji share grid.
- **Practice Mode:** 5 fresh deterministic tries per difficulty (`Easy`, `Medium`, `Hard`) every day (excluding today's Daily 5, resetting at midnight) with lifetime accuracy, streak, and false-positive / false-negative tracking.
- **Interactive Post-Swipe Review:** Reveals the Stockfish evaluation, blunder swing, tactical vs. positional classification, best-move arrow, PV move stepper right on the board, and a direct link to Lichess analysis.
- **Offline-First Android PWA:** Precaches the position pack and PNG app icons via `vite-plugin-pwa` for full-screen "Add to Home Screen" installation on Android Chrome.
- **Lichess 1800+ ETL Pipeline:** Streams recent monthly Lichess Standard Rated `.pgn.zst` archives using Node's built-in `zlib.createZstdDecompress`, filters for `1800+` Elo equal-material positions where a balanced game swings on one move, and enriches with local Stockfish MultiPV=2.

## Quick Start

Requires **Node.js 22.15+ / 26 LTS** (uses native `zlib.createZstdDecompress`).

```bash
# Install dependencies
npm --prefix web install
npm --prefix scripts/etl install

# Start the web app locally
npm run dev
```

## Regenerating or Scaling the Dataset

The starter pack ships with **90 verified 1800+ Lichess positions** (`45` Advantage / `45` Equal across 3 difficulty tiers) in `web/public/data/positions.json`.

To pull a larger pack (e.g. 600 positions = 100 per tier × 2):

```bash
npm --prefix scripts/etl run extract -- --min-elo 1800 --per-tier 100 --depth 14
```

Options:
- `--min-elo <n>`: Minimum rating for both players (default `1800`)
- `--per-tier <n>`: Advantage + Equal positions per tier (total = `n * 6`, default `15`)
- `--depth <n>`: Stockfish search depth for MultiPV=2 enrichment (default `14`)
- `--url <url>` / `--file <path>`: Custom Lichess `.pgn.zst` archive (defaults to latest monthly dump)

## Testing & Building

```bash
npm test       # Runs ETL (27 tests) + Web (15 tests)
npm run build  # Type-checks and builds production PWA in web/dist/
```
