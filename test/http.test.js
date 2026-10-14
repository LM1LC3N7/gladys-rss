// -----------------------------------------------------------------------------
// The HTTP layer: conditional GET, redirects, size cap, timeout, credentials.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FetchError, fetchFeed, parseRetryAfter } from '../src/http.js';
import { USER_AGENT } from '../src/constants.js';
import { installFetch, xml } from './helpers/fakeFetch.js';

let fake;
afterEach(() => fake?.restore());

const redirect = (location, status = 301) =>
  new Response(null, { status, headers: location ? { location } : {} });

test('a GET identifies itself and sends the validators; 304 has no body', async () => {
  fake = installFetch([
    [
      /a\.xml/,
      (call) =>
        call.headers['If-None-Match'] === '"v1"'
          ? xml(null, { status: 304 })
          : xml('<rss/>', {
              headers: {
                etag: '"v1"',
                'last-modified': 'Tue, 13 Oct 2026 03:28:22 GMT',
                'cache-control': 'max-age=600',
              },
            }),
    ],
  ]);
  const first = await fetchFeed('https://example.org/a.xml');
  assert.equal(first.status, 200);
  assert.equal(Buffer.from(first.bytes).toString(), '<rss/>');
  assert.deepEqual(first.headers, {
    etag: '"v1"',
    lastModified: 'Tue, 13 Oct 2026 03:28:22 GMT',
    cacheControl: 'max-age=600',
    contentType: 'application/rss+xml; charset=utf-8',
  });
  assert.equal(fake.calls[0].headers['User-Agent'], USER_AGENT);
  assert.equal(fake.calls[0].init.redirect, 'manual', 'redirects are checked one by one');
  const second = await fetchFeed('https://example.org/a.xml', {
    etag: '"v1"',
    lastModified: 'Tue, 13 Oct 2026 03:28:22 GMT',
  });
  assert.equal(second.status, 304);
  assert.equal(fake.calls[1].headers['If-Modified-Since'], 'Tue, 13 Oct 2026 03:28:22 GMT');
});

test('redirects: relative ones followed up to 5, then refused; only http(s)', async () => {
  fake = installFetch([
    [
      /\/hop\/(\d+)$/,
      ({ url }) => {
        const n = Number(url.split('/').pop());
        return n < 5 ? redirect(`/hop/${n + 1}`, n % 2 ? 302 : 308) : xml('<rss/>');
      },
    ],
    [/\/loop$/, () => redirect('/loop')],
    [/\/to-file$/, () => redirect('file:///etc/passwd')],
    [/\/nowhere$/, () => redirect(null)],
  ]);
  const ok = await fetchFeed('https://example.org/hop/0');
  assert.equal(ok.url, 'https://example.org/hop/5');
  assert.equal(fake.calls.length, 6);
  await assert.rejects(fetchFeed('https://example.org/loop'), (err) => err.code === 'redirects');
  assert.equal(fake.calls.length, 6 + 6, 'the first request and 5 redirects');
  await assert.rejects(fetchFeed('https://example.org/to-file'), (err) => err.code === 'protocol');
  await assert.rejects(fetchFeed('https://example.org/nowhere'), (err) => err.code === 'http');
});

test('credentials in the URL: a header for that origin only, never in a message', async () => {
  fake = installFetch([
    [/feed\.example\/private/, () => redirect('https://cdn.example/private.xml', 302)],
    [/cdn\.example/, () => xml('denied', { status: 403 })],
  ]);
  const err = await fetchFeed('https://me:s3cr%40t@feed.example/private?token=abc').catch((e) => e);
  assert.ok(err instanceof FetchError);
  assert.equal(err.message, 'HTTP 403');
  assert.equal(fake.calls[0].url, 'https://feed.example/private?token=abc');
  assert.equal(
    fake.calls[0].headers.Authorization,
    `Basic ${Buffer.from('me:s3cr@t').toString('base64')}`,
  );
  assert.equal(fake.calls[1].headers.Authorization, undefined, 'not sent to another origin');
});

test('size cap: the stream is abandoned past the limit, a big Content-Length refused', async () => {
  let pulled = 0;
  let cancelled = false;
  const endless = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(64 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    );
  fake = installFetch([
    [/endless/, endless],
    [/declared/, () => xml('<rss/>', { headers: { 'content-length': String(3 * 1024 * 1024) } })],
  ]);
  await assert.rejects(fetchFeed('https://example.org/endless'), (err) => err.code === 'too_large');
  assert.ok(cancelled, 'the body stream was cancelled');
  assert.ok(pulled <= 34, `${pulled} chunks of 64 KB read for a 2 MB cap`);
  await assert.rejects(fetchFeed('https://example.org/declared'), /over 2 MB/);
});

test('timeout, network errors and HTTP errors carry no URL', async () => {
  fake = installFetch([
    [
      /slow/,
      ({ init }) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        }),
    ],
    [
      /down/,
      () => {
        const err = new TypeError('fetch failed');
        err.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND down.example' };
        throw err;
      },
    ],
    [/busy/, () => xml('slow down', { status: 429, headers: { 'retry-after': '120' } })],
  ]);
  // AbortSignal.timeout does not keep the process alive: a test timer does.
  const keepAlive = setTimeout(() => {}, 5000);
  await assert.rejects(fetchFeed('https://example.org/slow?key=k', { timeout: 20 }), (err) => {
    assert.equal(err.code, 'timeout');
    assert.ok(!err.message.includes('key'));
    return true;
  });
  clearTimeout(keepAlive);
  await assert.rejects(fetchFeed('https://down.example/feed?key=k'), (err) => {
    assert.equal(err.message, 'network error (ENOTFOUND)');
    return true;
  });
  await assert.rejects(fetchFeed('https://example.org/busy'), (err) => {
    assert.equal(err.status, 429);
    assert.equal(err.retryAfterMs, 120_000);
    return true;
  });
  await assert.rejects(fetchFeed('ftp://example.org/feed'), (err) => err.code === 'protocol');
  assert.equal(
    parseRetryAfter('Wed, 14 Oct 2026 07:00:00 GMT', Date.parse('2026-10-14T06:00:00Z')),
    3_600_000,
  );
  assert.equal(parseRetryAfter('soon'), undefined);
});
