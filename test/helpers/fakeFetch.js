// -----------------------------------------------------------------------------
// Fake `fetch` for the tests: routes requests to handlers, records every
// call, and fails loudly on an unexpected URL. No test touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export function fixture(name) {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

/** A morning after the fixtures were recorded (2026-10-13). */
export const FIXTURE_NOW = Date.parse('2026-10-14T06:00:00Z');

export const xml = (body, { status = 200, headers = {} } = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'application/rss+xml; charset=utf-8', ...headers },
  });

/** Install a fake fetch; `routes` is a list of [RegExp, handler({ url, headers, init })]. */
export function installFetch(routes) {
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const call = { url, headers: { ...init.headers }, init };
    calls.push(call);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) {
      throw new Error(`Unexpected network call in a test: ${url}`);
    }
    return route[1](call);
  });
  return { calls, restore: () => setFetch(previous) };
}

/** A small RSS 2.0 document: items { id, title, link?, description?, date? }. */
export function rss(items, { title = 'Test feed', ttl } = {}) {
  const body = items
    .map(
      (i) =>
        `<item><title>${i.title}</title>` +
        (i.link === null ? '' : `<link>${i.link ?? `https://example.org/${i.id}`}</link>`) +
        `<guid isPermaLink="false">${i.id}</guid>` +
        (i.description ? `<description>${i.description}</description>` : '') +
        (i.date ? `<pubDate>${new Date(i.date).toUTCString()}</pubDate>` : '') +
        '</item>',
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>` +
    `<title>${title}</title><link>https://example.org/</link>` +
    (ttl ? `<ttl>${ttl}</ttl>` : '') +
    `\n${body}\n</channel></rss>\n`
  );
}
