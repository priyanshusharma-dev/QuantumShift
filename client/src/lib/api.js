const TOKEN_KEY = 'qs.token';

export const tokenStore = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  },
};

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

/** Thin fetch wrapper: JSON in/out, bearer token, consistent errors. */
export async function api(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
  const token = tokenStore.get();
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Cannot reach the QuantumShift API — is the backend running on port 4000?', 0);
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    let details;
    try {
      const j = await res.json();
      msg = j.error?.message || msg;
      details = j.error?.details;
    } catch { /* non-JSON */ }
    throw new ApiError(msg, res.status, details);
  }
  if (raw) return res;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

/** Downloads an authenticated file response. */
export async function download(path, fallbackName = 'download') {
  const res = await api(path, { raw: true });
  const cd = res.headers.get('content-disposition') || '';
  const name = cd.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

/** Saves a client-side object as a JSON file. */
export function saveJson(obj, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
