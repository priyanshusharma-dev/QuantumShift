import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Wand2, Brain, FlaskConical, GitPullRequest, Trash2, FileCode2, Sparkles, ShieldCheck, FilePlus2, ArrowRight, Info, Bot } from 'lucide-react';
import { useApi, useApp, useJob } from '../context/AppContext';
import { api } from '../lib/api';
import { STATUS_LABEL, timeAgo } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, RiskBadge, Badge, StatusBadge, ExecBadge, Loading, EmptyState, ProgressBar, Tabs, StepIcon, cx, inputCls, DemoBadge } from '../components/ui';
import { CodeView, DiffView } from '../components/Code';

const NON_CODE = /package\.json$/;

function TargetList({ assets, selectedAsset, onPick }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const g = {};
    for (const a of assets.filter((x) => !q || `${x.repository_name} ${x.file_path} ${x.algorithm}`.toLowerCase().includes(q.toLowerCase()))) (g[a.repository_name] ||= []).push(a);
    return g;
  }, [assets, q]);
  return (
    <Card className="flex max-h-[780px] flex-col">
      <CardHeader title="Remediation targets" subtitle="Open RED / YELLOW call sites" icon={FileCode2} />
      <div className="p-3"><input className={inputCls} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter targets" /></div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {!Object.keys(groups).length && <EmptyState title="No open targets" message="Everything is patched, in review or remediated." />}
        {Object.entries(groups).map(([repo, list]) => (
          <div key={repo} className="mb-3">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{repo}</div>
            {list.map((a) => (
              <button key={a.id} onClick={() => onPick(a)} className={cx('mb-1 w-full rounded-lg px-2.5 py-2 text-left transition', selectedAsset === a.id ? 'bg-sky-500/15 ring-1 ring-sky-400/40' : 'hover:bg-white/5')}>
                <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-slate-100">{a.algorithm}</span><RiskBadge level={a.risk_level} /></div>
                <div className="code-font mt-0.5 truncate text-[10.5px] text-slate-400">{a.file_path}:{a.line}</div>
                {a.status === 'patch_generated' && <Badge tone="blue" className="mt-1">patch generated</Badge>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Thinking() {
  const steps = ['Reading call sites and enclosing functions', 'Selecting ML-KEM / ML-DSA targets (FIPS 203 / 204)', 'Rewriting code with the liboqs-style adapter', 'Computing unified diff'];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 350); return () => clearInterval(t); }, [steps.length]);
  return (
    <div className="space-y-2 p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-violet-200"><Bot size={16} className="animate-pulse-soft" /> Code Refactoring Agent · Code Mode</div>
      {steps.map((s, k) => <div key={s} className="flex items-center gap-2 text-xs text-slate-300"><StepIcon status={k < i ? 'done' : k === i ? 'running' : 'pending'} size={14} />{s}</div>)}
      <ProgressBar value={((i + 1) / steps.length) * 100} animated />
    </div>
  );
}

export default function CodeMode() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can, notifyError, toast, settings } = useApp();
  const assetParam = Number(params.get('asset')) || null;
  const jobParam = Number(params.get('job')) || null;
  const { data: allAssets, loading: la } = useApi('/assets', ['assets', 'risks']);
  const { data: jobs, reload: reloadJobs } = useApi('/remediation/jobs', ['remediation']);
  const { data: job, setData: setJob, loading: lj } = useApi(jobParam ? `/remediation/jobs/${jobParam}` : null, ['remediation']);
  const { data: assetDetail } = useApi(assetParam && !jobParam ? `/assets/${assetParam}` : null, []);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState('diff');
  const [explanation, setExplanation] = useState(null);
  const [testJobId, setTestJobId] = useState(null);
  const [extraJobs, setExtraJobs] = useState([]);
  const testJob = useJob(testJobId);

  const targets = useMemo(() => (allAssets || []).filter((a) => ['RED', 'YELLOW'].includes(a.risk_level) && ['open', 'patch_generated'].includes(a.status) && !a.file_path.startsWith('aws://') && !NON_CODE.test(a.file_path)), [allAssets]);
  useEffect(() => { setExplanation(job?.explanation || null); setTab('diff'); setTestJobId(null); setExtraJobs([]); }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (a) => {
    const existing = (jobs || []).find((j) => j.asset_ids.includes(a.id) && ['generated', 'tested', 'changes_requested'].includes(j.status));
    setParams(existing ? { job: existing.id } : { asset: a.id });
  };
  const generate = async () => {
    const assetId = assetParam || job?.asset_ids?.[0];
    if (!assetId) return;
    setBusy('generate');
    try {
      const [r] = await Promise.all([api('/remediation/generate', { method: 'POST', body: { assetId } }), new Promise((res) => setTimeout(res, 1400))]);
      toast({ type: 'success', title: 'PQC patch generated', message: `${r.changes.length} change(s) in ${r.file_path} · confidence ${Math.round(r.confidence * 100)}%` });
      reloadJobs();
      setParams({ job: r.id });
    } catch (e) { notifyError(e, 'Patch generation failed'); } finally { setBusy(''); }
  };
  const explain = async () => {
    setBusy('explain');
    try { setExplanation(await api(`/remediation/jobs/${job.id}/explain`, { method: 'POST' })); setTab('explain'); } catch (e) { notifyError(e); } finally { setBusy(''); }
  };
  const runTests = async () => {
    setTab('tests');
    try { setTestJobId((await api('/tests/run', { method: 'POST', body: { remediationJobIds: [job.id, ...extraJobs], suite: 'all' } })).jobId); } catch (e) { notifyError(e, 'Tests could not start'); }
  };
  const createPr = async () => {
    setBusy('pr');
    try {
      const pr = await api('/pull-requests', { method: 'POST', body: { remediationJobIds: [job.id, ...extraJobs], ...(testJob?.result?.runId ? { testRunId: testJob.result.runId } : {}) } });
      toast({ type: 'success', title: `Pull request #${pr.number} created (simulated)`, message: 'Human approval required before merge.' });
      nav(`/pull-requests?pr=${pr.id}`);
    } catch (e) { notifyError(e, 'PR creation failed'); } finally { setBusy(''); }
  };
  const discard = async () => {
    if (!window.confirm('Discard this patch? The assets return to Open.')) return;
    try { await api(`/remediation/jobs/${job.id}/discard`, { method: 'POST' }); toast({ type: 'success', title: 'Patch discarded' }); setParams({}); reloadJobs(); } catch (e) { notifyError(e); }
  };

  const siblings = (jobs || []).filter((j) => job && j.id !== job.id && j.repository_id === job.repository_id && ['generated', 'tested'].includes(j.status));
  const locked = job && ['in_review', 'merged', 'rejected', 'discarded'].includes(job.status);
  const results = testJob?.meta?.results || [];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Phase 4 · Remediate" title="AI Remediation · Code Mode"
        description="Bob-style Code Mode rewrites RSA / ECDSA / ECDH call sites to ML-KEM-768 and ML-DSA-65 through a generated liboqs-style adapter (node:crypto on OpenSSL 3.5 for JS/TS, liboqs-python, liboqs-go, Bouncy Castle), plus SHA-1/MD5/3DES/AES-128 and hardcoded-key fixes."
        badges={<>{settings.mode === 'demo' && <DemoBadge />}<Badge tone="slate"><Info size={11} />Patches are proposals — no repository is modified; PRs are simulated</Badge></>} />
      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        {la ? <Card><Loading /></Card> : <TargetList assets={targets} selectedAsset={assetParam || job?.asset_ids?.[0]} onPick={pick} />}
        <div className="min-w-0 space-y-4">
          {!assetParam && !jobParam && (
            <Card><EmptyState icon={Wand2} title="Pick a target to migrate" message="Select an open RED/YELLOW call site on the left, or a recent patch below. Bob will propose a quantum-safe rewrite with a side-by-side diff." /></Card>
          )}

          {assetParam && !jobParam && assetDetail && (
            <Card>
              <CardHeader title={`${assetDetail.asset.algorithm} · ${assetDetail.asset.file_path}:${assetDetail.asset.line}`} subtitle={`${assetDetail.repository.name} · ${assetDetail.asset.function_name} · target ${assetDetail.asset.target_algorithm}`} icon={FileCode2}
                actions={<Button variant="primary" icon={Sparkles} loading={busy === 'generate'} disabled={!can('remediation:generate')} title={can('remediation:generate') ? '' : 'Developer or CISO role required'} onClick={generate}>Generate Patch</Button>} />
              {busy === 'generate' ? <Thinking /> : (
                <div className="p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-slate-400"><RiskBadge level={assetDetail.risk?.risk_level} score={assetDetail.risk?.risk_score} /> BEFORE — current vulnerable code</div>
                  {assetDetail.context ? <CodeView lines={assetDetail.context.lines} start={assetDetail.context.start} language={assetDetail.asset.language} highlightLines={[assetDetail.asset.line]} /> : <div className="text-xs text-slate-400">{assetDetail.asset.api_call}</div>}
                  <p className="mt-3 text-xs text-slate-400">All open vulnerable call sites in this file are migrated together so the file stays consistent.</p>
                </div>
              )}
            </Card>
          )}

          {jobParam && (lj && !job ? <Card><Loading /></Card> : job && (
            <Card>
              <CardHeader title={`Patch #${job.id} · ${job.file_path}`} subtitle={`${job.repository_name} · ${job.language} · ${job.changes.length} change(s) · confidence ${Math.round(job.confidence * 100)}% · ${job.explanation?.adapter || ''}`} icon={Wand2}
                actions={<>
                  <StatusBadge status={job.status} label={STATUS_LABEL[job.status]} />
                  <Button icon={Brain} loading={busy === 'explain'} onClick={explain}>Explain Changes</Button>
                  <Button icon={FlaskConical} disabled={locked || !can('tests:run') || testJob?.status === 'running'} onClick={runTests}>Run Tests</Button>
                  <Button variant="primary" icon={GitPullRequest} loading={busy === 'pr'} disabled={locked || !can('pr:create')} title={locked ? 'Already in a PR' : can('pr:create') ? '' : 'Developer or CISO role required'} onClick={createPr}>Create Pull Request</Button>
                  {!locked && can('remediation:generate') && <Button variant="ghost" icon={Trash2} aria-label="Discard patch" onClick={discard} />}
                </>} />
              <div className="border-b border-white/5 px-4 py-3">
                <Tabs value={tab} onChange={setTab} tabs={[
                  { value: 'diff', label: 'Side-by-side diff' }, { value: 'changes', label: 'Changes', count: job.changes.length },
                  ...job.extra_files.map((f, i) => ({ value: `extra-${i}`, label: f.path.split('/').pop(), icon: FilePlus2 })),
                  { value: 'explain', label: 'Explanation' }, { value: 'tests', label: 'Tests', count: results.length || undefined },
                ]} />
              </div>
              <div className="p-4">
                {tab === 'diff' && <DiffView before={job.before_code} after={job.after_code} language={job.language} beforeLabel={`BEFORE · ${job.file_path}`} afterLabel="AFTER · PQC-compatible implementation" />}
                {tab === 'changes' && (
                  <div className="space-y-2">
                    {job.changes.map((c) => (
                      <div key={`${c.assetId}-${c.line}`} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge tone="blue">{c.ruleId}</Badge><span className="code-font text-xs text-slate-400">line {c.line} · {c.functionName}</span>
                          <span className="font-semibold text-rose-200">{c.from}</span><ArrowRight size={14} className="text-slate-500" /><span className="font-semibold text-emerald-200">{c.to}</span>
                          <Badge tone={c.confidence >= 0.85 ? 'green' : c.confidence >= 0.7 ? 'yellow' : 'red'} className="ml-auto">confidence {Math.round(c.confidence * 100)}%</Badge>
                          <Badge>{c.standard}</Badge>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{c.rationale}</p>
                      </div>
                    ))}
                  </div>
                )}
                {tab.startsWith('extra-') && (() => {
                  const f = job.extra_files[Number(tab.split('-')[1])];
                  return <><div className="mb-2 flex items-center gap-2 text-xs text-slate-400"><Badge tone="green">new file</Badge><span className="code-font">{f.path}</span> — {f.reason}</div><CodeView code={f.content} language={/\.py$/.test(f.path) ? 'Python' : /\.md$/.test(f.path) ? 'Config' : job.language} maxHeight={520} /></>;
                })()}
                {tab === 'explain' && (explanation ? (
                  <div className="rounded-xl border border-violet-400/20 bg-violet-500/10 p-4 text-sm">
                    <div className="mb-2 flex items-center gap-2"><Brain size={16} className="text-violet-300" /><span className="font-semibold text-violet-100">Change explanation</span><DemoBadge>AI-generated — Demo Mode</DemoBadge></div>
                    <p className="leading-relaxed text-slate-100">{explanation.summary}</p>
                    <ul className="mt-3 space-y-1.5 text-xs text-slate-300">{(explanation.changes || []).map((c) => <li key={c}>{c}</li>)}</ul>
                    <p className="mt-3 text-xs text-slate-300"><span className="font-semibold text-slate-100">Compatibility:</span> {explanation.compatibility}</p>
                    <p className="mt-1 text-xs text-slate-300"><span className="font-semibold text-slate-100">Review notes:</span> {explanation.reviewNotes}</p>
                    <p className="mt-3 text-[10px] text-slate-500">{explanation.label}</p>
                  </div>
                ) : <EmptyState icon={Brain} title="No explanation yet" action={<Button icon={Brain} onClick={explain}>Explain Changes</Button>} />)}
                {tab === 'tests' && (
                  <div className="space-y-3">
                    {siblings.length > 0 && !locked && (
                      <div className="rounded-lg bg-white/[0.03] p-3 text-xs ring-1 ring-white/5">
                        <div className="mb-1.5 font-semibold text-slate-200">Include other patches from {job.repository_name} in tests & PR</div>
                        <div className="flex flex-wrap gap-3">{siblings.map((s) => (
                          <label key={s.id} className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" className="accent-sky-500" checked={extraJobs.includes(s.id)} onChange={() => setExtraJobs((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))} /><span className="code-font">#{s.id} {s.file_path}</span></label>
                        ))}</div>
                      </div>
                    )}
                    {!testJob ? <EmptyState icon={FlaskConical} title="Tests not run yet" message="Run regression, interoperability (real ML-KEM / ML-DSA round-trips), unit and security tests on this patch." action={<Button variant="primary" icon={FlaskConical} disabled={locked || !can('tests:run')} onClick={runTests}>Run Tests</Button>} /> : (
                      <>
                        <ProgressBar value={testJob.progress} animated={testJob.status === 'running'} tone={testJob.status === 'completed' ? 'green' : 'blue'} />
                        {testJob.result?.summary && <div className="text-xs text-slate-300">{testJob.result.summary.passed}/{testJob.result.summary.total} passed · {testJob.result.summary.warning} warning · {testJob.result.summary.failed} failed · {testJob.result.summary.real} executed for real</div>}
                        <div className="divide-y divide-white/5 rounded-xl bg-white/[0.02] ring-1 ring-white/5">
                          {results.map((r) => (
                            <div key={r.index} className="flex animate-rise items-start gap-3 px-3 py-2">
                              <StepIcon status={r.status} size={15} />
                              <div className="min-w-0 flex-1"><div className="text-xs font-medium text-slate-100">{r.name}</div><div className="text-[11px] text-slate-400">{r.details}</div></div>
                              <Badge>{r.category}</Badge><ExecBadge execution={r.execution} /><span className="text-[10px] tabular-nums text-slate-500">{r.duration_ms}ms</span>
                            </div>
                          ))}
                        </div>
                        {testJob.status === 'completed' && !locked && <div className="flex justify-end"><Button variant="primary" icon={GitPullRequest} loading={busy === 'pr'} disabled={!can('pr:create')} onClick={createPr}>Create Pull Request with these results</Button></div>}
                      </>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}

          <Card>
            <CardHeader title="Recent patches" subtitle="Generated by the Code Refactoring Agent" icon={ShieldCheck} />
            <div className="divide-y divide-white/5">
              {!(jobs || []).length ? <EmptyState title="No patches yet" /> : jobs.slice(0, 12).map((j) => (
                <button key={j.id} onClick={() => setParams({ job: j.id })} className={cx('flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]', j.id === jobParam && 'bg-sky-500/10')}>
                  <span className="text-xs font-semibold text-slate-400">#{j.id}</span>
                  <span className="code-font min-w-0 flex-1 truncate text-xs text-slate-100">{j.repository_name} · {j.file_path}</span>
                  <span className="text-[11px] text-slate-400">{j.changes.length} changes · {Math.round(j.confidence * 100)}%</span>
                  <StatusBadge status={j.status} label={STATUS_LABEL[j.status]} />
                  <span className="text-[11px] text-slate-500">{timeAgo(j.created_at)}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
