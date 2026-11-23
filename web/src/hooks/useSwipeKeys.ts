/**
 * Global keyboard shortcuts for swiping (←/A, →/D) and advancing review (Enter/Space).
 */
import { useEffect } from 'react';

interface UseSwipeKeysOptions {
  enabled: boolean;
  isFeedbackOpen: boolean;
  onSwipe: (guessedAdvantage: boolean) => void;
  onNext: () => void;
}

export function useSwipeKeys({
  enabled,
  isFeedbackOpen,
  onSwipe,
  onNext,
}: UseSwipeKeysOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabled || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (
        target &&
        (target.closest('input, textarea, select') !== null ||
          (target instanceof HTMLElement && target.isContentEditable))
      ) {
        return;
      }

      const isOnTab = Boolean(target?.closest('[role="tab"]'));

      if (!isFeedbackOpen) {
        if ((!isOnTab && event.key === 'ArrowLeft') || event.key === 'a' || event.key === 'A') {
          event.preventDefault();
          onSwipe(false);
        } else if (
          (!isOnTab && event.key === 'ArrowRight') ||
          event.key === 'd' ||
          event.key === 'D'
        ) {
          event.preventDefault();
          onSwipe(true);
        }
      } else if (event.key === 'Enter' || event.key === ' ') {
        // Let focused buttons, links, and tabs handle their own Enter/Space activation.
        if (target?.closest('button, a, select, [role="tab"]')) {
          return;
        }
        event.preventDefault();
        onNext();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, isFeedbackOpen, onSwipe, onNext]);
}
