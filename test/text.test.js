// -----------------------------------------------------------------------------
// Entities, HTML stripping and bounds: every feed text goes through them.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, decodeEntities, fold, htmlToText, stripTags, truncate } from '../src/text.js';

test('entities: named, numeric, hex; a stray & or an unknown name stays', () => {
  assert.equal(
    decodeEntities('AT&amp;T &lt;b&gt; &quot;x&quot; &apos;y&apos;'),
    'AT&T <b> "x" \'y\'',
  );
  assert.equal(
    decodeEntities('caf&eacute; &laquo;&nbsp;oui&nbsp;&raquo; &hellip;'),
    'café «\u00a0oui\u00a0» …',
  );
  assert.equal(decodeEntities('&#233;&#xE9;&#X1F600;'), 'éé😀');
  assert.equal(
    decodeEntities('Q&A, R & D, &unknown; &#0; &#xD800;'),
    'Q&A, R & D, &unknown; \ufffd \ufffd',
  );
  // A name that is also an Object.prototype key is not an entity.
  assert.equal(decodeEntities('&constructor; &toString;'), '&constructor; &toString;');
});

test('stripTags: tags, comments, scripts and styles go; blocks become lines', () => {
  const html =
    '<p>One <b>bold</b> word.</p><script>alert("x")</script><style>p{}</style>' +
    '<!-- note --><ul><li>a</li><li>b</li></ul>Two<br/>Three<img src="x.png">!';
  assert.equal(cleanText(stripTags(html)), 'One bold word.\na\nb\nTwo\nThree !');
  // An escaped tag is text, never markup.
  assert.equal(htmlToText('&lt;script&gt;x&lt;/script&gt; 1 &lt; 2'), '<script>x</script> 1 < 2');
  // A lone "<" is text; an unfinished tag at the end is dropped.
  assert.equal(htmlToText('a < b and <i>c</i> <a href="x'), 'a < b and c');
  // A source line break is a space in HTML.
  assert.equal(htmlToText('wrapped\nline\n\n<p>next</p>'), 'wrapped line\nnext');
});

test('bounds: word boundary, ellipsis, no split surrogate, controls removed; fold', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('the quick brown fox jumps', 20), 'the quick brown fox…');
  assert.equal(truncate('abcdefghijklmnopqrstuvwxyz', 10), 'abcdefghi…');
  const emoji = truncate('aaaaaaaa😀😀😀', 10);
  assert.ok(!/[\ud800-\udbff]…$/.test(emoji), 'no lone high surrogate');
  assert.equal(cleanText('a\u0000b\u202ec\u0085d \t e', { singleLine: true }), 'abcd e');
  assert.equal(cleanText(' one \n\n\n two ', { singleLine: true }), 'one two');
  assert.equal(cleanText(' one \n\n\n two '), 'one\ntwo');
  assert.equal(htmlToText('x'.repeat(5000), { max: 1000 }).length, 1000);
  assert.equal(fold('  Été À Paris '), 'ete a paris');
  assert.equal(fold(undefined), '');
});
