# 08 — Plan de collecte

## Principe

**Aucune collecte automatique n'est active à l'installation.** L'outil fonctionne avec trois sources
internes :

| Source interne | Ce qui est conservé |
| --- | --- |
| Annonce lue par un courtier (import manuel) | Extrait court et lien, usage interne |
| Annonce confiée par l'employeur | Texte complet et contact, chiffrés |
| Fichier CSV ou JSON fourni par un partenaire | Selon l'accord avec le partenaire |

Les six sites d'emploi du catalogue sont créés **désactivés**. Pour en activer un, un administrateur doit
consigner dans Administration › Sources et collecte :

1. la **base juridique** (accord écrit, licence, programme partenaire…) ;
2. la **date à laquelle il a lui-même relu** les conditions d'utilisation ;
3. une **autorisation** au statut « non requise » ou « accordée », avec sa référence.

La base de données refuse l'activation si l'un des trois manque. Chaque activation est journalisée.

## Constats par site

Relevés le **10 novembre 2026**. Ils décrivent ce qui a été lu ce jour-là, parfois partiellement ; ils ne
remplacent ni la relecture par Yallah Services ni un avis juridique. `robots.txt` indique ce qu'un robot
peut parcourir : ce n'est **pas** une autorisation contractuelle de réutiliser le contenu.

| Site | Conditions d'utilisation | `robots.txt` | Conclusion |
| --- | --- | --- | --- |
| **ReKrute** | Les mentions légales interdisent d'extraire tout ou partie des bases de données et les liens profonds ; les conditions de vente interdisent l'extraction répétée des offres et leur exploitation commerciale. | Pas de règle générale ; agrégateurs d'offres bloqués nommément. | **Interdit sans accord écrit.** Import manuel uniquement ; le lien reste interne. |
| **Indeed Maroc** | D'après deux sources secondaires concordantes, tout accès par robot est interdit sans autorisation écrite. **Texte officiel non relu.** | Non relu. | **Interdit.** Seule voie : un programme partenaire officiel. |
| **Emploi.ma** | **Non relues.** | Parcours autorisé, avec le signal `search=yes, ai-train=no` : indexation avec lien et court extrait admise, entraînement d'IA refusé. | Un mode « index de liens » est plausible **après** lecture des conditions et accord écrit. IA désactivée. |
| **MarocEmploi.net** | **Non relues.** | Parcours autorisé hors administration et pagination ; sitemaps déclarés. | Découverte possible par le sitemap **après** lecture des conditions. Fiabilité à confirmer. |
| **Dreamjob.ma** | **Non relues.** | Parcours autorisé hors administration et recherche. | Un flux RSS des offres existe : c'est le canal prévu par l'éditeur, donc le candidat le plus simple à un mode « extrait et lien », **après** lecture des conditions et de préférence accord écrit. |
| **Jobsquare.ma** | Page repérée, **non relue**. | Fiches d'offres ouvertes ; CV, recherche et espace personnel interdits. | Le site présente une page « API et intégrations » : demander un accès officiel. |

Ces constats figurent aussi dans l'écran des sources (`src/serveur/sources-initiales.ts`). La collecte sur
ces sites **n'a pas été exercée** : le code de collecte est testé de bout en bout sur un site fictif.

## Marche à suivre pour activer un site

1. Lire les conditions d'utilisation et `robots.txt` du site ; noter la date.
2. Écrire à l'éditeur : modèle dans [modeles/demande-autorisation.md](modeles/demande-autorisation.md).
3. À réception d'un accord écrit, l'archiver et reporter sa référence dans la fiche de la source.
4. Choisir le mode le plus restreint qui suffit : « index de liens », sinon « extrait ».
5. Régler le délai entre requêtes, le nombre de requêtes par passe et la fréquence.
6. Activer, puis surveiller « Dernières collectes ».
7. **Désactiver immédiatement** si l'éditeur le demande, et relire les conditions régulièrement :
   `npm run verifier` rappelle l'ancienneté de la dernière lecture.

## Comportement du client de collecte

Garanties portées par le code (`src/collecte/http.ts`, `robots.ts`) et couvertes par des tests :

- User-Agent identifiable avec une adresse de contact (`YS_COLLECTE_USER_AGENT`) ;
- `robots.txt` lu avant toute requête vers un hôte, et respecté ; s'il est inaccessible (erreur du serveur ou
  du réseau), rien n'est collecté ; s'il n'existe pas (réponse 404), aucune restriction n'en découle, comme
  le prévoit la RFC 9309 ;
- une requête à la fois, espacée du délai configuré ou du `Crawl-delay` du site s'il est plus long ;
- nombre de requêtes plafonné par passe ;
- lecture seule (GET) : aucun cookie, aucune connexion, aucun formulaire, aucun JavaScript exécuté, aucun
  contournement de CAPTCHA ou de blocage ;
- réponses 401, 403, 429 ou 503 : arrêt immédiat et mise en pause de la source (au moins 24 heures) ; un
  administrateur peut lever la pause ;
- requêtes conditionnelles (`ETag`, `Last-Modified`) pour ne pas retélécharger un contenu inchangé ;
- taille de réponse plafonnée, délai d'attente court, adresses privées refusées.

## Ce qui est conservé

- Une annonce hors Maroc ou hors secteurs est écartée : seul le motif est gardé, pas le texte.
- Selon le mode de la source : titre, lien et date ; plus un extrait limité ; texte complet uniquement pour
  une annonce confiée ou sur autorisation écrite.
- Les coordonnées présentes dans une annonce ne sont conservées que si la source l'autorise explicitement.
- Une offre rattachée comme doublon n'est pas supprimée : elle est archivée et liée à l'offre principale.
