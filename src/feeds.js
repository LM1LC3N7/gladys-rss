// -----------------------------------------------------------------------------
// Reading one feed: the conditional GET (src/http.js), the bytes decoded in
// the right charset, the document parsed (src/model.js), and the pacing hints
// the publisher gave (Cache-Control max-age, RSS ttl, Retry-After).
// -----------------------------------------------------------------------------

import { MAX_BACKOFF, MAX_DELAY } from './constants.js';
import { fetchFeed } from './http.js';
import { parseFeed } from './model.js';

// Node decodes "windows-1252" as Latin-1: the 0x80-0x9F range (€, ’, “, …)
// comes out as control characters. These are the characters it should be.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

function decoderFor(label) {
  try {
    return new TextDecoder(label);
  } catch {
    return undefined; // unknown or unsupported charset
  }
}

/**
 * The text of a feed. The charset comes from the byte order mark, else the
 * XML declaration (written by the generator that produced the bytes), else
 * the Content-Type header (often a server default), else UTF-8.
 */
export function decodeBody(bytes, contentType = '') {
  const b = bytes;
  let label;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    label = 'utf-8';
  } else if (b[0] === 0xfe && b[1] === 0xff) {
    label = 'utf-16be';
  } else if (b[0] === 0xff && b[1] === 0xfe) {
    label = 'utf-16le';
  } else {
    const head = Buffer.from(b.subarray(0, 200)).toString('latin1');
    label =
      /^<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(head)?.[1] ??
      /charset\s*=\s*"?([A-Za-z0-9._:-]+)/i.exec(contentType)?.[1];
  }
  const decoder = (label && decoderFor(label)) || new TextDecoder('utf-8');
  let text = decoder.decode(b);
  if (decoder.encoding === 'windows-1252') {
    text = text.replace(/[\u0080-\u009f]/g, (c) => CP1252[c.charCodeAt(0) - 0x80]);
  }
  return text.replace(/^\ufeff/, '');
}

/** Cache-Control -> the max-age in milliseconds (0 for no-store/no-cache). */
export function maxAgeOf(cacheControl) {
  const text = String(cacheControl ?? '').toLowerCase();
  if (/(^|,)\s*(no-store|no-cache)\b/.test(text)) {
    return 0;
  }
  const match = /(?:^|,)\s*max-age\s*=\s*"?(\d{1,10})"?/.exec(text);
  return match ? Number(match[1]) * 1000 : 0;
}

/**
 * When to read a feed again: the configured interval, or longer when the
 * publisher asks for it (max-age, ttl), within MAX_DELAY.
 */
export function nextDelay({ intervalMs, maxAgeMs = 0, ttlMinutes = null }) {
  const asked = Math.max(maxAgeMs, (ttlMinutes ?? 0) * 60_000);
  return Math.max(intervalMs, Math.min(asked, MAX_DELAY));
}

/**
 * When to retry a failing feed: the interval doubled at each failure, up to
 * MAX_BACKOFF, or longer when the server sent a Retry-After.
 */
export function retryDelay({ intervalMs, failures, retryAfterMs = 0 }) {
  const backoff = Math.min(intervalMs * 2 ** Math.max(0, failures - 1), MAX_BACKOFF);
  return Math.max(intervalMs, backoff, Math.min(retryAfterMs, MAX_DELAY));
}

/**
 * Read a feed. `cache` holds the validators of the previous answer.
 *   -> { notModified: true, maxAgeMs, etag, lastModified }
 *   -> { feed, maxAgeMs, etag, lastModified }
 * Throws a FetchError (network) or a FeedError (not a feed).
 */
export async function readFeed(url, cache = {}) {
  const answer = await fetchFeed(url, { etag: cache.etag, lastModified: cache.lastModified });
  const maxAgeMs = maxAgeOf(answer.headers.cacheControl);
  if (answer.status === 304) {
    return {
      notModified: true,
      maxAgeMs,
      etag: answer.headers.etag ?? cache.etag,
      lastModified: answer.headers.lastModified ?? cache.lastModified,
    };
  }
  const feed = parseFeed(decodeBody(answer.bytes, answer.headers.contentType), {
    url: answer.url,
  });
  return {
    feed,
    maxAgeMs,
    etag: answer.headers.etag,
    lastModified: answer.headers.lastModified,
  };
}
