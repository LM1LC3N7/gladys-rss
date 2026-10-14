// -----------------------------------------------------------------------------
// The tolerant XML parser: what feeds really contain, and what an attacker
// could put in one.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NS, XmlError, attrOf, childOf, childrenOf, parseXml, textOf } from '../src/xml.js';

test('elements, attributes, CDATA, comments, processing instructions', () => {
  const root = parseXml(
    '\ufeff<?xml version="1.0"?><?xml-stylesheet href="x.css"?>\n<!-- c -->' +
      '<rss version="2.0"><channel><title>A &amp; B</title>' +
      "<item><title><![CDATA[<b>Bold</b> & raw]]></title><guid isPermaLink='false'>1</guid>" +
      '<enclosure url="https://e/x.mp3" length="1"/></item></channel></rss>',
  );
  assert.equal(root.name, 'rss');
  assert.equal(root.attrs.version, '2.0');
  const channel = childOf(root, [''], 'channel');
  assert.equal(textOf(childOf(channel, [''], 'title')), 'A & B');
  const item = childOf(channel, [''], 'item');
  assert.equal(textOf(childOf(item, [''], 'title')), '<b>Bold</b> & raw');
  assert.equal(childOf(item, [''], 'guid').attrs.isPermaLink, 'false');
  assert.equal(childOf(item, [''], 'enclosure').attrs.url, 'https://e/x.mp3');
});

test('namespaces: declared prefixes, default namespace, well-known undeclared prefixes', () => {
  const root = parseXml(
    '<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:entry><a:id>1</a:id></a:entry></a:feed>',
  );
  assert.equal(root.ns, NS.ATOM);
  assert.equal(root.local, 'feed');
  assert.equal(textOf(childOf(childOf(root, [NS.ATOM], 'entry'), [NS.ATOM], 'id')), '1');
  const rdf = parseXml(
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">' +
      '<item rdf:about="https://x/1"><dc:date>2026-10-13</dc:date></item></rdf:RDF>',
  );
  const item = childOf(rdf, [NS.RSS1], 'item');
  assert.equal(attrOf(item, 'about'), 'https://x/1');
  // dc: is used without its xmlns declaration: still Dublin Core.
  assert.equal(textOf(childOf(item, [NS.DC], 'date')), '2026-10-13');
});

test('tolerant: stray &, HTML entities, wrong closing order, unquoted attribute, cut file', () => {
  const root = parseXml(
    '<rss><channel><title>Tom & Jerry &eacute;t&eacute;</title>' +
      '<item><title>One</b></title><link>https://x/?a=1&b=2</link></item>' +
      '<item><title>Two</item>' +
      '<item flag=yes><title>Three</title><description>cut here',
  );
  const channel = childOf(root, [''], 'channel');
  assert.equal(textOf(childOf(channel, [''], 'title')), 'Tom & Jerry été');
  const items = childrenOf(channel, [''], 'item');
  assert.equal(items.length, 3);
  assert.equal(textOf(childOf(items[0], [''], 'title')), 'One');
  assert.equal(textOf(childOf(items[0], [''], 'link')), 'https://x/?a=1&b=2');
  assert.equal(textOf(childOf(items[1], [''], 'title')), 'Two');
  assert.equal(items[2].attrs.flag, 'yes');
  assert.equal(textOf(childOf(items[2], [''], 'description')), 'cut here');
});

test('safe: the DOCTYPE entities are never expanded, prototype keys stay keys', () => {
  const laughs =
    '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;">' +
    '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>' +
    '<rss><channel><title>&lol3;</title></channel></rss>';
  const root = parseXml(laughs);
  assert.equal(textOf(childOf(childOf(root, [''], 'channel'), [''], 'title')), '&lol3;');
  const external = parseXml('<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>');
  assert.equal(textOf(external), '&x;');
  const proto = parseXml(
    '<r __proto__="x" constructor="y" xmlns:constructor="z"><constructor:a/></r>',
  );
  assert.equal(proto.attrs.__proto__, 'x');
  assert.equal(proto.attrs.constructor, 'y');
  assert.equal({}.polluted, undefined);
  assert.equal(proto.children[0].ns, 'z');
});

test('refused: no element at all, or a pathological nesting', () => {
  assert.throws(() => parseXml(''), XmlError);
  assert.throws(() => parseXml('just some text, no markup'), XmlError);
  assert.throws(() => parseXml('\u0000\u0001\u0002 < 3'), XmlError);
  assert.throws(() => parseXml('<a>'.repeat(500)), /nested too deeply/);
});
