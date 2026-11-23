/**
 * Practice mode difficulty tabs (5/day per tier) and compact lifetime accuracy/error stats bar.
 */
import { Check } from 'lucide-react';
import { ALL_TIERS, TIER_CONFIG } from '../config/constants';
import type { DifficultyTier, PracticeStats, TierProgressSummary } from '../types';

interface PracticeTabsProps {
  tier: DifficultyTier;
  onTierChange: (tier: DifficultyTier) => void;
  progressByTier: Record<DifficultyTier, TierProgressSummary>;
  stats: PracticeStats;
}

export function PracticeTabs({
  tier,
  onTierChange,
  progressByTier,
  stats,
}: PracticeTabsProps) {
  const accuracy =
    stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : null;

  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-3 pb-1">
      <div
        role="tablist"
        aria-label="Practice difficulty"
        className="grid grid-cols-3 gap-1.5"
      >
        {ALL_TIERS.map((value) => {
          const meta = TIER_CONFIG[value];
          const active = tier === value;
          const summary = progressByTier[value];
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTierChange(value)}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-semibold transition ${
                active
                  ? meta.tabActiveClass
                  : 'bg-slate-900/90 text-slate-400 ring-1 ring-slate-800 hover:text-slate-200'
              }`}
            >
              <span>{meta.label}</span>
              {summary.completed ? (
                <span
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"
                  aria-label={`${meta.label} completed`}
                >
                  <Check className="h-3 w-3 stroke-[3]" />
                </span>
              ) : (
                <span className="font-mono text-[10px] opacity-80">
                  {summary.answered}/{summary.total}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/80 px-2.5 py-1.5 text-[11px] ring-1 ring-slate-800/90">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-slate-300">
            Acc:{' '}
            <strong className="text-slate-100">
              {accuracy !== null ? `${accuracy}%` : '—'}
            </strong>
          </span>
          <span className="text-slate-600">|</span>
          <span className="font-semibold text-slate-300">
            Best: <strong className="text-amber-300">{stats.bestStreak}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            title="False Positives (swiped Advantage on an Equal position)"
            className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-300 ring-1 ring-rose-500/20"
          >
            F+:{stats.falsePositives}
          </span>
          <span
            title="False Negatives (swiped Equal on an Advantage position)"
            className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/20"
          >
            F-:{stats.falseNegatives}
          </span>
        </div>
      </div>
    </div>
  );
}
