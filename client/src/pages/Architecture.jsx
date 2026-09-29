import { useState } from 'react';
import { GitBranch as Github, Container, Cloud, Users, MonitorSmartphone, Server, Database, Brain, ShieldAlert, Boxes, Code2, Wand2, FlaskConical, ScrollText, Gauge, Bot, ArrowDown, Layers, Radio } from 'lucide-react';
import { useApi } from '../context/AppContext';
import { Card, PageHeader, Badge, StatusBadge, cx } from '../components/ui';

const C = {
  github: { name: 'GitHub / GitLab', icon: Github, zone: 1, desc: 'Source repositories. Real Integration mode downloads public repository archives (HEAD) and scans them locally; Demo mode maps URLs to bundled sample codebases.', tech: ['codeload.github.com', 'GitLab archive API', 'ZIP upload (zip-slip protected)'] },
  docker: { name: 'Docker Hub / registries', icon: Container, zone: 1, desc: 'Container images: Dockerfile base images (runtime OpenSSL/Go/JDK versions) and build-time certificate generation are analysed.', tech: ['Dockerfile analyser', 'Demo registry images'] },
  aws: { name: 'AWS cloud infrastructure', icon: Cloud, zone: 1, desc: 'Cloud cryptographic inventory: KMS key specs, ACM certificates and load-balancer TLS policies.', tech: ['KMS', 'ACM', 'ELB policies (demo inventory)'] },
  users: { name: 'Users & roles', icon: Users, zone: 1, desc: 'CTO, CISO / Security Team, Developer and Auditor personas with role-based dashboards and permissions (demo SSO issuing signed JWTs).', tech: ['RBAC', 'JWT sessions', 'OIDC-ready'] },
  react: { name: 'React + Tailwind CSS', icon: MonitorSmartphone, zone: 2, service: 'frontend', desc: 'Role-based interactive UI: executive dashboard, discovery, CBOM explorer, risk, planner, Code Mode, PR hub, BobShell. Live updates over Server-Sent Events.', tech: ['React 19', 'Tailwind CSS 4', 'Recharts', 'Lucide', 'Vite'] },
  gateway: { name: 'Node.js + Express API Gateway', icon: Server, zone: 3, service: 'backend', desc: 'REST API with helmet secure headers, CORS allow-list, rate limiting, zod input validation, JWT authentication, role authorization and central error handling.', tech: ['Express 5', 'helmet', 'express-rate-limit', 'zod', 'SSE'] },
  scanner: { name: 'Scanner service', icon: Code2, zone: 3, service: 'ast', desc: 'AST parsing (Babel) for JS/TS, Semgrep-style PQC rules for Python/Go/Java, dependency, Dockerfile, config and X.509 analysers.', tech: ['@babel/parser', 'PQC rule pack', 'node:crypto X509'] },
  cbomsvc: { name: 'CBOM service', icon: Boxes, zone: 3, service: 'cbom', desc: 'Builds CycloneDX 1.5 cryptographic-asset components with evidence occurrences and exports the CBOM document.', tech: ['CycloneDX 1.5'] },
  remediation: { name: 'Remediation service', icon: Wand2, zone: 3, desc: 'Deterministic code transformations to ML-KEM / ML-DSA via generated liboqs-style adapters; unified diffs for review.', tech: ['diff', 'Adapters: node:crypto, liboqs-python, liboqs-go, Bouncy Castle'] },
  testing: { name: 'Testing service', icon: FlaskConical, zone: 3, service: 'testing', desc: 'Security re-scans, syntax checks, adapter execution and real ML-KEM / ML-DSA interoperability tests on OpenSSL 3.5.', tech: ['OpenSSL 3.5', 'FIPS 203/204 round-trips'] },
  auditsvc: { name: 'Audit service', icon: ScrollText, zone: 3, service: 'audit', desc: 'BobShell-style append-only log with a SHA-256 hash chain and verification endpoint.', tech: ['SHA-256 hash chain'] },
  postgres: { name: 'PostgreSQL', icon: Database, zone: 4, service: 'database', desc: 'System of record: users, repositories, crypto_assets, cbom_assets, risk_assessments, migration_plans, remediation_jobs, test_results, pull_requests, audit_logs, system_services. Uses DATABASE_URL, or embedded PostgreSQL (PGlite) when none is configured.', tech: ['PostgreSQL 14+', 'PGlite (embedded)'] },
  risk: { name: 'Risk Engine', icon: Gauge, zone: 4, service: 'risk', desc: "Mosca's theorem (X + Y > Z) combined with algorithm status and business criticality → RED / YELLOW / GREEN and a 0–100 risk score.", tech: ['Mosca', 'NIST IR 8547 timeline'] },
  bob: { name: 'IBM Bob Agent Layer', icon: Bot, zone: 4, service: 'agents', desc: 'Local, IBM Bob-inspired orchestration: Discovery, AST, Risk, Architect (Architect Mode), Refactoring & Test (Code Mode), Compliance and Audit (BobShell) agents. Not the IBM Bob product.', tech: ['Architect Mode', 'Code Mode', 'Ask Mode', 'BobShell'] },
  granite: { name: 'IBM Granite explanations', icon: Brain, zone: 4, desc: 'Plain-language risk explanations. Demo mode uses a template engine (clearly labelled); Real mode calls IBM Granite on watsonx.ai when WATSONX_API_KEY / WATSONX_PROJECT_ID are set.', tech: ['watsonx.ai (optional)', 'Template fallback'] },
};

