// -----------------------------------------------------------------------------
// Feed documents -> articles: the three formats on real feeds (recorded on
// 2026-10-14, trimmed), and the corner cases of feeds in the wild.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBody, maxAgeOf, nextDelay, retryDelay } from '../src/feeds.js';
import { FeedError, parseDate, parseFeed, resolveLink, sortItems } from '../src/model.js';
import { fixture } from './helpers/fakeFetch.js';

test('RSS 2.0 (Discourse): CDATA HTML stripped, guid as id, empty summaries', () => {
  const feed = parseFeed(fixture('gladys-latest.rss'), {
    url: 'https://community.gladysassistant.com/latest.rss',
  });
  assert.equal(feed.format, 'RSS');
  assert.equal(feed.title, 'Gladys Assistant community - Sujets récents');
  assert.equal(feed.items.length, 3);
  const [first, second] = feed.items;
  assert.equal(first.id, 'community.gladysassistant.com-topic-11147');
  assert.equal(first.title, 'Intégration externe - Flipr (analyseur de piscine et Flipr Hub)');
  assert.equal(
    first.link,
    'https://community.gladysassistant.com/t/integration-externe-flipr-analyseur-de-piscine-et-flipr-hub/11147',
  );
  assert.match(first.summary, /^Bonjour à tous,\nPour ceux qui ont une piscine/);
  assert.ok(!/[<>]/.test(first.summary));
  assert.equal(first.published, '2026-10-13T22:02:02.000Z');
  assert.equal(second.summary, '', 'a description made of an image only');
});

test('RSS 2.0 (Le Monde): CDATA titles, media namespace, sorted by date', () => {
  const feed = parseFeed(fixture('lemonde-une.xml'), { url: 'https://www.lemonde.fr/rss/une.xml' });
  assert.equal(feed.items.length, 4);
  assert.match(feed.items[0].title, /^Mouvement lycéen : à l’approche/);
  assert.match(feed.items[0].summary, /^Les manifestations ont rassemblé/);
  // The feed lists a 17:00 article before an 18:23 one: the dates win.
  const sorted = sortItems(feed.items);
  assert.deepEqual(
    sorted.map((i) => i.published),
    [
      '2026-10-13T18:14:46.000Z',
      '2026-10-13T16:48:14.000Z',
      '2026-10-13T16:23:45.000Z',
      '2026-10-13T15:00:09.000Z',
    ],
  );
});

test('Atom (Rust blog): entries, alternate links, html content as summary', () => {
  const feed = parseFeed(fixture('rust-blog.atom'), { url: 'https://blog.rust-lang.org/feed.xml' });
  assert.equal(feed.format, 'Atom');
  assert.equal(feed.title, 'Rust Blog');
  assert.equal(feed.link, 'https://blog.rust-lang.org/');
  assert.equal(feed.items.length, 3);
  const [first, , third] = feed.items;
  assert.equal(
    first.id,
    'https://blog.rust-lang.org/2026/10/02/demoting-i686-windows-targets-to-std-only/',
  );
  assert.equal(first.link, first.id);
  assert.equal(first.published, '2026-10-02T00:00:00.000Z');
  assert.equal(
    first.summary,
    'With Rust 1.100.0, the following changes to 32-bit Windows targets will happen:',
  );
  assert.match(third.summary, /^At the end of August, we announced our first Maintainers/);
});

test('RSS 1.0 (Debian, RDF): items beside the channel, rdf:about, dc:date', () => {
  const feed = parseFeed(fixture('debian-news.rdf'), { url: 'https://www.debian.org/News/news' });
  assert.equal(feed.format, 'RSS 1.0');
  assert.equal(feed.title, 'Debian News');
  assert.equal(feed.items.length, 4);
  const [first] = feed.items;
  assert.equal(first.id, 'https://www.debian.org/News/2026/20260912');
  assert.equal(first.title, 'Updated Debian 13: 13.7 released');
  assert.equal(first.published, '2026-09-12T00:00:00.000Z');
  // Escaped <q> markup is stripped; the hard-wrapped source is one paragraph.
  assert.match(first.summary, /Debian 13 \(codename trixie\)\. This point release/);
});

