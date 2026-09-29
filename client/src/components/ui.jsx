import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, ShieldAlert, ShieldCheck, X, FlaskConical, Info } from 'lucide-react';
import { RISK_COLORS } from '../lib/format';

export const cx = (...c) => c.filter(Boolean).join(' ');

export function Card({ className, children, hover, ...p }) {
  return <div className={cx('glass rounded-2xl', hover && 'glass-hover', className)} {...p}>{children}</div>;
}

export function CardHeader({ title, subtitle, icon: Icon, actions, className }) {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-3 border-b border-white/5 px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/20 to-violet-500/20 text-sky-300 ring-1 ring-white/10"><Icon size={16} /></span>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const BTN = {
  primary: 'bg-gradient-to-r from-sky-500 to-violet-500 text-white shadow-lg shadow-sky-900/30 hover:brightness-110',
  secondary: 'bg-white/5 text-slate-100 ring-1 ring-white/10 hover:bg-white/10',
  ghost: 'text-slate-300 hover:bg-white/5 hover:text-white',
  danger: 'bg-rose-600/90 text-white hover:bg-rose-500',
  success: 'bg-emerald-600/90 text-white hover:bg-emerald-500',
  warning: 'bg-amber-600/90 text-white hover:bg-amber-500',
};

export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, ...p }) {
  const sz = size === 'sm' ? 'h-8 px-3 text-xs gap-1.5' : size === 'lg' ? 'h-11 px-5 text-sm gap-2' : 'h-9 px-3.5 text-sm gap-2';
  return (
    <button
      className={cx('inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50', BTN[variant], sz, className)}
      disabled={disabled || loading}
      {...p}
    >
      {loading ? <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

const BADGE = {
  slate: 'bg-slate-500/15 text-slate-300 ring-slate-400/20',
  blue: 'bg-sky-500/15 text-sky-300 ring-sky-400/25',
  violet: 'bg-violet-500/15 text-violet-300 ring-violet-400/25',
  green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/25',
  yellow: 'bg-amber-500/15 text-amber-300 ring-amber-400/25',
  red: 'bg-rose-500/15 text-rose-300 ring-rose-400/25',
  cyan: 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/25',
};
export function Badge({ tone = 'slate', className, children, ...p }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', BADGE[tone], className)} {...p}>{children}</span>;
}

/** Risk level badge — color is always paired with an icon and the level name. */
export function RiskBadge({ level, score, className }) {
  if (!level) return <Badge>—</Badge>;
  const Icon = level === 'RED' ? ShieldAlert : level === 'YELLOW' ? AlertTriangle : ShieldCheck;
  const tone = level === 'RED' ? 'red' : level === 'YELLOW' ? 'yellow' : 'green';
  return (
    <Badge tone={tone} className={className}>
      <Icon size={11} />
      {level}
      {score !== undefined && score !== null && <span className="opacity-70">· {score}</span>}
    </Badge>
  );
}

export const riskDot = (level) => <span className="inline-block h-2 w-2 rounded-full" style={{ background: RISK_COLORS[level] || '#64748b' }} />;

const STATUS_TONE = {
  open: 'red', patch_generated: 'blue', in_review: 'violet', remediated: 'green', pending_review: 'yellow', approved: 'green', rejected: 'red', changes_requested: 'yellow',
  generated: 'blue', tested: 'cyan', merged: 'green', discarded: 'slate', passed: 'green', failed: 'red', warning: 'yellow', success: 'green', failure: 'red', pending: 'yellow', info: 'blue',
  ONLINE: 'green', WARNING: 'yellow', OFFLINE: 'red', running: 'blue', completed: 'green', idle: 'slate', waiting: 'yellow', error: 'red',
};
export function StatusBadge({ status, label }) {
  return <Badge tone={STATUS_TONE[status] || 'slate'}>{label || String(status).replace(/_/g, ' ')}</Badge>;
}

export function ExecBadge({ execution }) {
  return execution === 'real'
    ? <Badge tone="cyan" title="Actually executed on this server"><FlaskConical size={11} />real</Badge>
    : <Badge tone="slate" title="Simulated — no CI/integration connected in demo mode">simulated</Badge>;
}

export function DemoBadge({ children = 'Demo / Simulation Mode', className }) {
  return <Badge tone="violet" className={cx('uppercase tracking-wide', className)}><CircleDashed size={11} />{children}</Badge>;
}

/** Counts up to `value` when it changes (dashboard counters). */
export function AnimatedNumber({ value, duration = 700, suffix = '', decimals = 0 }) {
  const [display, setDisplay] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  useEffect(() => {
    if (value === null || value === undefined) return undefined;
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - k) ** 3;
      setDisplay(a + (value - a) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{Number(display).toFixed(decimals)}{suffix}</>;
}

export function StatCard({ label, value, suffix, icon: Icon, tone = 'blue', hint, onClick, loading }) {
  const ring = { blue: 'from-sky-500/25 to-sky-500/5 text-sky-300', violet: 'from-violet-500/25 to-violet-500/5 text-violet-300', red: 'from-rose-500/25 to-rose-500/5 text-rose-300', yellow: 'from-amber-500/25 to-amber-500/5 text-amber-300', green: 'from-emerald-500/25 to-emerald-500/5 text-emerald-300', cyan: 'from-cyan-500/25 to-cyan-500/5 text-cyan-300' }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Card hover={!!onClick} className="text-left">
      <Tag onClick={onClick} className="block w-full p-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-slate-50 tabular-nums">
              {loading ? <span className="inline-block h-7 w-14 animate-pulse rounded bg-white/10" /> : <AnimatedNumber value={Number(value) || 0} suffix={suffix} />}
            </div>
          </div>
          {Icon && <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-white/10', ring)}><Icon size={17} /></span>}
        </div>
        {hint && <div className="mt-2 truncate text-xs text-slate-400">{hint}</div>}
      </Tag>
    </Card>
  );
}

export function ProgressBar({ value, tone = 'blue', className, animated }) {
  const bg = { blue: 'from-sky-500 to-violet-500', green: 'from-emerald-500 to-teal-400', red: 'bg-rose-500 from-rose-500 to-rose-400', yellow: 'from-amber-500 to-amber-400' }[tone];
  return (
    <div className={cx('relative h-2 overflow-hidden rounded-full bg-white/5', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full bg-gradient-to-r transition-all duration-500', bg)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      {animated && <div className="scanbar absolute inset-0" />}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions, badges }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400/90">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">{title}</h1>
        {description && <p className="mt-2 text-sm leading-relaxed text-slate-400">{description}</p>}
        {badges && <div className="mt-3 flex flex-wrap gap-2">{badges}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-slate-400 ring-1 ring-white/10"><Icon size={22} /></span>
      <div className="mt-3 text-sm font-semibold text-slate-200">{title}</div>
      {message && <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-400">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…', className }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-10 text-sm text-slate-400', className)}>
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="m-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
      <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> Could not load data</div>
      <div className="mt-1 text-xs text-rose-200/80">{error?.message || String(error)}</div>
      {onRetry && <Button size="sm" className="mt-3" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('inline-flex flex-wrap gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10', className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition', value === t.value ? 'bg-gradient-to-r from-sky-500/80 to-violet-500/80 text-white shadow' : 'text-slate-400 hover:text-white')}>
          {t.icon && <t.icon size={13} />}{t.label}{t.count !== undefined && <span className="rounded bg-black/20 px-1 text-[10px]">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('glass animate-rise flex max-h-[90vh] w-full flex-col rounded-2xl shadow-2xl', wide ? 'max-w-6xl' : 'max-w-lg')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/50 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="glass flex h-full w-full max-w-2xl animate-rise flex-col rounded-l-2xl shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 px-5 py-3">{footer}</div>}
      </aside>
    </div>
  );
}

export const inputCls = 'h-9 w-full rounded-lg bg-ink-900/80 px-3 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/60';

export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-300">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[11px] text-rose-300">{error}</span> : hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function Select({ value, onChange, options, className, ...p }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputCls, 'cursor-pointer pr-8', className)} {...p}>
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

export function StepIcon({ status, size = 16 }) {
  if (status === 'done' || status === 'completed' || status === 'passed') return <CheckCircle2 size={size} className="text-emerald-400" />;
  if (status === 'running') return <Loader2 size={size} className="animate-spin text-sky-400" />;
  if (status === 'error' || status === 'failed') return <AlertTriangle size={size} className="text-rose-400" />;
  if (status === 'waiting' || status === 'warning') return <AlertTriangle size={size} className="text-amber-400" />;
  return <CircleDashed size={size} className="text-slate-500" />;
}

export function Th({ children, className, onClick, sorted }) {
  return (
    <th onClick={onClick} className={cx('whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400', onClick && 'cursor-pointer select-none hover:text-slate-200', className)}>
      {children}{sorted && <span className="ml-1 text-sky-400">{sorted === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}
export const Td = ({ children, className, ...p }) => <td className={cx('px-3 py-2.5 align-top text-sm text-slate-200', className)} {...p}>{children}</td>;

/** Sorting helper for tables. */
export function useSort(rows, initialKey, initialDir = 'desc') {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir });
  const sorted = [...(rows || [])].sort((a, b) => {
    const va = a[sort.key];
    const vb = b[sort.key];
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return sort.dir === 'asc' ? r : -r;
  });
  const toggle = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  return { sorted, sort, toggle, sortedFor: (k) => (sort.key === k ? sort.dir : null) };
}
