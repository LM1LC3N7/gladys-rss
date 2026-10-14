# RSS & Atom

Lit les **flux RSS et Atom** de votre choix et amène leurs derniers articles
dans Gladys : un widget pour le tableau de bord, un déclencheur de scène
quand un nouvel article est publié, une action de scène pour lire le dernier
dans un message. Sans compte ni clé. **Cette intégration est sans lien avec
les éditeurs des flux que vous lisez : les articles, titres et résumés leur
appartiennent.**

## Ce que vous obtenez

| Surface              | Contenu                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Widget               | **Fil d'actualités** : les derniers articles d'un flux ou de tous, du plus récent au plus ancien, avec la source, l'âge, le résumé et le lien (touchez un article) |
| Déclencheur de scène | **Nouvel article dans un flux**, éventuellement pour un seul flux et pour un mot-clé du titre                                                                      |
| Action de scène      | **Dernier article d'un flux** : titre, lien, résumé, date de publication et nombre d'articles correspondants                                                       |
| Bouton des réglages  | **Tester les flux** : lit chaque flux maintenant et affiche son format, son nombre d'articles et son dernier titre, ou l'erreur                                    |

Formats pris en charge : RSS 2.0 (et 0.9x), RSS 1.0 (RDF) et Atom 1.0.

## Installation

Saisissez les adresses de vos flux dans **Flux**, séparées par des virgules.
Chaque adresse peut être suivie d'un **nom personnalisé**, après une espace
ou un `|` :

```
https://www.lemonde.fr/rss/une.xml Le Monde, https://community.gladysassistant.com/latest.rss|Forum
```

- Seules les adresses `http://` et `https://` sont lues ; une entrée qui n'en
  est pas une est ignorée et signalée (par sa position) dans l'état et le
  bouton de test.
- Sans nom personnalisé, un flux prend son propre titre (par exemple
  « Debian News »). Un nom court est plus simple à saisir dans une scène.
- Un flux protégé par un mot de passe peut s'écrire
  `https://utilisateur:motdepasse@example.org/feed.xml` : le mot de passe
  n'est envoyé qu'à ce serveur, dans un en-tête `Authorization`, et
  n'apparaît jamais dans les logs.
- Une virgule dans une adresse s'écrit `%2C`.

Appuyez ensuite sur **Tester les flux** : chaque flux répond avec son
format, son nombre d'articles et son dernier titre.

**Articles gardés par flux** (10 par défaut) est le nombre d'articles les
plus récents de chaque flux que regardent le widget et l'action de scène.

## Rythme de lecture

Chaque flux est lu toutes les **15 minutes** par défaut (option
**Intervalle de lecture**, 5 minutes au minimum), un flux après l'autre.
L'intégration est polie avec les éditeurs :

- elle demande « a-t-il changé depuis ? » (`ETag`, `Last-Modified`) : un flux
  inchangé ne coûte à l'éditeur qu'une réponse vide ;
- quand un éditeur demande un délai plus long (`Cache-Control: max-age` ou
  le `ttl` RSS), il est respecté, jusqu'à 6 heures ;
- un flux en échec est réessayé après l'intervalle, puis de moins en moins
  souvent (jusqu'à toutes les 4 heures), et après le délai qu'un serveur
  surchargé demande (`Retry-After`).

## Scènes

**Nouvel article dans un flux** lance une scène quand un flux publie un
article absent de sa lecture précédente. Ses deux filtres, facultatifs :

- **Nom du flux** : le nom personnalisé du flux, ou son titre s'il n'en a
  pas, exactement comme le widget ou le bouton de test l'affichent.
- **Mot-clé** : listez des mots-clés dans l'option **Mots-clés** de
  l'intégration (par exemple `Gladys, Zigbee, orage`). Un nouvel article
  dont le titre en contient un (casse et accents ignorés) porte le premier
  trouvé, et une scène dont le filtre de mot-clé est ce mot, écrit
  exactement comme dans l'option, s'exécute pour lui.

Variables : `feed`, `keyword`, `title`, `link`, `summary` (jusqu'à 1000
caractères, sans HTML) et `published` (date ISO, vide quand le flux n'en
donne pas).

Bon à savoir :

- Après un démarrage de l'intégration, la première lecture de chaque flux
  apprend seulement quels articles s'y trouvent : elle ne lance aucune
  scène. La mémoire des articles déjà vus n'est pas écrite sur le disque.
- Un flux qui publie beaucoup d'articles d'un coup lance au plus 5 scènes
  par lecture (les 5 plus récents).

**Dernier article d'un flux** donne `{{title}}`, `{{link}}`, `{{summary}}`,
`{{published}}`, `{{feed}}` et `{{count}}` pour l'article le plus récent
d'un flux (son nom ou sa position dans la liste ; vide pour tous les flux)
dont le titre contient un mot (facultatif). `count` vaut 0 quand rien ne
correspond.

## Widget

Ajoutez **Fil d'actualités** à un tableau de bord. Réglages : le **flux**
(son nom, sa position dans la liste, ou vide pour tous les flux) et le
nombre d'**articles affichés** (1 à 8). Touchez un article pour son résumé
et son lien. Un lien `http://` s'ouvre en `https://`, seul type accepté par
le tableau de bord.

## Dépannage

- **« not an RSS or Atom feed »** : l'adresse est une page web, pas son
  flux. Cherchez l'icône RSS ou un
  `<link rel="alternate" type="application/rss+xml">` dans le code de la
  page.
- **« HTTP 403 »** : certains sites refusent les lecteurs automatiques ; rien
  à faire côté Gladys.
- **« answer over 2 MB »** : le flux est trop gros pour être lu sans risque ;
  les éditeurs proposent souvent un flux plus court (par rubrique).
- **« more than 5 redirects »** ou **« timeout »** : vérifiez l'adresse dans
  un navigateur.
- Logs : le niveau de log de l'intégration se règle avec la variable
  `LOG_LEVEL`. Les logs désignent les flux par leur nom et leur hôte
  seulement, jamais par leur adresse complète (elle peut contenir un jeton).

## Confidentialité et sécurité

L'intégration ne contacte que les adresses que vous avez saisies, et celles
vers lesquelles elles redirigent (http et https seulement, 5 redirections
au plus). Chaque réponse est abandonnée au-delà de 2 Mo ou de 15 secondes.
Chaque texte est débarrassé de son HTML et borné (titre 300 caractères,
résumé 1000) avant d'atteindre Gladys. Rien n'est écrit sur le disque.
