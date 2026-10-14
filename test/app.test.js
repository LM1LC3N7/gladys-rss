// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and fake feeds.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { RssApp } from '../src/app.js';
import {
  ACTIONS,
  OUTPUT_KEYS,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  TICK,
  WIDGETS,
} from '../src/constants.js';
import { FIXTURE_NOW, fixture, installFetch, rss, xml } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const quiet = {
  info() {},
  warn: (...a) => process.env.DEBUG_TEST && console.error(...a),
  error() {},
  debug() {},
};

let fake;
afterEach(() => fake?.restore());

const MINUTE = 60_000;
const FIXTURES = {
  'https://community.gladysassistant.com/latest.rss': 'gladys-latest.rss',
  'https://www.lemonde.fr/rss/une.xml': 'lemonde-une.xml',
  'https://blog.rust-lang.org/feed.xml': 'rust-blog.atom',
  'https://www.debian.org/News/news': 'debian-news.rdf',
};

/**
 * `feeds`: URL -> handler(call) answering a Response; the fixtures above are
 * served by default.
 */
async function setup({ config = {}, feeds = {} } = {}) {
  const served = { ...feeds };
  for (const [url, file] of Object.entries(FIXTURES)) {
    served[url] ??= () => xml(fixture(file));
  }
  fake = installFetch([
    [
      /./,
      (call) => {
        const handler = served[call.url];
        if (!handler) throw new Error(`No fake feed at ${call.url}`);
        return handler(call);
      },
    ],
  ]);
  const gladys = createFakeGladys({ selector: 'rss', config });
  const timers = createFakeTimers();
  const clock = { now: FIXTURE_NOW };
  const app = new RssApp({ gladys, logger: quiet, now: () => clock.now, timers });
  gladys.onSceneAction(SCENE_ACTIONS.LATEST, (fields) => app.getLatestArticle(fields));
  gladys.onWidgetGet(WIDGETS.NEWS, (request) => app.getWidget(request));
  gladys.onAction(ACTIONS.TEST, () => app.testFeeds());
  gladys.onConfigUpdated((next) => app.start(next));
  await gladys.connect();
  /** Move the clock and run the minute tick. */
  const advance = async (ms) => {
    clock.now += ms;
    await timers.runIntervals();
  };
  return { app, gladys, timers, clock, served, advance };
}

const calls = (url) => fake.calls.filter((c) => c.url === url);
const widget = async (gladys, settings = {}, language = 'en') =>
  (await gladys.fake.widgetGet(WIDGETS.NEWS, { settings, language })).data.content;

test('start reads every feed once, fires nothing, and says it follows them', async () => {
  const { app, gladys, timers } = await setup();
  await app.start({
    feeds:
      'https://community.gladysassistant.com/latest.rss Forum Gladys, https://www.lemonde.fr/rss/une.xml|Le Monde\n' +
      'https://blog.rust-lang.org/feed.xml, https://www.debian.org/News/news',
  });
  assert.equal(fake.calls.length, 4);
  assert.deepEqual(
    [...app.feeds.values()].map((s) => [app.displayName(s), s.format, s.items.length]),
    [
      ['Forum Gladys', 'RSS', 3],
      ['Le Monde', 'RSS', 4],
      ['Rust Blog', 'Atom', 3],
      ['Debian News', 'RSS 1.0', 4],
    ],
  );
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first reading only learns');
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: { en: 'Following 4 feeds.', fr: '4 flux suivis.' },
  });
  assert.equal(timers.intervals()[0].ms, TICK);
  // Nothing is due one minute later: no request.
  timers.intervals()[0].fn();
  await app.refresh();
  assert.equal(fake.calls.length, 4);
});

test('a new article fires one event with its details; keyword and flood cap', async () => {
  const URL = 'https://news.example/feed.xml';
  const items = [
    { id: '1', title: 'First', date: FIXTURE_NOW - 3 * 3_600_000 },
    { id: '2', title: 'Second', date: FIXTURE_NOW - 2 * 3_600_000 },
  ];
  const { app, gladys, advance } = await setup({
    feeds: { [URL]: () => xml(rss(items, { title: 'Example news' })) },
  });
  await app.start({ feeds: `${URL} Example`, keywords: 'Zigbee, gladys' });
  items.unshift({
    id: '3',
    title: 'Gladys &amp; &lt;b&gt;Zigbee&lt;/b&gt;',
    link: '/articles/3',
    description: '&lt;p&gt;A new &lt;em&gt;integration&lt;/em&gt;.&lt;/p&gt;',
    date: FIXTURE_NOW + 5 * MINUTE,
  });
  await advance(10 * MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'not due before 15 minutes');
  await advance(5 * MINUTE);
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: SCENE_TRIGGERS.NEW_ARTICLE,
      data: {
        feed: 'Example',
        keyword: 'Zigbee',
        title: 'Gladys & Zigbee',
        link: 'https://news.example/articles/3',
        summary: 'A new integration.',
        published: new Date(FIXTURE_NOW + 5 * MINUTE).toISOString(),
      },
    },
  ]);
  assert.ok(gladys.fake.widgetRefreshes.includes(WIDGETS.NEWS));
  // The same content again: nothing.
  await advance(15 * MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 1);
  // Twelve articles at once: the five newest are announced, oldest first.
  for (let i = 4; i <= 15; i += 1) {
    items.unshift({ id: String(i), title: `Burst ${i}`, date: FIXTURE_NOW + i * MINUTE });
  }
  await advance(15 * MINUTE);
  const burst = gladys.fake.sceneEvents.slice(1).map((e) => e.data.title);
  assert.deepEqual(burst, ['Burst 11', 'Burst 12', 'Burst 13', 'Burst 14', 'Burst 15']);
  assert.equal(gladys.fake.sceneEvents[1].data.keyword, null);
});

