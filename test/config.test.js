// -----------------------------------------------------------------------------
// The configuration: the `feeds` grammar and the bounds.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseFeedEntry } from '../src/config.js';

test('feeds: commas or new lines, a custom name after a space or a |', () => {
  const config = normalizeConfig({
    feeds:
      'https://www.lemonde.fr/rss/une.xml Le Monde,\n' +
      'https://community.gladysassistant.com/latest.rss|Forum Gladys\r\n' +
      '  https://blog.rust-lang.org/feed.xml  ,https://www.lemonde.fr/rss/une.xml duplicate',
  });
  assert.deepEqual(config.feeds, [
    { url: 'https://www.lemonde.fr/rss/une.xml', name: 'Le Monde' },
    { url: 'https://community.gladysassistant.com/latest.rss', name: 'Forum Gladys' },
    { url: 'https://blog.rust-lang.org/feed.xml', name: undefined },
  ]);
  assert.deepEqual(config.invalid, []);
  assert.deepEqual(parseFeedEntry('https://x.example/feed | My | blog'), {
    url: 'https://x.example/feed',
    name: 'My | blog',
  });
});

test('only http(s) URLs (refused entries by position), defaults and bounds, keywords', () => {
  const config = normalizeConfig({
    feeds:
      'file:///etc/passwd, javascript:alert(1), www.example.org/feed, http://ok.example/rss#top',
  });
  assert.deepEqual(config.feeds, [{ url: 'http://ok.example/rss', name: undefined }]);
  assert.deepEqual(config.invalid, [1, 2, 3]);
  assert.deepEqual(normalizeConfig(), {
    feeds: [],
    invalid: [],
    interval: DEFAULTS.interval,
    maxItems: DEFAULTS.max_items,
    keywords: [],
  });
  const bounded = normalizeConfig({
    interval: 1,
    max_items: '500',
    keywords: 'Gladys, Zigbee ,, gladys, Gladys',
  });
  assert.equal(bounded.interval, 5, 'never below 5 minutes');
  assert.equal(bounded.maxItems, 50);
  assert.deepEqual(bounded.keywords, ['Gladys', 'Zigbee', 'gladys']);
  assert.equal(normalizeConfig({ interval: 'abc' }).interval, 15);
});
