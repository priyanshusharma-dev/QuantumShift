import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch as Github, GitMerge as Gitlab, Upload, Container, Cloud, Play, Eye, Trash2, Radar, CheckCircle2, FileArchive, Boxes, Code2, ScanSearch } from 'lucide-react';
import { useApi, useApp, useJob } from '../context/AppContext';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, Tabs, Field, Select, inputCls, Badge, StatusBadge, Loading, ErrorState, EmptyState, DemoBadge, Th, Td, cx } from '../components/ui';
import { JobSteps } from '../components/JobSteps';

const TARGETS = ['RSA', 'ECC', 'ECDSA', 'SHA-1', 'Hardcoded keys', 'Certificates', 'Crypto libraries', 'Crypto API calls', 'Dependencies', 'Docker configurations'];
const STAGES = [
  { key: 'ingestion', label: 'Repository ingestion' }, { key: 'ast', label: 'AST parsing' }, { key: 'semantic', label: 'Semantic analysis' },
  { key: 'detection', label: 'Cryptographic API detection' }, { key: 'dependencies', label: 'Dependency analysis' }, { key: 'cbom', label: 'CBOM generation' },
];
const SOURCE_ICON = { github: Github, gitlab: Gitlab, upload: FileArchive, docker: Container, cloud: Cloud, demo: Boxes };

function RiskProfileFields({ v, set }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Business criticality"><Select value={v.criticality} onChange={(x) => set({ ...v, criticality: x })} options={['critical', 'high', 'medium', 'low']} /></Field>
      <Field label="Data lifetime X (years)" hint="How long data must stay secure"><input className={inputCls} type="number" min={0} max={200} value={v.dataLifetimeYears} onChange={(e) => set({ ...v, dataLifetimeYears: e.target.value })} /></Field>
      <Field label="Migration time Y (years)" hint="Estimated effort to migrate"><input className={inputCls} type="number" min={0} max={200} step="0.5" value={v.migrationTimeYears} onChange={(e) => set({ ...v, migrationTimeYears: e.target.value })} /></Field>
    </div>
  );
}

