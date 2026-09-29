import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, FileCode2, Play, Boxes, FolderGit2, History } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { fmtDateTime, STATUS_LABEL } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, Badge, RiskBadge, StatusBadge, Loading, ErrorState, EmptyState, cx } from '../components/ui';
import { CodeView } from '../components/Code';
import { AssetDrawer } from '../components/AssetDrawer';

export default function RepositoryDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { notifyError, toast, can } = useApp();
  const { data: repo, loading, error, reload } = useApi(`/repositories/${id}`, ['repositories', 'assets', 'risks']);
  const { data: assets } = useApi(`/assets?repositoryId=${id}`, ['assets', 'risks']);
  const type = params.get('type') || '';
  const file = params.get('file') || '';
  const [assetId, setAssetId] = useState(Number(params.get('asset')) || null);
  const { data: content } = useApi(file && !file.startsWith('aws://') ? `/repositories/${id}/file?path=${encodeURIComponent(file)}` : null, []);

  const files = useMemo(() => {
    if (!repo) return [];
    if (!type) return repo.files;
    const keep = new Set((assets || []).filter((a) => a.asset_type === type).map((a) => a.file_path));
    return repo.files.filter((f) => keep.has(f.file_path));
  }, [repo, assets, type]);
  const fileAssets = (assets || []).filter((a) => a.file_path === file && (!type || a.asset_type === type));
  const set = (patch) => setParams(Object.fromEntries(Object.entries({ type, file, ...patch }).filter(([, v]) => v)));

  const scan = async () => {
    try { await api('/scan', { method: 'POST', body: { repositoryId: Number(id) } }); toast({ type: 'success', title: 'Scan started', message: 'Results refresh automatically.' }); } catch (e) { notifyError(e); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1 text-xs text-slate-400" aria-label="Breadcrumb">
        <button className="hover:text-white" onClick={() => nav('/dashboard')}>Executive Dashboard</button><ChevronRight size={12} />
        <button className="hover:text-white" onClick={() => set({ file: '' })}>{repo.name}</button>
        {file && <><ChevronRight size={12} /><span className="code-font text-slate-200">{file}</span></>}
        {file && <><ChevronRight size={12} /><span>crypto asset → call site</span></>}
      </nav>
      <PageHeader eyebrow="Drill-down · repository → file → crypto asset → call site" title={repo.name} description={repo.description}
        badges={<>
          <Badge tone="blue">{repo.source_type}</Badge>{repo.simulated_ingestion && <Badge tone="violet">simulated ingestion</Badge>}<Badge>{repo.primary_language}</Badge>
          <Badge tone={repo.criticality === 'critical' ? 'red' : 'yellow'}>{repo.criticality}</Badge><Badge>X {repo.data_lifetime_years}y · Y {repo.migration_time_years}y</Badge>
          {type && <Badge tone="cyan">filter: {type} <button className="ml-1" onClick={() => set({ type: '' })} aria-label="Clear filter">×</button></Badge>}
        </>}
        actions={<><Button icon={Boxes} onClick={() => nav(`/cbom?repositoryId=${id}`)}>CBOM</Button><Button variant="primary" icon={Play} disabled={!can('scan:run')} onClick={scan}>Re-scan</Button></>} />
      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <Card className="h-fit">
          <CardHeader title={`Files (${files.length})`} subtitle={`${repo.files_scanned} files · ${repo.loc} lines scanned`} icon={FolderGit2} />
          <div className="max-h-[640px] overflow-auto p-2">
            {!files.length && <EmptyState title="No files with findings" />}
            {files.map((f) => (
              <button key={f.file_path} onClick={() => set({ file: f.file_path })} className={cx('mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left', file === f.file_path ? 'bg-sky-500/15 ring-1 ring-sky-400/40' : 'hover:bg-white/5')}>
                <FileCode2 size={14} className="shrink-0 text-slate-400" />
                <span className="code-font min-w-0 flex-1 truncate text-[11.5px] text-slate-200">{f.file_path}</span>
                {f.red > 0 && <span className="rounded bg-rose-500/20 px-1 text-[10px] font-bold text-rose-300">{f.red}R</span>}
                {f.yellow > 0 && <span className="rounded bg-amber-500/20 px-1 text-[10px] font-bold text-amber-300">{f.yellow}Y</span>}
                {f.green > 0 && <span className="rounded bg-emerald-500/20 px-1 text-[10px] font-bold text-emerald-300">{f.green}G</span>}
              </button>
            ))}
          </div>
        </Card>
        <div className="min-w-0 space-y-4">
          {!file ? (
            <Card>
              <CardHeader title="Scan history" icon={History} />
              <div className="divide-y divide-white/5">{repo.scans.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs"><StatusBadge status={s.status} /><span className="text-slate-300">{fmtDateTime(s.started_at)}</span><span className="text-slate-400">{s.files_scanned} files · {s.assets_found} assets</span><span className="text-rose-300">{s.red} RED</span><span className="text-amber-300">{s.yellow} YELLOW</span><span className="text-emerald-300">{s.green} GREEN</span><span className="ml-auto text-slate-500">by {s.triggered_by} · {s.mode}</span></div>
              ))}{!repo.scans.length && <EmptyState title="Never scanned" />}</div>
              <p className="p-4 text-xs text-slate-400">Select a file on the left to see its crypto assets and call sites.</p>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title={`Crypto assets in ${file}`} subtitle="Click an asset to open its call site, Mosca assessment and explanation" icon={Boxes} />
                <div className="divide-y divide-white/5">{fileAssets.map((a) => (
                  <button key={a.id} onClick={() => setAssetId(a.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]">
                    <RiskBadge level={a.risk_level} score={a.risk_score} /><span className="text-sm font-semibold text-slate-100">{a.algorithm}</span><Badge tone="blue">{a.rule_id}</Badge>
                    <span className="code-font text-xs text-slate-400">line {a.line ?? '—'} · {a.function_name}</span><StatusBadge status={a.status} label={STATUS_LABEL[a.status]} />
                  </button>
                ))}</div>
              </Card>
              {content && <CodeView code={content.content} language={fileAssets[0]?.language} highlightLines={fileAssets.filter((a) => a.risk_level !== 'GREEN').map((a) => a.line)} maxHeight={620} focusLine={fileAssets[0]?.line} />}
            </>
          )}
        </div>
      </div>
      <AssetDrawer assetId={assetId} onClose={() => { setAssetId(null); if (params.get('asset')) set({}); }} />
    </div>
  );
}
