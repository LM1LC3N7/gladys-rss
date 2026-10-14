// -----------------------------------------------------------------------------
// Text helpers (pure): entity decoding, HTML stripping, bounding. Every text a
// feed provides goes through `htmlToText` or `plainText` before it reaches
// Gladys. The scanners are linear (indexOf, no backtracking regex), so a
// hostile feed cannot make them slow.
// -----------------------------------------------------------------------------

// Named entities: the five of XML, then the HTML ones feeds actually use
// (Latin-1 by code point, typography). Unknown names are left as written.
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg ' +
  'plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 ' +
  'iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml ' +
  'Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash ' +
  'Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring ' +
  'aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve ' +
  'oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';
const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  OElig: 'Œ',
  oelig: 'œ',
  Scaron: 'Š',
  scaron: 'š',
  Yuml: 'Ÿ',
  fnof: 'ƒ',
  circ: 'ˆ',
  tilde: '˜',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200c',
  zwj: '\u200d',
  lrm: '',
  rlm: '',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  dagger: '†',
  Dagger: '‡',
  bull: '•',
  hellip: '…',
  permil: '‰',
  prime: '′',
  Prime: '″',
  lsaquo: '‹',
  rsaquo: '›',
  euro: '€',
  trade: '™',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  minus: '−',
  ne: '≠',
  le: '≤',
  ge: '≥',
};
LATIN1.split(' ').forEach((name, i) => {
  ENTITIES[name] = String.fromCharCode(160 + i);
});

const ENTITY = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

function codePoint(n) {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) {
    return '�';
  }
  return String.fromCodePoint(n);
}

/** Decode the character references; a stray `&` or an unknown name stays. */
export function decodeEntities(text) {
  if (!text.includes('&')) {
    return text;
  }
  return text.replace(ENTITY, (whole, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      return codePoint(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return Object.hasOwn(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

// Tags that separate blocks of text: replaced by a line break.
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'ul',
]);
// Elements whose content is never text.
const SKIPPED = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object'];

const isTagStart = (c) => /[A-Za-z/!?]/.test(c ?? '');

/**
 * Remove the markup of an HTML fragment: tags, comments, scripts and styles.
 * Block tags become line breaks; a line break of the source is a mere space
 * in HTML. Entities are NOT decoded here, so a text "&lt;b&gt;" stays a text
 * once decoded, never a tag.
 */
export function stripTags(html) {
  let out = '';
  const text = (chunk) => chunk.replace(/\s+/g, ' ');
  let pos = 0;
  const lower = html.toLowerCase();
  while (pos < html.length) {
    const lt = html.indexOf('<', pos);
    if (lt === -1) {
      out += text(html.slice(pos));
      break;
    }
    out += text(html.slice(pos, lt));
    if (!isTagStart(html[lt + 1])) {
      // "a < b": a lone `<` is text.
      out += '<';
      pos = lt + 1;
      continue;
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      pos = end === -1 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) {
      break; // an unfinished tag at the end: dropped
    }
    const name = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(lt, Math.min(gt + 1, lt + 40)));
    const tag = name?.[1].toLowerCase();
    pos = gt + 1;
    if (tag && html[lt + 1] !== '/' && SKIPPED.includes(tag) && html[gt - 1] !== '/') {
      const end = lower.indexOf(`</${tag}`, pos);
      const close = end === -1 ? -1 : html.indexOf('>', end);
      pos = close === -1 ? html.length : close + 1;
      continue;
    }
    if (tag && BLOCKS.has(tag)) {
      out += '\n';
    } else if (tag === 'td' || tag === 'th' || tag === 'img') {
      out += ' ';
    }
  }
  return out;
}

// Invisible or misleading characters: C0/C1 controls (but tab and line
// breaks) and the bidirectional overrides that can disguise a text.
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g; // eslint-disable-line no-control-regex

/** Cut to `max` characters on a word boundary when one is close, with "…". */
export function truncate(text, max) {
  if (text.length <= max) {
    return text;
  }
  let cut = max - 1;
  const space = text.lastIndexOf(' ', cut);
  if (space > max * 0.8) {
    cut = space;
  }
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    cut -= 1; // never split a surrogate pair
  }
  return `${text.slice(0, cut).trimEnd()}…`;
}

/**
 * Normalize a text: controls removed, spaces collapsed, at most one line
 * break in a row (or none with `singleLine`), bounded to `max`.
 */
export function cleanText(text, { max = Infinity, singleLine = false } = {}) {
  let clean = String(text ?? '')
    .replace(CONTROLS, '')
    .replace(/\r\n?/g, '\n');
  clean = singleLine
    ? clean.replace(/\s+/g, ' ')
    : clean
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ ?\n[\s]*/g, '\n')
        .trim();
  return truncate(clean.trim(), max);
}

// A description can be huge (a whole article): only its start is worth
// stripping when at most LIMITS.SUMMARY characters are kept.
const HTML_SCAN = 100_000;

/** An HTML fragment (RSS description, Atom type="html") -> bounded text. */
export function htmlToText(html, options) {
  return cleanText(decodeEntities(stripTags(String(html ?? '').slice(0, HTML_SCAN))), options);
}

/** A plain text (Atom type="text") -> bounded text. */
export function plainText(text, options) {
  return cleanText(String(text ?? '').slice(0, HTML_SCAN), options);
}

/** Lower case without accents: "Été" and "ete" match. */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
