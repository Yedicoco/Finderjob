# 04 — Architecture technique

## Vue d'ensemble

```
Navigateur ──HTTPS──▶ Application Next.js (Node.js 22)
                        │  pages rendues côté serveur, formulaires = Server Actions
                        ▼
                      PostgreSQL 17  ◀──  Worker (processus séparé, facultatif)
                                           collecte des sources actives, alertes,
                                           relances, maintenance
```

Deux processus, une base. Aucun autre service n'est nécessaire : pas de file de messages, pas de cache
externe, pas de stockage de fichiers.

| Brique | Choix | Raison |
| --- | --- | --- |
| Application | Next.js 16 (App Router), React 19, TypeScript strict | Rendu serveur, formulaires utilisables sans JavaScript |
| Base | PostgreSQL 17, pilote `pg`, SQL écrit à la main | Contraintes, recherche plein texte et vues portées par la base |
| Styles | Tailwind CSS 4, polices auto-hébergées | Aucune requête vers un tiers depuis le navigateur |
| Validation | Zod (réponses de l'IA), fonctions de domaine pures | Règles testables sans base ni réseau |
| Tests | Vitest, PostgreSQL embarqué pour l'intégration | Mêmes requêtes qu'en production |

## Organisation du code

```
db/migrations/        schéma SQL (0001 tables et contraintes, 0002 recherche et statut effectif,
                      0003 heure légale du Maroc)
src/domaine/          règles métier PURES : classification, extraction, risque, statuts, scores,
                      doublons, rapprochement, commissions, alertes, heure du Maroc…
src/collecte/         client HTTP « poli », robots.txt, connecteurs RSS / sitemap / fichier / saisie,
                      pipeline d'analyse (pur)
src/ia/               complément d'extraction par modèle de langage (facultatif)
src/serveur/          accès à la base, un module par sujet : offres, candidats, employeurs,
                      appariements, placements, alertes, sources, ingestion, perimetre (début de la
                      recherche), auth, audit…
src/app/              pages, formulaires et actions (Next.js)
src/composants/       composants d'interface partagés
src/proxy.ts          en-têtes de sécurité, CSP avec nonce, redirection vers la connexion
scripts/              local (tout-en-un), migrer, initialiser, worker, verifier-conformite
tests/                unitaires (domaine, collecte, IA) et intégration (base réelle)
```

Règle de dépendance : `domaine` ne dépend de rien ; `collecte` et `ia` dépendent de `domaine` ; `serveur`
dépend des trois ; `app` dépend de `serveur`. Une règle métier se lit donc à un seul endroit et se teste sans
base.

## Le parcours d'une offre

1. **Arrivée** par saisie, fichier ou collecte d'une source active.
2. **Pipeline** (`src/collecte/pipeline.ts`, fonction pure) : pays, métier, extraction des champs, lieu,
   risque, statut, scores, puis ce que la source autorise à conserver.
3. **Rejet motivé** si l'annonce est hors Maroc ou hors secteurs : seule une trace du motif est gardée.
4. **Doublons** : empreinte exacte, puis similarité ; rattachement automatique ou signalement.
5. **Enregistrement** avec une version à chaque changement (salaire, date, statut).
6. **Lecture** : le statut affiché est recalculé à chaque lecture par la vue `v_job_offers` (une offre expire
   sans attendre le worker).
7. **Début de la recherche** : une annonce publiée avant cette date est enregistrée archivée. Quand la date
   change, les offres déjà enregistrées sont alignées dans la même transaction que le réglage
   (`src/serveur/perimetre.ts`) : écartées, ou reprises avec le statut qu'elles auraient eu à
   l'enregistrement. Le même alignement est rejoué au démarrage et à chaque maintenance ; il est sans effet
   quand tout est déjà en ordre.

## Lancer en local

`npm run local` démarre un PostgreSQL embarqué, applique les migrations, crée les référentiels et le compte
administrateur, construit l'application et lance le worker. Les données restent dans `.data/`.

## Déployer

1. Fournir PostgreSQL 17 et les variables de [`.env.example`](../.env.example) : au minimum `DATABASE_URL`
   et `YS_CLE_SECRETE`. Le compte de la base doit pouvoir créer les extensions `pg_trgm` et `unaccent`.
2. `npm ci`, puis `npm run db:initialiser` (migrations, référentiels, premier administrateur avec
   `YS_ADMIN_EMAIL`).
3. `npm run build`, puis `npm run start` derrière un proxy HTTPS.
4. Planifier `npm run worker` (processus permanent) ou `npm run worker:une-fois` (tâche planifiée).
5. `npm run verifier` contrôle l'installation : clé présente, sources actives et leur autorisation, fiches
   au-delà de la durée de conservation, comptes au mot de passe provisoire.

À prévoir côté exploitation : sauvegarde de la base **et** de la clé `YS_CLE_SECRETE`, conservées
séparément ; supervision de `/api/sante` (répond 200 quand la base est joignable).

`YS_APERCU_INTEGRE=1` relâche des protections pour afficher l'outil dans une iframe de prévisualisation :
ne jamais l'activer en production.

## Choix assumés

- **SQL explicite plutôt qu'un ORM** : les règles importantes (statut effectif, numérotation, journal non
  modifiable, activation d'une source) sont des contraintes ou des fonctions de la base ; les voir en SQL
  évite qu'elles soient contournées.
- **Extraction par règles d'abord** : déterministe, gratuite, testable. L'IA ne fait que compléter et reste
  désactivée par défaut.
- **Numérotation par séries** (`YS-OF-2026-0001`, `YS-CA-…`, `YS-PL-…`) avec une série distincte pour le jeu de
  démonstration (`YS-DEMO-…`), qui ne consomme donc aucun numéro réel.
- **Pas de préchargement des liens** : chaque consultation d'une fiche candidat est journalisée, une page ne
  doit donc être demandée que lorsqu'on clique.
- **Heure légale calculée par l'outil** : le Maroc est revenu à l'heure GMT le 20 septembre 2026. Un Node.js
  ou un PostgreSQL dont la base des fuseaux date d'avant juillet 2026 l'ignore et afficherait une heure de
  trop. `src/domaine/fuseau.ts` et la fonction SQL `ys_heure_maroc()` appliquent donc cette règle quand la
  base du serveur est ancienne, et suivent la base quand elle est à jour. Un changement d'heure ultérieur
  demanderait, lui, de mettre à jour Node.js et PostgreSQL.