test('conditional GET: a 304 keeps the articles; max-age and ttl lengthen the pace', async () => {
  const URL = 'https://cached.example/rss';
  const TTL = 'https://ttl.example/rss';
  const { app, gladys, advance } = await setup({
    feeds: {
      [URL]: (call) =>
        call.headers['If-None-Match'] === '"abc"'
          ? xml(null, { status: 304, headers: { 'cache-control': 'max-age=3600' } })
          : xml(rss([{ id: 'a', title: 'Cached article' }]), {
              headers: { etag: '"abc"', 'cache-control': 'public, max-age=3600' },
            }),
      [TTL]: () => xml(rss([{ id: 't', title: 'Slow feed' }], { ttl: 30 })),
    },
  });
  await app.start({ feeds: `${URL}, ${TTL}`, interval: 5 });
  assert.equal(calls(URL).length, 1);
  await advance(30 * MINUTE);
  assert.equal(calls(URL).length, 1, 'max-age=3600 is longer than the 5 min interval');
  assert.equal(calls(TTL).length, 2, 'ttl=30 is longer than the 5 min interval');
  await advance(30 * MINUTE);
  assert.equal(calls(URL).length, 2);
  assert.equal(calls(URL)[1].headers['If-None-Match'], '"abc"');
  assert.equal(app.feeds.get(URL).items[0].title, 'Cached article');
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('a failing feed: status, backoff, then recovery without false news', async () => {
  const URL = 'https://flaky.example/feed?token=s3cret';
  let up = false;
  const { app, gladys, advance } = await setup({
    feeds: {
      [URL]: () => (up ? xml(rss([{ id: '1', title: 'Back' }])) : xml('oops', { status: 503 })),
    },
  });
  await app.start({ feeds: URL });
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.equal(
    status.message.en,
    '1 of 1 feed unreachable: flaky.example (HTTP 503). Retrying later.',
  );
  assert.ok(!JSON.stringify(gladys.fake.connectionStatuses).includes('s3cret'));
  const failing = await widget(gladys);
  assert.deepEqual(validateWidgetContent(failing), []);
  assert.equal(failing.components[0].text, 'flaky.example');
  assert.match(failing.components[1].text.en, /unreachable/);
  await advance(15 * MINUTE);
  assert.equal(calls(URL).length, 2, 'retried after the interval');
  await advance(15 * MINUTE);
  assert.equal(calls(URL).length, 2, 'then after twice the interval');
  up = true;
  await advance(15 * MINUTE);
  assert.equal(calls(URL).length, 3);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'its first good reading only learns');
  const content = await widget(gladys);
  assert.equal(content.components[0].text, 'Test feed');
});

test('the widget: every feed, one by name or position, an unknown one', async () => {
  const { app, gladys } = await setup();
  await app.start({
    feeds: 'https://www.lemonde.fr/rss/une.xml Le Monde, https://www.debian.org/News/news',
  });
  const all = await widget(gladys, { count: '4' }, 'fr');
  assert.deepEqual(validateWidgetContent(all), []);
  assert.equal(all.components[0].text, 'Actualités');
  const cards = all.components.find((c) => c.type === 'card-list').items;
  assert.equal(cards.length, 4);
  assert.equal(cards[0].subtitle, 'Le Monde');
  assert.match(cards[0].title, /^Mouvement lycéen/);
  assert.equal(cards[0].badge.text, '11 h');
  const debian = await widget(gladys, { feed: 'debian news' });
  assert.equal(debian.components[0].text, 'Debian News');
  assert.equal(debian.components.find((c) => c.type === 'card-list').items.length, 4);
  const second = await widget(gladys, { feed: '1' });
  assert.equal(second.components[0].text, 'Le Monde');
  const unknown = await widget(gladys, { feed: 'Atlantis' });
  assert.deepEqual(validateWidgetContent(unknown), []);
  assert.match(unknown.components[1].text.en, /Unknown feed "Atlantis"/);
});

test('the scene action: latest article by feed and keyword', async () => {
  const { app, gladys } = await setup();
  await app.start({
    feeds:
      'https://www.lemonde.fr/rss/une.xml Le Monde, https://blog.rust-lang.org/feed.xml, https://www.debian.org/News/news',
    max_items: 3,
  });
  const latest = await gladys.fake.sceneAction(SCENE_ACTIONS.LATEST, {});
  assert.equal(latest.success, true);
  assert.deepEqual(Object.keys(latest.data.outputs), OUTPUT_KEYS);
  assert.equal(latest.data.outputs.feed, 'Le Monde');
  assert.equal(latest.data.outputs.count, 9, '3 kept per feed');
  const debian = await gladys.fake.sceneAction(SCENE_ACTIONS.LATEST, {
    feed: 'Debian News',
    keyword: 'DEBIAN 13',
  });
  assert.deepEqual(debian.data.outputs, {
    feed: 'Debian News',
    title: 'Updated Debian 13: 13.7 released',
    link: 'https://www.debian.org/News/2026/20260912',
    summary: debian.data.outputs.summary,
    published: '2026-09-12T00:00:00.000Z',
    count: 1,
  });
  assert.match(debian.data.outputs.summary, /^The Debian project is pleased/);
  const none = await gladys.fake.sceneAction(SCENE_ACTIONS.LATEST, { keyword: 'zzz' });
  assert.deepEqual(none.data.outputs, {
    feed: null,
    title: null,
    link: null,
    summary: null,
    published: null,
    count: 0,
  });
  const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.LATEST, { feed: 'Atlantis' });
  assert.equal(unknown.success, false);
});

