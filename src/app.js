// -----------------------------------------------------------------------------
// The integration itself: the reading loop over the configured feeds, the
// "new article" scene trigger, the "latest article" scene action, the "news"
// widget and the "Test the feeds" button. index.js only wires the SDK
// handlers to it.
//
// What a feed taught us (validators, ids already seen, articles) lives in
// memory, keyed by URL: it survives a configuration change and a
// reconnection, not a restart of the container (read-only rootfs).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { TEST_DEADLINE, TICK, WIDGETS } from './constants.js';
import { nextDelay, readFeed, retryDelay } from './feeds.js';
import { T } from './i18n.js';
import { sortItems } from './model.js';
import { fold, truncate } from './text.js';
import { articleEvent, newArticles, remember } from './triggers.js';
import { messageWidget, newsWidget } from './widget.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
const ALL = new Set(['all', '*', 'tous', 'toutes', 'tout']);
const time = (iso) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);

/** The host of a feed URL: what the logs show (the path may carry a token). */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '?';
  }
}

export class RssApp {
  constructor({ gladys, logger = createLogger({ name: 'rss' }), now = Date.now, timers }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers ?? defaultTimers;
    this.config = normalizeConfig();
    /** url -> what we know of that feed, in the order of the configuration. */
    this.feeds = new Map();
    this.timer = undefined;
    this.generation = 0;
    this.lastStatus = undefined;
    this.refreshing = undefined;
    this.chain = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    this.syncFeeds();
    // A pass started under the previous configuration stops at its next
    // feed (generation check): wait for it, then read what is due now.
    await this.refreshing?.catch(() => {});
    await this.refresh().catch((err) => this.logger.warn(`Reading failed: ${err.message}`));
    if (generation !== this.generation) {
      return;
    }
    this.timer = this.timers.setInterval(
      () => this.refresh().catch((err) => this.logger.warn(`Reading failed: ${err.message}`)),
      TICK,
    );
  }