function AddSource({ onAdded }) {
  const { settings, notifyError, toast, can } = useApp();
  const { data: sources } = useApi('/sources', []);
  const [tab, setTab] = useState('git');
  const [busy, setBusy] = useState(false);
  const [git, setGit] = useState({ sourceType: 'github', url: '', name: '' });
  const [file, setFile] = useState(null);
  const [image, setImage] = useState('');
  const [cloud, setCloud] = useState('aws-demo-us-east-1');
  const [profile, setProfile] = useState({ criticality: 'high', dataLifetimeYears: 7, migrationTimeYears: 2 });
  const [err, setErr] = useState(null);
  useEffect(() => { if (sources?.dockerImages?.length && !image) setImage(sources.dockerImages[0].image); }, [sources, image]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!can('repo:manage')) return notifyError(new Error('Auditors have read-only access.'), 'Permission required');
    const prof = { criticality: profile.criticality, dataLifetimeYears: Number(profile.dataLifetimeYears), migrationTimeYears: Number(profile.migrationTimeYears) };
    try {
      setBusy(true);
      let repo;
      if (tab === 'git') {
        if (!/^https:\/\/(github|gitlab)\.com\/[\w.-]+\/[\w.-]+/.test(git.url.trim())) { setErr('Enter a repository URL like https://github.com/owner/repo'); return; }
        const sourceType = git.url.includes('gitlab.com') ? 'gitlab' : 'github';
        repo = await api('/repositories', { method: 'POST', body: { sourceType, url: git.url.trim(), ...(git.name.trim() ? { name: git.name.trim() } : {}), ...prof } });
      } else if (tab === 'upload') {
        if (!file) { setErr('Choose a .zip archive'); return; }
        if (!file.name.toLowerCase().endsWith('.zip')) { setErr('Only .zip archives are supported'); return; }
        const fd = new FormData();
        fd.append('archive', file);
        Object.entries(prof).forEach(([k, v]) => fd.append(k, v));
        repo = await api('/repositories/upload', { method: 'POST', body: fd });
      } else if (tab === 'docker') {
        repo = await api('/repositories', { method: 'POST', body: { sourceType: 'docker', dockerImage: image, ...prof } });
      } else {
        repo = await api('/repositories', { method: 'POST', body: { sourceType: 'cloud', cloudSource: cloud, ...prof } });
      }
      toast({ type: 'success', title: 'Source registered', message: `${repo.name}${repo.simulated_ingestion ? ' — simulated ingestion (demo mode)' : ''}. Starting scan…` });
      setGit({ ...git, url: '', name: '' });
      setFile(null);
      onAdded(repo);
    } catch (e2) {
      setErr(e2.message);
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="Add a source" subtitle="GitHub/GitLab repositories, source ZIPs, Docker registries and AWS/cloud inventories" icon={Radar} actions={settings.mode === 'demo' && <DemoBadge />} />
      <form onSubmit={submit} className="space-y-4 p-5">
        <Tabs value={tab} onChange={(t) => { setTab(t); setErr(null); }} tabs={[{ value: 'git', label: 'GitHub / GitLab', icon: Github }, { value: 'upload', label: 'Upload ZIP', icon: Upload }, { value: 'docker', label: 'Docker image', icon: Container }, { value: 'cloud', label: 'Cloud source', icon: Cloud }]} />
        {tab === 'git' && (
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field label="Repository URL" hint={settings.mode === 'real' ? 'Real mode: the public HEAD archive is downloaded and scanned locally.' : 'Demo mode: ingestion is simulated with a bundled sample codebase.'}>
              <input className={inputCls} placeholder="https://github.com/acme/payments-service" value={git.url} onChange={(e) => setGit({ ...git, url: e.target.value })} />
            </Field>
            <Field label="Display name (optional)"><input className={inputCls} placeholder="Payments Service" value={git.name} onChange={(e) => setGit({ ...git, name: e.target.value })} /></Field>
          </div>
        )}
        {tab === 'upload' && (
          <Field label="Source archive (.zip)" hint="Extracted with zip-slip protection and scanned locally — never sent to a third party.">
            <label className={cx('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center hover:border-sky-400/40', file && 'border-sky-400/40')}>
              <Upload size={20} className="text-sky-300" />
              <span className="text-sm text-slate-200">{file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : 'Click to choose a ZIP of your source code'}</span>
              <input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </Field>
        )}
        {tab === 'docker' && (
          <Field label="Registry image" hint={settings.mode === 'real' ? 'Real mode requires Docker Engine / registry credentials, which are not configured.' : 'Demo registry: layers are simulated from bundled source + Dockerfiles.'}>
            <Select value={image} onChange={setImage} options={(sources?.dockerImages || []).map((d) => ({ value: d.image, label: `${d.image} (${d.name})` }))} />
          </Field>
        )}
        {tab === 'cloud' && (
          <Field label="Cloud source" hint="Scans KMS key specs, ACM certificates and load-balancer TLS policies (synthetic demo inventory).">
            <Select value={cloud} onChange={setCloud} options={(sources?.cloudSources || []).map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
        )}
        <RiskProfileFields v={profile} set={setProfile} />
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">{err}</div>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">{TARGETS.map((t) => <Badge key={t} tone="blue">{t}</Badge>)}</div>
          <Button type="submit" variant="primary" icon={ScanSearch} loading={busy}>Add &amp; start scan</Button>
        </div>
      </form>
    </Card>
  );
}

export default function Discovery() {
  const nav = useNavigate();
  const { notifyError, toast, can } = useApp();
  const { data: repos, loading, error, reload } = useApi('/repositories', ['repositories', 'assets']);
  const [jobId, setJobId] = useState(null);
  const job = useJob(jobId);

  const scan = async (repo) => {
    try {
      const r = await api('/scan', { method: 'POST', body: { repositoryId: repo.id } });
      setJobId(r.jobId);
      document.getElementById('scan-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { notifyError(e, 'Scan could not start'); }
  };
  const remove = async (repo) => {
    if (!window.confirm(`Remove ${repo.name} and all of its findings?`)) return;
    try { await api(`/repositories/${repo.id}`, { method: 'DELETE' }); toast({ type: 'success', title: 'Repository removed', message: repo.name }); reload(); } catch (e) { notifyError(e); }
  };
  useEffect(() => {
    if (job?.status === 'completed') toast({ type: 'success', title: 'Scan complete', message: `${job.result.repository}: ${job.result.assets} assets · RED ${job.result.counts.RED} · YELLOW ${job.result.counts.YELLOW} · GREEN ${job.result.counts.GREEN}` });
    if (job?.status === 'failed') notifyError(new Error(job.error), 'Scan failed');
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Phase 1 · Discover" title="Repository Discovery" description="Ingest enterprise sources and run the six-stage discovery pipeline: ingestion → AST parsing → semantic analysis → crypto API detection → dependency analysis → CBOM generation." />
      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <AddSource onAdded={(repo) => { reload(); scan(repo); }} />
        <Card id="scan-panel">
          <CardHeader title="Live scan pipeline" subtitle={job ? `${job.title} · ${job.status}` : 'Start a scan to watch each stage run'} icon={Radar}
            actions={job?.meta?.simulated && <Badge tone="violet">simulated ingestion</Badge>} />
          <div className="p-4">
            <JobSteps job={job} steps={STAGES} />
            {job?.status === 'completed' && (
              <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
                <div className="flex items-center gap-2 font-semibold text-emerald-200"><CheckCircle2 size={16} /> {job.result.repository} scanned in {job.result.stats.durationMs} ms</div>
                <div className="mt-1 text-xs text-emerald-100/80">{job.result.stats.files} files · {job.result.stats.loc} lines · {job.result.assets} assets · {job.result.vulnerable} vulnerable · {job.result.cbomComponents} CBOM components</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" icon={Eye} onClick={() => nav(`/repositories/${job.result.repositoryId}`)}>Drill down</Button>
                  <Button size="sm" icon={Code2} onClick={() => nav(`/ast-scanner?repositoryId=${job.result.repositoryId}`)}>AST findings</Button>
                  <Button size="sm" icon={Boxes} onClick={() => nav(`/cbom?repositoryId=${job.result.repositoryId}`)}>CBOM</Button>
                </div>
              </div>
            )}
            {job?.status === 'failed' && <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{job.error}</div>}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Registered repositories" subtitle="Bundled demo repositories are sample enterprise codebases with intentionally vulnerable cryptography (no real secrets)." icon={Boxes} />
        {loading ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !repos.length ? (
          <EmptyState title="No repositories yet" message="Add a GitHub/GitLab URL, upload a ZIP, pick a Docker image or a cloud source above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead><tr className="border-b border-white/5"><Th>Repository</Th><Th>Source</Th><Th>Language</Th><Th>Criticality</Th><Th>X / Y</Th><Th>Risk</Th><Th>Status</Th><Th>Last scan</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {repos.map((r) => {
                  const Icon = SOURCE_ICON[r.source_type] || Boxes;
                  return (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <Td>
                        <button className="text-left" onClick={() => nav(`/repositories/${r.id}`)}>
                          <div className="font-semibold text-slate-100 hover:text-sky-300">{r.name}</div>
                          <div className="max-w-[320px] truncate text-[11px] text-slate-500" title={r.description}>{r.description}</div>
                        </button>
                      </Td>
                      <Td><div className="flex items-center gap-1.5 text-xs text-slate-300"><Icon size={14} />{r.source_type}</div>{r.simulated_ingestion && <Badge tone="violet" className="mt-1">simulated</Badge>}</Td>
                      <Td className="text-xs">{r.primary_language || '—'}</Td>
                      <Td><Badge tone={r.criticality === 'critical' ? 'red' : r.criticality === 'high' ? 'yellow' : 'slate'}>{r.criticality}</Badge></Td>
                      <Td className="text-xs tabular-nums text-slate-300">{r.data_lifetime_years}y / {r.migration_time_years}y</Td>
                      <Td>
                        <div className="flex gap-1 text-[11px] font-semibold tabular-nums">
                          <span className="rounded bg-rose-500/15 px-1.5 text-rose-300" title="RED">{r.red} R</span>
                          <span className="rounded bg-amber-500/15 px-1.5 text-amber-300" title="YELLOW">{r.yellow} Y</span>
                          <span className="rounded bg-emerald-500/15 px-1.5 text-emerald-300" title="GREEN">{r.green} G</span>
                        </div>
                      </Td>
                      <Td><StatusBadge status={r.status === 'scanned' ? 'completed' : r.status === 'scanning' ? 'running' : r.status} label={r.status} /></Td>
                      <Td className="text-xs text-slate-400">{timeAgo(r.last_scan_at)}</Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="primary" icon={Play} disabled={r.status === 'scanning' || !can('scan:run')} title={can('scan:run') ? 'Start scan' : 'Auditors cannot start scans'} onClick={() => scan(r)}>Scan</Button>
                          <Button size="sm" icon={Eye} onClick={() => nav(`/repositories/${r.id}`)}>View</Button>
                          {!r.is_demo && can('settings:write') && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove" onClick={() => remove(r)} />}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
