import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Rocket, GitPullRequest, LayoutDashboard, Boxes, ScrollText, Map, Activity, Bot, CheckCircle2, UserCheck } from 'lucide-react';
import { useApi, useApp, useJob } from '../context/AppContext';
import { api } from '../lib/api';
import { fmtTime } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, ProgressBar, Badge, StatusBadge, DemoBadge, cx } from '../components/ui';
import { JobSteps } from '../components/JobSteps';

export default function Demo() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can, notifyError, liveAudit, agents, settings, toast } = useApp();
  const { data: steps } = useApi('/demo/steps', []);
  const [jobId, setJobId] = useState(null);
  const job = useJob(jobId);
  const started = useRef(false);

  const start = async () => {
    if (!can('demo:run')) return notifyError(new Error('Auditors have read-only access — switch to the CTO, CISO or Developer role.'), 'Permission required');
    try {
      const r = await api('/demo/run', { method: 'POST' });
      setJobId(r.jobId);
    } catch (e) { notifyError(e, 'Demo could not start'); }
  };

  // Attach to a running demo, or auto-start when arriving with ?autorun=1.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api('/jobs').then((jobs) => {
      const running = jobs.find((j) => j.type === 'demo' && j.status === 'running');
      if (running) setJobId(running.id);
      else if (params.get('autorun') === '1') start();
      if (params.get('autorun')) setParams({}, { replace: true });
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (job?.status === 'completed') toast({ type: 'success', title: 'Complete demo finished', message: `PR #${job.result.prNumber} is waiting for human approval.` });
    if (job?.status === 'failed') notifyError(new Error(job.error), 'Demo failed');
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = job?.status === 'running';
  const t0 = job ? new Date(job.startedAt).getTime() : 0;
  const feed = liveAudit.filter((e) => !job || new Date(e.ts).getTime() >= t0 - 1000).slice(0, 30);
  const activeAgents = Object.values(agents).filter((a) => a.status === 'running');

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="End-to-end" title="Run Complete QuantumShift Demo"
        description="One click executes the entire agentic pipeline on the Banking API sample: load → scan → detect → CBOM → Mosca → classify → explain → plan → remediate → generate & run tests → PR → human approval → BobShell → dashboard."
        badges={settings.mode === 'demo' && <DemoBadge />} />
      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-600/25 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">{running ? 'Running' : job?.status === 'completed' ? 'Completed — awaiting human approval' : job?.status === 'failed' ? 'Failed' : 'Ready'}</div>
            <div className="mt-2 flex items-center gap-4">
              <div className="text-4xl font-black tabular-nums text-white">{job?.progress ?? 0}%</div>
              <div className="min-w-0 flex-1">
                <ProgressBar value={job?.progress ?? 0} animated={running} tone={job?.status === 'completed' ? 'green' : 'blue'} className="h-3" />
                <div className="mt-1.5 truncate text-xs text-slate-400">{running ? job.steps.find((s) => s.status === 'running')?.label : job?.status === 'completed' ? `Finished in ${Math.round((new Date(job.finishedAt) - t0) / 1000)} s` : '15 steps · ~30 seconds · repeatable (resets the Banking API sample first)'}</div>
              </div>
            </div>
          </div>
          <Button variant="primary" size="lg" icon={Rocket} loading={running} disabled={running} onClick={start} className="px-7 text-base">
            {job?.status === 'completed' ? 'RUN AGAIN' : 'RUN COMPLETE QUANTUMSHIFT DEMO'}
          </Button>
        </div>
      </Card>

      {job?.status === 'completed' && (
        <Card className="animate-rise border border-amber-400/30 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <UserCheck size={22} className="text-amber-300" />
            <div className="min-w-0 flex-1"><div className="font-semibold text-white">Human approval required before merge</div><div className="text-xs text-slate-400">Pull request #{job.result.prNumber} is pending. Approve or reject it in the PR hub as a CISO or developer.</div></div>
            <Button variant="warning" icon={GitPullRequest} onClick={() => nav(`/pull-requests?pr=${job.result.prId}`)}>Review PR #{job.result.prNumber}</Button>
            <Button icon={LayoutDashboard} onClick={() => nav('/dashboard')}>Executive dashboard</Button>
            <Button icon={Boxes} onClick={() => nav(`/cbom?repositoryId=${job.result.repositoryId}`)}>CBOM</Button>
            <Button icon={Map} onClick={() => nav('/planner')}>Roadmap</Button>
            <Button icon={ScrollText} onClick={() => nav('/audit')}>BobShell</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Pipeline" subtitle="Each step calls the real services (scanner, risk engine, planner, Code Mode, Test Agent, PR workflow)" icon={CheckCircle2} />
          <div className="p-3"><JobSteps job={job} steps={(steps || []).map((s) => ({ ...s, status: 'pending' }))} /></div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Active agents" icon={Bot} actions={<Button size="sm" onClick={() => nav('/agents')}>Orchestration view</Button>} />
            <div className="flex min-h-[64px] flex-wrap gap-2 p-4">
              {activeAgents.length ? activeAgents.map((a) => <Badge key={a.key} tone="blue" className="animate-pulse-soft">{a.name}: {a.currentTask}</Badge>) : <span className="text-xs text-slate-500">{running ? 'Handing off between agents…' : 'Idle'}</span>}
            </div>
          </Card>
          <Card>
            <CardHeader title="BobShell (live)" subtitle="Every action recorded as it happens" icon={Activity} />
            <div className="code-font max-h-[560px] overflow-auto bg-[#04060e] p-3 text-[11.5px] leading-relaxed">
              {!feed.length && <div className="text-slate-600">$ waiting for agent actions…</div>}
              {feed.map((e) => (
                <div key={e.id} className="animate-rise">
                  <span className="text-slate-500">{fmtTime(e.ts)}</span> <span className="text-sky-300">{e.agent}</span> <span className="text-slate-100">{e.action}</span>
                  {e.result && <span className="text-slate-500"> → {e.result.slice(0, 90)}</span>} <span className={cx(e.status === 'success' ? 'text-emerald-400' : e.status === 'failure' ? 'text-rose-400' : 'text-amber-300')}>[{e.status}]</span>
                </div>
              ))}
            </div>
          </Card>
          {job?.status === 'failed' && <Card className="p-4 text-sm text-rose-200"><StatusBadge status="failed" /> {job.error}</Card>}
        </div>
      </div>
    </div>
  );
}
