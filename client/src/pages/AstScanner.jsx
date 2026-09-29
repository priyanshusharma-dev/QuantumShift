import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Code2, Play, BookOpen, Search, RefreshCw } from 'lucide-react';
import { useApi, useApp, useJob } from '../context/AppContext';
import { api } from '../lib/api';
import { Card, CardHeader, PageHeader, Button, Select, inputCls, RiskBadge, Badge, Loading, ErrorState, EmptyState, Th, Td, ProgressBar, useSort } from '../components/ui';
import { CodeView } from '../components/Code';
import { AssetDrawer } from '../components/AssetDrawer';

const SAMPLES = {
  'src/auth/security.js': `const crypto = require('crypto');

// Signs a funds-transfer instruction before it reaches the ledger.
function signTransaction(transaction, privateKey) {
  const payload = JSON.stringify(transaction);
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(payload);
  return signer.sign(privateKey, 'base64');
}

function fingerprint(token) {
  return crypto.createHash('sha1').update(token).digest('hex');
}`,
  'app/crypto.py': `from cryptography.hazmat.primitives.asymmetric import rsa, ec
import hashlib

def make_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)

def checksum(blob):
    return hashlib.md5(blob).hexdigest()`,
  'src/main/java/Signer.java': `import java.security.*;

public class Signer {
    public byte[] sign(PrivateKey key, byte[] data) throws Exception {
        Signature s = Signature.getInstance("SHA256withECDSA");
        s.initSign(key);
        s.update(data);
        return s.sign();
    }
}`,
  'internal/tls/server.go': `package tls

import "crypto/tls"

func Config() *tls.Config {
	return &tls.Config{CurvePreferences: []tls.CurveID{tls.CurveP256, tls.X25519}}
}`,
};

