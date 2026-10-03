/** @typedef {import('./schema').paths} ApiPaths */
/** @typedef {keyof ApiPaths | string} ApiPath */

let clockSkewMs = 0;

export class ApiError extends Error {
  constructor(status, code, data) {
    super(data?.message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function serverNow() {
  return Date.now() + clockSkewMs;
}

function updateClock(data) {
  if (typeof data?.server_time !== 'string') return;
  const serverTime = Date.parse(data.server_time);
  if (Number.isFinite(serverTime)) clockSkewMs = serverTime - Date.now();
}

function stored(key) {
  try {
    return globalThis.sessionStorage?.getItem(key) || null;
  } catch {
    return null;
  }
}

function clearIdentity() {
  try {
    globalThis.sessionStorage?.removeItem('fd.jwt');
  } catch {
    // The request error remains useful even when storage is unavailable.
  }
}

/**
 * @param {ApiPath} path
 * @param {{method?: string, body?: unknown, admin?: boolean, signal?: AbortSignal, includeHeaders?: boolean}} [options]
 */
export async function api(path, { method = 'GET', body, admin = false, signal, includeHeaders = false } = {}) {
  const headers = new Headers();
  const adminRoute = admin || String(path).startsWith('/api/admin/');
  const credential = stored(adminRoute ? 'fd.admin' : 'fd.jwt');
  if (credential) headers.set(adminRoute ? 'X-Admin-Key' : 'Authorization', adminRoute ? credential : `Bearer ${credential}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  });
  const contentType = response.headers.get('Content-Type') || '';
  const isJson = /(?:^|[\/+])json(?:\s*;|$)/i.test(contentType);
  const data = isJson
    ? await response.json()
    : await response.text();

  updateClock(data);
  if (!response.ok) {
    if (response.status === 401) clearIdentity();
    throw new ApiError(response.status, data?.error || 'request_failed', data);
  }
  return includeHeaders ? { data, headers: response.headers } : data;
}
