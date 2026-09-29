import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calculator, ShieldAlert, SlidersHorizontal, Save, Brain, Eye, Info } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { RISK_COLORS } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, Tabs, Field, Select, inputCls, RiskBadge, Badge, Loading, ErrorState, EmptyState, Th, Td, useSort, cx } from '../components/ui';
import { ExplanationPanel, AssetDrawer } from '../components/AssetDrawer';

function Slider({ label, sub, value, onChange, max, color }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-semibold text-slate-100">{label}</label>
        <span className="text-lg font-bold tabular-nums" style={{ color }}>{value} <span className="text-xs text-slate-400">years</span></span>
      </div>
      <div className="text-[11px] text-slate-400">{sub}</div>
      <input type="range" min={0} max={max} step={0.5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-sky-500" aria-label={label} />
    </div>
  );
}

function MoscaCalculator({ z0 }) {
  const { can, notifyError, toast, loadSettings } = useApp();
  const [v, setV] = useState({ x: 10, y: 2, z: z0 ?? 8 });
  const [res, setRes] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (z0 !== undefined) setV((s) => ({ ...s, z: z0 })); }, [z0]);
  useEffect(() => {
    const t = setTimeout(() => {
      api('/risk/calculate', { method: 'POST', body: v }).then(setRes).catch((e) => notifyError(e, 'Calculation failed'));
    }, 180);
    return () => clearTimeout(t);
  }, [v, notifyError]);
  const scale = Math.max(v.x + v.y, v.z, 1) * 1.1;
  const apply = async () => {
    setSaving(true);
    try {
      const r = await api('/system/settings', { method: 'PUT', body: { moscaZ: v.z } });
      await loadSettings();
      toast({ type: 'success', title: `Portfolio re-assessed with Z = ${v.z}`, message: r.counts ? `RED ${r.counts.RED} · YELLOW ${r.counts.YELLOW} · GREEN ${r.counts.GREEN}` : 'Z unchanged' });
    } catch (e) { notifyError(e); } finally { setSaving(false); }
  };
  return (
    <Card>
      <CardHeader title="Mosca risk calculator" subtitle="X + Y > Z  ⇒  data protected today is exposed before migration completes" icon={Calculator}
        actions={<Button size="sm" variant="primary" icon={Save} loading={saving} disabled={!can('risk:configure')} title={can('risk:configure') ? '' : 'CTO / CISO only'} onClick={apply}>Apply Z to portfolio</Button>} />
      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-5">
          <Slider label="X · Security shelf-life" sub="How long the data must remain confidential / authentic" value={v.x} max={60} onChange={(x) => setV({ ...v, x })} color="#7dd3fc" />
          <Slider label="Y · Migration time" sub="Years needed to migrate this system to PQC" value={v.y} max={20} onChange={(y) => setV({ ...v, y })} color="#c4b5fd" />
          <Slider label="Z · Time to a CRQC" sub="Estimated years until a cryptographically relevant quantum computer" value={v.z} max={40} onChange={(z) => setV({ ...v, z })} color="#f9a8d4" />
          <p className="flex gap-2 rounded-lg bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-400 ring-1 ring-white/5"><Info size={14} className="mt-0.5 shrink-0 text-sky-300" />Standard definitions from Mosca (2015): X is the data's security shelf-life, Y the migration time and Z the collapse time. Each repository's X and Y come from its risk profile; Z is the portfolio-wide assumption.</p>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl bg-[#070b17] p-4 ring-1 ring-white/10">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-slate-400">Timeline (years from today)</div>
            <div className="relative h-16">
              <div className="absolute left-0 top-1 flex h-6 overflow-hidden rounded-md text-[10px] font-semibold text-white" style={{ width: `${((v.x + v.y) / scale) * 100}%` }}>
                <div className="flex items-center justify-center bg-sky-500/70 transition-all duration-500" style={{ width: `${(v.x / Math.max(v.x + v.y, 0.01)) * 100}%` }}>{v.x > 1 && 'X'}</div>
                <div className="flex items-center justify-center bg-violet-500/70 transition-all duration-500" style={{ width: `${(v.y / Math.max(v.x + v.y, 0.01)) * 100}%` }}>{v.y > 1 && 'Y'}</div>
              </div>
              <div className="absolute top-0 h-14 w-[2px] bg-pink-400 transition-all duration-500" style={{ left: `${(v.z / scale) * 100}%` }}>
                <span className="absolute left-1 top-8 whitespace-nowrap text-[10px] font-semibold text-pink-300">Z = {v.z} (CRQC)</span>
              </div>
              {v.x + v.y > v.z && <div className="absolute top-1 h-6 rounded-r-md bg-rose-500/40 transition-all duration-500" style={{ left: `${(v.z / scale) * 100}%`, width: `${((v.x + v.y - v.z) / scale) * 100}%`, backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 5px, rgba(255,255,255,.18) 5px 7px)' }} title="Exposure window" />}
            </div>
          </div>
          {res && (
            <div className={cx('rounded-xl p-4 ring-1 transition', res.exposed ? 'bg-rose-500/10 ring-rose-500/30' : 'bg-emerald-500/10 ring-emerald-500/30')}>
              <div className="flex items-center gap-2">
                <RiskBadge level={res.exposed ? 'RED' : 'GREEN'} />
                <span className="text-lg font-bold text-white">X + Y = {res.lhs} {res.exposed ? '>' : '≤'} Z = {res.z}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">{res.verdict}</p>
            </div>
          )}
          {res && (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-white/10"><Th>Algorithm with these X/Y/Z</Th><Th>Level</Th><Th>Score</Th><Th>Urgency</Th></tr></thead>
              <tbody>{res.examples.map((e) => <tr key={e.algorithm} className="border-b border-white/5"><Td className="font-medium">{e.algorithm}</Td><Td><RiskBadge level={e.level} /></Td><Td className="tabular-nums">{e.score}</Td><Td className="text-slate-300">{e.urgency}</Td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </Card>
  );
}

function RiskProfiles() {
  const { can, notifyError, toast } = useApp();
  const { data: repos, reload } = useApi('/repositories', ['repositories', 'risks']);
  const [id, setId] = useState('');
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const r = repos?.find((x) => String(x.id) === id) || repos?.[0];
    if (r) { setId(String(r.id)); setP({ dataLifetimeYears: r.data_lifetime_years, migrationTimeYears: r.migration_time_years, criticality: r.criticality }); }
  }, [repos, id]);
  if (!repos || !p) return null;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api(`/repositories/${id}/risk-profile`, { method: 'PUT', body: { dataLifetimeYears: Number(p.dataLifetimeYears), migrationTimeYears: Number(p.migrationTimeYears), criticality: p.criticality } });
      toast({ type: 'success', title: `${r.repository.name} re-assessed`, message: `RED ${r.counts.RED} · YELLOW ${r.counts.YELLOW} · GREEN ${r.counts.GREEN}` });
      reload();
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader title="Repository risk profile" subtitle="Business criticality and data lifetime drive every asset's X, Y and score" icon={SlidersHorizontal} />
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
        <Field label="Repository" className="xl:col-span-2"><Select value={id} onChange={setId} options={repos.map((r) => ({ value: String(r.id), label: r.name }))} /></Field>
        <Field label="X · data lifetime"><input type="number" min={0} max={200} className={inputCls} value={p.dataLifetimeYears} onChange={(e) => setP({ ...p, dataLifetimeYears: e.target.value })} /></Field>
        <Field label="Y · migration time"><input type="number" min={0} max={200} step="0.5" className={inputCls} value={p.migrationTimeYears} onChange={(e) => setP({ ...p, migrationTimeYears: e.target.value })} /></Field>
        <Field label="Criticality"><Select value={p.criticality} onChange={(c) => setP({ ...p, criticality: c })} options={['critical', 'high', 'medium', 'low']} /></Field>
      </div>
      <div className="flex justify-end px-4 pb-4"><Button variant="primary" icon={Save} loading={busy} disabled={!can('risk:configure')} title={can('risk:configure') ? '' : 'CTO / CISO only'} onClick={save}>Save &amp; re-assess</Button></div>
    </Card>
  );
}

export default function Risk() {
  const [params, setParams] = useSearchParams();
  const level = params.get('level') || 'RED';
  const { settings, notifyError, toast } = useApp();
  const { data, loading, error, reload, setData } = useApi('/risks', ['risks', 'assets']);
  const [selected, setSelected] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [busy, setBusy] = useState(false);
  const counts = useMemo(() => (data || []).reduce((m, r) => ({ ...m, [r.risk_level]: (m[r.risk_level] || 0) + 1 }), {}), [data]);
  const rows = useMemo(() => (data || []).filter((r) => r.risk_level === level), [data, level]);
  const { sorted, toggle, sortedFor } = useSort(rows, 'risk_score');
  const sel = data?.find((r) => r.id === selected) || sorted[0];

  const regenerate = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const exp = await api(`/risks/${sel.id}/explain`, { method: 'POST' });
      setData((d) => d.map((r) => (r.id === sel.id ? { ...r, explanation: exp } : r)));
      toast({ type: 'success', title: 'Explanation regenerated', message: exp.label });
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Phase 2 · Assess" title="Quantum Risk Assessment" description="Mosca's theorem combined with algorithm status (vulnerable, classically broken, Grover-weakened, exposed key material) and business criticality classifies every asset RED, YELLOW or GREEN." />
      <MoscaCalculator z0={settings.moscaZ} />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Asset classification" subtitle="RED — immediate migration · YELLOW — migration planned · GREEN — no immediate action" icon={ShieldAlert}
            actions={<Tabs value={level} onChange={(l) => { setParams({ level: l }); setSelected(null); }} tabs={['RED', 'YELLOW', 'GREEN'].map((l) => ({ value: l, label: l, count: counts[l] || 0 }))} />} />
          {loading ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !sorted.length ? <EmptyState title={`No ${level} assets`} message="Nothing is classified at this level right now." /> : (
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full min-w-[820px]">
                <thead className="sticky top-0 bg-ink-850"><tr className="border-b border-white/5">
                  <Th onClick={() => toggle('risk_score')} sorted={sortedFor('risk_score')}>Risk score</Th><Th onClick={() => toggle('algorithm')} sorted={sortedFor('algorithm')}>Algorithm</Th>
                  <Th onClick={() => toggle('business_criticality')} sorted={sortedFor('business_criticality')}>Criticality</Th><Th onClick={() => toggle('x_years')} sorted={sortedFor('x_years')}>Data lifetime</Th><Th>Urgency</Th><Th />
                </tr></thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.id} onClick={() => setSelected(r.id)} className={cx('cursor-pointer border-b border-white/5 hover:bg-white/[0.03]', sel?.id === r.id && 'bg-sky-500/10')}>
                      <Td>
                        <div className="flex items-center gap-2"><RiskBadge level={r.risk_level} /><span className="text-sm font-bold tabular-nums">{r.risk_score}</span></div>
                        <div className="mt-1 h-1 w-20 rounded-full bg-white/5"><div className="h-1 rounded-full" style={{ width: `${r.risk_score}%`, background: RISK_COLORS[r.risk_level] }} /></div>
                      </Td>
                      <Td><div className="font-semibold">{r.algorithm}</div><div className="code-font text-[10px] text-slate-500">{r.repository_name} · {r.file_path}{r.line ? `:${r.line}` : ''}</div></Td>
                      <Td><Badge tone={r.business_criticality === 'critical' ? 'red' : r.business_criticality === 'high' ? 'yellow' : 'slate'}>{r.business_criticality}</Badge></Td>
                      <Td className="text-xs tabular-nums">{r.x_years} y <span className="text-slate-500">(X+Y {+(r.x_years + r.y_years).toFixed(1)} vs Z {r.z_years})</span></Td>
                      <Td className="text-xs">{r.urgency}</Td>
                      <Td><Button size="sm" variant="ghost" icon={Eye} aria-label="Details" onClick={(e) => { e.stopPropagation(); setDrawer(r.id); }} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          {sel ? (
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-400"><Brain size={14} className="text-violet-300" /> Explaining <span className="font-semibold text-slate-100">{sel.algorithm}</span> · {sel.rationale}</div>
              <ExplanationPanel explanation={sel.explanation} onRegenerate={regenerate} busy={busy} />
            </Card>
          ) : <Card><EmptyState icon={Brain} title="Select an asset" message="Pick a row to read its AI risk explanation." /></Card>}
          <RiskProfiles />
        </div>
      </div>
      <AssetDrawer assetId={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
