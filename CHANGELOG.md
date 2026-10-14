# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-14

### Added

- Reads RSS 2.0, RSS 1.0 (RDF) and Atom feeds typed in the configuration
  (addresses separated by commas, optional custom name after a space or a
  `|`), one after another, every 15 minutes by default (5 minutes at least).
- Polite reading: conditional requests (`ETag`, `Last-Modified`), the
  publisher's `Cache-Control: max-age` and RSS `ttl` honoured when longer
  than the interval, `Retry-After` honoured, a failing feed retried less and
  less often, an identifying User-Agent.
- Safe reading: http and https only, at most 5 redirects, a 15-second
  timeout, answers over 2 MB abandoned, credentials sent to their own server
  only and never logged; every text stripped of its HTML and bounded.
- Dashboard widget "News feeds": the latest articles of one feed or of all,
  with their source, age, summary and link.
- Scene trigger "New article in a feed", filtered by feed name and by a
  keyword of the configuration found in the title; variables feed, keyword,
  title, link, summary, published. Nothing fires at the first reading after a
  start, at most 5 events per feed and per reading.
- Scene action "Latest article of a feed" (feed, word in the title): title,
  link, summary, publication date and number of matching articles.
- "Test the feeds" button: format, number of articles and latest title of
  each feed, or its error.

[Unreleased]: https://github.com/LM1LC3N7/gladys-rss/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-rss/releases/tag/v0.1.1
