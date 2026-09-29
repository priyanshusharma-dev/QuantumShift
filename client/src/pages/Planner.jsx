import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Map, Sparkles, FileDown, Wand2, History, CalendarRange, ListChecks } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { api, download } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, Field, Select, inputCls, RiskBadge, Badge, StatusBadge, Loading, EmptyState, ProgressBar, Th, Td, useSort, Tabs, cx, DemoBadge } from '../components/ui';

const PHASE_TONE = { complete: 'green', in_progress: 'blue', pending: 'slate' };

function Generator({ onCreated }) {
  const { can, notifyError, toast, settings } = useApp();
  const { data: repos } = useApi('/repositories', ['repositories']);
  const [strategy, setStrategy] = useState('hybrid-first');
  const [scope, setScope] = useState([]);
  const [team, setTeam] = useState(4);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setScope((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const go = async () => {
    if (Number(team) < 1 || Number(team) > 50) return notifyError(new Error('Team size must be between 1 and 50'), 'Invalid input');
    setBusy(true);
    try {
      const p = await api('/migration/plan', { method: 'POST', body: { strategy, teamSize: Number(team), ...(scope.length ? { repositoryIds: scope } : {}), ...(name.trim() ? { name: name.trim() } : {}) } });
      toast({ type: 'success', title: 'Architect Agent generated a roadmap', message: `${p.summary.totalItems} items · ${p.summary.totalEffortDays} engineer-days · ${p.summary.estimatedWeeks} weeks` });
      onCreated(p.id);
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader title="IBM Bob · Architect Mode" subtitle="Generates a phased migration strategy from the current asset inventory and risk scores" icon={Sparkles} actions={settings.mode === 'demo' && <DemoBadge>Local Architect agent</DemoBadge>} />
      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Strategy"><Select value={strategy} onChange={setStrategy} options={[{ value: 'hybrid-first', label: 'Hybrid-first (recommended)' }, { value: 'direct-pqc', label: 'Direct PQC' }]} /></Field>
          <Field label="Engineering team size"><input type="number" min={1} max={50} className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} /></Field>
          <Field label="Plan name (optional)"><input className={inputCls} value={name} placeholder="FY27 PQC roadmap" onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-300">Scope <span className="text-slate-500">(none selected = whole portfolio)</span></div>
          <div className="flex flex-wrap gap-1.5">
            {(repos || []).map((r) => (
              <button key={r.id} onClick={() => toggle(r.id)} className={cx('rounded-lg px-2.5 py-1 text-xs ring-1 transition', scope.includes(r.id) ? 'bg-sky-500/20 text-sky-200 ring-sky-400/40' : 'bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10')}>{r.name}</button>
            ))}
          </div>
        </div>
        <div className="flex justify-end"><Button variant="primary" icon={Sparkles} loading={busy} disabled={!can('plan:generate')} title={can('plan:generate') ? '' : 'Auditors cannot generate plans'} onClick={go}>Generate migration plan</Button></div>
      </div>
    </Card>
  );
}

export default function Planner() {
  const nav = useNavigate();
  const { notifyError, toast } = useApp();
  const { data: plans, loading, reload } = useApi('/migration/plans', ['plans']);
  const [selId, setSelId] = useState(null);
  const planId = selId || plans?.find((p) => p.status === 'active')?.id || plans?.[0]?.id;
  const { data: plan } = useApi(planId ? `/migration/plans/${planId}` : null, ['plans']);
  const [prio, setPrio] = useState('ALL');
  const items = useMemo(() => (plan?.items || []).filter((i) => prio === 'ALL' || i.priority === prio), [plan, prio]);
  const { sorted, toggle, sortedFor } = useSort(items, 'riskScore');
  useEffect(() => { if (selId && plans && !plans.some((p) => p.id === selId)) setSelId(null); }, [plans, selId]);

  const exportMd = async () => {
    try { toast({ type: 'success', title: 'Migration report downloaded', message: await download(`/reports/migration?format=md&planId=${planId}`, 'migration.md') }); } catch (e) { notifyError(e, 'Export failed'); }
  };
  const totalWeeks = plan ? plan.phases.reduce((m, p) => Math.max(m, p.startWeek + p.durationWeeks - 1), 1) : 1;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Phase 3 · Plan" title="Migration Planner" description="Architect Mode turns the risk inventory into a seven-phase roadmap: Discovery → Risk Classification → Hybrid Cryptography → PQC Migration → Testing → Developer Approval → Production Deployment."
        actions={plan && <Button icon={FileDown} onClick={exportMd}>Migration report (Markdown)</Button>} />
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Generator onCreated={(id) => { setSelId(id); reload(); }} />
        <Card>
          <CardHeader title="Plan history" subtitle="Each generation is stored in PostgreSQL" icon={History} />
          <div className="max-h-[300px] divide-y divide-white/5 overflow-auto">
            {loading ? <Loading /> : !plans?.length ? <EmptyState title="No plans yet" message="Generate the first roadmap." /> : plans.map((p) => (
              <button key={p.id} onClick={() => setSelId(p.id)} className={cx('flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]', p.id === planId && 'bg-sky-500/10')}>
                <div className="min-w-0"><div className="truncate text-sm font-medium text-slate-100">{p.name}</div><div className="text-[11px] text-slate-500">{fmtDateTime(p.created_at)} · {p.strategy} · by {p.created_by}</div></div>
                <StatusBadge status={p.status === 'active' ? 'completed' : 'idle'} label={p.status} />
              </button>
            ))}
          </div>
        </Card>
      </div>

      {plan && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[['Work items', plan.summary.totalItems], ['P1 · critical', plan.summary.p1], ['P2 · high', plan.summary.p2], ['P3 · planned', plan.summary.p3], ['Engineer-days', plan.summary.totalEffortDays], ['Duration (weeks)', plan.summary.estimatedWeeks]].map(([l, v]) => (
              <Card key={l} className="p-4"><div className="text-[11px] uppercase tracking-wider text-slate-400">{l}</div><div className="mt-1 text-2xl font-bold text-white tabular-nums">{v}</div></Card>
            ))}
          </div>

          <Card>
            <CardHeader title={plan.name} subtitle={`Strategy: ${plan.strategy} · team of ${plan.summary.teamSize} · overall progress ${plan.summary.progressPct}%`} icon={CalendarRange} />
            <div className="overflow-x-auto p-5">
              <div className="min-w-[760px] space-y-2">
                <div className="grid grid-cols-[220px_1fr] text-[10px] uppercase tracking-wider text-slate-500">
                  <span>Phase</span>
                  <div className="flex">{Array.from({ length: totalWeeks }, (_, i) => <span key={i} className="flex-1 border-l border-white/5 pl-1">W{i + 1}</span>)}</div>
                </div>
                {plan.phases.map((p) => (
                  <div key={p.id} className="grid grid-cols-[220px_1fr] items-center gap-0">
                    <div className="pr-3">
                      <div className="text-sm font-semibold text-slate-100">PHASE {p.id} · {p.name}</div>
                      <div className="text-[11px] text-slate-500">{p.assetCount !== undefined ? `${p.assetCount} assets · ` : ''}{p.progress}%</div>
                    </div>
                    <div className="relative h-8 rounded-md bg-white/[0.02]">
                      <div className={cx('absolute top-1 flex h-6 items-center overflow-hidden rounded-md px-2 text-[10px] font-semibold text-white ring-1', p.status === 'complete' ? 'bg-emerald-600/60 ring-emerald-400/40' : p.status === 'in_progress' ? 'bg-sky-600/60 ring-sky-400/40' : 'bg-slate-600/40 ring-white/10')}
                        style={{ left: `${((p.startWeek - 1) / totalWeeks) * 100}%`, width: `${(p.durationWeeks / totalWeeks) * 100}%` }}>
                        <div className="absolute inset-y-0 left-0 bg-white/15" style={{ width: `${p.progress}%` }} />
                        <span className="relative truncate">{p.status.replace('_', ' ')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-3 border-t border-white/5 p-5 md:grid-cols-2 xl:grid-cols-4">
              {plan.phases.map((p) => (
                <div key={p.id} className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5">
                  <div className="flex items-center justify-between"><span className="text-[11px] font-semibold tracking-widest text-sky-300">PHASE {p.id}</span><Badge tone={PHASE_TONE[p.status]}>{p.status.replace('_', ' ')}</Badge></div>
                  <div className="mt-1 font-semibold text-white">{p.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{p.description}</p>
                  <ProgressBar value={p.progress} tone={p.status === 'complete' ? 'green' : 'blue'} className="mt-3" />
                  <ul className="mt-3 space-y-1 text-[11px] text-slate-300">{p.tasks.slice(0, 5).map((t) => <li key={t} className="truncate" title={t}>• {t}</li>)}{!p.tasks.length && <li className="text-slate-500">No items in this phase</li>}</ul>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Migration work items" subtitle="Priority · asset · current → target algorithm · dependencies · effort · status" icon={ListChecks}
              actions={<Tabs value={prio} onChange={setPrio} tabs={['ALL', 'P1', 'P2', 'P3'].map((x) => ({ value: x, label: x, count: x === 'ALL' ? plan.items.length : plan.items.filter((i) => i.priority === x).length }))} />} />
            {!sorted.length ? <EmptyState icon={Map} title="Nothing to migrate" message="All assets in scope are quantum-safe." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1150px]">
                  <thead><tr className="border-b border-white/5">
                    <Th onClick={() => toggle('priority')} sorted={sortedFor('priority')}>Priority</Th><Th>Asset</Th><Th onClick={() => toggle('currentAlgorithm')} sorted={sortedFor('currentAlgorithm')}>Current</Th><Th>Target</Th>
                    <Th>Dependencies</Th><Th onClick={() => toggle('effortDays')} sorted={sortedFor('effortDays')}>Effort</Th><Th onClick={() => toggle('phase')} sorted={sortedFor('phase')}>Phase</Th><Th onClick={() => toggle('status')} sorted={sortedFor('status')}>Status</Th><Th />
                  </tr></thead>
                  <tbody>
                    {sorted.map((i) => (
                      <tr key={i.assetId} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <Td><div className="flex items-center gap-2"><Badge tone={i.priority === 'P1' ? 'red' : i.priority === 'P2' ? 'yellow' : 'blue'}>{i.priority}</Badge><RiskBadge level={i.riskLevel} score={i.riskScore} /></div></Td>
                        <Td className="code-font text-xs"><div className="text-slate-100">{i.file}{i.line ? `:${i.line}` : ''}</div><div className="text-[10px] text-slate-500">{i.repository} · {i.functionName}</div></Td>
                        <Td className="text-xs font-semibold text-rose-200">{i.currentAlgorithm}</Td>
                        <Td className="text-xs font-semibold text-emerald-200">{i.targetAlgorithm}</Td>
                        <Td className="max-w-[240px] text-[11px] text-slate-400">{i.dependencies.slice(0, 3).join(' · ') || '—'}</Td>
                        <Td className="text-xs tabular-nums">{i.effortDays} d</Td>
                        <Td className="text-xs">{i.phase === 3 ? 'Hybrid' : 'PQC'}</Td>
                        <Td><StatusBadge status={i.statusKey} label={i.status} /></Td>
                        <Td>{!['remediated', 'in_review'].includes(i.statusKey) && !String(i.file).startsWith('aws://') && i.assetType !== 'library' && <Button size="sm" icon={Wand2} onClick={() => nav(`/code-mode?asset=${i.assetId}`)}>Remediate</Button>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
