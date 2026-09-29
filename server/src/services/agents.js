import { emit } from '../lib/events.js';
import { audit } from './audit.js';

/**
 * IBM Bob-inspired multi-agent registry. Each agent is a local orchestration
 * unit (this is NOT the IBM Bob product; see README → "Demo / Simulation Mode").
 */
export const AGENTS = [
  { key: 'discovery', name: 'Discovery Agent', mode: 'Ask', role: 'Ingests repositories, container images and cloud inventories.' },
  { key: 'ast', name: 'AST Analysis Agent', mode: 'Ask', role: 'Parses source into ASTs, applies Semgrep-style PQC rules and builds the CBOM.' },
  { key: 'risk', name: 'Risk Assessment Agent', mode: 'Ask', role: "Applies Mosca's theorem, scores assets RED/YELLOW/GREEN and writes Granite-style explanations." },
  { key: 'architect', name: 'Architect Agent', mode: 'Architect', role: 'Designs the phased hybrid → PQC migration roadmap.' },
  { key: 'refactor', name: 'Code Refactoring Agent', mode: 'Code', role: 'Generates ML-KEM / ML-DSA patches with a liboqs-style adapter.' },
  { key: 'test', name: 'Test Agent', mode: 'Code', role: 'Runs regression, interoperability, unit and security tests on patches.' },
  { key: 'compliance', name: 'Compliance Agent', mode: 'Ask', role: 'Checks changes against FIPS 203/204, NIST IR 8547 and CNSA 2.0 timelines.' },
  { key: 'audit', name: 'Audit Agent', mode: 'BobShell', role: 'Records every action in the tamper-evident BobShell audit trail.' },
];

const state = new Map(
  AGENTS.map((a) => [
    a.key,
    { ...a, status: 'idle', currentTask: null, progress: 0, lastAction: null, lastActionAt: null, executionMs: null, runs: 0, startedAt: null },
  ]),
);

const push = (key) => emit('agent', state.get(key));

export const agentName = (key) => state.get(key)?.name || key;

export function agentStart(key, task) {
  const a = state.get(key);
  if (!a) return;
  Object.assign(a, { status: 'running', currentTask: task, progress: 5, startedAt: Date.now() });
  push(key);
}

export function agentProgress(key, progress, task) {
  const a = state.get(key);
  if (!a) return;
  a.progress = Math.max(0, Math.min(100, Math.round(progress)));
  if (task) a.currentTask = task;
  push(key);
}

/** Marks the agent done and records the action in the BobShell audit log. */
export async function agentDone(key, { action, resource, result, user, status = 'success', details } = {}) {
  const a = state.get(key);
  if (a) {
    Object.assign(a, {
      status: status === 'failure' ? 'error' : status === 'pending' ? 'waiting' : 'completed',
      progress: 100,
      lastAction: action,
      lastActionAt: new Date().toISOString(),
      executionMs: a.startedAt ? Date.now() - a.startedAt : null,
      currentTask: null,
      runs: a.runs + 1,
    });
    push(key);
  }
  if (action) await audit({ agent: agentName(key), action, resource, result, user, status, details });
}

export function agentError(key, err) {
  const a = state.get(key);
  if (!a) return;
  Object.assign(a, { status: 'error', lastAction: `Error: ${err?.message || err}`, lastActionAt: new Date().toISOString(), currentTask: null });
  push(key);
}

export const listAgents = () => AGENTS.map((a) => state.get(a.key));

export function resetAgents() {
  for (const a of state.values()) Object.assign(a, { status: 'idle', currentTask: null, progress: 0 });
  emit('agents:reset', listAgents());
}