test('the test button: one line per feed, refused entries by position', async () => {
  const { app, gladys } = await setup({
    feeds: {
      'https://gone.example/rss': () => xml('nope', { status: 404 }),
      'https://html.example/': () =>
        xml('<!DOCTYPE html><html><body>Hi</body></html>', {
          headers: { 'content-type': 'text/html' },
        }),
    },
  });
  const feeds =
    'https://www.debian.org/News/news, https://gone.example/rss Gone, file:///etc/passwd, https://html.example/';
  await app.start({ feeds });
  const result = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(result.success, true);
  assert.deepEqual(result.data.message.en.split('\n'), [
    'OK Debian News (www.debian.org): RSS 1.0, 4 articles, latest: "Updated Debian 13: 13.7 released"',
    'FAILED Gone (gone.example): HTTP 404',
    'FAILED html.example (html.example): not an RSS or Atom feed (<html> document)',
    'Ignored (not an http or https address): entry 3.',
  ]);
  assert.match(
    result.data.message.fr,
    /^OK Debian News \(www\.debian\.org\) : RSS 1\.0, 4 articles/,
  );
  assert.equal(calls('https://www.debian.org/News/news').length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'one feed of three works');
});

test('a configuration change keeps what was learned: no false "new" articles', async () => {
  const A = 'https://a.example/rss';
  const B = 'https://b.example/rss';
  const items = [{ id: '1', title: 'Old news' }];
  const { app, gladys, advance } = await setup({
    feeds: {
      [A]: () => xml(rss(items, { title: 'Feed A' })),
      [B]: () => xml(rss([{ id: 'b1', title: 'B news' }], { title: 'Feed B' })),
    },
  });
  await app.start({ feeds: A });
  await gladys.fake.configUpdated({ feeds: `${A} Renamed, ${B}` });
  assert.equal(calls(A).length, 1, 'A is not due yet');
  assert.equal(calls(B).length, 1, 'B is new: read now');
  assert.equal(gladys.fake.sceneEvents.length, 0);
  items.unshift({ id: '2', title: 'Fresh news' });
  await advance(15 * MINUTE);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.data.feed, e.data.title]),
    [['Renamed', 'Fresh news']],
  );
});

test('relative links follow the redirects; no feed configured', async () => {
  const { app, gladys } = await setup({
    feeds: {
      'https://moved.example/old': () =>
        new Response(null, { status: 301, headers: { location: '/new/feed.xml' } }),
      'https://moved.example/new/feed.xml': () =>
        xml(rss([{ id: '1', title: 'Moved', link: 'post.html' }])),
    },
  });
  await app.start({ feeds: 'https://moved.example/old' });
  assert.equal(
    app.feeds.get('https://moved.example/old').items[0].link,
    'https://moved.example/new/post.html',
  );
  await app.start({ feeds: '' });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /^No feed yet/);
  const empty = await widget(gladys);
  assert.deepEqual(validateWidgetContent(empty), []);
  assert.match(empty.components[1].text.en, /No feed configured/);
  assert.match((await gladys.fake.action(ACTIONS.TEST)).data.message.en, /^No feed yet/);
});
