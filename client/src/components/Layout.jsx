import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Gauge, GitBranch, Code2, Boxes, ShieldAlert, Map, Wand2, Bot, FlaskConical, GitPullRequest, ScrollText,
  Network, Workflow, Scale, HeartHandshake, Settings, Rocket, Menu, X, Home, UserCircle2, ChevronDown, Radio, Atom,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ROLE_LABEL } from '../lib/format';
import { Button, cx } from './ui';

export const NAV = [
  { group: 'Overview', items: [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/workspace', label: 'My Workspace', icon: UserCircle2 },
    { to: '/dashboard', label: 'Executive Dashboard', icon: LayoutDashboard },
    { to: '/demo', label: 'Run Complete Demo', icon: Rocket },
  ] },
  { group: 'Discover', items: [
    { to: '/discovery', label: 'Repository Discovery', icon: GitBranch },
    { to: '/ast-scanner', label: 'AST Scanner', icon: Code2 },
    { to: '/cbom', label: 'CBOM Explorer', icon: Boxes },
  ] },
  { group: 'Assess & Plan', items: [
    { to: '/risk', label: 'Risk Assessment', icon: ShieldAlert },
    { to: '/planner', label: 'Migration Planner', icon: Map },
  ] },
  { group: 'Remediate', items: [
    { to: '/code-mode', label: 'AI Remediation · Code Mode', icon: Wand2 },
    { to: '/agents', label: 'Agent Orchestration', icon: Bot },
    { to: '/testing', label: 'Testing & Interop', icon: FlaskConical },
    { to: '/pull-requests', label: 'PR Review & Approval', icon: GitPullRequest },
  ] },
  { group: 'Govern', items: [
    { to: '/audit', label: 'BobShell Audit Logs', icon: ScrollText },
  ] },
  { group: 'Platform', items: [
    { to: '/architecture', label: 'System Architecture', icon: Network },
    { to: '/workflow', label: 'Implementation Workflow', icon: Workflow },
    { to: '/feasibility', label: 'Feasibility & Viability', icon: Scale },
    { to: '/impact', label: 'Impact & Benefits', icon: HeartHandshake },
    { to: '/settings', label: 'Settings & System Health', icon: Settings },
  ] },
];

const ALL = NAV.flatMap((g) => g.items);

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 px-2">
      <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 shadow-lg shadow-violet-900/40">
        <Atom size={19} className="text-white" />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-extrabold tracking-[0.12em] text-white">QUANTUMSHIFT</span>
        <span className="block text-[10px] font-medium text-slate-400">Agentic PQC Migration · IBM Bob</span>
      </span>
    </NavLink>
  );
}

function Sidebar({ open, onClose }) {
  const { agents } = useApp();
  const running = Object.values(agents).filter((a) => a.status === 'running').length;
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={onClose} />}
      <aside className={cx('fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-white/5 bg-ink-950/95 backdrop-blur-xl transition-transform lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-16 items-center justify-between px-3">
          <Brand />
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 lg:hidden" onClick={onClose} aria-label="Close menu"><X size={18} /></button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group} className="mt-4">
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{g.group}</div>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} onClick={onClose}
                  className={({ isActive }) => cx('group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition', isActive ? 'bg-gradient-to-r from-sky-500/20 to-violet-500/10 text-white ring-1 ring-sky-400/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100')}>
                  <it.icon size={16} className="shrink-0" />
                  <span className="truncate">{it.label}</span>
                  {it.to === '/agents' && running > 0 && <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-bold text-white">{running}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/5 p-3 text-[10px] leading-relaxed text-slate-500">
          IBM Bob-inspired local orchestration. IBM, Bob and Granite are trademarks of IBM; this demo is not an IBM product.
        </div>
      </aside>
    </>
  );
}

