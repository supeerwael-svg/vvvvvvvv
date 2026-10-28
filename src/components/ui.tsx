import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className={`surface rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] overflow-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-app">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost btn p-1.5"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted">
      {icon && <div className="mb-3 opacity-50">{icon}</div>}
      <p className="text-sm">{text}</p>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-muted">
      <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, danger }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: string; confirmLabel: string; danger?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn btn-ghost">{t('cancel')}</button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function StatCard({ label, value, icon, accent }: {
  label: string; value: ReactNode; icon?: ReactNode; accent?: string;
}) {
  return (
    <div className="card flex items-center gap-4">
      {icon && (
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: accent ? `color-mix(in srgb, ${accent} 14%, transparent)` : 'var(--surface-2)', color: accent ?? 'var(--primary-700)' }}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-tight">{value}</div>
        <div className="text-xs text-muted truncate">{label}</div>
      </div>
    </div>
  );
}

export function Badge({ children, color }: { children: ReactNode; color?: 'success' | 'warning' | 'error' | 'neutral' }) {
  const map: Record<string, React.CSSProperties> = {
    success: { background: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' },
    warning: { background: 'color-mix(in srgb, var(--warning) 14%, transparent)', color: 'var(--warning)' },
    error: { background: 'color-mix(in srgb, var(--error) 14%, transparent)', color: 'var(--error)' },
    neutral: { background: 'var(--surface-2)', color: 'var(--text-muted)' },
  };
  return <span className="chip" style={map[color ?? 'neutral']}>{children}</span>;
}
