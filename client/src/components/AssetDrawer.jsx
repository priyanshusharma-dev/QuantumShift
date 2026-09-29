import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Wand2, FolderGit2, RefreshCw, Braces, Brain } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { Drawer, RiskBadge, Badge, Button, Loading, ErrorState, StatusBadge, DemoBadge } from './ui';
import { CodeView } from './Code';
import { STATUS_LABEL } from '../lib/format';

export function ExplanationPanel({ explanation, onRegenerate, busy }) {
  if (!explanation) return null;
  const e = explanation;
  const rows = [
    ['Why is this risky?', e.whyRisky],
    ['What data is affected?', e.dataAffected],
    ['Recommended migration', e.recommendation],
  ];
  return (
    <div className="rounded-xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 to-sky-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-violet-200"><Brain size={16} /> IBM Granite-style risk explanation</div>
        <div className="flex items-center gap-2">
          {e.source === 'watsonx' ? <Badge tone="green">IBM Granite · watsonx.ai</Badge> : <DemoBadge>AI-generated explanation — Demo Mode</DemoBadge>}
          {onRegenerate && <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy} onClick={onRegenerate}>Regenerate</Button>}
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-100">{e.summary}</p>
      <dl className="mt-3 space-y-2.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="font-semibold uppercase tracking-wider text-slate-400">{k}</dt>
            <dd className="mt-0.5 leading-relaxed text-slate-200">{v}</dd>
          </div>
        ))}
        <div>
          <dt className="font-semibold uppercase tracking-wider text-slate-400">Dependencies</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">{(e.dependencies || []).map((d) => <Badge key={d}>{d}</Badge>)}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wider text-slate-400">What should the developer do?</dt>
          <dd className="mt-1"><ol className="list-decimal space-y-1 pl-4 text-slate-200">{(e.developerActions || []).map((a) => <li key={a}>{a}</li>)}</ol></dd>
        </div>
      </dl>
      <div className="mt-3 text-[10px] text-slate-500">{e.label}{e.fallbackReason ? ` · ${e.fallbackReason}` : ''}</div>
    </div>
  );
}

export function AssetDrawer({ assetId, onClose }) {
  const { data, loading, error, reload, setData } = useApi(assetId ? `/assets/${assetId}` : null, ['assets', 'risks']);
  const { notifyError, toast, can } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [showCbom, setShowCbom] = useState(false);
  const a = data?.asset;
  const r = data?.risk;

  const regenerate = async () => {
    setBusy(true);
    try {
      const exp = await api(`/risks/${assetId}/explain`, { method: 'POST' });
      setData((d) => ({ ...d, risk: { ...d.risk, explanation: exp } }));
      toast({ type: 'success', title: 'Explanation regenerated', message: exp.label });
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  };

  const safe = a && ['safe', 'pqc'].includes(a.quantum_status);
  return (
    <Drawer open={!!assetId} onClose={onClose} title={a ? a.algorithm : 'Crypto asset'} subtitle={a ? `${data.repository.name} · ${a.file_path}${a.line ? `:${a.line}` : ''}` : ''}
      footer={a && (
        <>
          {!a.file_path.startsWith('aws://') && <Button icon={FolderGit2} onClick={() => nav(`/repositories/${a.repository_id}?file=${encodeURIComponent(a.file_path)}&asset=${a.id}`)}>Open in repository</Button>}
          {!safe && a.status !== 'remediated' && (
            <Button variant="primary" icon={Wand2} disabled={!can('remediation:generate')} title={can('remediation:generate') ? '' : 'Developer or CISO role required'} onClick={() => nav(`/code-mode?asset=${a.id}`)}>Fix with Bob (Code Mode)</Button>
          )}
        </>
      )}>
      {loading && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {a && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <RiskBadge level={r?.risk_level} score={r?.risk_score} />
            <Badge tone="blue">{a.rule_id}</Badge>
            <Badge>{a.asset_type}</Badge>
            <Badge>{a.language}</Badge>
            <StatusBadge status={a.status} label={STATUS_LABEL[a.status]} />
            <Badge tone="cyan">{a.detection_method}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            {[
              ['Function', a.function_name || '—'],
              ['Line', a.line ?? '—'],
              ['Quantum status', a.quantum_status],
              ['Target', a.target_algorithm],
              ['X · data lifetime', r ? `${r.x_years} y` : '—'],
              ['Y · migration time', r ? `${r.y_years} y` : '—'],
              ['Z · CRQC estimate', r ? `${r.z_years} y` : '—'],
              ['Mosca', r ? (r.mosca_exposed ? `Exposed +${r.mosca_margin} y` : `Headroom ${Math.abs(r.mosca_margin)} y`) : '—'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-white/[0.03] p-2.5 ring-1 ring-white/5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
                <div className="mt-0.5 break-words font-medium text-slate-100">{String(v)}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Call site</div>
            {data.context ? (
              <CodeView lines={data.context.lines} start={data.context.start} language={a.language} highlightLines={Array.from({ length: (a.end_line || a.line) - a.line + 1 }, (_, i) => a.line + i)} maxHeight={260} />
            ) : (
              <div className="code-font rounded-xl bg-[#070b17] p-3 text-xs text-slate-300 ring-1 ring-white/10">{a.api_call || a.snippet}</div>
            )}
            <div className="mt-2 code-font text-[11px] text-slate-400">Detected API: <span className="text-sky-300">{a.api_call}</span></div>
          </div>
          {r && <div className="rounded-lg bg-white/[0.03] p-3 text-xs text-slate-300 ring-1 ring-white/5"><span className="font-semibold text-slate-100">{r.urgency}.</span> {r.rationale}</div>}
          <ExplanationPanel explanation={r?.explanation} onRegenerate={regenerate} busy={busy} />
          {data.remediationJobs?.length > 0 && (
            <div className="text-xs text-slate-400">
              Remediation jobs: {data.remediationJobs.map((j) => <button key={j.id} className="mr-2 text-sky-300 hover:underline" onClick={() => nav(`/code-mode?job=${j.id}`)}>#{j.id} ({j.status})</button>)}
            </div>
          )}
          {data.cbom && (
            <div>
              <Button size="sm" variant="ghost" icon={Braces} onClick={() => setShowCbom((s) => !s)}>{showCbom ? 'Hide' : 'Show'} CycloneDX component</Button>
              {showCbom && <pre className="code-font mt-2 max-h-72 overflow-auto rounded-xl bg-[#070b17] p-3 text-[11px] text-slate-300 ring-1 ring-white/10">{JSON.stringify(data.cbom, null, 2)}</pre>}
            </div>
          )}
          {safe && <div className="flex items-center gap-2 text-xs text-emerald-300"><Sparkles size={14} /> Quantum-resistant — recorded in the CBOM for completeness.</div>}
        </div>
      )}
    </Drawer>
  );
}
