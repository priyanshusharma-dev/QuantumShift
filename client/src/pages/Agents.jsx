import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radar, Code2, ShieldAlert, Compass, Wand2, FlaskConical, UserCheck, ScrollText, Scale, Rocket, Activity, Timer, ArrowDown } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { fmtTime, timeAgo } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, Badge, StatusBadge, ProgressBar, DemoBadge, cx } from '../components/ui';

const ICON = { discovery: Radar, ast: Code2, risk: ShieldAlert, architect: Compass, refactor: Wand2, test: FlaskConical, compliance: Scale, audit: ScrollText };
const CHAIN = ['discovery', 'ast', 'risk', 'architect', 'refactor', 'test', 'human', 'audit'];

function AgentNode({ a, human, pending }) {
  if (human) {
    return (
      <div className={cx('glass rounded-2xl p-4 ring-1 transition', pending ? 'ring-amber-400/50' : 'ring-transparent')}>
        <div className="flex items-center gap-3">
          <span className={cx('flex h-10 w-10 items-center justify-center rounded-xl', pending ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-slate-300')}><UserCheck size={18} /></span>
          <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white">Human Approval</div><div className="text-[11px] text-slate-400">Mandatory checkpoint — Bob never self-approves</div></div>
          <StatusBadge status={pending ? 'waiting' : 'idle'} label={pending ? `${pending} pending` : 'idle'} />
        </div>
      </div>
    );
  }
  const Icon = ICON[a.key];
  const running = a.status === 'running';
  return (
    <div className={cx('glass relative overflow-hidden rounded-2xl p-4 ring-1 transition duration-500', running ? 'ring-sky-400/60 shadow-[0_0_40px_-12px_rgba(56,189,248,.6)]' : a.status === 'error' ? 'ring-rose-500/40' : 'ring-transparent')}>
      {running && <div className="scanbar pointer-events-none absolute inset-0" />}
      <div className="relative flex items-start gap-3">
        <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition', running ? 'bg-gradient-to-br from-sky-500 to-violet-500 text-white' : a.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-slate-300')}><Icon size={18} className={running ? 'animate-pulse-soft' : ''} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-white">{a.name}</span><Badge tone="violet">{a.mode} mode</Badge></div>
          <div className="mt-0.5 text-[11px] text-slate-400">{a.role}</div>
        </div>
        <StatusBadge status={a.status} />
      </div>
      <div className="relative mt-3 space-y-1.5 text-[11px]">
        <div className="flex justify-between gap-2"><span className="text-slate-500">Current task</span><span className="truncate text-right text-slate-200">{a.currentTask || '—'}</span></div>
        <ProgressBar value={a.status === 'completed' ? 100 : a.progress} animated={running} tone={a.status === 'completed' ? 'green' : 'blue'} className="h-1.5" />
        <div className="flex justify-between gap-2"><span className="text-slate-500">Last action</span><span className="truncate text-right text-slate-200" title={a.lastAction}>{a.lastAction || '—'}</span></div>
        <div className="flex justify-between gap-2 text-slate-500"><span className="inline-flex items-center gap-1"><Timer size={11} />{a.executionMs !== null && a.executionMs !== undefined ? `${a.executionMs} ms` : '—'}</span><span>{a.runs} run(s) · {timeAgo(a.lastActionAt)}</span></div>
      </div>
    </div>
  );
}

export default function Agents() {
  const nav = useNavigate();
  const { agents, setAgents, liveAudit, can, notifyError, toast, settings } = useApp();
  const { data: initial } = useApi('/agents', []);
  const { data: prs } = useApi('/pull-requests', ['prs']);
  const { data: recent } = useApi('/audit-logs?limit=25', []);
  useEffect(() => {
    if (initial) setAgents((cur) => ({ ...Object.fromEntries(initial.map((a) => [a.key, a])), ...cur }));
  }, [initial, setAgents]);
  const list = initial ? initial.map((a) => agents[a.key] || a) : [];
  const byKey = Object.fromEntries(list.map((a) => [a.key, a]));
  const pending = (prs || []).filter((p) => p.status === 'pending_review').length;
  const feed = [...liveAudit, ...(recent || [])].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i).slice(0, 25);

  const interop = async () => {
    try { await api('/tests/run', { method: 'POST', body: { suite: 'interoperability' } }); toast({ type: 'success', title: 'Test Agent started', message: 'Real ML-KEM / ML-DSA interoperability tests are running.' }); } catch (e) { notifyError(e); }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="IBM Bob-inspired multi-agent system" title="Agent Orchestration"
        description="Eight specialised agents coordinate through a local orchestrator (Ask / Architect / Code modes) and report every action to the BobShell audit trail. Watch them light up during scans, tests or the complete demo."
        badges={settings.mode === 'demo' && <DemoBadge>Local orchestration — not the IBM Bob product</DemoBadge>}
        actions={<>
          <Button icon={FlaskConical} disabled={!can('tests:run')} onClick={interop}>Run interoperability tests</Button>
          <Button variant="primary" icon={Rocket} onClick={() => nav('/demo?autorun=1')}>Run complete demo</Button>
        </>} />
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div>
          {!list.length ? null : CHAIN.map((k, i) => (
            <div key={k}>
              <AgentNode a={byKey[k]} human={k === 'human'} pending={pending} />
              {i < CHAIN.length - 1 && (
                <div className="flex items-center justify-center py-1.5">
                  <div className={cx('h-6 w-[2px]', byKey[CHAIN[i + 1]]?.status === 'running' || byKey[k]?.status === 'running' ? 'flow-line' : 'bg-white/10')} />
                  {k === 'refactor' && byKey.compliance && <span className="ml-3 text-[10px] text-slate-500">↳ Compliance Agent reviews each PR</span>}
                </div>
              )}
            </div>
          ))}
          {byKey.compliance && <div className="mt-4"><div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500"><ArrowDown size={12} /> Parallel reviewer</div><AgentNode a={byKey.compliance} /></div>}
        </div>
        <Card className="h-fit xl:sticky xl:top-24">
          <CardHeader title="Agent communication feed" subtitle="Live from BobShell (Server-Sent Events)" icon={Activity} actions={<Button size="sm" onClick={() => nav('/audit')}>Open BobShell</Button>} />
          <div className="max-h-[760px] divide-y divide-white/5 overflow-auto">
            {feed.map((e) => (
              <div key={e.id} className="animate-rise px-4 py-2.5">
                <div className="flex items-center gap-2 text-[11px]"><span className="code-font text-slate-500">{fmtTime(e.ts)}</span><span className="font-semibold text-sky-300">{e.agent}</span><StatusBadge status={e.status} /></div>
                <div className="mt-0.5 text-xs text-slate-100">{e.action}{e.resource ? <span className="text-slate-400"> · {e.resource}</span> : ''}</div>
                {e.result && <div className="mt-0.5 truncate text-[11px] text-slate-400" title={e.result}>{e.result}</div>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
