import { useEffect } from 'react';
import { useI18n } from './i18n';

export function useDocumentTitle(title: string) {
  const { t } = useI18n();
  useEffect(() => {
    document.title = `${title} — ${t('app_name')}`;
  }, [title, t]);
}

export function formatDate(iso: string, lang: 'ar' | 'en'): string {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === 'ar' ? 'ar-DZ' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function monthLabel(year: number, month: number, lang: 'ar' | 'en'): string {
  const d = new Date(year, month, 1);
  return d.toLocaleDateString(lang === 'ar' ? 'ar-DZ' : 'en-US', { year: 'numeric', month: 'long' });
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function weekDayOf(d: Date): string {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][d.getDay()];
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Triggers a file download from a Blob. Returns true if the download was
 * initiated successfully, false otherwise. The caller is responsible for
 * showing appropriate success/error messaging based on the return value.
 *
 * Validates the blob is non-empty before attempting. Uses navigator.msSaveBlob
 * for IE/legacy WebView, falls back to anchor-click with body append.
 */
export function downloadBlob(blob: Blob, filename: string): boolean {
  if (!blob || blob.size === 0) return false;

  // Legacy IE / some WebView environments support msSaveBlob
  const nav = navigator as Navigator & { msSaveBlob?: (b: Blob, f: string) => boolean };
  if (typeof nav.msSaveBlob === 'function') {
    try {
      return nav.msSaveBlob(blob, filename);
    } catch {
      return false;
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
    return true;
  } catch {
    return false;
  }
}
