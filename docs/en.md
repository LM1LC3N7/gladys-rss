# RSS & Atom

Reads the **RSS and Atom feeds** of your choice and brings their latest
articles into Gladys: a dashboard widget, a scene trigger when a new article
is published, a scene action to read the latest one into a message. No
account, no key. **This integration is not affiliated with the publishers of
the feeds you read: the articles, titles and summaries belong to them.**

## What you get

| Surface         | Content                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Widget          | **News feeds**: the latest articles of one feed or of all of them, newest first, with the source, the age, the summary and the link (tap an article) |
| Scene trigger   | **New article in a feed**, optionally only for one feed and only for a keyword of the title                                                          |
| Scene action    | **Latest article of a feed**: title, link, summary, publication date and number of matching articles                                                 |
| Settings button | **Test the feeds**: reads every feed now and shows its format, its number of articles and its latest title, or the error                             |

Supported formats: RSS 2.0 (and 0.9x), RSS 1.0 (RDF) and Atom 1.0.

## Setup

Type the addresses of your feeds in **Feeds**, separated by commas. Each
address may be followed by a **custom name**, after a space or a `|`:

```
https://www.lemonde.fr/rss/une.xml Le Monde, https://community.gladysassistant.com/latest.rss|Forum
```

- Only `http://` and `https://` addresses are read; an entry that is not one
  is ignored and named (by its position) in the status and the test button.
- Without a custom name, a feed is named after its own title (for example
  "Debian News"). A short custom name is easier to type in a scene.
- A feed protected by a password can be written
  `https://user:password@example.org/feed.xml`: the password is sent to that
  server only, as an `Authorization` header, and never appears in the logs.
- A comma inside an address must be written `%2C`.

Then press **Test the feeds**: each feed answers with its format, its number
of articles and its latest title.

**Articles kept per feed** (10 by default) is the number of newest articles
of each feed the widget and the scene action look at.

## Reading pace

Each feed is read every **15 minutes** by default (option **Reading
interval**, 5 minutes at least), one feed after another. The integration is
polite with the publishers:

- it asks "has it changed since?" (`ETag`, `Last-Modified`): an unchanged feed
  costs the publisher an empty answer;
- when a publisher asks for a longer delay (`Cache-Control: max-age` or the
  RSS `ttl`), it is honoured, up to 6 hours;
- a feed that fails is retried after the interval, then less and less often
  (up to every 4 hours), and after the delay a busy server asks for
  (`Retry-After`).

## Scenes

**New article in a feed** starts a scene when a feed publishes an article
that was not there at its previous reading. Its two filters, both optional:

- **Feed name**: the custom name of the feed, or its title when it has none,
  exactly as the widget or the test button shows it.
- **Keyword**: list keywords in the **Keywords** option of the integration
  (for example `Gladys, Zigbee, storm`). A new article whose title contains
  one of them (case and accents ignored) carries the first one found, and a
  scene whose keyword filter is that word, spelled exactly as in the option,
  runs for it.

Variables: `feed`, `keyword`, `title`, `link`, `summary` (up to 1000
characters, without HTML) and `published` (ISO date, empty when the feed
gives none).

Good to know:

- After a start of the integration, the first reading of each feed only
  learns which articles are there: it starts no scene. The memory of the
  articles already seen is not written on disk.
- A feed that publishes many articles at once starts at most 5 scenes per
  reading (the 5 newest).

**Latest article of a feed** gives `title`, `link`, `summary`, `published`,
`feed` and `count` for the newest article of a feed (its name or its
position in the list; empty for all feeds) whose title contains a word
(optional). `count` is 0 when nothing matches. The following actions of the
scene find them in their variable list (written `{{<step>.<action>.<key>}}`,
for instance `{{0.0.title}}` when this action is the first of the scene).

## Widget

Add **News feeds** to a dashboard. Settings: the **feed** (its name, its
position in the list, or empty for all feeds) and the number of **articles
shown** (1 to 8). Tap an article for its summary and its link. An `http://`
link is opened in `https://`, the only kind the dashboard accepts.

## Troubleshooting

- **"not an RSS or Atom feed"**: the address is a web page, not its feed.
  Look for the RSS icon or a `<link rel="alternate" type="application/rss+xml">`
  in the page source.
- **"HTTP 403"**: some sites refuse automated readers; nothing to do on the
  Gladys side.
- **"answer over 2 MB"**: the feed is too big to be read safely; publishers
  often offer a shorter one (per category).
- **"more than 5 redirects"** or **"timeout"**: check the address in a
  browser.
- Logs: the integration's log level is set with the `LOG_LEVEL` variable. The
  logs name the feeds by name and host only, never their full address (it may
  carry a token).

## Privacy and security

The integration only contacts the addresses you typed, and the ones they
redirect to (http and https only, 5 redirects at most). Each answer is
abandoned past 2 MB or 15 seconds. Every text is stripped of its HTML and
bounded (title 300 characters, summary 1000) before it reaches Gladys.
Nothing is written on disk.
