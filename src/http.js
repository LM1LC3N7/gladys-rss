// -----------------------------------------------------------------------------
// The only place that talks to the network: one GET of a feed, with the
// safety rules of the integration (see CLAUDE.md):
//   - http: and https: only, at every redirect too;
//   - at most MAX_REDIRECTS redirects, followed by hand so each is checked;
//   - one timeout for the whole read, body included;
//   - the body is streamed and abandoned past MAX_BYTES (decompressed);
//   - credentials in the URL become an Authorization header, sent to that
//     origin only, and never appear in an error message;
//   - conditional GET (If-None-Match / If-Modified-Since).
// The tests replace `fetch` with `setFetch()`.
// -----------------------------------------------------------------------------

import { ACCEPT, HTTP_TIMEOUT, MAX_BYTES, MAX_REDIRECTS, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/**
 * A failed read. `code` is one of: http, timeout, too_large, redirects,
 * protocol, network. The message never contains the URL (it may carry a
 * token): the caller names the feed by its name or host.
 */
export class FetchError extends Error {
  constructor(code, message, { status, retryAfterMs } = {}) {
    super(message);
    this.name = 'FetchError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Retry-After: seconds or an HTTP date -> milliseconds, or undefined. */
export function parseRetryAfter(value, now = Date.now()) {
  const text = String(value ?? '').trim();
  if (!text) {
    return undefined;
  }
  if (/^\d+$/.test(text)) {
    return Number(text) * 1000;
  }
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Split the credentials off a URL: { url (without them), authorization }. */
function withoutCredentials(url) {
  if (!url.username && !url.password) {
    return { url, authorization: undefined };
  }
  const decode = (text) => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };
  const user = decode(url.username);
  const password = decode(url.password);
  const clean = new URL(url.href);
  clean.username = '';
  clean.password = '';
  return {
    url: clean,
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
  };
}

function checkProtocol(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError('protocol', `refused ${url.protocol} URL (http and https only)`);
  }
}

/** Read a body stream up to `maxBytes`, cancelling it beyond. */
async function readCapped(body, maxBytes) {
  if (!body) {
    return new Uint8Array(0);
  }
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchError('too_large', `answer over ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

const discard = (response) => response.body?.cancel().catch(() => {});

/**
 * GET a feed. Resolves
 *   { status: 200, url, bytes, headers } or { status: 304, url, headers }
 * where `url` is the final address (after the redirects) and `headers` holds
 * etag, lastModified, cacheControl, contentType. Throws a FetchError.
 */
export async function fetchFeed(
  address,
  {
    etag,
    lastModified,
    timeout = HTTP_TIMEOUT,
    maxBytes = MAX_BYTES,
    maxRedirects = MAX_REDIRECTS,
  } = {},
) {
  const signal = AbortSignal.timeout(Math.max(1, timeout));
  try {
    const first = withoutCredentials(new URL(address));
    const origin = first.url.origin;
    let url = first.url;
    for (let hop = 0; ; hop += 1) {
      checkProtocol(url);
      const headers = { 'User-Agent': USER_AGENT, Accept: ACCEPT };
      if (etag) headers['If-None-Match'] = etag;
      if (lastModified) headers['If-Modified-Since'] = lastModified;
      // The credentials typed for a feed are for its own server only.
      if (first.authorization && url.origin === origin) {
        headers.Authorization = first.authorization;
      }
      const response = await fetchImpl(url.href, { headers, redirect: 'manual', signal });
      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get('location');
        await discard(response);
        if (!location) {
          throw new FetchError('http', `HTTP ${response.status} without a Location`, {
            status: response.status,
          });
        }
        if (hop >= maxRedirects) {
          throw new FetchError('redirects', `more than ${maxRedirects} redirects`);
        }
        url = withoutCredentials(new URL(location, url)).url;
        continue;
      }
      const meta = {
        etag: response.headers.get('etag') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined,
        cacheControl: response.headers.get('cache-control') ?? undefined,
        contentType: response.headers.get('content-type') ?? undefined,
      };
      if (response.status === 304) {
        await discard(response);
        return { status: 304, url: url.href, headers: meta };
      }
      if (!response.ok) {
        await discard(response);
        throw new FetchError('http', `HTTP ${response.status}`, {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        });
      }
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > maxBytes) {
        await discard(response);
        throw new FetchError('too_large', `answer over ${Math.round(maxBytes / 1024 / 1024)} MB`);
      }
      const bytes = await readCapped(response.body, maxBytes);
      return { status: 200, url: url.href, bytes, headers: meta };
    }
  } catch (err) {
    if (err instanceof FetchError) {
      throw err;
    }
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || signal.aborted) {
      throw new FetchError('timeout', `no answer within ${Math.round(timeout / 1000)} s`);
    }
    if (err instanceof TypeError && /URL/i.test(err.message)) {
      throw new FetchError('protocol', 'invalid address');
    }
    // Keep the cause code only (ENOTFOUND, ECONNREFUSED…): undici's messages
    // can quote the address.
    const code = err?.cause?.code ?? err?.code;
    throw new FetchError('network', code ? `network error (${code})` : 'network error');
  }
}
