/**
 * End-of-day Daily 5 results screen with Wordle share card, streak stats, and puzzle review.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Clock, Eye, Flame, Share2, Sparkles, Trophy } from 'lucide-react';
import { COPY_FEEDBACK_MS } from '../config/constants';
import { formatEval } from '../domain/bestLine';
import { buildShareText, copyTextToClipboard } from '../domain/share';
import { useMidnightCountdown } from '../hooks/useLocalDate';
import type { DailyAnswer, DailyStreak, Position } from '../types';

interface DailyResultsProps {
  puzzleNumber: number;
  positions: readonly Position[];
  answers: readonly DailyAnswer[];
  streak: DailyStreak;
  onInspectPuzzle: (index: number) => void;
  onPlayPractice: () => void;
}

export function DailyResults({
  puzzleNumber,
  positions,
  answers,
  streak,
  onInspectPuzzle,
  onPlayPractice,
}: DailyResultsProps) {
  const countdown = useMidnightCountdown();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    },
    []
  );

  const answerById = new Map(answers.map((a) => [a.positionId, a]));
  const results = positions.map((p) => Boolean(answerById.get(p.id)?.correct));
  const score = results.filter(Boolean).length;
  const total = positions.length;
  const shareText = buildShareText(puzzleNumber, results, streak.currentStreak);

  const handleShare = async () => {
    if (!(await copyTextToClipboard(shareText))) return;
    setCopied(true);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  return (
    <div className="flex flex-1 flex-col justify-between gap-3 overflow-y-auto px-3 pb-4 pt-1">
      <div className="rounded-2xl bg-slate-900/95 p-4 text-center ring-1 ring-slate-800 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
          Daily Challenge #{puzzleNumber}
        </p>
        <div className="mt-1 flex items-baseline justify-center gap-1">
          <span className="text-5xl font-black tracking-tight text-slate-50">{score}</span>
          <span className="text-2xl font-bold text-slate-500">/{total}</span>
        </div>

        <div className="mt-3 flex items-center justify-center gap-1.5 text-2xl" aria-label={`Results: ${score} out of ${total} correct`}>
          {results.map((ok, idx) => (
            <button
              key={positions[idx]?.id ?? idx}
              type="button"
              onClick={() => onInspectPuzzle(idx)}
              title={`Inspect Puzzle #${idx + 1}`}
              aria-label={`Inspect puzzle ${idx + 1}: ${ok ? 'Correct' : 'Missed'}`}
              className="rounded-lg p-0.5 transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <span aria-hidden="true">{ok ? '🟩' : '🟥'}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-950/70 px-2 py-2.5 ring-1 ring-slate-800/80">
            <div className="flex items-center justify-center gap-1 text-amber-400">
              <Flame className="h-4 w-4 fill-amber-400" />
              <span className="text-lg font-extrabold text-slate-100">{streak.currentStreak}</span>
            </div>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Streak</p>
          </div>
          <div className="rounded-xl bg-slate-950/70 px-2 py-2.5 ring-1 ring-slate-800/80">
            <div className="flex items-center justify-center gap-1 text-emerald-400">
              <Trophy className="h-4 w-4" />
              <span className="text-lg font-extrabold text-slate-100">{streak.maxStreak}</span>
            </div>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Best</p>
          </div>
          <div className="rounded-xl bg-slate-950/70 px-2 py-2.5 ring-1 ring-slate-800/80">
            <div className="flex items-center justify-center gap-1 text-sky-400">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono text-sm font-bold text-slate-100">{countdown}</span>
            </div>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Next Daily</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-900/90 p-3 ring-1 ring-slate-800">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Review Today&apos;s 5</h2>
          <span className="text-[11px] text-slate-500">Tap any to inspect line</span>
        </div>
        <div className="space-y-1.5">
          {positions.map((pos, idx) => {
            const ok = Boolean(answerById.get(pos.id)?.correct);
            const evalStr = formatEval(pos.evalAfter, pos.mateIn, pos.sideToMove);
            return (
              <button
                key={pos.id}
                type="button"
                onClick={() => onInspectPuzzle(idx)}
                className="flex w-full items-center justify-between rounded-xl bg-slate-950/60 px-3 py-2 text-left text-xs ring-1 ring-slate-800/80 transition hover:bg-slate-800/80"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                    {idx + 1}
                  </span>
                  <span className="font-semibold text-slate-200 truncate">{pos.hasAdvantage ? 'Advantage' : 'Equal'}</span>
                  <span className="font-mono text-[11px] text-slate-400">({evalStr})</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] text-slate-500">{pos.sideToMove === 'w' ? 'White' : 'Black'}</span>
                  <Eye className="h-3.5 w-3.5 text-slate-400" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-[0.98]"
        >
          {copied ? <><Check className="h-4 w-4" />Copied to Clipboard!</> : <><Share2 className="h-4 w-4" />Share Results</>}
        </button>
        <button
          type="button"
          onClick={onPlayPractice}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-semibold text-slate-100 ring-1 ring-slate-700 transition hover:bg-slate-700 active:scale-[0.98]"
        >
          <Sparkles className="h-4 w-4 text-sky-400" />
          Play Practice Mode
        </button>
      </div>
    </div>
  );
}
