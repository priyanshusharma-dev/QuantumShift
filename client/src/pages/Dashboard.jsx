import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area, ReferenceLine } from 'recharts';
import { Boxes, AlertOctagon, AlertTriangle, ShieldCheck, Atom, TrendingUp, GitPullRequest, FlaskConical, FileDown, Grid3x3, BarChart3, Clock, Layers, Code2, GitBranch, Table2 } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { download } from '../lib/api';
import { RISK_COLORS, timeAgo } from '../lib/format';
import { Card, CardHeader, StatCard, PageHeader, Button, RiskBadge, Loading, ErrorState, DemoBadge, EmptyState, cx, Th, Td } from '../components/ui';
import { axisProps, gridProps, ChartTooltip, Legend, riskLegend } from '../components/charts';
import { AssetDrawer } from '../components/AssetDrawer';

const TYPE_LABEL = { algorithm: 'Algorithms', key: 'Keys', secret: 'Secrets', certificate: 'Certificates', protocol: 'Protocols', library: 'Libraries' };
const SURFACE = '#0d1428';

function StackedRiskBars({ data, onSelect, height = 260, layout = 'vertical', nameKey = 'name' }) {
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={vertical ? 'vertical' : 'horizontal'} margin={{ left: vertical ? 8 : 0, right: 16, top: 8, bottom: 0 }} barCategoryGap={vertical ? 6 : '28%'}>
        <CartesianGrid {...gridProps} vertical={vertical} horizontal={!vertical} />
        {vertical ? <XAxis type="number" allowDecimals={false} {...axisProps} /> : <XAxis dataKey={nameKey} {...axisProps} interval={0} tick={{ ...axisProps.tick, fontSize: 10 }} />}
        {vertical ? <YAxis type="category" dataKey={nameKey} width={118} interval={0} {...axisProps} /> : <YAxis allowDecimals={false} {...axisProps} width={28} />}
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,.06)' }} />
        {['RED', 'YELLOW', 'GREEN'].map((lv, i) => (
          <Bar key={lv} dataKey={lv} name={lv} stackId="r" fill={RISK_COLORS[lv]} stroke={SURFACE} strokeWidth={2} radius={i === 2 ? (vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0} onClick={onSelect ? (d) => onSelect(d.payload ?? d) : undefined} style={{ cursor: onSelect ? 'pointer' : 'default' }} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const { settings, notifyError, toast } = useApp();
  const { data, loading, error, reload } = useApi('/dashboard/summary', ['dashboard', 'assets', 'risks', 'prs', 'tests']);
  const [assetId, setAssetId] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const exportReport = async (path, name) => {
    try { toast({ type: 'success', title: 'Report downloaded', message: await download(path, name) }); } catch (e) { notifyError(e, 'Export failed'); }
  };

  if (loading) return <Loading label="Computing executive posture…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const k = data.kpis;
  const empty = k.totalAssets === 0;
  const donut = data.riskDistribution.filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CTO / CISO command center"
        title="Executive Risk Dashboard"
        description={`Quantum exposure across ${k.repositories} repositories. Every number is computed live from the scan database (last scan ${timeAgo(data.lastScanAt)}; CRQC assumption Z = ${data.z} years → ${data.crqcYear}).`}
        badges={settings.mode === 'demo' && <DemoBadge />}
        actions={<>
          <Button icon={FileDown} onClick={() => exportReport('/reports/risk?format=csv', 'risk.csv')}>Risk report (CSV)</Button>
          <Button variant="primary" icon={FileDown} onClick={() => exportReport('/reports/executive', 'executive-report.html')}>Executive security report</Button>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        <StatCard label="Total assets" value={k.totalAssets} icon={Boxes} tone="violet" hint={`${k.certificates} certs · ${k.hardcodedKeys} keys/secrets`} onClick={() => nav('/cbom')} />
        <StatCard label="High risk" value={k.high} icon={AlertOctagon} tone="red" hint="RED · immediate" onClick={() => nav('/risk?level=RED')} />
        <StatCard label="Medium risk" value={k.medium} icon={AlertTriangle} tone="yellow" hint="YELLOW · planned" onClick={() => nav('/risk?level=YELLOW')} />
        <StatCard label="Low risk" value={k.low} icon={ShieldCheck} tone="green" hint="GREEN · no action" onClick={() => nav('/risk?level=GREEN')} />
        <StatCard label="PQC ready" value={k.pqcReadyPct} suffix="%" icon={Atom} tone="cyan" hint={`${k.pqcReady} of ${k.totalAssets} assets`} />
        <StatCard label="Migration progress" value={k.migrationProgress} suffix="%" icon={TrendingUp} tone="green" hint={`${k.remediated}/${k.vulnerable} remediated`} onClick={() => nav('/planner')} />
        <StatCard label="Pending PRs" value={k.pendingPRs} icon={GitPullRequest} tone="yellow" hint={`${k.generatedPRs} generated`} onClick={() => nav('/pull-requests')} />
        <StatCard label="Tests passed" value={k.testsPassed} icon={FlaskConical} tone="blue" hint={`${k.testPassRate}% of ${k.testsTotal} · ${k.testsRealPct}% real`} onClick={() => nav('/testing')} />
      </div>

      {empty ? (
        <Card><EmptyState icon={Boxes} title="No cryptographic assets yet" message="Scan a repository to populate the dashboard." action={<Button variant="primary" onClick={() => nav('/discovery')}>Go to Repository Discovery</Button>} /></Card>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader title="Risk distribution" subtitle="Share of assets by quantum-risk level" icon={AlertOctagon} />
              <div className="relative p-4">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={donut} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={2} stroke={SURFACE} strokeWidth={2} onClick={(d) => nav(`/risk?level=${d.name}`)} style={{ cursor: 'pointer' }}>
                      {donut.map((d) => <Cell key={d.name} fill={RISK_COLORS[d.name]} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-x-0 top-[92px] text-center">
                  <div className="text-2xl font-bold text-white">{k.totalAssets}</div>
                  <div className="text-[11px] text-slate-400">assets</div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  {data.riskDistribution.map((d) => (
                    <button key={d.name} onClick={() => nav(`/risk?level=${d.name}`)} className="rounded-lg bg-white/[0.03] p-2 ring-1 ring-white/5 hover:bg-white/5">
                      <RiskBadge level={d.name} />
                      <div className="mt-1 text-base font-bold text-white">{d.value}</div>
                    </button>
                  ))}
                </div>
              </div>
            </Card>
            <Card className="xl:col-span-2">
              <CardHeader title="Algorithm distribution" subtitle="Assets per algorithm family, split by risk" icon={BarChart3} actions={<Legend items={riskLegend} />} />
              <div className="p-4"><StackedRiskBars data={data.algorithmDistribution} height={Math.max(240, data.algorithmDistribution.length * 24)} onSelect={() => nav('/cbom')} /></div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Risk by repository" subtitle="Click a bar to drill down: repository → file → asset → call site" icon={GitBranch} actions={<Legend items={riskLegend} />} />
              <div className="p-4"><StackedRiskBars data={data.byRepository} height={250} onSelect={(d) => d?.id && nav(`/repositories/${d.id}`)} /></div>
            </Card>
            <Card>
              <CardHeader title="Migration progress" subtitle="Remediated vs open quantum-vulnerable assets per repository" icon={TrendingUp} actions={<Legend items={[{ name: 'Remediated', color: RISK_COLORS.GREEN }, { name: 'Open', color: '#3987e5' }]} />} />
              <div className="space-y-3 p-5">
                {data.byRepository.map((r) => (
                  <button key={r.id} onClick={() => nav(`/repositories/${r.id}`)} className="block w-full text-left">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-200">{r.name}</span>
                      <span className="tabular-nums text-slate-400">{r.remediated}/{r.vulnerable} · <span className="font-semibold text-slate-100">{r.progress}%</span></span>
                    </div>
                    <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-l-full transition-all duration-700" style={{ width: `${r.vulnerable ? (r.remediated / r.vulnerable) * 100 : 100}%`, background: RISK_COLORS.GREEN }} />
                      <div className="h-full flex-1 rounded-r-full" style={{ background: r.vulnerable - r.remediated > 0 ? '#3987e5' : 'transparent', opacity: 0.55 }} />
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Risk by programming language" subtitle="Where quantum-vulnerable code lives" icon={Code2} actions={<Legend items={riskLegend} />} />
              <div className="p-4"><StackedRiskBars data={data.byLanguage} layout="horizontal" height={250} onSelect={(d) => d?.name && nav(`/cbom?language=${encodeURIComponent(d.name)}`)} /></div>
            </Card>
            <Card>
              <CardHeader title="Crypto asset exposure timeline" subtitle={`Open vulnerable assets whose data still needs protection each year (X + Y); shaded past the CRQC line (${data.crqcYear})`} icon={Clock} />
              <div className="p-4">
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={data.timeline} margin={{ left: 0, right: 16, top: 10 }}>
                    <defs>
                      <linearGradient id="gNeed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3987e5" stopOpacity={0.45} /><stop offset="1" stopColor="#3987e5" stopOpacity={0.02} /></linearGradient>
                      <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={RISK_COLORS.RED} stopOpacity={0.55} /><stop offset="1" stopColor={RISK_COLORS.RED} stopOpacity={0.05} /></linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="year" {...axisProps} interval={4} />
                    <YAxis allowDecimals={false} {...axisProps} width={28} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="needingProtection" name="Still needing protection" stroke="#3987e5" strokeWidth={2} fill="url(#gNeed)" />
                    <Area type="monotone" dataKey="exposed" name="Exposed after CRQC" stroke={RISK_COLORS.RED} strokeWidth={2} fill="url(#gExp)" />
                    <ReferenceLine x={data.crqcYear} stroke="#c084fc" strokeDasharray="4 4" label={{ value: `CRQC (Z=${data.z})`, fill: '#d8b4fe', fontSize: 11, position: 'insideTopRight' }} />
                  </AreaChart>
                </ResponsiveContainer>
                <Legend items={[{ name: 'Still needing protection', color: '#3987e5' }, { name: 'Exposed after CRQC', color: RISK_COLORS.RED }]} />
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="RED / YELLOW / GREEN risk heatmap" subtitle="Worst risk level per repository × asset type — click a cell to drill down" icon={Grid3x3}
              actions={<><Legend items={riskLegend} /><Button size="sm" variant="ghost" icon={Table2} onClick={() => setShowTable((s) => !s)}>{showTable ? 'Hide' : 'Show'} data table</Button></>} />
            <div className="overflow-x-auto p-4">
              <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-1.5"><colgroup><col className="w-48" />{Object.keys(TYPE_LABEL).map((t) => <col key={t} />)}</colgroup>
                <thead><tr><th className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Repository</th>{Object.values(TYPE_LABEL).map((t) => <th key={t} className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t}</th>)}</tr></thead>
                <tbody>
                  {data.heatmap.map((row) => (
                    <tr key={row.repositoryId}>
                      <td className="pr-2 text-sm font-medium text-slate-200"><button className="hover:text-sky-300" onClick={() => nav(`/repositories/${row.repositoryId}`)}>{row.repository}</button></td>
                      {row.cells.map((c) => (
                        <td key={c.type}>
                          <button disabled={!c.count} onClick={() => nav(`/repositories/${row.repositoryId}?type=${c.type}`)}
                            title={c.count ? `${row.repository} · ${TYPE_LABEL[c.type]}: ${c.count} asset(s), worst ${c.level}` : 'No assets'}
                            className={cx('flex h-12 w-full flex-col items-center justify-center rounded-lg text-xs font-semibold transition hover:scale-[1.03] disabled:cursor-default disabled:hover:scale-100', !c.count && 'bg-white/[0.02] text-slate-600 ring-1 ring-white/5')}
                            style={c.count ? { background: `${RISK_COLORS[c.level]}${c.level === 'GREEN' ? '55' : '88'}`, color: '#fff' } : undefined}>
                            {c.count ? <><span>{c.level}</span><span className="text-[10px] font-medium opacity-90">{c.count} asset{c.count > 1 ? 's' : ''}</span></> : '—'}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {showTable && (
                <table className="mt-4 w-full text-xs">
                  <thead><tr className="border-b border-white/10"><Th>Repository</Th><Th>RED</Th><Th>YELLOW</Th><Th>GREEN</Th><Th>Total</Th><Th>Mosca exposure</Th><Th>Progress</Th></tr></thead>
                  <tbody>{data.byRepository.map((r) => <tr key={r.id} className="border-b border-white/5"><Td>{r.name}</Td><Td>{r.RED}</Td><Td>{r.YELLOW}</Td><Td>{r.GREEN}</Td><Td>{r.total}</Td><Td>{r.exposureYears} y</Td><Td>{r.progress}%</Td></tr>)}</tbody>
                </table>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Top open risks" subtitle="Highest-scoring quantum-vulnerable assets awaiting migration" icon={Layers} actions={<Button size="sm" onClick={() => nav('/risk')}>All risks</Button>} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead><tr className="border-b border-white/5"><Th>Risk</Th><Th>Asset</Th><Th>Location</Th><Th>Function</Th><Th>Urgency</Th></tr></thead>
                <tbody>
                  {data.topRisks.map((t) => (
                    <tr key={t.id} className="cursor-pointer border-b border-white/5 hover:bg-white/[0.03]" onClick={() => setAssetId(t.id)}>
                      <Td><RiskBadge level={t.level} score={t.score} /></Td>
                      <Td className="font-medium">{t.algorithm}</Td>
                      <Td className="code-font text-xs text-slate-300">{t.repository} · {t.file}{t.line ? `:${t.line}` : ''}</Td>
                      <Td className="code-font text-xs text-sky-300">{t.functionName}</Td>
                      <Td className="text-xs text-slate-300">{t.urgency}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <AssetDrawer assetId={assetId} onClose={() => setAssetId(null)} />
    </div>
  );
}
