import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Play, RotateCcw, Network, FileDown, History, CheckCircle2, XCircle, AlertTriangle, Cpu } from 'lucide-react';
import { useApi, useApp, useJob } from '../context/AppContext';
import { api, download } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, Badge, ExecBadge, StepIcon, Loading, EmptyState, ProgressBar, StatCard, Tabs, cx, DemoBadge } from '../components/ui';

const SUITES = [
  { key: 'regression', label: 'Regression', icon: RotateCcw },
  { key: 'interoperability', label: 'Interoperability', icon: Network },
  { key: 'unit', label: 'Unit', icon: Cpu },
  { key: 'security', label: 'Security', icon: FlaskConical },
];

export default function Testing() {
  const { can, notifyError, toast, settings } = useApp();
  const { data: runs, reload: reloadRuns } = useApi('/tests/runs', ['tests']);
  const [runId, setRunId] = useState(null);
  const { data, loading } = useApi(`/tests${runId ? `?runId=${runId}` : ''}`, ['tests']);
  const [jobId, setJobId] = useState(null);
  const job = useJob(jobId);
  const [filter, setFilter] = useState('all');
  const live = job?.status === 'running';
  const liveResults = job?.meta?.results || [];
  useEffect(() => { if (job?.status === 'completed') { setRunId(job.result.runId); reloadRuns(); toast({ type: job.result.summary.failed ? 'error' : 'success', title: 'Test run finished', message: `${job.result.summary.passed}/${job.result.summary.total} passed · ${job.result.summary.warning} warning · ${job.result.summary.failed} failed` }); } }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (suite) => {
    try { setJobId((await api('/tests/run', { method: 'POST', body: { suite } })).jobId); setFilter('all'); } catch (e) { notifyError(e, 'Could not start tests'); }
  };
  const report = async (format) => {
    try { toast({ type: 'success', title: 'Test report downloaded', message: await download(`/reports/tests?format=${format}${data?.runId ? `&runId=${data.runId}` : ''}`, `tests.${format}`) }); } catch (e) { notifyError(e, 'Export failed'); }
  };

  const results = live ? liveResults : data?.results || [];
  const summary = live ? liveResults.reduce((s, r) => ({ ...s, total: s.total + 1, [r.status]: s[r.status] + 1, [r.execution]: s[r.execution] + 1 }), { total: 0, passed: 0, failed: 0, warning: 0, real: 0, simulated: 0 }) : data?.summary;
  const bySuite = useMemo(() => Object.fromEntries(SUITES.map((s) => [s.key, results.filter((r) => r.suite === s.key)])), [results]);
  const shown = filter === 'all' ? results : results.filter((r) => r.suite === filter);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Phase 5 · Testing" title="Testing & Interoperability"
        description="Regression, interoperability, unit and security tests for generated PQC migrations. Interoperability tests run real ML-KEM-768 / ML-DSA-65 operations on this server's OpenSSL; tests without a connected CI are clearly marked simulated."
        badges={settings.mode === 'demo' && <DemoBadge />}
        actions={<>
          <Button variant="primary" icon={Play} disabled={!can('tests:run') || live} onClick={() => start('all')}>Run All Tests</Button>
          <Button icon={RotateCcw} disabled={!can('tests:run') || live} onClick={() => start('regression')}>Run Regression Tests</Button>
          <Button icon={Network} disabled={!can('tests:run') || live} onClick={() => start('interoperability')}>Run Interoperability Tests</Button>
          <Button icon={FileDown} disabled={!data?.runId} onClick={() => report('json')}>Generate Test Report</Button>
        </>} />

      {live && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold text-sky-200">Test Agent executing… {job.steps[0].message}</span><span className="tabular-nums text-slate-400">{job.progress}%</span></div>
          <ProgressBar value={job.progress} animated />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Tests executed" value={summary?.total || 0} icon={FlaskConical} tone="blue" hint={`${summary?.real || 0} real · ${summary?.simulated || 0} simulated`} />
        <StatCard label="Passed" value={summary?.passed || 0} icon={CheckCircle2} tone="green" hint={summary?.total ? `${Math.round((summary.passed / summary.total) * 100)}% pass rate` : '—'} />
        <StatCard label="Failed" value={summary?.failed || 0} icon={XCircle} tone="red" hint="blocks PR compliance" />
        <StatCard label="Warning" value={summary?.warning || 0} icon={AlertTriangle} tone="yellow" hint="needs developer follow-up" />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {SUITES.map((s) => {
          const list = bySuite[s.key];
          const p = list.filter((r) => r.status === 'passed').length;
          return (
            <Card key={s.key} hover className="p-4">
              <button className="w-full text-left" onClick={() => setFilter(s.key)}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white"><s.icon size={15} className="text-sky-300" />{s.label} tests</div>
                <div className="mt-2 flex gap-2 text-[11px]"><Badge tone="green">{p} passed</Badge><Badge tone="red">{list.filter((r) => r.status === 'failed').length} failed</Badge><Badge tone="yellow">{list.filter((r) => r.status === 'warning').length} warning</Badge></div>
                <ProgressBar value={list.length ? (p / list.length) * 100 : 0} tone="green" className="mt-3" />
              </button>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader title={live ? 'Live execution' : `Results · ${data?.runId || 'no runs yet'}`} subtitle="Every result states whether it was actually executed (real) or simulated" icon={FlaskConical}
            actions={<Tabs value={filter} onChange={setFilter} tabs={[{ value: 'all', label: 'All', count: results.length }, ...SUITES.map((s) => ({ value: s.key, label: s.label, count: bySuite[s.key].length }))]} />} />
          {loading && !live ? <Loading /> : !shown.length ? <EmptyState icon={FlaskConical} title="No test results" message="Generate a patch in Code Mode, or run interoperability tests to exercise ML-KEM / ML-DSA directly." /> : (
            <div className="divide-y divide-white/5">
              {shown.map((r, i) => (
                <div key={r.id || `l${r.index}`} className={cx('flex items-start gap-3 px-4 py-3', live && i === shown.length - 1 && 'animate-rise bg-sky-500/5')}>
                  <StepIcon status={r.status} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-100">{r.name}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-slate-400">{r.details}</div>
                    {r.file_path && <div className="code-font mt-0.5 text-[10px] text-slate-500">{r.file_path}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1"><div className="flex gap-1"><Badge>{r.category}</Badge><ExecBadge execution={r.execution} /></div><span className="text-[10px] tabular-nums text-slate-500">{r.duration_ms} ms</span></div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Run history" icon={History} actions={<Button size="sm" variant="ghost" icon={FileDown} disabled={!data?.runId} onClick={() => report('csv')}>CSV</Button>} />
          <div className="max-h-[520px] divide-y divide-white/5 overflow-auto">
            {!(runs || []).length ? <EmptyState title="No runs" /> : runs.map((r) => (
              <button key={r.run_id} onClick={() => { setJobId(null); setRunId(r.run_id); }} className={cx('block w-full px-4 py-2.5 text-left hover:bg-white/[0.03]', (data?.runId === r.run_id && !live) && 'bg-sky-500/10')}>
                <div className="code-font text-[11px] text-slate-300">{r.run_id}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px]"><Badge tone="green">{r.passed}</Badge><Badge tone="red">{r.failed}</Badge><Badge tone="yellow">{r.warning}</Badge><span className="text-slate-500">{r.real}/{r.total} real · {fmtDateTime(r.started_at)}</span></div>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
