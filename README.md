# Yallah Services — Job Radar

Outil interne de **veille d'offres d'emploi et de placement** pour Yallah Services (Casablanca).
Il rassemble les offres publiées **au Maroc depuis le début de la recherche — le lundi 9 novembre 2026** — dans
trois secteurs — personnel de maison, beauté et bien-être, conciergerie et hospitalité —, les qualifie (source,
date, statut, risque, doublons), puis aide les courtiers à rapprocher candidats et employeurs et à suivre
placements et commissions.

L'outil est en français, réservé à l'équipe (connexion obligatoire), et ne publie rien.

> **Aucune collecte automatique n'est active à l'installation.** Les six sites d'emploi du catalogue sont
> désactivés : la base refuse d'en activer un tant qu'un administrateur n'a pas consigné une base juridique,
> la date de sa lecture des conditions d'utilisation et une autorisation. Voir
> [docs/08-plan-de-collecte.md](docs/08-plan-de-collecte.md).

## Démarrer en une commande

Prérequis : **Node.js 22 ou plus récent**. Rien d'autre (PostgreSQL est embarqué pour l'usage local).

```bash
npm ci
npm run local
```

La commande démarre une base PostgreSQL locale, applique le schéma, crée les référentiels (villes, métiers,
compétences, catalogue des sources), construit l'application et l'ouvre sur <http://localhost:3000>.

Au premier lancement, elle affiche **une seule fois** l'adresse et le mot de passe provisoire du compte
administrateur (également notés dans `.data/admin-local.txt`). Ce mot de passe doit être changé à la première
connexion.

| Commande | Rôle |
| --- | --- |
| `npm run local` | Tout-en-un : base embarquée, application en mode production, worker |
| `npm run local:dev` | Idem avec le serveur de développement |
| `npm run local -- --sans-worker` | Sans tâches d'arrière-plan |
| `npm run worker` / `npm run worker:une-fois` | Collecte des sources actives, alertes, relances, maintenance |
| `npm run verifier` | Contrôle de conformité de l'installation (lecture seule) |
| `npm run db:migrer` / `npm run db:initialiser` | Schéma et référentiels sur une base existante |
| `npm run typecheck`, `npm run lint`, `npm test` | Contrôles |

Les données locales vivent dans `.data/` (ignoré par Git) : la base, la clé de chiffrement `secret.key` et les
identifiants locaux. **Sans la clé, les données chiffrées sont illisibles** : sauvegardez-la avec la base.

## Découvrir l'outil sans vraies données

Administration › Jeu de démonstration charge 18 annonces, 8 candidats et 2 employeurs **inventés**, tous
marqués « FICTIF ». Ils utilisent leur propre numérotation (`YS-DEMO-…`), ne sont jamais additionnés aux
montants réels et se retirent en un clic. Les annonces sont datées entre le début de la recherche et le jour
du chargement ; une seule, volontairement ancienne, montre une offre écartée.

## Début de la recherche

L'outil ne retient que les annonces publiées à partir d'une date : le **début de la recherche**, réglé sur le
**lundi 9 novembre 2026 à 00 h 00** (heure de Casablanca). C'est une date fixe : elle n'avance pas d'elle-même.

- **La changer** : Administration › Paramètres, par un administrateur. Elle se choisit entre le 1er janvier
  2026 et le jour même, et s'applique aussitôt aux offres déjà enregistrées.
- **Une annonce publiée plus tôt** est archivée avec le motif « Avant le début de la recherche ». Rien n'est
  supprimé : si la date est reculée, l'offre revient avec le statut qu'elle aurait eu à l'enregistrement.
- **Une annonce republiée** dans la période prend la place de sa première publication, plus ancienne que le
  début de la recherche : c'est elle qui reste visible.
- **Après une mise à jour**, les offres enregistrées sont alignées au démarrage. Une installation où un
  administrateur a déjà enregistré cette date dans les paramètres garde la sienne.

## Ce que fait l'outil

- **Veille** : offres avec source, date de publication, statut (active, douteuse, expirée, archivée), scores
  expliqués (pertinence, placement, risque) et rattachement des doublons. Sans date connue, une offre n'est
  jamais « active ».
- **Ajout d'offres** : collage d'une annonce lue par un courtier (extrait et lien), annonce confiée par un
  employeur (texte complet), fichier CSV ou JSON.
- **Candidats** : fiche avec consentement obligatoire (loi n° 09-08), coordonnées chiffrées, consultation
  journalisée, anonymisation à la demande ou après la durée de conservation.
- **Employeurs et besoins**, **rapprochement** expliqué critère par critère, **placements**, **commissions**
  et reçus internes.
- **Alertes**, **tableau de bord**, **administration** (sources, comptes et rôles, paramètres, journal d'audit).

## Documentation

| Document | Contenu |
| --- | --- |
| [01-analyse-et-hypotheses](docs/01-analyse-et-hypotheses.md) | Compréhension de la demande, hypothèses, points à trancher |
| [02-product-brief](docs/02-product-brief.md) | Utilisateurs, objectifs, périmètre, hors périmètre |
| [03-parcours-et-ecrans](docs/03-parcours-et-ecrans.md) | Parcours des courtiers et description des écrans |
| [04-architecture-technique](docs/04-architecture-technique.md) | Architecture, organisation du code, déploiement |
| [05-modele-de-donnees](docs/05-modele-de-donnees.md) | Tables, règles portées par la base |
| [06-securite-et-conformite](docs/06-securite-et-conformite.md) | Comptes, chiffrement, loi 09-08, audit |
| [07-prompts-extraction-ia](docs/07-prompts-extraction-ia.md) | Complément d'extraction par IA (facultatif, désactivé) |
| [08-plan-de-collecte](docs/08-plan-de-collecte.md) | Constats site par site, conditions d'activation |
| [09-algorithmes-de-score](docs/09-algorithmes-de-score.md) | Classification, scores, doublons, rapprochement |
| [10-plan-de-tests](docs/10-plan-de-tests.md) | Tests automatisés et vérifications manuelles |

## Limites connues

- La collecte sur les sites réels n'a pas été exercée : elle est testée de bout en bout sur un site fictif.
- L'extraction par IA et les envois par e-mail ou WhatsApp ne fonctionnent qu'avec un fournisseur configuré ;
  sans lui, les envois sont enregistrés comme « simulés » et l'IA n'est jamais appelée.
- Les reçus sont des justificatifs internes, pas des factures fiscales.
- Plusieurs points relèvent d'un avis juridique : voir [docs/01-analyse-et-hypotheses.md](docs/01-analyse-et-hypotheses.md).
