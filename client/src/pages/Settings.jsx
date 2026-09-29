import { useState } from 'react';
import { Activity, Stethoscope, ToggleLeft, Plug, RotateCcw, ShieldCheck, UserCircle2, Database } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { fmtDateTime, ROLE_LABEL } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, Badge, StatusBadge, Loading, cx } from '../components/ui';

const DOT = { ONLINE: 'bg-emerald-400', WARNING: 'bg-amber-400', OFFLINE: 'bg-rose-500' };

export default function Settings() {
  const { settings, setMode, can, notifyError, toast, user, permissions, loadSettings } = useApp();
  const { data: health, reload } = useApi('/system/health', []);
  const [diag, setDiag] = useState(null);
  const [busy, setBusy] = useState('');
  const services = diag?.services || health?.services || [];

  const run = async () => {
    setBusy('diag');
    try {
      const r = await api('/system/diagnostics', { method: 'POST' });
      setDiag(r);
      reload();
      toast({ type: r.overall === 'ONLINE' ? 'success' : 'warning', title: `Diagnostics: ${r.overall}`, message: `${r.services.filter((s) => s.status === 'ONLINE').length}/${r.services.length} services online` });
    } catch (e) { notifyError(e, 'Diagnostics failed'); } finally { setBusy(''); }
  };
  const reset = async () => {
    if (!window.confirm('Reset all demo data? Repositories are re-scanned and history is re-seeded (≈20 s).')) return;
    setBusy('reset');
    try { await api('/system/reset', { method: 'POST' }); await loadSettings(); toast({ type: 'success', title: 'Demo data reset', message: 'Fresh seed data loaded.' }); setTimeout(() => window.location.assign('/dashboard'), 600); } catch (e) { notifyError(e, 'Reset failed'); } finally { setBusy(''); }
  };
  const toggle = async (m) => {
    if (!can('settings:write')) return notifyError(new Error('Only the CTO or CISO can change the integration mode.'), 'Permission required');
    try { await setMode(m); } catch (e) { notifyError(e); }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title="Settings & System Health" description="Verify every local/demo service with real self-tests, switch between Demo / Simulation and Real Integration, and review integration status." />
      <Card>
        <CardHeader title="System health" subtitle={diag ? `Diagnostics ran ${fmtDateTime(diag.checkedAt)} · overall ${diag.overall}` : `API ${health?.api || '…'} · database ${health?.database || '…'} · uptime ${health?.uptimeSec ?? '…'} s`} icon={Activity}
          actions={<Button variant="primary" icon={Stethoscope} loading={busy === 'diag'} onClick={run}>Run System Diagnostics</Button>} />
        {!health && !diag ? <Loading /> : (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map((s) => (
              <div key={s.key} className={cx('rounded-xl p-4 ring-1', s.status === 'ONLINE' ? 'bg-emerald-500/5 ring-emerald-500/20' : s.status === 'WARNING' ? 'bg-amber-500/5 ring-amber-500/25' : 'bg-rose-500/5 ring-rose-500/30')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-white"><span className={cx('h-2.5 w-2.5 rounded-full', DOT[s.status], s.status === 'ONLINE' && 'animate-pulse-soft')} />{s.name}</span>
                  <StatusBadge status={s.status} />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">{s.message}</p>
                <div className="mt-2 text-[10px] text-slate-500">{s.latency_ms ?? 0} ms · checked {fmtDateTime(s.last_check)}</div>
              </div>
            ))}
            {!services.length && <div className="p-4 text-sm text-slate-400">No diagnostics recorded yet — run them now.</div>}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Integration mode" subtitle="Changes are recorded in BobShell" icon={ToggleLeft} />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {[['demo', 'DEMO MODE', 'Everything external is simulated and labelled: repository ingestion from URLs, Docker/AWS sources, IBM Granite explanations, CI regression suites and PR pushes. Crypto tests still run for real.'], ['real', 'REAL INTEGRATION', 'Public GitHub/GitLab repositories are downloaded and scanned; IBM Granite on watsonx.ai is called if credentials are configured. Unconfigured integrations fail clearly — nothing is faked.']].map(([m, t, d]) => (
              <button key={m} onClick={() => toggle(m)} className={cx('rounded-xl p-4 text-left ring-1 transition', settings.mode === m ? 'bg-sky-500/15 ring-sky-400/50' : 'bg-white/[0.03] ring-white/10 hover:bg-white/[0.06]')}>
                <div className="flex items-center justify-between"><span className="text-sm font-bold tracking-wide text-white">{t}</span>{settings.mode === m && <Badge tone="green">active</Badge>}</div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{d}</p>
              </button>
            ))}
          </div>
          <div className="px-4 pb-4 text-[11px] text-slate-500"><Database size={12} className="mr-1 inline" />Database engine: {settings.dbEngine} · Mosca Z = {settings.moscaZ} years · visual pacing {settings.pacingMs} ms</div>
        </Card>
        <Card>
          <CardHeader title="Integrations" icon={Plug} />
          <div className="divide-y divide-white/5">
            {(settings.integrations || []).map((i) => (
              <div key={i.key} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-100">{i.name}</span><Badge tone={/connected|available/.test(i.status) ? 'green' : /simulated/.test(i.status) ? 'violet' : 'yellow'}>{i.status}</Badge></div>
                <p className="mt-1 text-xs text-slate-400">{i.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Session & permissions" icon={UserCircle2} />
          <div className="p-4 text-sm">
            <div className="text-white">{user.name} · <span className="text-slate-400">{user.title}</span></div>
            <div className="mt-1 text-xs text-slate-400">Role: {ROLE_LABEL[user.role]} (demo SSO, signed JWT)</div>
            <div className="mt-3 flex flex-wrap gap-1.5">{permissions.map((p) => <Badge key={p} tone="blue">{p}</Badge>)}{!permissions.length && <Badge>read-only</Badge>}</div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Security controls" icon={ShieldCheck} actions={<Button variant="danger" icon={RotateCcw} loading={busy === 'reset'} disabled={!can('settings:write')} title={can('settings:write') ? '' : 'CTO / CISO only'} onClick={reset}>Reset demo data</Button>} />
          <ul className="grid gap-1.5 p-4 text-xs text-slate-300 sm:grid-cols-2">
            {['Secrets only in server environment variables', 'Helmet secure headers + CSP', 'CORS allow-list', 'Rate limiting (global + heavy endpoints)', 'zod input validation on every write', 'JWT authentication + role-based authorization', 'Zip-slip & path-traversal protection', 'Hash-chained audit logging', 'CSV formula-injection neutralisation', 'No stack traces returned to clients'].map((x) => <li key={x} className="flex gap-2"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald-400" />{x}</li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}
