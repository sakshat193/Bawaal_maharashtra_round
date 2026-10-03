export class ApiError extends Error {
  constructor(status, payload) {
    const message = payload?.message || (status >= 500
      ? 'Ticket service is unavailable. Start the Fair Drop API and Postgres, then retry.'
      : payload?.error || `Request failed (${status})`);
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload?.error || '';
    this.payload = payload;
  }
}

export async function apiRequest(path, { method = 'GET', token, body, signal } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}