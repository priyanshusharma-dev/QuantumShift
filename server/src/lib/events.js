import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

/** In-process event bus fanned out to browsers over Server-Sent Events. */
export const bus = new EventEmitter();
bus.setMaxListeners(200);

export const emit = (type, payload) => bus.emit('event', { type, payload, at: new Date().toISOString() });

/** Tells connected dashboards which data scopes changed so they can refetch. */
export const invalidate = (...scopes) => emit('invalidate', { scopes });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Jobs: long-running operations (scans, test runs, the end-to-end demo) are
// tracked here and streamed step-by-step to the UI.
// ---------------------------------------------------------------------------
const jobs = new Map();
const MAX_JOBS = 100;

export function createJob(type, title, steps, meta = {}) {
  const job = {
    id: crypto.randomUUID(),
    type,
    title,
    status: 'running',
    progress: 0,
    steps: steps.map((s) => ({ ...s, status: 'pending', progress: 0, message: '', startedAt: null, finishedAt: null })),
    result: null,
    error: null,
    meta,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  if (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
  emit('job', job);
  return job;
}

const recompute = (job) => {
  const total = job.steps.reduce((a, s) => a + (s.status === 'done' || s.status === 'skipped' ? 100 : s.progress), 0);
  job.progress = Math.round(total / Math.max(1, job.steps.length));
};

export function updateStep(job, key, patch) {
  const step = job.steps.find((s) => s.key === key);
  if (!step) return;
  if (patch.status === 'running' && !step.startedAt) step.startedAt = new Date().toISOString();
  if ((patch.status === 'done' || patch.status === 'error' || patch.status === 'skipped') && !step.finishedAt) {
    step.finishedAt = new Date().toISOString();
    if (patch.status === 'done') step.progress = 100;
  }
  Object.assign(step, patch);
  recompute(job);
  emit('job', job);
}

export function finishJob(job, result) {
  job.status = 'completed';
  job.result = result ?? null;
  job.progress = 100;
  job.finishedAt = new Date().toISOString();
  emit('job', job);
}

export function failJob(job, error) {
  job.status = 'failed';
  job.error = error?.message || String(error);
  job.finishedAt = new Date().toISOString();
  const running = job.steps.find((s) => s.status === 'running');
  if (running) {
    running.status = 'error';
    running.message = job.error;
  }
  emit('job', job);
}

export const getJob = (id) => jobs.get(id) || null;
export const listJobs = () => [...jobs.values()].reverse();
