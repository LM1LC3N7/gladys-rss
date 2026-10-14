# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+: a few real feeds (the forum, a newspaper,
      an Atom blog), the widget for all feeds and for one, a scene on
      "new article" with a feed filter and a keyword, the scene action in a
      message.
- [ ] Reserve "RSS & Atom" in the forum thread of the external
      integrations, then add the `gladys-assistant-integration` topic to
      publish in the store.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).

## To confirm on a real instance

- [ ] The core compares a `string` trigger field with equality: is it case
      sensitive? The docs tell users to type the feed name and the keyword
      exactly as configured; relax that if the core folds the case.
- [ ] A widget setting cannot list the configured feeds (no `source` for
      them in a provider): the `feed` setting is a typed name or position.
      Switch to a select if the vocabulary gains a dynamic source.
- [ ] The `card-list` rows show the subtitle (the source) and the badge (the
      age) as expected, and the detail panel shows the summary and the link.
- [ ] An `http://` article link upgraded to `https://` for the widget opens
      on the sites of the usual feeds.
- [ ] The Node 24 Alpine image decodes `windows-1252` / `iso-8859-1` feeds
      (full ICU); the C1 range fix in `decodeBody` covers Node's Latin-1
      shortcut.

## Ideas

- A "feed digest" scene action: the titles of the last N articles, one per
  line, for a morning briefing.
- Thumbnails in the widget (`media:thumbnail`, `enclosure`), resized and
  served through `onWidgetGetImage` (needs an image library: weigh it).
- A "Find the feed of a page" button: read a page and list its
  `<link rel="alternate">` feeds.
- Remember a permanent redirect (301/308) and suggest the new address in the
  test button.
