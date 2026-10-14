// -----------------------------------------------------------------------------
// The "news" widget content, checked against the SDK's own validator.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { cardCount, httpsLink, messageWidget, newsWidget } from '../src/widget.js';
import { T } from '../src/i18n.js';

const NOW = Date.parse('2026-10-14T06:00:00Z');
const article = (id, minutesAgo, extra = {}) => ({
  id,
  title: `Article ${id} with a rather long title that will not fit in sixty characters`,
  link: `http://example.org/${id}`,
  summary: `Summary of ${id}`,
  published: minutesAgo === null ? null : new Date(NOW - minutesAgo * 60_000).toISOString(),
  ...extra,
});

test('a card per article: title, source, age badge, summary and https link; count', () => {
  const content = newsWidget({
    title: T.widget.allFeeds,
    feeds: [
      {
        name: 'Le Monde',
        readAt: new Date(NOW - 120_000).toISOString(),
        items: [article('a', 30), article('b', 300)],
      },
      {
        name: 'Debian',
        readAt: new Date(NOW - 60_000).toISOString(),
        items: [article('c', 90), article('d', null)],
      },
    ],
    count: 3,
    now: NOW,
    language: 'fr',
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, 'Actualités');
  const cards = content.components.find((c) => c.type === 'card-list');
  assert.equal(cards.display, 'list');
  assert.deepEqual(
    cards.items.map((i) => [i.subtitle, i.badge?.text]),
    [
      ['Le Monde', '30 min'],
      ['Debian', '1 h'],
      ['Le Monde', '5 h'],
    ],
  );
  assert.ok(cards.items[0].title.length <= 60 && cards.items[0].title.endsWith('…'));
  assert.equal(cards.items[0].links[0].url, 'https://example.org/a');
  assert.equal(cards.items[0].badge.color, 'primary');
  assert.equal(cards.items[0].description, 'Summary of a');
  const caption = content.components.at(-1);
  assert.equal(caption.variant, 'caption');
  assert.equal(caption.text.fr, 'Mis à jour il y a 1 min');
  assert.equal(cardCount(undefined), 5);
  assert.equal(cardCount('3'), 3);
  assert.equal(cardCount(50), 8);
  assert.equal(cardCount(0), 5);
  assert.equal(httpsLink('http://a.example/x'), 'https://a.example/x');
  assert.equal(httpsLink('https://a.example/x'), 'https://a.example/x');
  assert.equal(httpsLink(null), null);
});

test('the empty states are valid contents too', () => {
  const states = [
    newsWidget({ title: 'Feed', feeds: [{ name: 'Feed', items: [] }], now: NOW }),
    newsWidget({
      title: 'Feed',
      feeds: [{ name: 'Feed', items: [], error: 'HTTP 404' }],
      now: NOW,
    }),
    newsWidget({
      title: 'Feed',
      feeds: [{ name: 'Feed', readAt: new Date(NOW).toISOString(), items: [] }],
      now: NOW,
    }),
    messageWidget(T.widget.allFeeds, T.widget.noFeed),
  ];
  for (const content of states) {
    assert.deepEqual(validateWidgetContent(content), []);
  }
  assert.equal(states[0].components[1].text.en, 'Waiting for the first reading…');
  assert.match(states[1].components[1].text.en, /unreachable/);
  assert.equal(states[2].components[1].text.en, 'No article in this feed');
});
