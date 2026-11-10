# 10 — Plan de tests

## Lancer les contrôles

```bash
npm run typecheck          # types TypeScript
npm run lint               # ESLint
npm run test:unitaires     # règles métier, sans base ni réseau
npm run test:integration   # sur un vrai PostgreSQL (embarqué, jetable)
npm test                   # les deux
```

Les tests d'intégration démarrent leur propre PostgreSQL temporaire. Pour utiliser un serveur existant :
`YS_TEST_DATABASE_URL=postgres://…` (base vide dédiée : les tables y sont vidées).

Aucun test n'appelle un site réel, un fournisseur d'IA, d'e-mail ou de WhatsApp : les réponses sont
simulées à partir des fichiers de `tests/fixtures/`.

## Résultat au 10 novembre 2026

**350 tests, tous réussis** : 271 unitaires (14 fichiers) et 79 d'intégration (3 fichiers). Types et lint
sans erreur.

### Tests unitaires

| Fichier | Tests | Ce qui est vérifié |
| --- | --- | --- |
| `extraction` | 59 | Salaire, contrat, expérience, langues, logement, dates relatives et absolues, en français, arabe et anglais ; rien n'est inventé |
| `geographie` | 28 | Villes, quartiers, alias, écriture arabe, détection d'un lieu hors Maroc |
| `http-pipeline` | 27 | Client de collecte : délais, plafond de requêtes, arrêt sur refus, adresses privées ; pipeline complet |
| `risques-statuts` | 27 | Signaux de risque, négations, salaires anormaux, statut initial et statut effectif |
| `classification` | 24 | Classement des 42 métiers, faux amis, contexte, annonces hors secteurs |
| `collecte` | 23 | `robots.txt` (RFC 9309), flux RSS et Atom, sitemaps, données structurées, fichiers CSV et JSON |
| `appariement-commissions-alertes` | 23 | Score de rapprochement, bloquants, permis compté une fois, calcul et statuts des commissions, critères d'alerte |
| `scores-doublons` | 19 | Fraîcheur, qualité, pertinence, indice de placement, doublons exacts, proches et bilingues |
| `fuseau` | 12 | Heure légale du Maroc : retour à GMT du 20 septembre 2026, ramadan 2026, même résultat que la base des fuseaux du serveur soit ancienne ou à jour ; dates saisies et dates affichées |
| `texte` | 9 | Normalisation du français et de l'arabe, conversion du HTML en texte, similarité |
| `ia` | 8 | Réponse du modèle validée, valeurs hors référentiel écartées, tentative d'injection sans effet |
| `csv` | 5 | Export : neutralisation des formules de tableur, guillemets, format lisible par un tableur |
| `accord` | 4 | Accords singulier et pluriel |
| `referentiels` | 3 | Codes reconnus ou refusés, libellés |

### Tests d'intégration

| Fichier | Tests | Ce qui est vérifié |
| --- | --- | --- |
| `ingestion` | 26 | Collecte de bout en bout sur un site fictif ; activation d'une source refusée sans base juridique ; mise en pause sur refus ; recherche en français, arabe et anglais ; doublons ; versions ; rejets motivés ; statut effectif identique en SQL et dans le code ; imports manuels et par fichier |
| `crm` | 33 | Candidats (consentement, refus des mineurs, chiffrement, anonymisation), employeurs, besoins, rapprochements, placements, commissions et reçus (filtre par jour à l'heure du Maroc), alertes, maintenance, jeu de démonstration séparé des données réelles |
| `securite` | 20 | Connexion, limite de tentatives, fermeture des sessions, dernier administrateur, droits par rôle, journal non modifiable et sans donnée personnelle, validation des paramètres, heure légale identique dans la base et dans l'application, reprise d'une source en pause |

## Vérifications manuelles faites

Faites dans l'environnement de développement, sur une installation locale avec le jeu de démonstration et
des saisies d'essai.

- **Parcours complet sans JavaScript** : connexion et changement de mot de passe imposé ; import manuel et
  par fichier ; candidat, employeur, besoin, rapprochement, placement, commission, encaissement, reçu ;
  alertes ; export CSV ; comptes et rôles ; paramètres ; journal.
- **Droits** : pages et actions interdites refusées pour le lecteur et le courtier, y compris par requête
  forgée.
- **Navigateur réel** (Chromium) : les écrans principaux à 1366 px ; 30 pages sans défilement horizontal à
  360, 390, 768 et 1024 px ; impression du reçu sur une page A4 et du tableau de bord ; chargement et
  suppression du jeu de démonstration par clic, avec confirmation.
- **Scripts** : `npm run verifier` et `npm run worker:une-fois` sur la base locale.
- **Heure légale** : suite complète rejouée avec deux versions de Node.js — 22.22.3, dont la base des
  fuseaux (2026a) ignore le retour du Maroc à GMT, et 22.23.4, dont la base (2026e) le connaît — et tests
  d'intégration rejoués sur deux versions de PostgreSQL — 17.9 (base ancienne) et 17.11 (base à jour).
  Mêmes résultats dans les quatre cas.
- **Intégration continue** (`.github/workflows/ci.yml`) : exécutée par GitHub à chaque mise à jour d'une
  demande de fusion ; le résultat se lit dans l'onglet « Actions » du dépôt. La première exécution
  (demande n° 1) s'est arrêtée sur deux tests d'heure légale : le Node.js de GitHub connaissait le retour à
  GMT, pas celui du poste de développement, et les tests attendaient encore UTC+1. C'est ce qui a fait
  corriger l'outil.

## Ce qui n'a pas été vérifié

| Sujet | État |
| --- | --- |
| Collecte sur les sites réels | Jamais exécutée : sources désactivées, sites inaccessibles depuis l'environnement de développement. Seul le site fictif des tests a été collecté. |
| Extraction par IA | Testée avec un modèle simulé uniquement. |
| Envoi d'e-mails et de messages WhatsApp | Aucun fournisseur configuré : les envois sont enregistrés comme « simulés ». |
| Heure légale du Maroc | Le retour à GMT du 20 septembre 2026 est tiré de la base internationale des fuseaux horaires (IANA, version 2026c de juillet 2026), qui cite le décret n° 2.26.530 ; le texte du décret n'a pas été lu. Un changement d'heure ultérieur demanderait de mettre à jour Node.js et PostgreSQL. |
| Charge | Aucun test de volume ; l'outil est conçu pour une petite équipe et quelques milliers d'offres. |
| Navigateurs | Chromium uniquement ; ni Safari ni Firefox. |
| Accessibilité | Structure, libellés et contrastes soignés, mais aucun audit avec lecteur d'écran. |
| Dépendances | `npm audit --omit=dev` : aucune alerte sur les dépendances de production. `npm audit` complet : 8 alertes de niveau modéré, sur des outils de développement. |

## Recette proposée avant mise en service

1. Installer, changer le mot de passe administrateur, lancer `npm run verifier`.
2. Charger le jeu de démonstration, dérouler le parcours du document [03](03-parcours-et-ecrans.md), puis
   le supprimer.
3. Créer un compte courtier et un compte lecteur ; vérifier ce que chacun voit.
4. Saisir trois annonces réelles par import manuel et contrôler métier, ville, date et statut.
5. Enregistrer un candidat réel avec son accord, le rapprocher d'une offre, relire l'explication du score.
6. Imprimer un reçu et le faire relire par la personne chargée de la comptabilité.
7. Vérifier la sauvegarde : restaurer la base et la clé sur une autre machine, ouvrir une fiche candidat.