test('relative links resolve against the feed URL and xml:base; other schemes are dropped', () => {
  const rss = parseFeed(
    `<rss><channel><title>T</title>
      <item><title>a</title><link>/news/1</link></item>
      <item><title>b</title><link>2.html</link></item>
      <item><title>c</title><link>javascript:alert(1)</link></item>
      <item><title>d</title><guid>https://example.org/permalink</guid></item>
      <item><title>e</title><guid isPermaLink="false">https://example.org/not-a-link</guid></item>
    </channel></rss>`,
    { url: 'https://example.org/feeds/main.xml' },
  );
  assert.deepEqual(
    rss.items.map((i) => i.link),
    [
      'https://example.org/news/1',
      'https://example.org/feeds/2.html',
      null,
      'https://example.org/permalink',
      null,
    ],
  );
  const atom = parseFeed(
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://blog.example/">
      <title type="html">My &lt;i&gt;blog&lt;/i&gt;</title>
      <entry xml:base="posts/"><id>urn:1</id><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">One <b>bold</b></div></title>
        <link rel="self" href="self.xml"/><link href="one.html"/></entry>
      <entry><id>urn:2</id><title>Two &amp; more</title><link rel="alternate" type="text/html" href="/two"/>
        <content src="https://blog.example/two.txt"/></entry>
    </feed>`,
    { url: 'https://feeds.example/atom' },
  );
  assert.equal(atom.title, 'My blog');
  assert.equal(atom.items[0].title, 'One bold');
  assert.equal(atom.items[0].link, 'https://blog.example/posts/one.html');
  assert.equal(atom.items[1].title, 'Two & more');
  assert.equal(atom.items[1].link, 'https://blog.example/two');
  assert.equal(atom.items[1].summary, '');
  assert.equal(resolveLink('ftp://x/y', 'https://a/'), null);
  assert.equal(resolveLink(`https://a/${'x'.repeat(1200)}`), null, 'too long for an event');
});

test('missing or odd dates: null, and the feed order is kept', () => {
  assert.equal(parseDate('Tue, 13 Oct 2026 20:14:46 +0200'), '2026-10-13T18:14:46.000Z');
  assert.equal(parseDate('Tue, 13 Oct 2026 20:14:46 GMT'), '2026-10-13T20:14:46.000Z');
  assert.equal(parseDate('Tue, 13 Oct 2026 20:14:46 CEST'), '2026-10-13T18:14:46.000Z');
  assert.equal(parseDate('2026-10-13T21:13:49+02:00'), '2026-10-13T19:13:49.000Z');
  assert.equal(parseDate('13/45/2026'), null);
  assert.equal(parseDate('12'), null);
  assert.equal(parseDate(''), null);
  const feed = parseFeed(
    `<rss><channel>
      <item><title>no date</title><guid>a</guid></item>
      <item><title>dated</title><guid>b</guid><pubDate>Tue, 13 Oct 2026 20:14:46 GMT</pubDate></item>
      <item><title>bad date</title><guid>c</guid><pubDate>yesterday</pubDate></item>
    </channel></rss>`,
  );
  assert.deepEqual(
    feed.items.map((i) => i.published),
    [null, '2026-10-13T20:14:46.000Z', null],
  );
  assert.deepEqual(
    sortItems(feed.items).map((i) => i.id),
    ['a', 'b', 'c'],
  );
});

test('items without title, id or anything; duplicates', () => {
  const feed = parseFeed(
    `<rss><channel><ttl>60</ttl>
      <item><description>&lt;p&gt;Only a description, long enough to become the title of the item&lt;/p&gt;</description><link>https://x/1</link></item>
      <item><link>https://x/2</link></item>
      <item></item>
      <item><title>Dup</title><guid>same</guid></item>
      <item><title>Dup again</title><guid>same</guid></item>
    </channel></rss>`,
  );
  assert.equal(feed.ttlMinutes, 60);
  assert.deepEqual(
    feed.items.map((i) => [i.id, i.title]),
    [
      ['https://x/1', 'Only a description, long enough to become the title of the item'],
      ['https://x/2', 'https://x/2'],
      ['same', 'Dup'],
    ],
  );
});

test('malformed documents: an HTML page or garbage is refused, a cut feed is read', () => {
  const html = '<!DOCTYPE html><html><head><title>Not found</title></head><body></body></html>';
  assert.throws(
    () => parseFeed(html),
    (err) => err instanceof FeedError && err.code === 'not_a_feed' && /<html>/.test(err.message),
  );
  assert.throws(() => parseFeed('{"items": []}'), FeedError);
  assert.throws(() => parseFeed(''), FeedError);
  const cut = fixture('lemonde-une.xml').slice(0, 2600);
  const feed = parseFeed(cut);
  assert.equal(feed.items.length, 2, 'what was read is kept');
  assert.match(feed.items[0].title, /^Mouvement lycéen/);
  assert.match(feed.items[1].title, /^Budget 2027/);
  assert.equal(feed.items[1].link, null, 'cut before its link');
});

test('charset: BOM, XML declaration, Content-Type, windows-1252', () => {
  const utf8 = Buffer.from('\ufeff<rss><channel><title>Été</title></channel></rss>');
  assert.match(decodeBody(utf8), /^<rss><channel><title>Été/);
  const latin = Buffer.from(
    '<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><title>Été \x92 \x80</title></channel></rss>',
    'latin1',
  );
  assert.equal(parseFeed(decodeBody(latin)).title, 'Été ’ €');
  const header = Buffer.from('<rss><channel><title>caf\xe9</title></channel></rss>', 'latin1');
  assert.equal(parseFeed(decodeBody(header, 'text/xml; charset=windows-1252')).title, 'café');
  assert.equal(parseFeed(decodeBody(header, 'text/xml; charset=bogus-42')).title, 'caf�');
});

test('pacing: max-age and ttl only lengthen the interval, within bounds', () => {
  const intervalMs = 15 * 60_000;
  assert.equal(maxAgeOf('public, max-age=3600'), 3_600_000);
  assert.equal(maxAgeOf('no-cache, no-store'), 0);
  assert.equal(maxAgeOf('private, must-revalidate, max-age=0'), 0);
  assert.equal(nextDelay({ intervalMs, maxAgeMs: 600_000 }), intervalMs);
  assert.equal(nextDelay({ intervalMs, maxAgeMs: 3_600_000 }), 3_600_000);
  assert.equal(nextDelay({ intervalMs, ttlMinutes: 120 }), 7_200_000);
  assert.equal(nextDelay({ intervalMs, maxAgeMs: 31_536_000_000 }), 6 * 3_600_000);
  assert.equal(retryDelay({ intervalMs, failures: 1 }), intervalMs);
  assert.equal(retryDelay({ intervalMs, failures: 3 }), 4 * intervalMs);
  assert.equal(retryDelay({ intervalMs, failures: 10 }), 4 * 3_600_000);
  assert.equal(retryDelay({ intervalMs, failures: 1, retryAfterMs: 7_200_000 }), 7_200_000);
});
