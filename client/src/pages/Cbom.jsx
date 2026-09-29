import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, FileJson, Download, Filter, KeyRound, FileBadge2, Cpu, Library, Network, X } from 'lucide-react';
import { useApi, useApp } from '../context/AppContext';
import { api, download } from '../lib/api';
import { STATUS_LABEL } from '../lib/format';
import { Card, CardHeader, PageHeader, Button, Select, inputCls, RiskBadge, Badge, StatusBadge, Loading, ErrorState, EmptyState, Modal, Th, Td, useSort, DemoBadge } from '../components/ui';
import { AssetDrawer } from '../components/AssetDrawer';

const TYPE_META = {
  algorithm: { label: 'Algorithms', icon: Cpu }, certificate: { label: 'Certificates', icon: FileBadge2 }, 'related-crypto-material': { label: 'Keys & secrets', icon: KeyRound },
  protocol: { label: 'Protocols', icon: Network }, library: { label: 'Libraries', icon: Library },
};

export default function Cbom() {
  const [params, setParams] = useSearchParams();
  const { notifyError, toast, settings } = useApp();
  const repoId = params.get('repositoryId') || '';
  const { data: repos } = useApi('/repositories', ['repositories']);
  const { data, loading, error, reload } = useApi(`/cbom${repoId ? `?repositoryId=${repoId}` : ''}`, ['cbom', 'assets', 'risks']);
  const [f, setF] = useState({ family: '', risk: params.get('risk') || '', language: params.get('language') || '', type: '', file: '' });
  const [assetId, setAssetId] = useState(null);
  const [doc, setDoc] = useState(null);
  const [docBusy, setDocBusy] = useState(false);

  const rows = useMemo(() => (data || []).filter((c) =>
    (!f.family || c.family === f.family) && (!f.risk || c.risk_level === f.risk) && (!f.language || c.language === f.language)
    && (!f.type || c.asset_type === f.type) && (!f.file || `${c.file_path} ${c.name} ${c.bom_ref}`.toLowerCase().includes(f.file.toLowerCase()))), [data, f]);
  const { sorted, toggle, sortedFor } = useSort(rows, 'risk_score');
  const uniq = (k) => [...new Set((data || []).map((c) => c[k]).filter(Boolean))].sort();
  const counts = (data || []).reduce((m, c) => ({ ...m, [c.asset_type]: (m[c.asset_type] || 0) + 1 }), {});
  const active = Object.values(f).some(Boolean);

  const exportJson = async () => {
    try { toast({ type: 'success', title: 'CBOM exported', message: await download(`/reports/cbom${repoId ? `?repositoryId=${repoId}` : ''}`, 'cbom.cdx.json') }); } catch (e) { notifyError(e, 'Export failed'); }
  };
  const preview = async () => {
    setDocBusy(true);
    try { setDoc(await api(`/cbom/document${repoId ? `?repositoryId=${repoId}` : ''}`)); } catch (e) { notifyError(e); } finally { setDocBusy(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Discover · Cryptography Bill of Materials" title="CBOM Explorer"
        description="CycloneDX 1.5 CBOM: cryptographic-asset components (algorithms, certificates, related crypto material, protocols) and libraries, each with evidence occurrences pointing at the exact call site."
        badges={<><Badge tone="blue">CycloneDX 1.5</Badge>{settings.mode === 'demo' && <DemoBadge />}</>}
        actions={<><Button icon={FileJson} loading={docBusy} onClick={preview}>Preview document</Button><Button variant="primary" icon={Download} onClick={exportJson}>Export CBOM JSON</Button></>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Object.entries(TYPE_META).map(([k, m]) => (
          <Card key={k} hover className="p-3">
            <button className="flex w-full items-center gap-3 text-left" onClick={() => setF({ ...f, type: f.type === k ? '' : k })}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300"><m.icon size={16} /></span>
              <span><span className="block text-lg font-bold text-white">{counts[k] || 0}</span><span className="block text-[11px] text-slate-400">{m.label}</span></span>
              {f.type === k && <Badge tone="blue" className="ml-auto">filter</Badge>}
            </button>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title={`Components (${rows.length}${active ? ` of ${data?.length || 0}` : ''})`} subtitle="Filter by algorithm, risk, repository, file, language or asset type — click a row for the call site" icon={Filter}
          actions={active && <Button size="sm" variant="ghost" icon={X} onClick={() => setF({ family: '', risk: '', language: '', type: '', file: '' })}>Clear filters</Button>} />
        <div className="grid gap-2 border-b border-white/5 p-4 sm:grid-cols-3 xl:grid-cols-6">
          <Select aria-label="Repository" value={repoId} onChange={(v) => setParams(v ? { repositoryId: v } : {})} options={[{ value: '', label: 'All repositories' }, ...(repos || []).map((r) => ({ value: String(r.id), label: r.name }))]} />
          <Select aria-label="Algorithm family" value={f.family} onChange={(v) => setF({ ...f, family: v })} options={[{ value: '', label: 'All algorithms' }, ...uniq('family').map((x) => ({ value: x, label: x }))]} />
          <Select aria-label="Risk" value={f.risk} onChange={(v) => setF({ ...f, risk: v })} options={[{ value: '', label: 'All risk levels' }, 'RED', 'YELLOW', 'GREEN']} />
          <Select aria-label="Language" value={f.language} onChange={(v) => setF({ ...f, language: v })} options={[{ value: '', label: 'All languages' }, ...uniq('language')]} />
          <Select aria-label="Asset type" value={f.type} onChange={(v) => setF({ ...f, type: v })} options={[{ value: '', label: 'All asset types' }, ...Object.entries(TYPE_META).map(([v, m]) => ({ value: v, label: m.label }))]} />
          <input className={inputCls} placeholder="File / name / bom-ref…" value={f.file} onChange={(e) => setF({ ...f, file: e.target.value })} aria-label="File filter" />
        </div>
        {loading ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !sorted.length ? <EmptyState icon={Boxes} title="No components match" message="Adjust the filters or scan a repository." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead><tr className="border-b border-white/5">
                <Th onClick={() => toggle('name')} sorted={sortedFor('name')}>Component</Th><Th onClick={() => toggle('asset_type')} sorted={sortedFor('asset_type')}>Asset type</Th><Th>Primitive</Th>
                <Th onClick={() => toggle('repository_name')} sorted={sortedFor('repository_name')}>Repository</Th><Th>Location / call site</Th><Th onClick={() => toggle('risk_score')} sorted={sortedFor('risk_score')}>Risk</Th><Th>Status</Th>
              </tr></thead>
              <tbody>
                {sorted.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-b border-white/5 hover:bg-white/[0.03]" onClick={() => c.crypto_asset_id && setAssetId(c.crypto_asset_id)}>
                    <Td><div className="font-semibold text-slate-100">{c.name}</div><div className="code-font max-w-[260px] truncate text-[10px] text-slate-500" title={c.bom_ref}>{c.bom_ref}</div></Td>
                    <Td><Badge tone="violet">{c.asset_type}</Badge></Td>
                    <Td className="text-xs text-slate-300">{c.primitive || '—'}</Td>
                    <Td className="text-xs">{c.repository_name}</Td>
                    <Td className="code-font text-xs"><div className="text-slate-200">{c.file_path}{c.line ? `:${c.line}` : ''}</div><div className="max-w-[320px] truncate text-[10px] text-sky-300/80" title={c.api_call}>{c.function_name} · {c.api_call}</div></Td>
                    <Td><RiskBadge level={c.risk_level} score={c.risk_score} /></Td>
                    <Td><StatusBadge status={c.status} label={STATUS_LABEL[c.status]} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <AssetDrawer assetId={assetId} onClose={() => setAssetId(null)} />
      <Modal open={!!doc} onClose={() => setDoc(null)} wide title="CycloneDX 1.5 CBOM document" subtitle={doc ? `${doc.components.length} components · serial ${doc.serialNumber}` : ''}
        footer={<Button variant="primary" icon={Download} onClick={exportJson}>Download JSON</Button>}>
        <pre className="code-font max-h-[60vh] overflow-auto rounded-xl bg-[#070b17] p-4 text-[11.5px] leading-relaxed text-slate-300 ring-1 ring-white/10">{doc && JSON.stringify(doc, null, 2)}</pre>
      </Modal>
    </div>
  );
}
