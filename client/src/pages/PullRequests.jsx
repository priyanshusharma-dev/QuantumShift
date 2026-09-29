import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GitPullRequest, Check, X, MessageSquareWarning, FileDiff, ShieldCheck, Brain, FlaskConical, Scale, GitBranch, UserCheck, ArrowRight, FilePlus2, Lock } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { STATUS_LABEL, fmtDateTime, timeAgo } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, Badge, StatusBadge, ExecBadge, StepIcon, Loading, EmptyState, Tabs, Modal, inputCls, cx, DemoBadge } from '../components/ui';
import { DiffView, CodeView } from '../components/Code';

const CHECK_TONE = { pass: 'green', warning: 'yellow', fail: 'red', info: 'blue', pending: 'yellow' };

function ReviewModal({ pr, action, onClose, onDone }) {
  const { notifyError, toast } = useApp();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const meta = { approve: { title: `Approve PR #${pr.number}`, btn: 'Approve', variant: 'success', route: 'approve' }, reject: { title: `Reject PR #${pr.number}`, btn: 'Reject', variant: 'danger', route: 'reject' }, request_changes: { title: `Request changes on PR #${pr.number}`, btn: 'Request changes', variant: 'warning', route: 'request-changes' } }[action];
  const needs = action !== 'approve';
  const submit = async () => {
    if (needs && !comment.trim()) return;
    setBusy(true);
    try {
      const r = await api(`/pull-requests/${pr.id}/${meta.route}`, { method: 'POST', body: comment.trim() ? { comment: comment.trim() } : {} });
      toast({ type: action === 'approve' ? 'success' : 'warning', title: `PR #${pr.number} ${STATUS_LABEL[r.status].toLowerCase()}`, message: 'Decision recorded in the BobShell audit trail.' });
      onDone();
    } catch (e) { notifyError(e, 'Review failed'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={meta.title} subtitle={pr.title}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={meta.variant} loading={busy} disabled={needs && !comment.trim()} onClick={submit}>{meta.btn}</Button></>}>
      {action === 'approve' && <p className="mb-3 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-100 ring-1 ring-emerald-500/30">Approving marks the affected assets as remediated and records a <b>simulated merge</b> — no remote repository is modified.</p>}
      <label className="block text-xs font-medium text-slate-300">Reviewer comment {needs ? <span className="text-rose-300">(required)</span> : '(optional)'}</label>
      <textarea className={`${inputCls} mt-1 h-28 py-2`} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={needs ? 'Explain what must change…' : 'Looks good — verified ML-DSA key rotation plan.'} />
      {needs && !comment.trim() && <p className="mt-1 text-[11px] text-rose-300">A comment is required for this decision.</p>}
    </Modal>
  );
}

function DiffModal({ pr, onClose }) {
  const [i, setI] = useState(0);
  const files = pr.jobs.flatMap((j) => [{ key: `j${j.id}`, label: j.file_path, job: j }, ...(j.extra_files || []).map((f, k) => ({ key: `j${j.id}-e${k}`, label: f.path, extra: f, job: j }))]).filter((f, k, arr) => arr.findIndex((x) => x.label === f.label) === k);
  const cur = files[i];
  return (
    <Modal open wide onClose={onClose} title={`PR #${pr.number} · ${pr.branch} → ${pr.base_branch}`} subtitle={`${files.length} file(s) changed`}>
      <div className="mb-3 flex flex-wrap gap-1.5">{files.map((f, k) => <button key={f.key} onClick={() => setI(k)} className={cx('code-font rounded-lg px-2 py-1 text-[11px] ring-1', k === i ? 'bg-sky-500/20 text-sky-200 ring-sky-400/40' : 'bg-white/5 text-slate-300 ring-white/10')}>{f.extra && <FilePlus2 size={11} className="mr-1 inline" />}{f.label}</button>)}</div>
      {cur && (cur.extra ? <CodeView code={cur.extra.content} language={/\.py$/.test(cur.label) ? 'Python' : /\.md$/.test(cur.label) ? 'Config' : cur.job.language} maxHeight={560} /> : <DiffView before={cur.job.before_code} after={cur.job.after_code} language={cur.job.language} />)}
    </Modal>
  );
}

export default function PullRequests() {
  const [params, setParams] = useSearchParams();
  const { can, settings } = useApp();
  const { data: prs, loading, reload } = useApi('/pull-requests', ['prs']);
  const [tab, setTab] = useState('pending_review');
  const list = (prs || []).filter((p) => tab === 'all' || p.status === tab);
  const selId = Number(params.get('pr')) || list[0]?.id;
  const { data: pr, reload: reloadPr } = useApi(selId ? `/pull-requests/${selId}` : null, ['prs']);
  const [review, setReview] = useState(null);
  const [diff, setDiff] = useState(false);
  const counts = (prs || []).reduce((m, p) => ({ ...m, [p.status]: (m[p.status] || 0) + 1 }), {});
  const open = pr && ['pending_review', 'changes_requested'].includes(pr.status);
  const canReview = can('pr:review');

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Phase 6 · Govern · Human-in-the-loop" title="PR Review & Approval Hub"
        description="Every Bob-generated migration arrives as a pull request with its diff, cryptographic changes, risk reduction, test evidence, AI explanation and compliance checks. Nothing is ever auto-approved."
        badges={<>{settings.mode === 'demo' && <DemoBadge>Simulated PRs — no remote push</DemoBadge>}<Badge tone="yellow"><UserCheck size={11} />Human approval mandatory</Badge></>} />
      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <Card className="h-fit">
          <div className="border-b border-white/5 p-3">
            <Tabs value={tab} onChange={(t) => { setTab(t); setParams({}); }} tabs={[{ value: 'pending_review', label: 'Pending', count: counts.pending_review || 0 }, { value: 'changes_requested', label: 'Changes', count: counts.changes_requested || 0 }, { value: 'approved', label: 'Approved', count: counts.approved || 0 }, { value: 'rejected', label: 'Rejected', count: counts.rejected || 0 }, { value: 'all', label: 'All' }]} />
          </div>
          <div className="max-h-[680px] divide-y divide-white/5 overflow-auto">
            {loading ? <Loading /> : !list.length ? <EmptyState icon={GitPullRequest} title="No pull requests here" message="Generate a patch in Code Mode and create a PR, or run the complete demo." /> : list.map((p) => (
              <button key={p.id} onClick={() => setParams({ pr: p.id })} className={cx('block w-full px-4 py-3 text-left hover:bg-white/[0.03]', p.id === selId && 'bg-sky-500/10')}>
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-400">#{p.number}</span><StatusBadge status={p.status} label={STATUS_LABEL[p.status]} /></div>
                <div className="mt-1 line-clamp-2 text-sm font-medium text-slate-100">{p.title}</div>
                <div className="mt-1 text-[11px] text-slate-500">{p.repository_name} · −{p.risk_reduction}% risk · {timeAgo(p.created_at)}</div>
              </button>
            ))}
          </div>
        </Card>

        {!pr ? <Card><EmptyState icon={GitPullRequest} title="Select a pull request" /></Card> : (
          <div className="min-w-0 space-y-4">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-lg font-bold text-slate-400">#{pr.number}</span><StatusBadge status={pr.status} label={STATUS_LABEL[pr.status]} />{pr.simulated && <Badge tone="violet">simulated PR</Badge>}</div>
                  <h2 className="mt-1 text-lg font-semibold text-white">{pr.title}</h2>
                  <div className="code-font mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400"><GitBranch size={13} />{pr.repository_name} · <span className="text-sky-300">{pr.branch}</span> → {pr.base_branch} · opened by {pr.created_by} {timeAgo(pr.created_at)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button icon={FileDiff} onClick={() => setDiff(true)}>VIEW DIFF</Button>
                  {open && <>
                    <Button variant="warning" icon={MessageSquareWarning} disabled={!canReview} onClick={() => setReview('request_changes')}>REQUEST CHANGES</Button>
                    <Button variant="danger" icon={X} disabled={!canReview} onClick={() => setReview('reject')}>REJECT</Button>
                    <Button variant="success" icon={Check} disabled={!canReview} onClick={() => setReview('approve')}>APPROVE</Button>
                  </>}
                </div>
              </div>
              {open && (
                <div className="mx-5 mb-5 flex items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  <UserCheck size={18} className="shrink-0 text-amber-300" />
                  <div><b>Human approval required before merge.</b> <span className="text-amber-100/80">{canReview ? 'Review the diff, tests and compliance checks below.' : 'Your role is read-only here — a CISO or developer code owner must decide.'}</span></div>
                  {!canReview && <Lock size={16} className="ml-auto text-amber-300" />}
                </div>
              )}
              {!open && pr.reviewer && (
                <div className={cx('mx-5 mb-5 rounded-xl px-4 py-3 text-sm ring-1', pr.status === 'approved' ? 'bg-emerald-500/10 text-emerald-100 ring-emerald-500/30' : 'bg-rose-500/10 text-rose-100 ring-rose-500/30')}>
                  <b>{STATUS_LABEL[pr.status]}</b> by {pr.reviewer} · {fmtDateTime(pr.reviewed_at)}{pr.review_comment && <div className="mt-1 text-xs opacity-80">“{pr.review_comment}”</div>}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 border-t border-white/5 p-5 md:grid-cols-4">
                {[['Changed files', pr.changed_files.length], ['Crypto changes', pr.crypto_changes.length], ['Risk reduction', `−${pr.risk_reduction}%`], ['Audit status', pr.audit_status]].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5"><div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div><div className="mt-1 break-words text-sm font-semibold text-white">{v}</div></div>
                ))}
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Changed files" icon={FileDiff} />
                <div className="divide-y divide-white/5">{pr.changed_files.map((f) => (
                  <div key={f.path} className="flex items-center gap-3 px-4 py-2 text-xs"><span className="code-font min-w-0 flex-1 truncate text-slate-200">{f.path}</span>{f.isNew && <Badge tone="green">new</Badge>}<span className="tabular-nums text-emerald-300">+{f.additions}</span><span className="tabular-nums text-rose-300">−{f.deletions}</span></div>
                ))}</div>
              </Card>
              <Card>
                <CardHeader title="Risk reduction" icon={ShieldCheck} />
                <div className="space-y-3 p-5">
                  {[['Before', pr.risk_before, '#e5484d'], ['After (estimated)', pr.risk_after, '#199e70']].map(([k, v, c]) => (
                    <div key={k}><div className="mb-1 flex justify-between text-xs"><span className="text-slate-300">{k}</span><span className="font-semibold tabular-nums text-white">{v} risk points</span></div><div className="h-2.5 rounded-full bg-white/5"><div className="h-2.5 rounded-full transition-all duration-700" style={{ width: `${pr.risk_before ? (v / pr.risk_before) * 100 : 0}%`, background: c }} /></div></div>
                  ))}
                  <p className="text-[11px] text-slate-500">Residual risk weights each migrated asset by (1 − change confidence).</p>
                </div>
              </Card>
            </div>

            <Card>
              <CardHeader title="Cryptographic changes" icon={ArrowRight} />
              <div className="divide-y divide-white/5">{pr.crypto_changes.map((c, k) => (
                <div key={k} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs">
                  <Badge tone="blue">{c.ruleId}</Badge><span className="code-font text-slate-400">{c.file}:{c.line}</span><span className="font-semibold text-rose-200">{c.from}</span><ArrowRight size={12} className="text-slate-500" /><span className="font-semibold text-emerald-200">{c.to}</span><Badge className="ml-auto">{c.standard}</Badge><Badge tone={c.confidence >= 0.85 ? 'green' : c.confidence >= 0.7 ? 'yellow' : 'red'}>{Math.round(c.confidence * 100)}%</Badge>
                </div>
              ))}</div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Test results" subtitle={pr.test_summary?.total ? `${pr.test_summary.passed}/${pr.test_summary.total} passed · ${pr.test_summary.warning} warning · ${pr.test_summary.failed} failed · ${pr.test_summary.real} real` : 'No tests attached'} icon={FlaskConical} />
                <div className="max-h-80 divide-y divide-white/5 overflow-auto">{pr.tests.map((t, k) => (
                  <div key={k} className="flex items-start gap-2 px-4 py-2"><StepIcon status={t.status} size={14} /><div className="min-w-0 flex-1 text-xs text-slate-200">{t.name}</div><ExecBadge execution={t.execution} /></div>
                ))}{!pr.tests.length && <EmptyState title="No test run attached" />}</div>
              </Card>
              <Card>
                <CardHeader title="Compliance Agent" subtitle={`Overall: ${pr.compliance?.status?.replace('_', ' ')}`} icon={Scale} />
                <div className="divide-y divide-white/5">{(pr.compliance?.checks || []).map((c) => (
                  <div key={c.name} className="px-4 py-2.5"><div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-100">{c.name}<Badge tone={CHECK_TONE[c.status]}>{c.status}</Badge></div><div className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{c.detail}</div></div>
                ))}</div>
              </Card>
            </div>

            <Card>
              <CardHeader title="AI explanation" icon={Brain} actions={<DemoBadge>AI-generated — Demo Mode</DemoBadge>} />
              <p className="p-5 text-sm leading-relaxed text-slate-200">{pr.ai_explanation || 'No explanation recorded.'}</p>
            </Card>
          </div>
        )}
      </div>
      {review && pr && <ReviewModal pr={pr} action={review} onClose={() => setReview(null)} onDone={() => { setReview(null); reload(); reloadPr(); }} />}
      {diff && pr && <DiffModal pr={pr} onClose={() => setDiff(false)} />}
    </div>
  );
}
