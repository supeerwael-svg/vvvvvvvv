import { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';
import { onSyncStatusChange, syncPending, pendingSyncCount } from '@/lib/sync';

export default function SyncIndicator() {
  const [status, setStatus] = useState<'idle' | 'syncing' | 'online' | 'offline' | 'error'>('online');
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const unsub = onSyncStatusChange((s, p) => {
      setStatus(s);
      setPending(p);
    });
    return unsub;
  }, []);

  const handleClick = () => {
    if (status === 'offline' || status === 'error' || pending > 0) {
      syncPending();
    }
  };

  const icon = () => {
    if (status === 'syncing') return <RefreshCw size={16} className="animate-spin" />;
    if (status === 'offline') return <CloudOff size={16} />;
    if (status === 'error') return <AlertCircle size={16} />;
    return <Cloud size={16} />;
  };

  const color = () => {
    if (status === 'offline') return 'var(--text-muted)';
    if (status === 'error') return 'var(--error)';
    if (status === 'syncing') return 'var(--warning)';
    if (pending > 0) return 'var(--warning)';
    return 'var(--success)';
  };

  return (
    <button
      onClick={handleClick}
      className="btn btn-ghost p-2 flex items-center gap-1.5 text-xs"
      title={pending > 0 ? `${pending} pending` : status}
      style={{ color: color() }}
    >
      {icon()}
      {pending > 0 && <span className="font-medium">{pending}</span>}
    </button>
  );
}
