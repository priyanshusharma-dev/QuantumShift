import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ScanSearch, LayoutDashboard, Network, Rocket, FileCode2, Radar, Boxes, ShieldAlert, Map, Wand2, FlaskConical, UserCheck, ScrollText,
  GitBranch, AlertOctagon, TrendingUp, GitPullRequest, Clock, ArrowRight, Search, Gauge, Route, ShieldCheck, Landmark,
} from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { Button, Card, StatCard, DemoBadge, Badge, cx } from '../components/ui';

const FLOW = [
  { label: 'Source code', icon: FileCode2, hint: 'GitHub · GitLab · Docker · AWS' },
  { label: 'Discovery', icon: Radar, hint: 'AST parsing + PQC rules' },
  { label: 'CBOM', icon: Boxes, hint: 'CycloneDX 1.5' },
  { label: 'Risk assessment', icon: ShieldAlert, hint: "Mosca X + Y > Z" },
  { label: 'Migration plan', icon: Map, hint: 'Bob Architect Mode' },
  { label: 'PQC remediation', icon: Wand2, hint: 'Bob Code Mode · ML-KEM / ML-DSA' },
  { label: 'Tests', icon: FlaskConical, hint: 'Regression + interoperability' },
  { label: 'Human approval', icon: UserCheck, hint: 'Mandatory checkpoint' },
  { label: 'Audit report', icon: ScrollText, hint: 'BobShell hash chain' },
];

const PHASES = [
  { key: 'DISCOVER', icon: Search, to: '/discovery', text: 'Scan repositories, containers and cloud inventories; build the CBOM.' },
  { key: 'ASSESS', icon: Gauge, to: '/risk', text: "Quantify quantum exposure with Mosca's theorem and Granite-style explanations." },
  { key: 'PLAN', icon: Route, to: '/planner', text: 'Architect Mode sequences hybrid → PQC phases by priority and effort.' },
  { key: 'REMEDIATE', icon: Wand2, to: '/code-mode', text: 'Code Mode generates ML-KEM / ML-DSA patches, tests and PRs.' },
  { key: 'GOVERN', icon: Landmark, to: '/audit', text: 'Human approval, compliance checks and a tamper-evident BobShell trail.' },
];