function RoleSwitcher() {
  const { user, users, login, toast, notifyError } = useApp();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  if (!user) return null;
  const pick = async (u) => {
    setOpen(false);
    if (u.username === user.username) return;
    try {
      const nu = await login(u.username);
      toast({ type: 'success', title: `Signed in as ${nu.name}`, message: `${ROLE_LABEL[nu.role]} view (demo SSO)` });
      nav('/workspace');
    } catch (e) { notifyError(e, 'Could not switch role'); }
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl bg-white/5 py-1.5 pl-1.5 pr-2.5 ring-1 ring-white/10 hover:bg-white/10" aria-haspopup="menu" aria-expanded={open}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-violet-500 text-[11px] font-bold text-white">{user.name.split(' ').map((p) => p[0]).join('')}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-xs font-semibold text-white">{user.name}</span>
          <span className="block text-[10px] text-slate-400">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDown size={14} className="text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass absolute right-0 z-50 mt-2 w-72 rounded-xl p-1.5 shadow-2xl" role="menu">
            <div className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Switch demo role</div>
            {users.map((u) => (
              <button key={u.username} role="menuitem" onClick={() => pick(u)} className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-white/5', u.username === user.username && 'bg-sky-500/10')}>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-[11px] font-bold">{u.name.split(' ').map((p) => p[0]).join('')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-slate-100">{u.name}</span>
                  <span className="block truncate text-[11px] text-slate-400">{u.title}</span>
                </span>
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">{ROLE_LABEL[u.role]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ModeToggle() {
  const { settings, setMode, can, notifyError } = useApp();
  const [busy, setBusy] = useState(false);
  const mode = settings.mode;
  const change = async (m) => {
    if (m === mode) return;
    if (!can('settings:write')) return notifyError(new Error('Only the CTO or CISO can switch integration mode.'), 'Permission required');
    setBusy(true);
    try { await setMode(m); } catch (e) { notifyError(e); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center rounded-xl bg-white/5 p-1 text-[11px] font-semibold ring-1 ring-white/10" role="radiogroup" aria-label="Integration mode">
      {[['real', 'REAL INTEGRATION'], ['demo', 'DEMO MODE']].map(([m, label]) => (
        <button key={m} role="radio" aria-checked={mode === m} disabled={busy} onClick={() => change(m)}
          className={cx('rounded-lg px-2.5 py-1.5 tracking-wide transition', mode === m ? (m === 'demo' ? 'bg-violet-500/80 text-white' : 'bg-emerald-600/80 text-white') : 'text-slate-400 hover:text-white')}>
          <span className="hidden sm:inline">{label}</span><span className="sm:hidden">{m === 'demo' ? 'DEMO' : 'REAL'}</span>
        </button>
      ))}
    </div>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const { connected, agents, settings } = useApp();
  const current = ALL.find((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to) && i.to !== '/')) || (loc.pathname.startsWith('/repositories') ? { label: 'Repository drill-down' } : { label: 'QuantumShift' });
  const running = Object.values(agents).filter((a) => a.status === 'running');
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  return (
    <div className="min-h-full lg:pl-[264px]">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/75 backdrop-blur-xl">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button className="rounded-lg p-2 text-slate-300 hover:bg-white/5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{current.label}</div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className={cx('inline-flex items-center gap-1', connected ? 'text-emerald-400' : 'text-amber-400')}>
                <Radio size={11} className={connected ? 'animate-pulse-soft' : ''} />{connected ? 'Live' : 'Reconnecting'}
              </span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden truncate sm:inline">{running.length ? `${running.map((a) => a.name).join(', ')} working…` : 'Agents idle'}</span>
              {settings.mode === 'demo' && <span className="hidden whitespace-nowrap rounded bg-violet-500/15 px-1.5 text-violet-300 2xl:inline">Demo / Simulation Mode</span>}
            </div>
          </div>
          <ModeToggle />
          <Button variant="primary" size="sm" icon={Rocket} className="hidden xl:inline-flex" onClick={() => nav('/demo?autorun=1')}>Run Complete Demo</Button>
          <RoleSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
