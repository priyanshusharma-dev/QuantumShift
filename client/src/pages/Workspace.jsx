import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, AlertOctagon, GitPullRequest, Atom, FileDown, Boxes, ShieldAlert, Wand2, Code2, ScrollText, ShieldCheck, Scale, KeyRound, FileBadge2, Library } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { api, download } from '../lib/api';
import { ROLE_LABEL, STATUS_LABEL, fmtTime } from '../lib/format';
import { Card, CardHeader, PageHeader, StatCard, Button, RiskBadge, StatusBadge, Badge, ProgressBar, Loading, EmptyState, Th, Td } from '../components/ui';
import { AssetDrawer } from '../components/AssetDrawer';

function useExport() {
  const { toast, notifyError } = useApp();
  return async (path, name) => {
    try { toast({ type: 'success', title: 'Downloaded', message: await download(path, name) }); } catch (e) { notifyError(e, 'Export failed'); }
  };
}

function CtoView({ d }) {
  const nav = useNavigate();
  const exp = useExport();
  const k = d.kpis;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Migration progress" value={k.migrationProgress} suffix="%" icon={TrendingUp} tone="green" hint={`${k.remediated}/${k.vulnerable} assets`} onClick={() => nav('/planner')} />
        <StatCard label="High-risk assets" value={k.high} icon={AlertOctagon} tone="red" hint="immediate migration" onClick={() => nav('/dashboard')} />
        <StatCard label="PQC ready" value={k.pqcReadyPct} suffix="%" icon={Atom} tone="cyan" />
        <StatCard label="Awaiting approval" value={k.pendingPRs} icon={GitPullRequest} tone="yellow" onClick={() => nav('/pull-requests')} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Portfolio exposure" subtitle={`Mosca exposure = X + Y − Z (Z = ${d.z})`} icon={AlertOctagon} actions={<Button size="sm" variant="primary" icon={FileDown} onClick={() => exp('/reports/executive', 'executive.html')}>Executive report</Button>} />
          <div className="space-y-3 p-5">{d.byRepository.map((r) => (
            <button key={r.id} className="block w-full text-left" onClick={() => nav(`/repositories/${r.id}`)}>
              <div className="flex justify-between text-xs"><span className="font-medium text-slate-200">{r.name}</span><span className="text-slate-400">{r.exposureYears > 0 ? <span className="text-rose-300">{r.exposureYears} y exposed</span> : 'within window'} · {r.RED} RED · {r.progress}% migrated</span></div>
              <ProgressBar value={r.progress} tone="green" className="mt-1.5" />
            </button>
          ))}</div>
        </Card>
        <Card>
          <CardHeader title="Active roadmap" icon={TrendingUp} actions={<Button size="sm" onClick={() => nav('/planner')}>Open planner</Button>} />
          {d.activePlan ? (
            <div className="grid grid-cols-2 gap-3 p-5 text-sm">
              {[['Plan', d.activePlan.name], ['Work items', d.activePlan.summary.totalItems], ['Engineer-days', d.activePlan.summary.totalEffortDays], ['Duration', `${d.activePlan.summary.estimatedWeeks} weeks`], ['P1 critical', d.activePlan.summary.p1], ['Progress', `${d.activePlan.summary.progressPct}%`]].map(([a, b]) => (
                <div key={a} className="rounded-lg bg-white/[0.03] p-3 ring-1 ring-white/5"><div className="text-[10px] uppercase tracking-wider text-slate-500">{a}</div><div className="mt-0.5 truncate font-semibold text-white">{b}</div></div>
              ))}
            </div>
          ) : <EmptyState title="No roadmap yet" action={<Button onClick={() => nav('/planner')}>Generate one</Button>} />}
        </Card>
      </div>
    </>
  );
}

