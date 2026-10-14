// -----------------------------------------------------------------------------
// Readings -> "new article" events: dedupe, flood cap, keyword.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_KEYS, MAX_EVENTS_PER_FEED, SCENE_TRIGGERS } from '../src/constants.js';
import { articleEvent, matchKeyword, newArticles, remember } from '../src/triggers.js';

const item = (id, extra = {}) => ({
  id,
  title: `Article ${id}`,
  link: null,
  summary: '',
  ...extra,
});

test('the first reading fires nothing; then only the ids never seen; bounded memory', () => {
  const first = [item('c'), item('b'), item('a')];
  assert.deepEqual(newArticles(undefined, first), []);
  const seen = remember(undefined, first);
  assert.deepEqual(newArticles(seen, first), []);
  const second = [item('e'), item('d'), item('c'), item('b')];
  assert.deepEqual(
    newArticles(seen, second).map((i) => i.id),
    ['d', 'e'],
  );
  // The memory is bounded but keeps the ids still in the feed.
  let small = remember(undefined, [item('keep')], 3);
  for (const id of ['x1', 'x2', 'x3', 'x4']) {
    small = remember(small, [item(id), item('keep')], 3);
  }
  assert.equal(small.size, 3);
  assert.ok(small.has('keep'));
  assert.ok(!small.has('x1'));
});

test('a flood is capped: the newest five are announced', () => {
  const seen = remember(undefined, [item('old')]);
  const burst = Array.from({ length: 12 }, (_, i) => item(`n${11 - i}`)); // n11 newest
  const fresh = newArticles(seen, burst);
  assert.equal(fresh.length, MAX_EVENTS_PER_FEED);
  assert.deepEqual(
    fresh.map((i) => i.id),
    ['n7', 'n8', 'n9', 'n10', 'n11'],
  );
});

test('keyword: the first configured one found in the title, spelled as configured', () => {
  assert.equal(matchKeyword('Une intégration Zigbee pour Gladys', ['gladys', 'Zigbee']), 'gladys');
  assert.equal(matchKeyword('Été chaud', ['ete']), 'ete');
  assert.equal(matchKeyword('Nothing here', ['gladys']), null);
  const event = articleEvent(
    'x'.repeat(150),
    item('1', {
      title: 'Gladys 5.1 released',
      link: 'https://example.org/1',
      summary: 's'.repeat(1500),
      published: '2026-10-13T20:00:00.000Z',
    }),
    ['5.1'],
  );
  assert.equal(event.key, SCENE_TRIGGERS.NEW_ARTICLE);
  assert.deepEqual(Object.keys(event.data), EVENT_KEYS);
  assert.equal(event.data.keyword, '5.1');
  assert.equal(event.data.feed.length, 100);
  assert.equal(event.data.summary.length, 1000);
  assert.equal(event.data.published, '2026-10-13T20:00:00.000Z');
  for (const value of Object.values(event.data)) {
    assert.ok(value === null || (typeof value === 'string' && value.length <= 1000));
  }
});
