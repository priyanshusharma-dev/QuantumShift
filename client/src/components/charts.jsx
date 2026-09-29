import { RISK_COLORS } from '../lib/format';

export const axisProps = { stroke: 'rgba(148,163,184,0.25)', tick: { fill: '#9aa6bf', fontSize: 11 }, tickLine: false, axisLine: { stroke: 'rgba(148,163,184,0.2)' } };
export const gridProps = { strokeDasharray: '0', vertical: false, stroke: 'rgba(148,163,184,0.10)' };

/** Dark tooltip; text in text tokens, a colored swatch carries identity. */
export function ChartTooltip({ active, payload, label, unit = '', labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0b1224]/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {label !== undefined && <div className="mb-1 font-semibold text-slate-100">{labelFormatter ? labelFormatter(label) : label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="flex items-center gap-2 text-slate-300">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color || p.payload?.fill }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums text-slate-100">{p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}

/** Legend that always pairs swatch + name (identity is never color-only). */
export function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

export const riskLegend = [
  { name: 'RED · immediate', color: RISK_COLORS.RED },
  { name: 'YELLOW · planned', color: RISK_COLORS.YELLOW },
  { name: 'GREEN · quantum-safe', color: RISK_COLORS.GREEN },
];
