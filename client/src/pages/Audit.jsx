import { useState, useEffect } from 'react';
import { ScrollText, Search, ShieldCheck, FileDown, Terminal, Table2, Link2, ShieldX } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { api, download } from '../lib/api';
import { fmtTime, fmtDate } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, Select, inputCls, StatusBadge, Loading, ErrorState, EmptyState, Tabs, Th, Td, cx, Badge } from '../components/ui';

const STATUS_COLOR = { success: 'text-emerald-400', warning: 'text-amber-400', failure: 'text-rose-400', pending: 'text-amber-300', info: 'text-sky-400' };

export default function Audit() {
  const { notifyError, toast } = useApp();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [agent, setAgent] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState('shell');
  const [verify, setVerify] = useState(null);
  const [verifying, setVerifying] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const qs = new URLSearchParams({ limit: '500', ...(debounced && { search: debounced }), ...(agent && { agent }), ...(status && { status }) }).toString();
  const { data, loading, error, reload } = useApi(`/audit-logs?${qs}`, ['audit']);
  const { data: all } = useApi('/audit-logs?limit=5000', []);
  const agents = [...new Set((all || []).map((r) => r.agent))].sort();

  const exportAudit = async (format) => {
    try { toast({ type: 'success', title: 'Audit report exported', message: await download(`/reports/audit?format=${format}&${qs}`, `audit.${format}`) }); } catch (e) { notifyError(e, 'Export failed'); }
  };
  const doVerify = async () => {
    setVerifying(true);
    try { setVerify(await api('/audit-logs/verify')); } catch (e) { notifyError(e); } finally { setVerifying(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Govern · tamper-evident trail" title="BobShell Audit Logs"
        description="Every agent and human action — scans, detections, classifications, plans, patches, tests, PRs and approvals — is appended to a SHA-256 hash chain (hash = SHA-256(previous hash ‖ entry)). Any edit to history breaks verification."
        actions={<>
          <Button icon={ShieldCheck} loading={verifying} onClick={doVerify}>Verify hash chain</Button>
          <Button icon={FileDown} onClick={() => exportAudit('csv')}>Export CSV</Button>
          <Button variant="primary" icon={FileDown} onClick={() => exportAudit('json')}>Export Audit Report</Button>
        </>} />
      {verify && (
        <div className={cx('flex items-center gap-3 rounded-xl px-4 py-3 text-sm ring-1', verify.valid ? 'bg-emerald-500/10 text-emerald-100 ring-emerald-500/30' : 'bg-rose-500/10 text-rose-100 ring-rose-500/30')}>
          {verify.valid ? <ShieldCheck size={18} /> : <ShieldX size={18} />}
          {verify.valid ? <span><b>Chain intact.</b> {verify.entries} entries verified · head <span className="code-font text-xs">{verify.head?.slice(0, 16)}…</span></span> : <span><b>Chain broken</b> at entry #{verify.brokenAt}.</span>}
        </div>
      )}
      <Card>
        <CardHeader title={`${data?.length ?? 0} entries`} subtitle="Live — new entries stream in as agents act" icon={ScrollText}
          actions={<Tabs value={view} onChange={setView} tabs={[{ value: 'shell', label: 'BobShell', icon: Terminal }, { value: 'table', label: 'Table', icon: Table2 }]} />} />
        <div className="grid gap-2 border-b border-white/5 p-4 sm:grid-cols-[1fr_220px_180px]">
          <div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-slate-500" /><input className={`${inputCls} pl-8`} placeholder="Search agent, action, resource, result, user…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search audit log" /></div>
          <Select aria-label="Agent" value={agent} onChange={setAgent} options={[{ value: '', label: 'All agents' }, ...agents]} />
          <Select aria-label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, 'success', 'warning', 'failure', 'pending', 'info']} />
        </div>
        {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.length ? <EmptyState icon={ScrollText} title="No matching entries" message="Clear the filters or perform an action." /> : view === 'shell' ? (
          <div className="code-font max-h-[640px] overflow-auto bg-[#04060e] p-4 text-[12px] leading-[1.75]">
            <div className="mb-2 text-slate-500">bobshell@quantumshift:~$ audit tail --follow --verify</div>
            {data.map((r) => (
              <div key={r.id} className="animate-rise whitespace-pre-wrap break-words">
                <span className="text-slate-500">{fmtTime(r.ts)}</span>{'  '}
                <span className="text-sky-300">{r.agent.padEnd(24).slice(0, 24)}</span>{' '}
                <span className="text-slate-100">{r.action}</span>
                {r.resource && <span className="text-violet-300"> · {r.resource}</span>}
                {r.result && <span className="text-slate-400"> → {r.result}</span>}
                <span className="text-slate-600"> [{r.username}]</span>{' '}
                <span className={STATUS_COLOR[r.status]}>{r.status.toUpperCase()}</span>
                <span className="text-slate-700"> #{r.hash.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full min-w-[1100px]">
              <thead className="sticky top-0 bg-ink-850"><tr className="border-b border-white/5"><Th>Timestamp</Th><Th>Agent</Th><Th>Action</Th><Th>Resource</Th><Th>Result</Th><Th>User</Th><Th>Status</Th><Th>Hash</Th></tr></thead>
              <tbody>{data.map((r) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <Td className="code-font whitespace-nowrap text-xs text-slate-400">{fmtDate(r.ts)} {fmtTime(r.ts)}</Td>
                  <Td className="text-xs font-semibold text-sky-300">{r.agent}</Td>
                  <Td className="text-xs">{r.action}</Td>
                  <Td className="max-w-[220px] truncate text-xs text-slate-300" title={r.resource}>{r.resource}</Td>
                  <Td className="max-w-[300px] text-xs text-slate-400">{r.result}</Td>
                  <Td className="text-xs">{r.username}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td className="code-font text-[10px] text-slate-500" title={`prev ${r.prev_hash}\nhash ${r.hash}`}><Link2 size={10} className="mr-1 inline" />{r.hash.slice(0, 10)}</Td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-[11px] text-slate-500"><Badge tone="slate">mode</Badge> Each entry also records whether it happened in Demo / Simulation or Real Integration mode.</p>
    </div>
  );
}