function Playground() {
  const { notifyError } = useApp();
  const [file, setFile] = useState('src/auth/security.js');
  const [code, setCode] = useState(SAMPLES['src/auth/security.js']);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!code.trim()) return notifyError(new Error('Paste some source code first'), 'Nothing to scan');
    setBusy(true);
    try { setRes(await api('/scan/ast', { method: 'POST', body: { filename: file, code } })); } catch (e) { notifyError(e, 'AST scan failed'); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader title="AST scan playground" subtitle="Paste code and run the same Babel AST parser and Semgrep-style PQC rules used on repositories" icon={Code2}
        actions={<Button variant="primary" icon={Play} loading={busy} onClick={run}>Run AST Scan</Button>} />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Select value={file} onChange={(f) => { setFile(f); setCode(SAMPLES[f]); setRes(null); }} options={Object.keys(SAMPLES).map((f) => ({ value: f, label: `Sample · ${f}` }))} />
          <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-label="Source code"
            className={`${inputCls} code-font h-72 resize-y py-2 text-[12.5px] leading-relaxed`} />
        </div>
        <div className="min-w-0">
          {!res ? (
            <EmptyState icon={Search} title="No scan yet" message="Run the scanner to see detected cryptographic APIs, the enclosing function, rule IDs and risk." />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-[11px]">
                <Badge tone="blue">{res.language}</Badge>
                {res.nodes > 0 && <Badge tone="cyan">{res.nodes} AST nodes</Badge>}
                <Badge>{res.durationMs} ms</Badge>
                <Badge tone={res.findings.length ? 'red' : 'green'}>{res.findings.length} finding(s)</Badge>
                {res.parseError && <Badge tone="yellow">recovered: {res.parseError}</Badge>}
              </div>
              <CodeView code={code} language={res.language} highlightLines={res.findings.filter((f) => !['safe', 'pqc'].includes(f.quantumStatus)).map((f) => f.line)} maxHeight={170} />
              <div className="space-y-2">
                {res.findings.map((f, i) => (
                  <div key={i} className="rounded-lg bg-white/[0.03] p-2.5 text-xs ring-1 ring-white/5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={['safe', 'pqc'].includes(f.quantumStatus) ? 'green' : 'red'}>{f.quantumStatus}</Badge>
                      <span className="font-semibold text-slate-100">{f.algorithm}</span>
                      <Badge tone="blue">{f.ruleId}</Badge>
                      <span className="text-slate-400">line {f.line} · {f.functionName}()</span>
                    </div>
                    <div className="code-font mt-1 text-sky-300">{f.apiCall}</div>
                    <div className="mt-1 text-slate-400">→ {f.targetAlgorithm}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function AstScanner() {
  const [params, setParams] = useSearchParams();
  const { notifyError, can } = useApp();
  const repoId = params.get('repositoryId') || '';
  const { data: repos } = useApi('/repositories', ['repositories']);
  const { data: assets, loading, error, reload } = useApi(`/assets${repoId ? `?repositoryId=${repoId}` : ''}`, ['assets', 'risks']);
  const { data: rules } = useApi('/rules', []);
  const [q, setQ] = useState('');
  const [assetId, setAssetId] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [jobId, setJobId] = useState(null);
  const job = useJob(jobId);
  const rows = useMemo(() => (assets || []).filter((a) => a.asset_type !== 'library' && !a.file_path.startsWith('aws://') && (!q || `${a.file_path} ${a.algorithm} ${a.api_call} ${a.function_name} ${a.rule_id}`.toLowerCase().includes(q.toLowerCase()))), [assets, q]);
  const { sorted, toggle, sortedFor } = useSort(rows, 'risk_score');

  const rescan = async () => {
    if (!repoId) return notifyError(new Error('Select a repository to scan'), 'No repository');
    try { setJobId((await api('/scan', { method: 'POST', body: { repositoryId: Number(repoId) } })).jobId); } catch (e) { notifyError(e); }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Discover · static analysis" title="AST Scanner" description="JavaScript/TypeScript are parsed into real ASTs with @babel/parser; Python, Go and Java use Semgrep-style PQC rules with enclosing-function resolution; configs, manifests, Dockerfiles and X.509 certificates have dedicated analysers." />
      <Playground />
      <Card>
        <CardHeader title="Repository findings" subtitle="Every detected cryptographic call site with file, language, function, line, API, algorithm, risk and rule" icon={Search}
          actions={<>
            <Select value={repoId} onChange={(v) => setParams(v ? { repositoryId: v } : {})} className="w-56" options={[{ value: '', label: 'All repositories' }, ...(repos || []).map((r) => ({ value: String(r.id), label: r.name }))]} />
            <input className={`${inputCls} w-52`} placeholder="Filter findings…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter findings" />
            <Button icon={RefreshCw} disabled={!repoId || !can('scan:run') || job?.status === 'running'} onClick={rescan}>Re-scan</Button>
            <Button variant="ghost" icon={BookOpen} onClick={() => setShowRules((s) => !s)}>{showRules ? 'Hide' : 'PQC'} rules</Button>
          </>} />
        {job?.status === 'running' && <div className="px-4 pt-3"><ProgressBar value={job.progress} animated /><div className="mt-1 text-[11px] text-slate-400">{job.steps.find((s) => s.status === 'running')?.message || 'Scanning…'}</div></div>}
        {showRules && (
          <div className="grid gap-2 border-b border-white/5 p-4 md:grid-cols-2 xl:grid-cols-3">
            {(rules || []).map((r) => (
              <div key={r.id} className="rounded-lg bg-white/[0.03] p-3 text-xs ring-1 ring-white/5">
                <div className="flex items-center gap-2"><Badge tone="blue">{r.id}</Badge><Badge tone={r.severity === 'CRITICAL' ? 'red' : r.severity === 'HIGH' ? 'yellow' : r.severity === 'INFO' ? 'green' : 'slate'}>{r.severity}</Badge>{r.cwe && <span className="text-slate-500">{r.cwe}</span>}</div>
                <div className="mt-1.5 font-semibold text-slate-100">{r.name}</div>
                <div className="code-font mt-1 break-words text-[11px] text-sky-300/90">{r.pattern}</div>
                <div className="mt-1 text-slate-400">{r.message}</div>
              </div>
            ))}
          </div>
        )}
        {loading ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !sorted.length ? <EmptyState title="No findings" message="Scan a repository or clear the filter." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px]">
              <thead><tr className="border-b border-white/5">
                <Th onClick={() => toggle('file_path')} sorted={sortedFor('file_path')}>File</Th><Th onClick={() => toggle('language')} sorted={sortedFor('language')}>Language</Th>
                <Th>Function</Th><Th onClick={() => toggle('line')} sorted={sortedFor('line')}>Line</Th><Th>Cryptographic API</Th>
                <Th onClick={() => toggle('algorithm')} sorted={sortedFor('algorithm')}>Algorithm</Th><Th onClick={() => toggle('risk_score')} sorted={sortedFor('risk_score')}>Risk</Th><Th onClick={() => toggle('rule_id')} sorted={sortedFor('rule_id')}>Rule</Th>
              </tr></thead>
              <tbody>
                {sorted.map((a) => (
                  <tr key={a.id} className="cursor-pointer border-b border-white/5 hover:bg-white/[0.03]" onClick={() => setAssetId(a.id)}>
                    <Td className="code-font text-xs"><div className="text-slate-100">{a.file_path}</div><div className="text-[10px] text-slate-500">{a.repository_name}</div></Td>
                    <Td className="text-xs">{a.language}</Td>
                    <Td className="code-font text-xs text-sky-300">{a.function_name}</Td>
                    <Td className="code-font text-xs tabular-nums">{a.line ?? '—'}</Td>
                    <Td className="code-font max-w-[300px] truncate text-xs text-slate-300" title={a.api_call}>{a.api_call}</Td>
                    <Td className="text-xs font-semibold">{a.algorithm}</Td>
                    <Td><RiskBadge level={a.risk_level} score={a.risk_score} /></Td>
                    <Td><Badge tone="blue">{a.rule_id}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <AssetDrawer assetId={assetId} onClose={() => setAssetId(null)} />
    </div>
  );
}
