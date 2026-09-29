import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, tokenStore, setUnauthorizedHandler } from '../lib/api';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const DEFAULT_USER = 'ava.chen';

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [users, setUsers] = useState([]);
  const [authError, setAuthError] = useState(null);
  const [settings, setSettings] = useState({ mode: 'demo', moscaZ: 8, integrations: [] });
  const [versions, setVersions] = useState({});
  const [jobs, setJobs] = useState({});
  const [agents, setAgents] = useState({});
  const [liveAudit, setLiveAudit] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [connected, setConnected] = useState(false);
  const toastId = useRef(0);

  const toast = useCallback((t) => {
    const id = ++toastId.current;
    setToasts((xs) => [...xs.slice(-4), { id, type: 'info', ...t }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.duration || 5200);
  }, []);
  const dismissToast = (id) => setToasts((xs) => xs.filter((x) => x.id !== id));
  const notifyError = useCallback((e, title = 'Action failed') => toast({ type: 'error', title, message: e?.message || String(e) }), [toast]);

  const login = useCallback(async (username) => {
    const r = await api('/auth/login', { method: 'POST', body: { username } });
    tokenStore.set(r.token);
    try { localStorage.setItem('qs.user', username); } catch { /* ignore */ }
    setUser(r.user);
    setPermissions(r.permissions);
    setAuthError(null);
    return r.user;
  }, []);

  const loadSettings = useCallback(async () => {
    try { setSettings(await api('/system/settings')); } catch { /* shown elsewhere */ }
  }, []);

  // Session bootstrap: resume token, otherwise demo SSO as the last-used (or CTO) persona.
  useEffect(() => {
    let cancelled = false;
    setUnauthorizedHandler(() => {
      tokenStore.set(null);
      setUser(null);
    });
    (async () => {
      try {
        setUsers(await api('/auth/users'));
        if (tokenStore.get()) {
          try {
            const me = await api('/auth/me');
            if (!cancelled) { setUser(me.user); setPermissions(me.permissions); }
            return;
          } catch { tokenStore.set(null); }
        }
        let last = DEFAULT_USER;
        try { last = localStorage.getItem('qs.user') || DEFAULT_USER; } catch { /* ignore */ }
        await login(last).catch(() => login(DEFAULT_USER));
      } catch (e) {
        if (!cancelled) setAuthError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [login]);

  useEffect(() => { if (user) loadSettings(); }, [user, loadSettings]);

  // Live stream (SSE): jobs, agents, audit entries and data invalidations.
  useEffect(() => {
    if (!user) return undefined;
    const token = tokenStore.get();
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener('hello', () => setConnected(true));
    es.onerror = () => setConnected(false);
    es.addEventListener('invalidate', (e) => {
      const { scopes } = JSON.parse(e.data);
      setVersions((v) => {
        const n = { ...v };
        for (const s of scopes) n[s] = (n[s] || 0) + 1;
        return n;
      });
    });
    es.addEventListener('job', (e) => {
      const job = JSON.parse(e.data);
      setJobs((j) => ({ ...j, [job.id]: job }));
    });
    es.addEventListener('agent', (e) => {
      const a = JSON.parse(e.data);
      setAgents((x) => ({ ...x, [a.key]: a }));
    });
    es.addEventListener('agents:reset', (e) => {
      const list = JSON.parse(e.data);
      setAgents(Object.fromEntries(list.map((a) => [a.key, a])));
    });
    es.addEventListener('audit', (e) => {
      const row = JSON.parse(e.data);
      setLiveAudit((xs) => [row, ...xs].slice(0, 60));
      setVersions((v) => ({ ...v, audit: (v.audit || 0) + 1 }));
    });
    return () => { es.close(); setConnected(false); };
  }, [user]);

  const setMode = useCallback(async (mode) => {
    const r = await api('/system/settings', { method: 'PUT', body: { mode } });
    setSettings((s) => ({ ...s, ...r }));
    toast({ type: 'success', title: mode === 'demo' ? 'Demo / Simulation Mode' : 'Real Integration mode', message: mode === 'demo' ? 'All external integrations are simulated.' : 'Public GitHub/GitLab downloads and watsonx.ai (if configured) are live. Unconfigured integrations report clearly.' });
  }, [toast]);

  const can = useCallback((perm) => permissions.includes(perm), [permissions]);

  const value = useMemo(() => ({
    user, users, permissions, can, login, authError, settings, setSettings, loadSettings, setMode,
    versions, jobs, agents, setAgents, liveAudit, connected, toast, notifyError,
  }), [user, users, permissions, can, login, authError, settings, loadSettings, setMode, versions, jobs, agents, liveAudit, connected, toast, notifyError]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Toasts toasts={toasts} dismiss={dismissToast} />
    </Ctx.Provider>
  );
}

function Toasts({ toasts, dismiss }) {
  const tone = { success: 'border-emerald-500/40', error: 'border-rose-500/50', info: 'border-sky-500/40', warning: 'border-amber-500/50' };
  const icon = { success: '✓', error: '!', info: 'i', warning: '!' };
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`glass animate-rise rounded-xl border-l-4 ${tone[t.type]} p-3 shadow-2xl`}>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">{icon[t.type]}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t.title}</div>
              {t.message && <div className="mt-0.5 text-xs leading-relaxed text-slate-300">{t.message}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-white" aria-label="Dismiss">×</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Data hook: fetches `path`, refetches when any of `scopes` is invalidated by
 * the live stream, and exposes reload(). Pass path = null to skip.
 */
export function useApi(path, scopes = []) {
  const { versions } = useApp();
  const [state, setState] = useState({ data: null, loading: !!path, error: null });
  const [tick, setTick] = useState(0);
  const key = scopes.map((s) => versions[s] || 0).join('.');
  const first = useRef(true);

  useEffect(() => {
    if (!path) return undefined;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: first.current || s.data === null, error: null }));
    api(path, { signal: ctrl.signal })
      .then((data) => { first.current = false; setState({ data, loading: false, error: null }); })
      .catch((e) => { if (e.name !== 'AbortError') setState((s) => ({ ...s, loading: false, error: e })); });
    return () => ctrl.abort();
  }, [path, key, tick]);

  return { ...state, reload: () => setTick((t) => t + 1), setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

/** Tracks a server job (scan/tests/demo) live via the SSE job events. */
export function useJob(jobId) {
  const { jobs } = useApp();
  const [initial, setInitial] = useState(null);
  useEffect(() => {
    if (!jobId) return;
    api(`/jobs/${jobId}`).then(setInitial).catch(() => {});
  }, [jobId]);
  return jobId ? jobs[jobId] || initial : null;
}
