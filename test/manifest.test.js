// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  EVENT_KEYS,
  OUTPUT_KEYS,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  WIDGETS,
} from '../src/constants.js';
import { BOUNDS, DEFAULTS } from '../src/config.js';
import { DEFAULT_CARDS, MAX_CARDS } from '../src/widget.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'provider');
  assert.match(manifest.gladys_version, />=5\.1\.0/, 'provider, widgets and scenes need 5.1');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-rss:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.equal(manifest.location, undefined, 'a feed reader needs no house location');
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, lang === 'en' ? /not affiliated with the publishers/ : /sans lien avec/i);
    assert.ok(manifest.config_schema[0].description[lang].length <= 1000);
  }
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration and the widget settings match the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], key);
    if (typeof value === 'number') {
      assert.equal(fields[key].default, value, key);
      assert.deepEqual([fields[key].min, fields[key].max], BOUNDS[key], key);
    } else {
      assert.equal(fields[key].default, undefined, key);
    }
  }
  const count = manifest.widgets[0].settings.find((s) => s.key === 'count');
  assert.deepEqual([count.default, count.max], [DEFAULT_CARDS, MAX_CARDS]);
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    Object.values(SCENE_TRIGGERS),
  );
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    Object.values(WIDGETS),
  );
  assert.ok(index.includes('onSceneAction(SCENE_ACTIONS.LATEST'));
  assert.ok(index.includes('onWidgetGet(WIDGETS.NEWS'));
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  // The event carries exactly the trigger's filters and variables.
  const [trigger] = manifest.scene_triggers;
  const declared = new Set([...trigger.fields, ...trigger.variables].map((f) => f.key));
  assert.deepEqual([...declared].sort(), [...EVENT_KEYS].sort());
  assert.deepEqual(
    manifest.scene_actions[0].outputs.map((o) => o.key),
    OUTPUT_KEYS,
  );
});
