import type { Config } from './config.js';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, msg: string) { super(msg); }
}

export class Api {
  constructor(private readonly cfg: Config) {}

  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.cfg.serverUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: this.cfg.token ? `Bearer ${this.cfg.token}` : '',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const err = json?.error ?? { code: 'internal_error', message: text };
      throw new ApiError(res.status, err.code, err.message);
    }
    return json as T;
  }
}
