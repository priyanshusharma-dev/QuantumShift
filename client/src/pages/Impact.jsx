import { Code2, ShieldCheck, Landmark, Briefcase, Users, HeartHandshake, TrendingUp, Globe2, Wand2, FlaskConical, GitPullRequest, Boxes } from 'lucide-react';
import { useApi } from '../context/AppContext';
import { Card, CardHeader, PageHeader, StatCard } from '../components/ui';

const STAKEHOLDERS = [
  { icon: Code2, who: 'Developers', benefits: ['Exact file, line and function for every vulnerable call', 'Ready-to-review ML-KEM / ML-DSA patches with explanations', 'Automated tests instead of manual crypto research'] },
  { icon: ShieldCheck, who: 'Security Teams / CISOs', benefits: ['Complete CBOM of cryptographic assets', 'Quantified, explainable risk (Mosca)', 'Human approval gates and compliance evidence'] },
  { icon: Landmark, who: 'National Intelligence', benefits: ['Reduced harvest-now-decrypt-later exposure of sensitive data', 'Alignment with CNSA 2.0 and NIST IR 8547 timelines', 'Auditable migration of critical infrastructure'] },
  { icon: Briefcase, who: 'Enterprise Leadership / CTOs', benefits: ['Portfolio-wide migration progress at a glance', 'Effort and timeline estimates per phase', 'Lower cost and risk of a mandatory transition'] },
  { icon: Users, who: 'Citizens / End Users', benefits: ['Health, financial and identity data stays confidential for decades', 'Trust in digital public services', 'No disruption thanks to hybrid-first rollout'] },
];

const DOMAINS = [
  { icon: HeartHandshake, title: 'Security & Social', text: 'Protects long-lived personal data — medical records, identities, financial histories — against future quantum decryption, preserving public trust in digital services.' },
  { icon: TrendingUp, title: 'Economic', text: 'Turns a multi-year manual migration into an agent-assisted programme, reducing engineering cost, avoiding breach and compliance penalties, and de-risking vendor timelines.' },
  { icon: Globe2, title: 'Digital Ecosystem', text: 'Open standards (CycloneDX CBOM, NIST FIPS 203/204) make results portable across suppliers, strengthening the whole software supply chain’s crypto-agility.' },
];

export default function Impact() {
  const { data } = useApi('/dashboard/summary', ['dashboard']);
  const k = data?.kpis;
  const callSites = k ? k.patches : 0;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title="Impact & Benefits" description="Who benefits from agentic PQC migration, and how — with live platform metrics showing the work agents have already done in this environment." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Crypto assets catalogued" value={k?.totalAssets} icon={Boxes} tone="violet" hint="automatically, via AST + rules" />
        <StatCard label="Patches generated" value={callSites} icon={Wand2} tone="blue" hint="by the Code Refactoring Agent" />
        <StatCard label="Tests executed" value={k?.testsTotal} icon={FlaskConical} tone="cyan" hint={`${k?.testsRealPct ?? 0}% actually executed`} />
        <StatCard label="PRs for human review" value={k?.generatedPRs} icon={GitPullRequest} tone="green" hint={`${k?.approvedPRs ?? 0} approved`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {STAKEHOLDERS.map((s) => (
          <Card key={s.who} hover className="p-5">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/30 to-violet-500/30 text-sky-200 ring-1 ring-white/10"><s.icon size={20} /></span>
            <div className="mt-4 text-sm font-bold text-white">{s.who}</div>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-300">{s.benefits.map((b) => <li key={b} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />{b}</li>)}</ul>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title="Impact domains" />
        <div className="grid gap-4 p-5 md:grid-cols-3">
          {DOMAINS.map((d) => (
            <div key={d.title} className="rounded-2xl bg-gradient-to-br from-white/[0.05] to-transparent p-5 ring-1 ring-white/10">
              <d.icon size={22} className="text-violet-300" />
              <div className="mt-3 text-base font-semibold text-white">{d.title}</div>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{d.text}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
