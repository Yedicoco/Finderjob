# 05 — Modèle de données

Le schéma est dans `db/migrations/` : `0001_schema_initial.sql` (32 tables),
`0002_recherche_et_statut_effectif.sql` (recherche plein texte, vue `v_job_offers`) et
`0003_heure_legale_maroc.sql` (fonction `ys_heure_maroc`).

## Les tables par domaine

| Domaine | Tables | Contenu |
| --- | --- | --- |
| Comptes | `roles`, `users`, `sessions`, `rate_limits` | Comptes, empreintes de sessions, compteurs de tentatives |
| Réglages | `app_settings`, `counters` | Paramètres modifiables, numérotation par série |
| Référentiels | `cities`, `districts`, `job_categories`, `skills` | Villes et quartiers, secteurs et métiers, compétences et documents |
| Sources | `job_sources`, `scraping_runs`, `ingestion_rejections` | Catalogue et conformité, historique des collectes, annonces écartées (motif seulement) |
| Offres | `job_offers`, `job_offer_categories`, `job_offer_skills`, `job_offer_versions` | Offres, classement, compétences repérées, historique des changements |
| Employeurs | `employers`, `employer_interactions`, `employer_needs` | Employeurs, échanges et relances, besoins |
| Candidats | `candidates`, `candidate_profiles`, `candidate_profile_categories`, `candidate_skills`, `candidate_references` | Identité chiffrée, profil professionnel, métiers, compétences, références |
| Placement | `matches`, `placements`, `commissions` | Rapprochements et leur explication, placements, commissions et reçus |
| Suivi | `alerts`, `notifications`, `search_queries` | Alertes, notifications et envois, recherches |
| Audit | `audit_logs` | Journal non modifiable |

## Règles portées par la base

Ces règles s'appliquent même à une requête SQL écrite à la main.

- **Statut effectif.** La vue `v_job_offers` calcule `effective_status` à la lecture : une offre active dont
  la validité est dépassée apparaît « expirée » sans traitement. Toutes les lectures passent par cette vue.
  Un test compare, sur une grille de cas, le résultat SQL et celui du code.
- **Pas d'offre active sans date.** Une contrainte refuse une offre « active » sans date de publication ou
  rattachée comme doublon.
- **Activation d'une source.** Une source automatisée ne peut être active sans base juridique, date de
  lecture des conditions et autorisation « non requise » ou « accordée ».
- **Journal non modifiable.** Un déclencheur refuse toute modification ou suppression dans `audit_logs`.
- **Numérotation.** `ys_next_reference(série)` délivre des numéros uniques qui se suivent, par série et par
  année ; les séries `DEMO-…` sont séparées.
- **Heure légale.** `ys_heure_maroc(instant)` donne la date et l'heure de Casablanca. Les requêtes
  l'utilisent à la place de `AT TIME ZONE 'Africa/Casablanca'`, qui dépend de la base des fuseaux du
  serveur ; un test vérifie qu'elle donne la même heure que l'application.
- **Valeurs fermées.** Statuts, types de contrat, modes de collecte, moyens de paiement sont limités par des
  contraintes `CHECK`, alignées sur les référentiels du code.
- **Aucun mineur.** Une fiche candidat dont l'âge déclaré est inférieur à 18 ans est refusée.
- **Dédoublonnage des notifications.** Une alerte ne signale pas deux fois la même offre sur le même canal.

## Données personnelles

| Donnée | Stockage |
| --- | --- |
| Nom, téléphone, e-mail, notes d'un candidat | Chiffrés (AES-256-GCM) |
| Recherche par téléphone ou par mot du nom | Index « aveugle » (HMAC), sans valeur en clair |
| Contact d'un employeur, texte d'une annonce confiée | Chiffrés |
| Mot de passe | Empreinte scrypt |
| Jeton de session, adresse IP | Empreintes seulement |
| Journal d'audit | Références et noms de champs, jamais de valeur personnelle |

À l'anonymisation d'un candidat, l'identité et les coordonnées sont effacées ; la référence, le métier et
l'historique des placements sont conservés pour les statistiques.

## Offres : ce qui est conservé selon la source

| Mode de la source | Conservé |
| --- | --- |
| `index_liens` | Titre, lien, date |
| `extrait` | Idem, plus un extrait limité (200 caractères par défaut) |
| `texte_complet` | Texte entier — réservé aux annonces confiées ou à une autorisation écrite |
| Contacts | Seulement si la source l'autorise explicitement, et chiffrés |

Un import manuel depuis un site d'emploi ne garde qu'un extrait court et le lien, pour un usage interne.
