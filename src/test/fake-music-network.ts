/**
 * A `NetworkClient` that answers music_api's routes from the fake client.
 *
 * music_client's React Query hooks build their own `MusicClient` from the
 * context's `NetworkClient`, so a component reading its project list through
 * `useProjects` never touches the `FakeMusicClient` the rest of a test seeds
 * and inspects. This puts the two back together: each request is routed to the
 * same fake instance, and the answer wrapped in the server's envelope — so a
 * project created through the store shows up in a list fetched through a hook,
 * exactly as it would against one server.
 *
 * Only the routes this app reaches through hooks are routed. Anything else
 * answers 500, so a hook reaching for something unexpected fails loudly rather
 * than quietly succeeding with nothing.
 */
import type { NetworkClient, NetworkRequestOptions, NetworkResponse } from '@sudobility/types';

type FakeLike = Record<string, unknown>;

type Route = {
  method: string;
  pattern: RegExp;
  call: (fake: FakeLike, match: RegExpMatchArray, query: URLSearchParams, body: unknown) => unknown;
};

const TOKEN = 'test-token';

function invoke(fake: FakeLike, name: string, ...args: unknown[]): unknown {
  const method = fake[name];
  if (typeof method !== 'function') throw new Error(`fake client has no ${name}`);
  return (method as (...a: unknown[]) => unknown).apply(fake, args);
}

const ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: /^\/projects$/,
    call: (fake, _m, query) =>
      invoke(fake, 'listProjects', TOKEN, {
        ...(query.get('search') ? { search: query.get('search') } : {}),
        ...(query.get('sort') ? { sort: query.get('sort') } : {}),
      }),
  },
  {
    method: 'POST',
    pattern: /^\/projects$/,
    call: (fake, _m, _q, body) => invoke(fake, 'createProject', body, TOKEN),
  },
  {
    method: 'GET',
    pattern: /^\/projects\/transcribe\/capability$/,
    call: (fake) => invoke(fake, 'getTranscriptionCapability', TOKEN),
  },
  {
    method: 'POST',
    pattern: /^\/projects\/([^/]+)\/duplicate$/,
    call: (fake, m, _q, body) =>
      invoke(fake, 'duplicateProject', decodeURIComponent(m[1]!), body ?? {}, TOKEN),
  },
  {
    method: 'POST',
    pattern: /^\/projects\/([^/]+)\/generation\/cancel$/,
    call: (fake, m) => invoke(fake, 'cancelProjectGeneration', decodeURIComponent(m[1]!), TOKEN),
  },
  {
    method: 'DELETE',
    pattern: /^\/projects\/([^/]+)$/,
    call: (fake, m) => invoke(fake, 'deleteProject', decodeURIComponent(m[1]!), TOKEN),
  },
  {
    method: 'POST',
    pattern: /^\/jobs$/,
    call: (fake, _m, _q, body) => invoke(fake, 'createJob', body, TOKEN),
  },
  { method: 'GET', pattern: /^\/me$/, call: (fake) => invoke(fake, 'getCurrentUser', TOKEN) },
];

async function decodeBody(body: unknown): Promise<unknown> {
  if (typeof body === 'string') return JSON.parse(body);
  if (body instanceof Blob) {
    // Bodies over a kilobyte go up gzipped where the platform can; undo it.
    const stream = new Response(body).body;
    if (!stream) return undefined;
    return JSON.parse(
      await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).text(),
    );
  }
  return body;
}

export function fakeMusicNetwork(fake: object): NetworkClient {
  const request = async <T>(
    url: string,
    options?: NetworkRequestOptions | null,
  ): Promise<NetworkResponse<T>> => {
    const parsed = new URL(url, 'http://test.local');
    const path = parsed.pathname.replace(/^\/api\/v1/, '');
    const method = options?.method ?? 'GET';
    let status = 200;
    let envelope: unknown;
    const route = ROUTES.find((r) => r.method === method && r.pattern.test(path));
    try {
      if (!route) throw new Error(`unrouted ${method} ${path}`);
      const data = await route.call(
        fake as FakeLike,
        path.match(route.pattern)!,
        parsed.searchParams,
        await decodeBody(options?.body),
      );
      envelope = { success: true, data: data ?? { ok: true } };
    } catch (err) {
      // The error's own shape when it carries one (an `ApiError` a test threw
      // on purpose keeps its status); a plain failure is a server error.
      const typed = err as { status?: number; code?: string; message?: string };
      status = typed.status ?? 500;
      envelope = { success: false, error: typed.message ?? 'failed', code: typed.code };
    }
    const ok = status >= 200 && status < 300;
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      headers: {},
      data: envelope as T,
    } as NetworkResponse<T>;
  };
  return {
    request,
    get: (u, o) => request(u, o ?? undefined),
    post: (u, b, o) => request(u, { ...o, method: 'POST', body: b as never }),
    put: (u, b, o) => request(u, { ...o, method: 'PUT', body: b as never }),
    delete: (u, o) => request(u, { ...o, method: 'DELETE' }),
  };
}