function CisoView({ d, setAsset }) {
  const nav = useNavigate();
  const k = d.kpis;
  const { data: prs } = useApi('/pull-requests', ['prs']);
  const pending = (prs || []).filter((p) => p.status === 'pending_review');
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="CBOM assets" value={k.totalAssets} icon={Boxes} tone="violet" onClick={() => nav('/cbom')} />
        <StatCard label="Hardcoded keys/secrets" value={k.hardcodedKeys} icon={KeyRound} tone="red" onClick={() => nav('/cbom?risk=RED')} />
        <StatCard label="Certificates" value={k.certificates} icon={FileBadge2} tone="yellow" onClick={() => nav('/cbom')} />
        <StatCard label="Libraries & runtimes" value={d.algorithmDistribution.find((a) => a.name === 'Libraries / runtimes')?.total || 0} icon={Library} tone="blue" onClick={() => nav('/cbom')} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Top vulnerabilities" icon={ShieldAlert} actions={<Button size="sm" onClick={() => nav('/risk')}>Risk assessment</Button>} />
          <table className="w-full"><tbody>{d.topRisks.map((t) => (
            <tr key={t.id} className="cursor-pointer border-b border-white/5 hover:bg-white/[0.03]" onClick={() => setAsset(t.id)}>
              <Td><RiskBadge level={t.level} score={t.score} /></Td><Td className="text-xs font-semibold">{t.algorithm}</Td><Td className="code-font text-[11px] text-slate-400">{t.repository} · {t.file}{t.line ? `:${t.line}` : ''}</Td>
            </tr>
          ))}</tbody></table>
        </Card>
        <Card>
          <CardHeader title="Your approval queue" icon={GitPullRequest} />
          <div className="divide-y divide-white/5">
            {!pending.length ? <EmptyState title="Nothing awaiting approval" /> : pending.map((p) => (
              <button key={p.id} onClick={() => nav(`/pull-requests?pr=${p.id}`)} className="block w-full px-4 py-3 text-left hover:bg-white/[0.03]">
                <div className="text-sm font-medium text-slate-100">#{p.number} {p.title}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">{p.repository_name} · −{p.risk_reduction}% risk · compliance {p.compliance?.status?.replace('_', ' ')}</div>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function DeveloperView({ setAsset }) {
  const nav = useNavigate();
  const { data: assets, loading } = useApi('/assets?status=open', ['assets', 'risks']);
  const { data: jobs } = useApi('/remediation/jobs', ['remediation']);
  const { data: prs } = useApi('/pull-requests', ['prs']);
  const findings = (assets || []).filter((a) => a.risk_level !== 'GREEN' && !a.file_path.startsWith('aws://') && ['JavaScript', 'TypeScript', 'Python', 'Go', 'Java'].includes(a.language));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open code findings" value={findings.length} icon={Code2} tone="red" onClick={() => nav('/ast-scanner')} />
        <StatCard label="My patches" value={(jobs || []).length} icon={Wand2} tone="blue" onClick={() => nav('/code-mode')} />
        <StatCard label="PRs in review" value={(prs || []).filter((p) => p.status === 'pending_review').length} icon={GitPullRequest} tone="yellow" onClick={() => nav('/pull-requests')} />
        <StatCard label="Changes requested" value={(prs || []).filter((p) => p.status === 'changes_requested').length} icon={AlertOctagon} tone="violet" onClick={() => nav('/pull-requests')} />
      </div>
      <Card>
        <CardHeader title="Code findings to fix" subtitle="Open RED / YELLOW call sites in application code" icon={Code2} />
        {loading ? <Loading /> : !findings.length ? <EmptyState title="No open code findings" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
            <thead><tr className="border-b border-white/5"><Th>Risk</Th><Th>Algorithm</Th><Th>Location</Th><Th>Function</Th><Th /></tr></thead>
            <tbody>{findings.slice(0, 20).map((a) => (
              <tr key={a.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <Td><RiskBadge level={a.risk_level} score={a.risk_score} /></Td><Td className="text-xs font-semibold">{a.algorithm}</Td>
                <Td className="code-font text-xs"><button className="hover:text-sky-300" onClick={() => setAsset(a.id)}>{a.repository_name} · {a.file_path}:{a.line}</button></Td>
                <Td className="code-font text-xs text-sky-300">{a.function_name}</Td>
                <Td className="text-right"><Button size="sm" variant="primary" icon={Wand2} onClick={() => nav(`/code-mode?asset=${a.id}`)}>Fix with Bob</Button></Td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

function AuditorView() {
  const nav = useNavigate();
  const exp = useExport();
  const { notifyError } = useApp();
  const { data: logs } = useApi('/audit-logs?limit=12', ['audit']);
  const { data: prs } = useApi('/pull-requests', ['prs']);
  const [chain, setChain] = useState(null);
  const verify = async () => { try { setChain(await api('/audit-logs/verify')); } catch (e) { notifyError(e); } };
  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck size={22} className="text-emerald-300" />
          <div className="min-w-0 flex-1"><div className="font-semibold text-white">BobShell integrity</div><div className="text-xs text-slate-400">{chain ? (chain.valid ? `Hash chain intact · ${chain.entries} entries verified` : `Broken at entry #${chain.brokenAt}`) : 'Verify the SHA-256 hash chain of every recorded action.'}</div></div>
          <Button icon={ShieldCheck} onClick={verify}>Verify chain</Button>
          <Button icon={FileDown} onClick={() => exp('/reports/audit?format=csv', 'audit.csv')}>Audit CSV</Button>
          <Button variant="primary" icon={FileDown} onClick={() => exp('/reports/audit?format=json', 'audit.json')}>Audit report</Button>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent BobShell entries" icon={ScrollText} actions={<Button size="sm" onClick={() => nav('/audit')}>All logs</Button>} />
          <div className="code-font divide-y divide-white/5 text-[11.5px]">{(logs || []).map((l) => (
            <div key={l.id} className="px-4 py-2"><span className="text-slate-500">{fmtTime(l.ts)}</span> <span className="text-sky-300">{l.agent}</span> <span className="text-slate-100">{l.action}</span> <StatusBadge status={l.status} /></div>
          ))}</div>
        </Card>
        <Card>
          <CardHeader title="Compliance of pull requests" icon={Scale} />
          <div className="divide-y divide-white/5">{(prs || []).map((p) => (
            <button key={p.id} onClick={() => nav(`/pull-requests?pr=${p.id}`)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]">
              <span className="text-xs font-semibold text-slate-400">#{p.number}</span><span className="min-w-0 flex-1 truncate text-xs text-slate-100">{p.title}</span>
              <Badge tone={p.compliance?.status === 'compliant' ? 'green' : p.compliance?.status === 'non_compliant' ? 'red' : 'yellow'}>{p.compliance?.status?.replace('_', ' ')}</Badge>
              <StatusBadge status={p.status} label={STATUS_LABEL[p.status]} />
            </button>
          ))}{!(prs || []).length && <EmptyState title="No pull requests yet" />}</div>
        </Card>
      </div>
    </>
  );
}

const INTRO = {
  CTO: 'Executive risk and migration progress across the portfolio.',
  CISO: 'CBOM, risk and vulnerabilities — plus the PRs waiting for your approval.',
  DEVELOPER: 'Your code findings, Bob-generated patches and pull requests.',
  AUDITOR: 'BobShell logs, hash-chain integrity and compliance evidence (read-only).',
};

export default function Workspace() {
  const { user } = useApp();
  const { data, loading } = useApi('/dashboard/summary', ['dashboard']);
  const [asset, setAsset] = useState(null);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`${ROLE_LABEL[user.role]} workspace`} title={`Welcome, ${user.name.split(' ')[0]}`} description={INTRO[user.role]} badges={<Badge tone="blue">{user.title}</Badge>} />
      {loading || !data ? <Loading /> : (
        <>
          {user.role === 'CTO' && <CtoView d={data} />}
          {user.role === 'CISO' && <CisoView d={data} setAsset={setAsset} />}
          {user.role === 'DEVELOPER' && <DeveloperView setAsset={setAsset} />}
          {user.role === 'AUDITOR' && <AuditorView />}
        </>
      )}
      <AssetDrawer assetId={asset} onClose={() => setAsset(null)} />
    </div>
  );
}
