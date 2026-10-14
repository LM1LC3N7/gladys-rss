// -----------------------------------------------------------------------------
// A small, tolerant XML parser for feeds (pure). Feeds in the wild are often
// not well-formed (a stray `&`, an HTML entity, a tag closed in the wrong
// order, a file cut short): a strict parser would refuse them, this one keeps
// what it can read, the way feed readers do.
//
// Safety: a single linear pass with indexOf (no backtracking regex), the
// DOCTYPE is skipped without expanding any entity it declares (no "billion
// laughs", no external entity), and the depth and node count are bounded.
// The input itself is bounded by the HTTP layer (MAX_BYTES).
//
// The tree: { name, ns, local, attrs, children } for an element, a plain
// string for a text (CDATA included). `ns` is the resolved namespace URI.
// -----------------------------------------------------------------------------

import { decodeEntities } from './text.js';

export const NS = {
  ATOM: 'http://www.w3.org/2005/Atom',
  ATOM03: 'http://purl.org/atom/ns#',
  RSS1: 'http://purl.org/rss/1.0/',
  RSS09: 'http://my.netscape.com/rdf/simple/0.9/',
  RDF: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  DC: 'http://purl.org/dc/elements/1.1/',
  CONTENT: 'http://purl.org/rss/1.0/modules/content/',
  MEDIA: 'http://search.yahoo.com/mrss/',
  XHTML: 'http://www.w3.org/1999/xhtml',
  XML: 'http://www.w3.org/XML/1998/namespace',
};

// A prefix used without its xmlns declaration (it happens) falls back to
// the namespace it always means in feeds.
const KNOWN_PREFIXES = {
  atom: NS.ATOM,
  rdf: NS.RDF,
  dc: NS.DC,
  content: NS.CONTENT,
  media: NS.MEDIA,
  xml: NS.XML,
};

const MAX_DEPTH = 128;
const MAX_NODES = 200_000;

export class XmlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XmlError';
  }
}

const NAME_START = /[A-Za-z_:À-￿]/;
const isSpace = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r';

/** Skip `<!DOCTYPE ... [ ... ]>` and other declarations, quotes and brackets aware. */
function skipDeclaration(text, from) {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '[') {
      depth += 1;
    } else if (c === ']') {
      depth = Math.max(0, depth - 1);
    } else if (c === '>' && depth === 0) {
      return i + 1;
    }
  }
  return text.length;
}

/** Read a start tag at `lt`: { name, attrs, selfClosing, end } or undefined. */
function readStartTag(text, lt) {
  let i = lt + 1;
  while (i < text.length && !isSpace(text[i]) && text[i] !== '>' && text[i] !== '/') {
    i += 1;
  }
  const name = text.slice(lt + 1, i);
  // Null-prototype objects: a name like `__proto__` or `constructor` is a
  // plain key here, never a way into Object.prototype.
  const attrs = Object.create(null);
  while (i < text.length) {
    while (isSpace(text[i])) i += 1;
    const c = text[i];
    if (c === undefined) {
      return undefined;
    }
    if (c === '>') {
      return { name, attrs, selfClosing: false, end: i + 1 };
    }
    if (c === '/') {
      if (text[i + 1] === '>') {
        return { name, attrs, selfClosing: true, end: i + 2 };
      }
      i += 1;
      continue;
    }
    const start = i;
    while (
      i < text.length &&
      !isSpace(text[i]) &&
      text[i] !== '=' &&
      text[i] !== '>' &&
      text[i] !== '/'
    ) {
      i += 1;
    }
    const attr = text.slice(start, i);
    while (isSpace(text[i])) i += 1;
    let value = '';
    if (text[i] === '=') {
      i += 1;
      while (isSpace(text[i])) i += 1;
      const quote = text[i];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, i + 1);
        if (close === -1) {
          return undefined;
        }
        value = text.slice(i + 1, close);
        i = close + 1;
      } else {
        // Unquoted value (not XML, but seen): up to a space or the end.
        const from = i;
        while (i < text.length && !isSpace(text[i]) && text[i] !== '>') i += 1;
        value = text.slice(from, i);
      }
    }
    if (attr && !(attr in attrs)) {
      attrs[attr] = decodeEntities(value);
    }
  }
  return undefined;
}

