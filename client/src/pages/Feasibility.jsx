import { useState } from 'react';
import { Binary, ShieldCheck, Boxes, Calculator, Users, Bot, FileCheck2, Rocket, Server, RefreshCw, Wifi, GraduationCap, Lock, Cable, UserCheck, ChevronDown, ArrowRight } from 'lucide-react';
import { Card, CardHeader, PageHeader, Badge, cx } from '../components/ui';

const SECTIONS = [
  { title: 'Feasibility', tone: 'blue', items: [
    { icon: Binary, name: 'Semantic AST Parsing', text: 'Real syntax trees (Babel for JS/TS) and language rule packs find crypto APIs with their enclosing function and data context — far fewer false positives than grep.' },
    { icon: ShieldCheck, name: 'Shift-left security', text: 'Scans run on source before deployment and every patch is re-scanned by the Test Agent, catching vulnerable cryptography in development rather than production.' },
    { icon: Boxes, name: 'CycloneDX 1.5 CBOM', text: 'An open, machine-readable Cryptography Bill of Materials that integrates with existing SBOM tooling and procurement evidence.' },
    { icon: Calculator, name: "Mosca's Theorem", text: 'A quantitative, explainable prioritisation model: X + Y > Z tells leadership which systems are already late.' },
  ] },
  { title: 'Viability', tone: 'violet', items: [
    { icon: Users, name: 'Role-based interactive UI', text: 'CTO, CISO, Developer and Auditor each get a purpose-built view — executives see posture, engineers see diffs.' },
    { icon: Bot, name: 'Agentic productivity', text: 'Bob-style agents take migration from weeks of manual inventory to minutes: discovery, planning, patches and tests are generated automatically for human review.' },
    { icon: FileCheck2, name: 'Proactive compliance', text: 'Changes are checked against FIPS 203/204, NIST IR 8547 deprecation timelines and CNSA 2.0, with a tamper-evident audit trail for regulators.' },
  ] },
  { title: 'Practical implementation', tone: 'green', items: [
    { icon: Rocket, name: 'Quick rollout', text: 'One Node.js service plus PostgreSQL (or embedded PostgreSQL for pilots). No agents to install on developer machines.' },
    { icon: Server, name: 'On-premise security', text: 'Source code is scanned locally and never leaves the environment; AI integrations are optional and off by default.' },
    { icon: RefreshCw, name: 'Incremental scanning', text: 'Fingerprinted findings are upserted per scan, preserving remediation state so re-scans only surface what changed.' },
  ] },
];

const CHALLENGES = [
  { challenge: 'Connectivity', icon: Wifi, problem: 'Air-gapped or restricted networks cannot reach cloud AI services or public registries.', strategy: 'Localized Scanning', sIcon: Server, how: 'All scanning, CBOM generation, risk scoring, patch generation and PQC tests run locally on the QuantumShift server; external AI is optional and falls back to local templates.' },
  { challenge: 'Adoption', icon: GraduationCap, problem: 'Developers are unfamiliar with ML-KEM / ML-DSA and wary of AI-generated code.', strategy: 'Training & Champions', sIcon: Users, how: 'Plain-language explanations, change rationales and confidence scores teach as they fix; PQC champions per team own reviews in the PR hub.' },
  { challenge: 'Data Privacy', icon: Lock, problem: 'Proprietary source code and secrets must not leak to third parties.', strategy: 'Secure Sandboxes', sIcon: ShieldCheck, how: 'Uploads are extracted into an isolated workspace with zip-slip protection; secrets are redacted in findings; generated adapters execute in temporary sandboxed modules.' },
  { challenge: 'Legacy System Durability', icon: Cable, problem: 'Old runtimes (Java 8, Bouncy Castle 1.60, Node 18) lack PQC primitives.', strategy: 'Adaptable Middleware', sIcon: Cable, how: 'Generated liboqs-style adapters isolate PQC behind one interface per language; hybrid-first plans keep classical fallbacks while runtimes are upgraded.' },
  { challenge: 'Integration / Trust', icon: UserCheck, problem: 'Enterprises cannot let an AI agent merge security-critical changes on its own.', strategy: 'Human Checkpoints', sIcon: UserCheck, how: 'Every patch becomes a PR requiring CISO or code-owner approval; the Compliance Agent and BobShell hash chain provide evidence for every decision.' },
];

const TONE = { blue: 'from-sky-500/25 text-sky-300', violet: 'from-violet-500/25 text-violet-300', green: 'from-emerald-500/25 text-emerald-300' };

export default function Feasibility() {
  const [open, setOpen] = useState(0);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title="Feasibility & Viability" description="Why QuantumShift is technically feasible, commercially viable and practical to implement — and how it addresses the main adoption challenges." />
      <div className="grid gap-4 xl:grid-cols-3">
        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <CardHeader title={s.title.toUpperCase()} />
            <div className="space-y-3 p-4">
              {s.items.map((it) => (
                <div key={it.name} className="flex gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                  <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br to-transparent', TONE[s.tone])}><it.icon size={17} /></span>
                  <div><div className="text-sm font-semibold text-white">{it.name}</div><p className="mt-1 text-xs leading-relaxed text-slate-400">{it.text}</p></div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title="Challenges & Solutions" subtitle="Expand a challenge to see its mitigation strategy" />
        <div className="divide-y divide-white/5">
          {CHALLENGES.map((c, i) => (
            <div key={c.challenge}>
              <button onClick={() => setOpen(open === i ? -1 : i)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-4 text-left hover:bg-white/[0.02] md:grid-cols-[auto_1fr_auto_1fr_auto]" aria-expanded={open === i}>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500/15 text-rose-300"><c.icon size={17} /></span>
                <span><span className="text-[10px] uppercase tracking-wider text-slate-500">Challenge {i + 1}</span><span className="block text-sm font-semibold text-white">{c.challenge}</span></span>
                <ArrowRight size={16} className="hidden text-slate-500 md:block" />
                <span className="hidden items-center gap-2 md:flex"><Badge tone="green">Strategy {i + 1}</Badge><span className="text-sm font-semibold text-emerald-200">{c.strategy}</span></span>
                <ChevronDown size={16} className={cx('text-slate-400 transition', open === i && 'rotate-180')} />
              </button>
              {open === i && (
                <div className="grid animate-rise gap-3 px-5 pb-5 md:grid-cols-2">
                  <div className="rounded-xl bg-rose-500/5 p-4 ring-1 ring-rose-500/20"><div className="text-[11px] font-semibold uppercase tracking-wider text-rose-300">The challenge</div><p className="mt-1.5 text-sm text-slate-200">{c.problem}</p></div>
                  <div className="rounded-xl bg-emerald-500/5 p-4 ring-1 ring-emerald-500/20"><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-300"><c.sIcon size={13} />{c.strategy}</div><p className="mt-1.5 text-sm text-slate-200">{c.how}</p></div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
