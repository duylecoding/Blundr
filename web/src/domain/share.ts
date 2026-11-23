/**
 * Formats Wordle-style Daily 5 share cards and copies text with a DOM fallback.
 */
import { APP_NAME } from '../config/constants';

export function buildShareText(
  puzzleNumber: number,
  results: readonly boolean[],
  streak: number
): string {
  const score = results.filter(Boolean).length;
  const total = results.length;
  const squares = results.map((ok) => (ok ? '🟩' : '🟥')).join('');
  const streakSuffix = streak > 0 ? ` 🔥${streak}` : '';
  return `${APP_NAME} #${puzzleNumber} — ${score}/${total}${streakSuffix}\n${squares}`;
}

function fallbackCopyText(text: string): boolean {
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    return Boolean(document.execCommand('copy'));
  } catch {
    return false;
  } finally {
    if (textarea && textarea.parentNode === document.body) {
      document.body.removeChild(textarea);
    }
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopyText(text);
    }
  }
  return fallbackCopyText(text);
}
