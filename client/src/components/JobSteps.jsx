import { StepIcon, ProgressBar, cx } from './ui';

/** Live step list for a server job (scan pipeline, tests, complete demo). */
export function JobSteps({ job, steps: fallbackSteps, compact }) {
  const steps = job?.steps || fallbackSteps || [];
  return (
    <ol className="relative space-y-1">
      {steps.map((s, i) => {
        const status = s.status || 'pending';
        const active = status === 'running';
        return (
          <li key={s.key} className={cx('relative flex gap-3 rounded-xl px-3 py-2.5 transition', active && 'bg-sky-500/10 ring-1 ring-sky-400/30', status === 'waiting' && 'bg-amber-500/10 ring-1 ring-amber-400/30')}>
            {i < steps.length - 1 && <span className={cx('absolute left-[21px] top-8 h-[calc(100%-18px)] w-px', status === 'done' ? 'bg-emerald-500/40' : 'bg-white/10')} />}
            <span className="relative z-10 mt-0.5 rounded-full bg-ink-900"><StepIcon status={status} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx('text-sm font-medium', status === 'pending' ? 'text-slate-500' : 'text-slate-100')}>{compact ? '' : `${i + 1}. `}{s.label}</span>
                {s.agent && <span className="text-[11px] text-slate-500">{s.agent}</span>}
              </div>
              {s.message && <div className={cx('mt-0.5 text-xs leading-relaxed', status === 'error' ? 'text-rose-300' : status === 'waiting' ? 'text-amber-200' : 'text-slate-400')}>{s.message}</div>}
              {active && <ProgressBar value={s.progress || 5} animated className="mt-2 h-1.5" />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
