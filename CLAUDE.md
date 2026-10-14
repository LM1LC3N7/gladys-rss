# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `provider` (no device):
a Node.js service (Node 22+, ESM, no build step) in its own sandboxed Docker
container, talking to Gladys through `@gladysassistant/integration-sdk`
(v0.15). It reads **RSS 2.0, RSS 1.0 (RDF) and Atom** feeds typed in the
configuration and offers a "news" widget, a "new article" scene trigger and
a "latest article" scene action. No account, no key. Not affiliated with
the publishers of the feeds.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK wiring only (handlers registered before connect())
src/app.js          RssApp: the reading loop, events, scene action, widget,
                    test button; the per-feed state (in memory, by URL)
src/feeds.js        one feed read: conditional GET, charset, pacing hints
src/http.js         the only network access (fetch, redirects, size cap)
src/xml.js          the tolerant XML parser (pure)
src/text.js         entities, HTML stripping, bounds, fold (pure)
src/model.js        RSS / RDF / Atom tree -> articles, dates, links (pure)
src/triggers.js     readings -> "new article" events (pure)
src/widget.js       the "news" widget (pure)
src/config.js       config_schema normalized, the `feeds` grammar
src/constants.js    pacing, limits, manifest keys
src/i18n.js         runtime texts (en/fr)
test/fixtures/      real feeds (2026-10-14), trimmed, forum names anonymized
test/helpers/       fake fetch, an RSS builder, fake timers; Gladys is the SDK's fake
```

## The `feeds` grammar

Entries separated by commas or new lines. Each entry is a URL, then an
optional custom name after the first space or `|`:

```
https://www.lemonde.fr/rss/une.xml Le Monde, https://example.org/feed.xml|My blog
```

Only `http:` and `https:` URLs; an invalid entry is reported by its
position, never echoed (it may carry a token). Duplicates are dropped, at
most `MAX_FEEDS` (30). The name of a feed is its custom name, else its own
title, else its host: it is what the `feed` filter of the trigger compares
(equality, done by the core) and what the widget and the scene action
resolve (name, position or part of a name, case and accents ignored).

## No XML dependency: why

The only runtime dependency stays the SDK. `fast-xml-parser` was considered:
its current major (5.x) pulls six packages of its own, releases every few
weeks and has had several advisories (prototype pollution, ReDoS, entity
expansion). A feed reader needs a small subset of XML, so `src/xml.js` is a
~300-line single-pass parser that is tolerant the way feed readers must be
(stray `&`, HTML entities, wrong closing order, a file cut short) and safe
by construction: no regex backtracking, the DOCTYPE skipped without
expanding any entity, null-prototype attribute maps, bounded depth and node
count. `test/xml.test.js` and `test/model.test.js` exercise it on real feeds
and on hostile input. Revisit only if real feeds keep breaking it.

## Rules

- **Not affiliated** with the publishers of the feeds: the docs say so; no
  publisher logo anywhere (the cover is a drawn pictogram).
- **Keys are forever**: the manifest keys (`src/constants.js`: `test_feeds`,
  `news`, `new_article`, `get_latest_article`), the config keys (`feeds`,
  `interval`, `max_items`, `keywords`), the widget settings (`feed`,
  `count`), the event variables (`EVENT_KEYS`) and the action outputs
  (`OUTPUT_KEYS`) are stored in user scenes and dashboards. Never rename
  them.
- **Security** (enforced in `src/http.js`, tested in `test/http.test.js`):
  only `http:`/`https:` URLs, at every redirect too; at most 5 redirects,
  followed by hand (`redirect: 'manual'`); one 15 s timeout for the whole
  read; the body streamed and abandoned past 2 MB (decompressed); URL
  credentials become an `Authorization` header sent to that origin only.
- **No secret in the logs**: a feed URL may carry a token. Logs, statuses
  and errors name a feed by its name and host only (`hostOf`), never the
  path or the query; `FetchError` messages never contain the URL.
- **Every text is bounded before it reaches Gladys**: HTML stripped and
  entities decoded (`htmlToText`), title ≤ 300 characters, summary ≤ 1000,
  feed name ≤ 100, links http(s) only and ≤ 1000 characters (`LIMITS`).
- **Be polite with the publishers**: identify with the User-Agent;
  conditional GET (`ETag` / `Last-Modified`); the interval is 15 minutes by
  default and never below 5; `Cache-Control: max-age` and RSS `ttl` are
  honoured when longer, up to `MAX_DELAY` (6 hours); `Retry-After` is
  honoured; a failing feed backs off (interval doubled per failure, up to 4
  hours); feeds are read one after another, never in parallel. The
  one-minute tick makes no request unless a feed is due.
- **One event per new article** (`src/triggers.js`): new means an id never
  seen; the ids live in memory only, so the first reading after a start
  fires nothing; at most `MAX_EVENTS_PER_FEED` (5) per feed and per reading,
  the newest ones, oldest first. The keyword of an event is the first
  configured keyword found in the title, spelled as configured (the core
  matches trigger fields by equality only).
- **Read-only rootfs**: write nothing on disk.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code.
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (`installFetch` replaces `fetch`).

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.
- The Docker image cannot be built in the Claude Code cloud container (no
  network for `apk` inside `docker build`): the CI builds it.

## Refreshing the fixtures

```bash
UA='gladys-rss/dev (+https://github.com/LM1LC3N7/gladys-rss)'
curl -sA "$UA" https://community.gladysassistant.com/latest.rss > gladys.xml
curl -sA "$UA" https://www.lemonde.fr/rss/une.xml > lemonde.xml
curl -sA "$UA" https://blog.rust-lang.org/feed.xml > rust.xml
curl -sA "$UA" https://www.debian.org/News/news > debian.xml
```

Then keep 3 or 4 items of each, shorten the long contents and replace the
forum user names (`dc:creator`). `FIXTURE_NOW` in `test/helpers/fakeFetch.js`
is the morning after; the expected ages in the tests follow.
