import { useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { cx } from './ui';

const KW = 'const|let|var|function|return|if|else|for|while|import|from|export|def|class|public|private|protected|static|final|new|func|package|throws|try|catch|async|await|require|module|true|false|null|None|True|False|void|byte|String|type|struct|interface|default|case|switch|break|with|as|in|of|FROM|RUN|CMD|WORKDIR|COPY|EXPOSE|ENTRYPOINT|server|listen|location';
const HASH = new Set(['Python', 'Dockerfile', 'Config', 'Manifest', 'Shell']);

function makeRe(language) {
  const com = HASH.has(language) ? '#.*$|\\/\\/.*$' : '\\/\\/.*$|\\/\\*.*?\\*\\/|^\\s*\\*.*$';
  return new RegExp(`(${com})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|\\b(\\d+(?:\\.\\d+)?)\\b|\\b(${KW})\\b|([A-Za-z_$][\\w$]*)(?=\\()`, 'g');
}

/** Minimal, dependency-free syntax highlighter (safe: renders text nodes only). */
export function highlight(line, re) {
  const out = [];
  let last = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const cls = m[1] ? 'tok-com' : m[2] ? 'tok-str' : m[3] ? 'tok-num' : m[4] ? 'tok-kw' : 'tok-fn';
    out.push(<span key={m.index} className={cls}>{m[0]}</span>);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function CodeView({ code, lines: linesProp, start = 1, language, highlightLines = [], maxHeight = 420, className, focusLine }) {
  const lines = useMemo(() => linesProp || String(code ?? '').split(/\r?\n/), [code, linesProp]);
  const re = useMemo(() => makeRe(language), [language]);
  const hl = new Set(highlightLines);
  return (
    <div className={cx('code-font overflow-auto rounded-xl bg-[#070b17] text-[12.5px] leading-[1.6] ring-1 ring-white/10', className)} style={{ maxHeight }}>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) => {
            const n = start + i;
            const on = hl.has(n);
            return (
              <tr key={n} className={on ? 'bg-rose-500/12' : undefined} ref={focusLine === n ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}>
                <td className={cx('select-none border-r border-white/5 px-3 text-right align-top text-slate-600', on && 'text-rose-300')}>{n}</td>
                <td className={cx('whitespace-pre px-3 text-slate-200', on && 'shadow-[inset_3px_0_0_#e5484d]')}>{highlight(l, re)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Aligns a before/after pair into side-by-side rows. */
function buildRows(before, after) {
  const parts = diffLines(before || '', after || '');
  const rows = [];
  let l = 1;
  let r = 1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lines = p.value.replace(/\n$/, '').split('\n');
    if (p.removed && parts[i + 1]?.added) {
      const added = parts[i + 1].value.replace(/\n$/, '').split('\n');
      const n = Math.max(lines.length, added.length);
      for (let k = 0; k < n; k++) {
        rows.push({ left: k < lines.length ? { n: l++, text: lines[k], type: 'del' } : null, right: k < added.length ? { n: r++, text: added[k], type: 'add' } : null });
      }
      i++;
    } else if (p.removed) {
      for (const t of lines) rows.push({ left: { n: l++, text: t, type: 'del' }, right: null });
    } else if (p.added) {
      for (const t of lines) rows.push({ left: null, right: { n: r++, text: t, type: 'add' } });
    } else {
      for (const t of lines) rows.push({ left: { n: l++, text: t, type: 'ctx' }, right: { n: r++, text: t, type: 'ctx' } });
    }
  }
  return rows;
}

export function DiffView({ before, after, language, context = 4, beforeLabel = 'BEFORE', afterLabel = 'AFTER' }) {
  const rows = useMemo(() => buildRows(before, after), [before, after]);
  const re = useMemo(() => makeRe(language), [language]);
  const [expanded, setExpanded] = useState(new Set());
  const changed = rows.map((r) => r.left?.type !== 'ctx' || r.right?.type !== 'ctx');
  const visible = rows.map((_, i) => changed.slice(Math.max(0, i - context), i + context + 1).some(Boolean));
  const segments = [];
  let i = 0;
  while (i < rows.length) {
    if (visible[i]) { segments.push({ type: 'row', i }); i++; continue; }
    let j = i;
    while (j < rows.length && !visible[j]) j++;
    segments.push({ type: 'gap', from: i, to: j });
    i = j;
  }
  const cell = (c, side) => {
    if (!c) return <><td className="w-10 bg-white/[0.02]" /><td className="bg-white/[0.02]" /></>;
    const bg = c.type === 'del' ? 'bg-rose-500/12' : c.type === 'add' ? 'bg-emerald-500/12' : '';
    const mark = c.type === 'del' ? '−' : c.type === 'add' ? '+' : ' ';
    return (
      <>
        <td className={cx('w-10 select-none border-r border-white/5 px-2 text-right align-top text-slate-600', bg)}>{c.n}</td>
        <td className={cx('whitespace-pre px-2 align-top text-slate-200', bg, side === 'left' && 'border-r border-white/10')}>
          <span className={cx('mr-2 select-none', c.type === 'del' ? 'text-rose-400' : c.type === 'add' ? 'text-emerald-400' : 'text-transparent')}>{mark}</span>
          {highlight(c.text, re)}
        </td>
      </>
    );
  };
  return (
    <div className="code-font overflow-auto rounded-xl bg-[#070b17] text-[12px] leading-[1.6] ring-1 ring-white/10">
      <table className="w-full min-w-[760px] table-fixed border-collapse">
        <colgroup><col className="w-10" /><col /><col className="w-10" /><col /></colgroup>
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wider">
            <th colSpan={2} className="border-b border-r border-white/10 bg-rose-500/10 px-3 py-2 text-left text-rose-300">{beforeLabel}</th>
            <th colSpan={2} className="border-b border-white/10 bg-emerald-500/10 px-3 py-2 text-left text-emerald-300">{afterLabel}</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => {
            if (s.type === 'row') return <tr key={s.i}>{cell(rows[s.i].left, 'left')}{cell(rows[s.i].right, 'right')}</tr>;
            const key = `${s.from}-${s.to}`;
            if (expanded.has(key)) return rows.slice(s.from, s.to).map((r, k) => <tr key={`${key}-${k}`}>{cell(r.left, 'left')}{cell(r.right, 'right')}</tr>);
            return (
              <tr key={key}>
                <td colSpan={4} className="bg-sky-500/5 px-3 py-1 text-center">
                  <button className="text-[11px] text-sky-300 hover:underline" onClick={() => setExpanded(new Set([...expanded, key]))}>⋯ show {s.to - s.from} unchanged lines</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