  stop() {
    this.generation += 1;
    this.timers.clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Keep the state of the feeds still configured, add the new ones. */
  syncFeeds() {
    const previous = this.feeds;
    this.feeds = new Map();
    this.config.feeds.forEach((entry, index) => {
      const state = previous.get(entry.url) ?? {
        url: entry.url,
        host: hostOf(entry.url),
        nextAt: 0,
        failures: 0,
        items: [],
        seen: undefined,
      };
      state.name = entry.name;
      state.position = index + 1;
      this.feeds.set(entry.url, state);
    });
  }

  /** Run `fn` after every read in progress: one feed is never read twice at once. */
  exclusive(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  withInvalid(message) {
    if (this.config.invalid.length === 0) {
      return message;
    }
    const suffix = T.invalid(this.config.invalid);
    return { en: message.en + suffix.en, fr: message.fr + suffix.fr };
  }

  async reportStatus() {
    const states = [...this.feeds.values()];
    if (states.length === 0) {
      await this.setStatus(true, this.withInvalid(T.noFeed));
      return;
    }
    const failing = states.filter((s) => s.error);
    if (failing.length === 0) {
      await this.setStatus(true, this.withInvalid(T.ok(states.length)));
      return;
    }
    const details = failing
      .slice(0, 3)
      .map((s) => `${this.displayName(s)} (${s.error})`)
      .concat(failing.length > 3 ? ['…'] : [])
      .join(', ');
    await this.setStatus(
      failing.length < states.length,
      this.withInvalid(T.failing(failing.length, states.length, details)),
    );
  }

  // --- Reading ---------------------------------------------------------------

  displayName(state) {
    return state.name || state.title || state.host;
  }

  /** The articles the user sees: the newest `max_items` of the feed. */
  keptItems(state) {
    return state.items.slice(0, this.config.maxItems);
  }

  refresh() {
    if (!this.refreshing) {
      this.refreshing = this.exclusive(() => this.readDue()).finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  /** Read the feeds that are due, one after another. */
  async readDue() {
    const generation = this.generation;
    let changed = false;
    for (const state of [...this.feeds.values()]) {
      if (generation !== this.generation) {
        return;
      }
      if (this.now() < state.nextAt) {
        continue;
      }
      changed = (await this.readSafely(state)) || changed;
    }
    if (changed) {
      this.gladys.requestWidgetRefresh(WIDGETS.NEWS);
    }
    await this.reportStatus();
  }

  /** Read one feed; a failure is recorded on the feed, never thrown. */
  async readSafely(state) {
    try {
      return await this.readOne(state);
    } catch (err) {
      const intervalMs = this.config.interval * 60_000;
      state.failures += 1;
      state.error = err.message;
      state.nextAt =
        this.now() +
        retryDelay({ intervalMs, failures: state.failures, retryAfterMs: err.retryAfterMs });
      this.logger.warn(`Reading ${this.displayName(state)} (${state.host}) failed: ${err.message}`);
      return true;
    }
  }

  /** Read one feed now; resolves whether the widget has something new to show. */
  async readOne(state) {
    const intervalMs = this.config.interval * 60_000;
    const result = await readFeed(state.url, state);
    const now = this.now();
    const recovered = Boolean(state.error);
    state.error = undefined;
    state.failures = 0;
    state.etag = result.etag;
    state.lastModified = result.lastModified;
    state.readAt = new Date(now).toISOString();
    if (result.notModified) {
      state.nextAt =
        now + nextDelay({ intervalMs, maxAgeMs: result.maxAgeMs, ttlMinutes: state.ttlMinutes });
      this.logger.debug(`${this.displayName(state)} (${state.host}): not modified`);
      return recovered;
    }
    const { feed } = result;
    state.format = feed.format;
    state.title = feed.title;
    state.ttlMinutes = feed.ttlMinutes;
    state.nextAt =
      now + nextDelay({ intervalMs, maxAgeMs: result.maxAgeMs, ttlMinutes: feed.ttlMinutes });
    const before = state.items.map((i) => i.id).join('\n');
    const sorted = sortItems(feed.items);
    state.items = sorted;
    const kept = this.keptItems(state);
    const fresh = newArticles(state.seen, kept);
    const unseen = state.seen ? kept.filter((i) => !state.seen.has(i.id)).length : 0;
    state.seen = remember(state.seen, sorted);
    // A quiet reading is a debug line; a reading with news is worth an info.
    this.logger[unseen > 0 ? 'info' : 'debug'](
      `${this.displayName(state)} (${state.host}): ${sorted.length} articles, ${unseen} new` +
        (unseen > fresh.length ? ` (${fresh.length} announced)` : ''),
    );
    for (const item of fresh) {
      const event = articleEvent(this.displayName(state), item, this.config.keywords);
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
    }
    return recovered || before !== sorted.map((i) => i.id).join('\n');
  }

  // --- Feed selection (widget, scene action) ------------------------------------

  /**
   * The feeds a widget or a scene action asks for: empty or "all" for every
   * feed, a position in the list ("2"), else a name (custom name or feed
   * title, case and accents ignored), else a part of a name or host.
   */
  selectFeeds(query) {
    const text = String(query ?? '').trim();
    const states = [...this.feeds.values()];
    if (!text || ALL.has(fold(text))) {
      return states;
    }
    if (/^\d+$/.test(text)) {
      const state = states[Number(text) - 1];
      return state ? [state] : [];
    }
    const wanted = fold(text);
    const names = (s) => [s.name, s.title, s.host].filter(Boolean).map(fold);
    const exact = states.filter((s) => names(s).includes(wanted));
    return exact.length > 0
      ? exact
      : states.filter((s) => names(s).some((n) => n.includes(wanted)));
  }

  // --- Scene action --------------------------------------------------------------

  /** "Latest article": the newest article of the chosen feeds matching the keyword. */
  async getLatestArticle(fields = {}) {
    const states = this.selectFeeds(fields.feed);
    if (states.length === 0) {
      throw new Error(T.unknownFeed(truncate(String(fields.feed), 60)).en);
    }
    const unread = states.filter((s) => !s.readAt);
    if (unread.length > 0) {
      // Right after a start the first reading may still be running.
      await this.exclusive(async () => {
        for (const state of unread.filter((s) => !s.readAt)) {
          await this.readSafely(state);
        }
      });
      if (states.every((s) => !s.readAt)) {
        throw new Error(`Feed unreachable: ${states.map((s) => s.error).join(', ')}`);
      }
    }
    const keyword = fold(fields.keyword);
    const matches = states
      .flatMap((s) => this.keptItems(s).map((item, index) => ({ item, index, state: s })))
      .filter(({ item }) => !keyword || fold(item.title).includes(keyword))
      .sort((a, b) => time(b.item.published) - time(a.item.published) || a.index - b.index);
    const latest = matches[0];
    return {
      feed: latest ? this.displayName(latest.state) : null,
      title: latest?.item.title ?? null,
      link: latest?.item.link ?? null,
      summary: latest?.item.summary || null,
      published: latest?.item.published ?? null,
      count: matches.length,
    };
  }

  // --- Widget --------------------------------------------------------------------

  async getWidget({ settings = {}, language = 'en' } = {}) {
    if (this.feeds.size === 0) {
      return messageWidget(T.widget.allFeeds, T.widget.noFeed, language);
    }
    const states = this.selectFeeds(settings.feed);
    if (states.length === 0) {
      return messageWidget(
        T.widget.allFeeds,
        T.unknownFeed(truncate(String(settings.feed), 60)),
        language,
      );
    }
    return newsWidget({
      title: states.length === 1 ? this.displayName(states[0]) : T.widget.allFeeds,
      feeds: states.map((s) => ({
        name: this.displayName(s),
        readAt: s.readAt,
        error: s.error,
        items: this.keptItems(s),
      })),
      count: settings.count,
      now: this.now(),
      language,
    });
  }

  // --- Configuration screen button ---------------------------------------------------

  /** Read every feed now (one after another) and say what each one gave. */
  async testFeeds() {
    const states = [...this.feeds.values()];
    if (states.length === 0) {
      return this.withInvalid(T.noFeed);
    }
    const lines = { en: [], fr: [] };
    const deadline = this.now() + TEST_DEADLINE;
    await this.exclusive(async () => {
      let changed = false;
      for (const state of states) {
        const info = { name: this.displayName(state), host: state.host };
        let line;
        if (this.now() > deadline) {
          line = T.test.skipped(info);
        } else {
          changed = (await this.readSafely(state)) || changed;
          info.name = this.displayName(state);
          line = state.error
            ? T.test.failed({ ...info, error: state.error })
            : T.test.ok({
                ...info,
                format: state.format ?? '?',
                count: state.items.length,
                latest: state.items[0] ? truncate(state.items[0].title, 80) : '',
              });
        }
        lines.en.push(line.en);
        lines.fr.push(line.fr);
      }
      if (changed) {
        this.gladys.requestWidgetRefresh(WIDGETS.NEWS);
      }
      await this.reportStatus();
    });
    if (this.config.invalid.length > 0) {
      const invalid = T.invalid(this.config.invalid);
      lines.en.push(invalid.en.trim());
      lines.fr.push(invalid.fr.trim());
    }
    return { en: lines.en.join('\n'), fr: lines.fr.join('\n') };
  }
}