const ZONES = [
  { n: 1, title: 'Input Sources & Users', items: ['github', 'docker', 'aws', 'users'] },
  { n: 2, title: 'Frontend / Presentation Layer', items: ['react'] },
  { n: 3, title: 'Backend / Application Layer', items: ['gateway', 'scanner', 'cbomsvc', 'remediation', 'testing', 'auditsvc'] },
  { n: 4, title: 'Data & IBM Bob AI Layer', items: ['postgres', 'risk', 'bob', 'granite'] },
];

export default function Architecture() {
  const [sel, setSel] = useState('gateway');
  const { data: health } = useApi('/system/health', []);
  const svc = Object.fromEntries((health?.services || []).map((s) => [s.key, s]));
  const cur = C[sel];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title="System Architecture" description="Four zones: input sources and users feed a React + Tailwind presentation layer, which talks to a Node.js + Express API gateway and microservices, backed by PostgreSQL, the Risk Engine and the IBM Bob-inspired agent layer. Click any component." />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-1">
          {ZONES.map((z, zi) => (
            <div key={z.n}>
              <Card className="p-4">
                <div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-violet-500 text-[11px] font-bold text-white">{z.n}</span><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">Zone {z.n} · {z.title}</span></div>
                <div className={cx('grid gap-2', z.items.length === 1 ? 'grid-cols-1' : z.items.length <= 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3')}>
                  {z.items.map((k) => {
                    const c = C[k];
                    const s = c.service && svc[c.service];
                    return (
                      <button key={k} onClick={() => setSel(k)} className={cx('group flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition', sel === k ? 'bg-sky-500/15 ring-sky-400/50' : 'bg-white/[0.03] ring-white/10 hover:bg-white/[0.06]')}>
                        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', sel === k ? 'bg-gradient-to-br from-sky-500 to-violet-500 text-white' : 'bg-white/5 text-sky-300')}><c.icon size={17} /></span>
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-100">{c.name}</span>{s && <span className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400"><span className={cx('h-1.5 w-1.5 rounded-full', s.status === 'ONLINE' ? 'bg-emerald-400' : s.status === 'WARNING' ? 'bg-amber-400' : 'bg-rose-400')} />{s.status}</span>}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
              {zi < ZONES.length - 1 && <div className="flex justify-center py-1"><div className="flex flex-col items-center"><div className="flow-line h-5 w-[2px]" /><ArrowDown size={14} className="text-sky-400" /></div></div>}
            </div>
          ))}
        </div>
        <Card className="h-fit p-5 xl:sticky xl:top-24">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-violet-500 text-white"><cur.icon size={20} /></span><div><div className="text-[11px] uppercase tracking-wider text-slate-400">Zone {cur.zone}</div><div className="text-base font-semibold text-white">{cur.name}</div></div></div>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">{cur.desc}</p>
          <div className="mt-4 flex flex-wrap gap-1.5">{cur.tech.map((t) => <Badge key={t} tone="blue">{t}</Badge>)}</div>
          {cur.service && svc[cur.service] && (
            <div className="mt-4 rounded-xl bg-white/[0.03] p-3 text-xs ring-1 ring-white/5">
              <div className="flex items-center gap-2 font-semibold text-slate-200"><Radio size={13} className="text-emerald-400" />Live status <StatusBadge status={svc[cur.service].status} /></div>
              <div className="mt-1 text-slate-400">{svc[cur.service].message}</div>
            </div>
          )}
          <div className="mt-5 border-t border-white/5 pt-4 text-[11px] leading-relaxed text-slate-500"><Layers size={12} className="mr-1 inline" />Request flow: UI → REST/SSE → gateway middleware (auth, RBAC, validation, rate limit) → service → PostgreSQL → events back to the UI; every agent step writes to BobShell.</div>
          <div className="mt-2 text-[11px] text-slate-500"><ShieldAlert size={12} className="mr-1 inline" />Secrets never reach the browser — API keys live only in server environment variables.</div>
        </Card>
      </div>
    </div>
  );
}
