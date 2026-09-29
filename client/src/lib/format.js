export const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
export const fmtDate = (t) => (t ? new Date(t).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (t) => (t ? `${fmtDate(t)} ${fmtTime(t)}` : '—');

export function timeAgo(t) {
  if (!t) return 'never';
  const s = Math.round((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Validated dark-surface palettes (see dataviz validator run in README). */
export const RISK_COLORS = { RED: '#e5484d', YELLOW: '#c98500', GREEN: '#199e70' };
export const RISK_TEXT = { RED: 'text-rose-300', YELLOW: 'text-amber-300', GREEN: 'text-emerald-300' };
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export const ROLE_LABEL = { CTO: 'CTO', CISO: 'CISO / Security', DEVELOPER: 'Developer', AUDITOR: 'Auditor' };

export const STATUS_LABEL = {
  open: 'Open',
  patch_generated: 'Patch generated',
  in_review: 'In review',
  remediated: 'Remediated',
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  generated: 'Generated',
  tested: 'Tested',
  merged: 'Merged (simulated)',
  discarded: 'Discarded',
};

export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