/** An element name -> its namespace URI and local name, in the open scopes. */
function resolve(qualified, scopes) {
  const colon = qualified.indexOf(':');
  const prefix = colon === -1 ? '' : qualified.slice(0, colon);
  const local = colon === -1 ? qualified : qualified.slice(colon + 1);
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    if (prefix in scopes[i]) {
      return { ns: scopes[i][prefix], local };
    }
  }
  const known = prefix.toLowerCase();
  return { ns: prefix && Object.hasOwn(KNOWN_PREFIXES, known) ? KNOWN_PREFIXES[known] : '', local };
}

/**
 * Parse a document into its root element. Throws an XmlError when there is
 * no element at all (an empty answer, a plain text, binary data).
 */
export function parseXml(text) {
  const doc = {
    name: '#document',
    ns: '',
    local: '#document',
    attrs: Object.create(null),
    children: [],
  };
  const stack = [doc];
  const scopes = [Object.create(null)];
  let nodes = 0;
  let pos = 0;
  const addText = (value) => {
    const parent = stack[stack.length - 1];
    if (parent === doc) {
      return; // text outside the root element is not content
    }
    const last = parent.children.length - 1;
    if (typeof parent.children[last] === 'string') {
      parent.children[last] += value; // one text node, however many pieces
    } else {
      parent.children.push(value);
    }
  };

  while (pos < text.length && nodes < MAX_NODES) {
    const lt = text.indexOf('<', pos);
    if (lt === -1) {
      addText(decodeEntities(text.slice(pos)));
      break;
    }
    if (lt > pos) {
      addText(decodeEntities(text.slice(pos, lt)));
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      pos = end === -1 ? text.length : end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      addText(text.slice(lt + 9, end === -1 ? text.length : end));
      pos = end === -1 ? text.length : end + 3;
    } else if (text.startsWith('<!', lt)) {
      pos = skipDeclaration(text, lt + 2);
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      pos = end === -1 ? text.length : end + 2;
    } else if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt + 2);
      const name = text.slice(lt + 2, end === -1 ? text.length : end).trim();
      pos = end === -1 ? text.length : end + 1;
      // Close the nearest open element of that name; a closing tag that
      // matches nothing open is ignored.
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].name === name) {
          stack.length = i;
          scopes.length = i;
          break;
        }
      }
    } else if (!NAME_START.test(text[lt + 1] ?? '')) {
      addText('<'); // a lone `<` in a text
      pos = lt + 1;
    } else {
      const tag = readStartTag(text, lt);
      if (!tag) {
        break; // a tag cut by the end of the file
      }
      pos = tag.end;
      const scope = Object.create(null);
      for (const [attr, value] of Object.entries(tag.attrs)) {
        if (attr === 'xmlns') {
          scope[''] = value;
        } else if (attr.startsWith('xmlns:')) {
          scope[attr.slice(6)] = value;
        }
      }
      scopes.push(scope);
      const { ns, local } = resolve(tag.name, scopes);
      const element = { name: tag.name, ns, local, attrs: tag.attrs, children: [] };
      nodes += 1;
      stack[stack.length - 1].children.push(element);
      if (tag.selfClosing) {
        scopes.pop();
      } else {
        if (stack.length > MAX_DEPTH) {
          throw new XmlError('the document is nested too deeply');
        }
        stack.push(element);
      }
    }
  }
  const root = doc.children.find((c) => typeof c === 'object');
  if (!root) {
    throw new XmlError('no XML element found');
  }
  return root;
}

// --- Reading the tree ---------------------------------------------------------

/** The element children of `el` in one of the namespaces `nss`, named `local`. */
export function childrenOf(el, nss, local) {
  return (el?.children ?? []).filter(
    (c) => typeof c === 'object' && c.local === local && nss.includes(c.ns),
  );
}

export function childOf(el, nss, local) {
  return childrenOf(el, nss, local)[0];
}

/** The text of an element and its descendants, tags removed. */
export function textOf(el) {
  if (!el) {
    return '';
  }
  let out = '';
  const walk = (node) => {
    for (const c of node.children) {
      if (typeof c === 'string') {
        out += c;
      } else {
        walk(c);
        out += ' ';
      }
    }
  };
  walk(el);
  return out;
}

/** An attribute by local name, whatever its prefix (`rdf:about`, `about`). */
export function attrOf(el, local) {
  if (!el) {
    return undefined;
  }
  if (local in el.attrs) {
    return el.attrs[local];
  }
  const key = Object.keys(el.attrs).find((k) => k.endsWith(`:${local}`));
  return key === undefined ? undefined : el.attrs[key];
}
