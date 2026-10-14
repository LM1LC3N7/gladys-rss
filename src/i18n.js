// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, button result, widget).
// -----------------------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const T = {
  ok: (feeds) => ({
    en: `Following ${plural(feeds, 'feed')}.`,
    fr: `${feeds} flux suivi${feeds > 1 ? 's' : ''}.`,
  }),
  noFeed: {
    en: 'No feed yet: type the address of a feed in the configuration.',
    fr: "Aucun flux : saisissez l'adresse d'un flux dans la configuration.",
  },
  failing: (failing, total, details) => ({
    en: `${failing} of ${plural(total, 'feed')} unreachable: ${details}. Retrying later.`,
    fr: `${failing} flux sur ${total} injoignable${failing > 1 ? 's' : ''} : ${details}. Nouvel essai plus tard.`,
  }),
  invalid: (positions) => ({
    en: ` Ignored (not an http or https address): entry ${positions.join(', ')}.`,
    fr: ` Ignorée${positions.length > 1 ? 's' : ''} (pas une adresse http ou https) : entrée ${positions.join(', ')}.`,
  }),
  unknownFeed: (query) => ({
    en: `Unknown feed "${query}": type its name, its position in the list or leave empty for all.`,
    fr: `Flux inconnu « ${query} » : saisissez son nom, sa position dans la liste, ou laissez vide pour tous.`,
  }),
  test: {
    ok: (feed) => ({
      en: `OK ${feed.name} (${feed.host}): ${feed.format}, ${plural(feed.count, 'article')}${feed.latest ? `, latest: "${feed.latest}"` : ''}`,
      fr: `OK ${feed.name} (${feed.host}) : ${feed.format}, ${feed.count} article${feed.count > 1 ? 's' : ''}${feed.latest ? `, dernier : « ${feed.latest} »` : ''}`,
    }),
    failed: (feed) => ({
      en: `FAILED ${feed.name} (${feed.host}): ${feed.error}`,
      fr: `ÉCHEC ${feed.name} (${feed.host}) : ${feed.error}`,
    }),
    skipped: (feed) => ({
      en: `NOT TESTED ${feed.name} (${feed.host}): out of time, press the button again`,
      fr: `NON TESTÉ ${feed.name} (${feed.host}) : temps écoulé, relancez le bouton`,
    }),
  },
  widget: {
    allFeeds: { en: 'News', fr: 'Actualités' },
    noFeed: {
      en: 'No feed configured: add one in the integration settings',
      fr: "Aucun flux configuré : ajoutez-en un dans les réglages de l'intégration",
    },
    notLoaded: { en: 'Waiting for the first reading…', fr: 'En attente de la première lecture…' },
    empty: { en: 'No article in this feed', fr: 'Aucun article dans ce flux' },
    read: { en: 'Read the article', fr: "Lire l'article" },
    updated: (age) => ({ en: `Updated ${age.en}`, fr: `Mis à jour ${age.fr}` }),
    failing: (n) => ({
      en: `${n === 1 ? 'A feed is' : `${n} feeds are`} unreachable, retrying later`,
      fr: `${n === 1 ? 'Un flux est injoignable' : `${n} flux sont injoignables`}, nouvel essai plus tard`,
    }),
  },
  /** An age: "just now", "12 min", "3 h", "2 d". */
  age: (ms) => {
    const minutes = Math.max(0, Math.floor(ms / 60_000));
    if (minutes < 1) {
      return { en: 'now', fr: "à l'instant" };
    }
    if (minutes < 60) {
      return { en: `${minutes} min`, fr: `${minutes} min` };
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return { en: `${hours} h`, fr: `${hours} h` };
    }
    const days = Math.floor(hours / 24);
    return { en: `${days} d`, fr: `${days} j` };
  },
  ago: (ms) => {
    const age = T.age(ms);
    return age.en === 'now'
      ? { en: 'just now', fr: "à l'instant" }
      : { en: `${age.en} ago`, fr: `il y a ${age.fr}` };
  },
};
