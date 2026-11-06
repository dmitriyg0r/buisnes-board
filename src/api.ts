export class HttpError extends Error {
  constructor(
    public status: number,
    public detail?: string,
  ) {
    super(detail ?? `HTTP ${status}`);
  }
}

export async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail: string | undefined;
    try {
      detail = ((await res.json()) as { error?: string }).error;
    } catch {
      /* тела нет */
    }
    // сессия истекла: просим приложение показать экран входа
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('bb:unauthorized'));
    throw new HttpError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
