# gladys-rss

[Gladys Assistant](https://gladysassistant.com) external integration for
**RSS and Atom feeds**: the latest articles of your feeds in a dashboard
widget, a "new article" scene trigger with the title and the link, and a
"latest article" scene action. No account, no key. Not affiliated with the
publishers of the feeds.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (RssApp)
                 ├─ src/feeds.js      one feed read: conditional GET, charset, pacing hints
                 │   ├─ src/http.js   fetch: http(s) only, 5 redirects, 15 s, 2 MB cap
                 │   └─ src/model.js  RSS 2.0 / RSS 1.0 / Atom -> articles (pure)
                 │       ├─ src/xml.js   a small tolerant XML parser (pure)
                 │       └─ src/text.js  entities, HTML stripping, bounds (pure)
                 ├─ src/triggers.js   two readings -> "new article" events (pure)
                 └─ src/widget.js     the "news" widget (pure)
```

- **Type `provider`**: no device. The feeds are typed in the configuration
  (`feeds`: URLs separated by commas, optional name after a space or `|`).
- **Reading**: a one-minute tick reads the feeds that are due, one after
  another. A feed is due every `interval` minutes (15 by default, 5 at
  least), later when its `Cache-Control: max-age` or RSS `ttl` asks for it
  (up to 6 hours), with a growing backoff when it fails.
- **Triggers**: an article is new when its id (guid, Atom id, rdf:about,
  else link) was not in a previous reading. The ids live in memory: the
  first reading after a start fires nothing. At most 5 events per feed and
  per reading.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

The fixtures in `test/fixtures/` are real feeds recorded on 2026-10-14 and
trimmed to a few items: the Gladys forum (RSS 2.0, Discourse), Le Monde
(RSS 2.0), the Rust blog (Atom) and Debian News (RSS 1.0 / RDF).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