function PipelineVisual() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % FLOW.length), 1100);
    return () => clearInterval(t);
  }, []);
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-violet-600/20 blur-3xl" />
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Agentic pipeline</span>
        <Badge tone="cyan">live</Badge>
      </div>
      <ol className="relative">
        {FLOW.map((f, i) => {
          const on = i === active;
          const done = i < active;
          return (
            <li key={f.label} className="relative">
              <div className={cx('flex items-center gap-3 rounded-xl px-3 py-2 transition-all duration-500', on ? 'bg-gradient-to-r from-sky-500/25 to-violet-500/15 ring-1 ring-sky-400/40' : 'ring-1 ring-transparent')}>
                <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-500', on ? 'bg-gradient-to-br from-sky-500 to-violet-500 text-white shadow-lg shadow-sky-900/50' : done ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-slate-400')}>
                  <f.icon size={15} />
                </span>
                <div className="min-w-0">
                  <div className={cx('text-[13px] font-semibold uppercase tracking-wide', on ? 'text-white' : 'text-slate-300')}>{f.label}</div>
                  <div className="truncate text-[11px] text-slate-500">{f.hint}</div>
                </div>
              </div>
              {i < FLOW.length - 1 && <div className={cx('ml-[27px] h-3 w-[2px]', i < active ? 'bg-emerald-500/50' : 'flow-line opacity-60')} />}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export default function Landing() {
  const nav = useNavigate();
  const { settings } = useApp();
  const { data, loading } = useApi('/dashboard/summary', ['dashboard']);
  const k = data?.kpis;
  return (
    <div className="space-y-10">
      <section className="grid items-center gap-8 lg:grid-cols-[1.25fr_1fr]">
        <div className="animate-rise">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">NIST FIPS 203 · 204 · 205</Badge>
            <Badge tone="violet">IBM Bob-inspired agents</Badge>
            {settings.mode === 'demo' && <DemoBadge />}
          </div>
          <h1 className="mt-5 text-5xl font-black tracking-[0.06em] sm:text-6xl lg:text-7xl">
            <span className="text-gradient">QUANTUMSHIFT</span>
          </h1>
          <p className="mt-4 max-w-2xl text-xl font-semibold leading-snug text-slate-100 sm:text-2xl">Agentic PQC Migration of Enterprise Codebases using IBM Bob</p>
          <p className="mt-3 text-lg text-sky-300/90">From discovery to quantum-safe code in days.</p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-400">
            QuantumShift discovers every RSA, ECC, SHA-1 and hardcoded key across your codebases, builds a CycloneDX 1.5 CBOM, scores quantum exposure with Mosca's theorem,
            and lets Bob-style agents plan, patch and test the migration to ML-KEM and ML-DSA — with a human approving every change and every action recorded in BobShell.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button variant="primary" size="lg" icon={ScanSearch} onClick={() => nav('/discovery')}>Start Security Scan</Button>
            <Button size="lg" icon={LayoutDashboard} onClick={() => nav('/dashboard')}>View Executive Dashboard</Button>
            <Button size="lg" icon={Network} onClick={() => nav('/architecture')}>Explore Architecture</Button>
            <Button size="lg" variant="success" icon={Rocket} onClick={() => nav('/demo?autorun=1')}>Run Demo</Button>
          </div>
        </div>
        <PipelineVisual />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Live platform state</h2>
          <span className="text-[11px] text-slate-500">computed from the database · updates live</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard loading={loading} label="Repositories scanned" value={k?.repositoriesScanned} icon={GitBranch} tone="blue" hint={`${k?.repositories ?? '—'} registered`} onClick={() => nav('/discovery')} />
          <StatCard loading={loading} label="Cryptographic assets" value={k?.totalAssets} icon={Boxes} tone="violet" hint="in the CBOM" onClick={() => nav('/cbom')} />
          <StatCard loading={loading} label="High-risk assets" value={k?.high} icon={AlertOctagon} tone="red" hint="RED · immediate migration" onClick={() => nav('/risk')} />
          <StatCard loading={loading} label="PQC migration progress" value={k?.migrationProgress} suffix="%" icon={TrendingUp} tone="green" hint={`${k?.remediated ?? 0} of ${k?.vulnerable ?? 0} remediated`} onClick={() => nav('/planner')} />
          <StatCard loading={loading} label="Pending approvals" value={k?.pendingPRs} icon={Clock} tone="yellow" hint="human-in-the-loop" onClick={() => nav('/pull-requests')} />
          <StatCard loading={loading} label="Generated PRs" value={k?.generatedPRs} icon={GitPullRequest} tone="cyan" hint={`${k?.approvedPRs ?? 0} approved`} onClick={() => nav('/pull-requests')} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Core workflow</h2>
        <div className="grid gap-3 md:grid-cols-5">
          {PHASES.map((p, i) => (
            <Card key={p.key} hover className="group relative p-4">
              <button className="block w-full text-left" onClick={() => nav(p.to)}>
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/25 to-violet-500/25 text-sky-200 ring-1 ring-white/10"><p.icon size={17} /></span>
                  <span className="text-[11px] font-semibold text-slate-500">0{i + 1}</span>
                </div>
                <div className="mt-3 text-sm font-bold tracking-[0.14em] text-white">{p.key}</div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{p.text}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-[11px] text-sky-300 opacity-70 group-hover:opacity-100">Open <ArrowRight size={12} /></span>
              </button>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          { icon: Clock, title: 'Harvest now, decrypt later', text: 'Adversaries record encrypted traffic today and decrypt it once a cryptographically relevant quantum computer exists. Long-lived data is already exposed.' },
          { icon: ShieldAlert, title: "Mosca's theorem: X + Y > Z", text: `If data must stay secret for X years and migration takes Y years, you are late whenever X + Y exceeds Z — the years until a CRQC. Current assumption: Z = ${settings.moscaZ} years.` },
          { icon: ShieldCheck, title: 'Standards are final', text: 'NIST published FIPS 203 (ML-KEM), FIPS 204 (ML-DSA) and FIPS 205 (SLH-DSA) in August 2024; NIST IR 8547 proposes deprecating RSA/ECC after 2030.' },
        ].map((c) => (
          <Card key={c.title} className="p-5">
            <c.icon size={18} className="text-sky-300" />
            <div className="mt-3 text-sm font-semibold text-white">{c.title}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{c.text}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
