import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ScanSearch, Boxes, Gauge, Bot, LayoutDashboard, ArrowRight } from 'lucide-react';
import { useApi } from '../context/AppContext';
import { Card, PageHeader, Button, Badge, StatusBadge, cx, Loading } from '../components/ui';

export default function Workflow() {
  const nav = useNavigate();
  const { data: d, loading } = useApi('/dashboard/summary', ['dashboard']);
  const [sel, setSel] = useState(0);
  if (loading || !d) return <Loading />;
  const k = d.kpis;
  const st = (ok, partial) => (ok ? 'completed' : partial ? 'running' : 'idle');
  const STAGES = [
    { title: 'Asset Ingestion', icon: Download, to: '/discovery', status: st(k.repositoriesScanned === k.repositories && k.repositories > 0, k.repositoriesScanned > 0), metric: `${k.repositoriesScanned}/${k.repositories} sources ingested`,
      desc: 'Pull code and configuration from GitHub/GitLab, source ZIPs, Docker images and AWS inventories into an isolated local workspace.',
      input: 'Repository URLs, ZIP archives, registry images, cloud inventory exports', processing: 'Download / extract (zip-slip protected), file enumeration, language & LOC profiling', output: 'Normalised file set per repository + ingestion metadata' },
    { title: 'Deep Scanning', icon: ScanSearch, to: '/ast-scanner', status: st(k.totalAssets > 0), metric: `${k.totalAssets} cryptographic assets detected`,
      desc: 'Semantic AST parsing and Semgrep-style PQC rules detect cryptographic APIs, key generation, hardcoded keys, TLS settings, certificates and vulnerable libraries.',
      input: 'Normalised source files, manifests, Dockerfiles, certificates', processing: 'Babel AST traversal, rule engine, enclosing-function resolution, data-context inference', output: 'Crypto findings with file, line, function, API, algorithm and rule' },
    { title: 'CBOM Generation', icon: Boxes, to: '/cbom', status: st(k.totalAssets > 0), metric: 'CycloneDX 1.5 per repository',
      desc: 'Findings become a CycloneDX 1.5 Cryptography Bill of Materials — algorithms, keys, certificates, protocols and libraries with evidence occurrences.',
      input: 'Crypto findings', processing: 'Component mapping, bom-ref generation, dependency graph', output: 'Exportable CBOM JSON' },
    { title: 'Quantum Risk Assessment', icon: Gauge, to: '/risk', status: st(k.totalAssets > 0), metric: `${k.high} RED · ${k.medium} YELLOW · ${k.low} GREEN`,
      desc: "Mosca's theorem (X + Y > Z) plus algorithm status and business criticality classifies each asset and generates plain-language explanations.",
      input: 'CBOM + repository risk profiles + Z assumption', processing: 'Mosca calculation, scoring, Granite-style explanation', output: 'RED / YELLOW / GREEN classification, risk scores, explanations' },
    { title: 'IBM Bob Remediation', icon: Bot, to: '/code-mode', status: st(k.migrationProgress === 100, k.patches > 0), metric: `${k.patches} patches · ${k.generatedPRs} PRs · ${k.migrationProgress}% migrated`,
      desc: 'Architect Mode plans the migration; Code Mode generates ML-KEM / ML-DSA patches, tests run, and PRs wait for mandatory human approval.',
      input: 'Prioritised risks and migration plan', processing: 'Code transformation, adapter generation, test execution, compliance check', output: 'Reviewed pull requests and an audit trail' },
    { title: 'Dashboard Visualization', icon: LayoutDashboard, to: '/dashboard', status: 'completed', metric: 'Live over Server-Sent Events',
      desc: 'Role-based dashboards give CTOs, CISOs, developers and auditors the view they need, updated live as agents work.',
      input: 'All platform state', processing: 'Aggregation, charting, drill-down', output: 'Executive, security, developer and audit views + exportable reports' },
  ];
  const s = STAGES[sel];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title="Implementation Workflow" description="Six implementation stages from ingestion to visualisation. Stage status is computed from the live platform state." />
      <div className="grid gap-2 md:grid-cols-6">
        {STAGES.map((x, i) => (
          <button key={x.title} onClick={() => setSel(i)} className={cx('glass relative rounded-2xl p-4 text-left transition', sel === i ? 'ring-2 ring-sky-400/60' : 'hover:ring-1 hover:ring-white/20')}>
            <div className="flex items-center justify-between"><span className="text-[11px] font-bold text-slate-500">0{i + 1}</span><StatusBadge status={x.status} label={x.status === 'completed' ? 'complete' : x.status === 'running' ? 'in progress' : 'pending'} /></div>
            <x.icon size={20} className="mt-3 text-sky-300" />
            <div className="mt-2 text-sm font-semibold text-white">{x.title}</div>
            <div className="mt-1 text-[11px] text-slate-400">{x.metric}</div>
            {i < STAGES.length - 1 && <ArrowRight size={14} className="absolute -right-2.5 top-1/2 hidden text-sky-400 md:block" />}
          </button>
        ))}
      </div>
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl"><Badge tone="blue">Stage {sel + 1}</Badge><h2 className="mt-2 text-xl font-bold text-white">{s.title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-300">{s.desc}</p></div>
          <Button variant="primary" icon={s.icon} onClick={() => nav(s.to)}>Open module</Button>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {[['Input', s.input], ['Processing', s.processing], ['Output', s.output], ['Status', s.metric]].map(([k2, v]) => (
            <div key={k2} className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5"><div className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">{k2}</div><p className="mt-1.5 text-sm leading-relaxed text-slate-200">{v}</p></div>
          ))}
        </div>
      </Card>
    </div>
  );
}
