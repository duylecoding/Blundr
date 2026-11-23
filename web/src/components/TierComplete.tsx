/**
 * Completion card shown when a Practice difficulty's 5 daily tries are finished.
 */
import { ArrowRight, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { ALL_TIERS, TIER_CONFIG } from '../config/constants';
import { useMidnightCountdown } from '../hooks/useLocalDate';
import type { DailyAnswer, DifficultyTier, Position } from '../types';

interface TierCompleteProps {
  tier: DifficultyTier;
  positions: readonly Position[];
  answers: readonly DailyAnswer[];
  remainingByTier: Record<DifficultyTier, number>;
  onSelectTier: (tier: DifficultyTier) => void;
  onGoToDaily: () => void;
}

export function TierComplete({
  tier,
  positions,
  answers,
  remainingByTier,
  onSelectTier,
  onGoToDaily,
}: TierCompleteProps) {
  const countdown = useMidnightCountdown();
  const tierMeta = TIER_CONFIG[tier];

  const answerById = new Map(answers.map((a) => [a.positionId, a]));
  const results = positions.map((p) => Boolean(answerById.get(p.id)?.correct));
  const score = results.filter(Boolean).length;
  const total = positions.length;

  const otherAvailableTiers = ALL_TIERS.filter(
    (other) => other !== tier && remainingByTier[other] > 0
  );

  return (
    <main className="flex flex-1 flex-col items-center px-3 pb-4 pt-1 overflow-y-auto">
      <div className="my-auto w-full rounded-2xl bg-slate-900/95 p-5 text-center ring-1 ring-slate-800 shadow-xl">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
          <CheckCircle2 className="h-6 w-6 text-emerald-400" />
        </div>

        <p
          className={`mt-3 text-xs font-bold uppercase tracking-wider ${tierMeta.accentTextClass}`}
        >
          Practice · {tierMeta.label} Complete
        </p>

        <div className="mt-1 flex items-baseline justify-center gap-1">
          <span className="text-4xl font-black tracking-tight text-slate-50">{score}</span>
          <span className="text-xl font-bold text-slate-500">/{total}</span>
        </div>

        <div
          className="mt-3 flex items-center justify-center gap-1.5 text-2xl"
          aria-label={`${tierMeta.label} score: ${score} out of ${total}`}
        >
          {results.map((ok, idx) => (
            <span key={positions[idx]?.id ?? idx} aria-hidden="true">
              {ok ? '🟩' : '🟥'}
            </span>
          ))}
        </div>

        <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950/80 px-3.5 py-2 ring-1 ring-slate-800/80">
          <Clock className="h-3.5 w-3.5 text-sky-400" />
          <span className="text-xs font-medium text-slate-400">Resets at midnight:</span>
          <span className="font-mono text-xs font-bold text-slate-100">{countdown}</span>
        </div>

        {otherAvailableTiers.length > 0 ? (
          <div className="mt-5 flex flex-col gap-2">
            {otherAvailableTiers.map((otherTier) => (
              <button
                key={otherTier}
                type="button"
                onClick={() => onSelectTier(otherTier)}
                className="inline-flex h-11 w-full items-center justify-between rounded-xl bg-sky-500/15 px-4 text-sm font-bold text-sky-200 ring-1 ring-sky-400/40 transition hover:bg-sky-500/25 active:scale-[0.98]"
              >
                <span>
                  Try {TIER_CONFIG[otherTier].label} ({remainingByTier[otherTier]} left)
                </span>
                <ArrowRight className="h-4 w-4 text-sky-300" />
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <p className="text-xs leading-relaxed text-slate-400">
              You&apos;ve completed all Practice difficulties for today! Fresh positions
              unlock at midnight.
            </p>
            <button
              type="button"
              onClick={onGoToDaily}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-slate-950 shadow-md shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-[0.98]"
            >
              <Sparkles className="h-4 w-4" />
              View Daily 5
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
