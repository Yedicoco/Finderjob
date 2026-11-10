-- =============================================================================
-- Yallah Services Job Radar — schéma initial (PostgreSQL 15+)
-- =============================================================================
-- Conventions
--   * Noms de tables et de colonnes en anglais : ce sont les entités listées
--     dans le cahier des charges (User, JobOffer, Candidate, Commission…).
--   * Valeurs métier (statuts, types) en français, sans accent : ce sont les
--     libellés du cahier des charges (actif, expire, douteux, archive…).
--   * Les énumérations sont des contraintes CHECK (plus simples à faire évoluer
--     que des types ENUM).
--   * Les colonnes suffixées « _enc » contiennent une donnée personnelle
--     chiffrée par l'application (AES-256-GCM, voir src/serveur/chiffrement.ts).
--     Les colonnes suffixées « _bidx » sont des index aveugles (HMAC) qui
--     permettent une recherche exacte sans stocker la valeur en clair.
--   * Aucune offre fictive n'est créée par les migrations.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- -----------------------------------------------------------------------------
-- Fonctions utilitaires
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ys_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Rôles, utilisateurs, sessions
-- -----------------------------------------------------------------------------

CREATE TABLE roles (
  code        text PRIMARY KEY CHECK (code IN ('administrateur', 'courtier', 'lecteur')),
  label       text NOT NULL,
  description text NOT NULL
);

INSERT INTO roles (code, label, description) VALUES
  ('administrateur', 'Administrateur',
   'Gère les sources, les règles, les utilisateurs, les paramètres et les exports.'),
  ('courtier', 'Courtier',
   'Qualifie les offres, gère candidats, employeurs, placements et commissions.'),
  ('lecteur', 'Lecteur',
   'Consulte les offres et les indicateurs. Ne voit jamais les données personnelles.');

CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                text NOT NULL,
  password_hash        text NOT NULL,
  full_name            text NOT NULL,
  role_code            text NOT NULL REFERENCES roles (code),
  is_active            boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  -- Numéro WhatsApp de l'utilisateur (chiffré), uniquement pour recevoir ses propres alertes.
  phone_enc            text,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_format CHECK (email = lower(email) AND position('@' IN email) > 1)
);
CREATE UNIQUE INDEX users_email_unique ON users (email);
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION ys_touch_updated_at();

-- Sessions côté serveur : révocables, le cookie ne contient qu'un jeton aléatoire
-- dont seule l'empreinte SHA-256 est stockée.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip_hash      text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Limitation de débit (connexion, import) — même principe que le serveur du
-- site Yallah Services : compteur par empreinte salée, jamais l'adresse IP.
CREATE TABLE rate_limits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 1 CHECK (hits > 0),
  PRIMARY KEY (bucket, window_start)
);

-- -----------------------------------------------------------------------------
-- 2. Paramètres et numérotation
-- -----------------------------------------------------------------------------

CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text NOT NULL DEFAULT '',
  updated_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Numérotation « YS-<type>-<année>-<NNNN> », dans la continuité des numéros de
-- dossier YS-2026-0001 du site Yallah Services.
CREATE TABLE counters (
  scope      text NOT NULL,
  year       smallint NOT NULL,
  last_value integer NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (scope, year)
);

CREATE OR REPLACE FUNCTION ys_next_reference(p_scope text, p_year integer DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_year  integer := COALESCE(p_year, extract(year FROM (now() AT TIME ZONE 'Africa/Casablanca'))::integer);
  v_value integer;
BEGIN
  INSERT INTO counters (scope, year, last_value) VALUES (p_scope, v_year, 1)
  ON CONFLICT (scope, year) DO UPDATE SET last_value = counters.last_value + 1
  RETURNING last_value INTO v_value;
  RETURN 'YS-' || p_scope || '-' || v_year::text || '-' || lpad(v_value::text, 4, '0');
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Référentiels : villes, quartiers, catégories de métiers, compétences
-- -----------------------------------------------------------------------------

CREATE TABLE cities (
  code         text PRIMARY KEY,
  name_fr      text NOT NULL,
  name_ar      text,
  region       text,
  -- Statut dans la couverture Yallah Services (site.config.json du site vitrine).
  yallah_status text NOT NULL DEFAULT 'hors_zone'
    CHECK (yallah_status IN ('confirmee', 'pole', 'candidate', 'retiree', 'hors_zone')),
  yallah_phase smallint CHECK (yallah_phase BETWEEN 1 AND 3),
  aliases      text[] NOT NULL DEFAULT '{}',
  sort_order   integer NOT NULL DEFAULT 1000
);

CREATE TABLE districts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_code      text NOT NULL REFERENCES cities (code) ON DELETE CASCADE,
  name           text NOT NULL,
  is_target_zone boolean NOT NULL DEFAULT false,
  aliases        text[] NOT NULL DEFAULT '{}',
  UNIQUE (city_code, name)
);

CREATE TABLE job_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  parent_id       uuid REFERENCES job_categories (id) ON DELETE RESTRICT,
  level           text NOT NULL CHECK (level IN ('secteur', 'metier')),
  label_fr        text NOT NULL,
  label_ar        text,
  label_en        text,
  -- Mots-clés et synonymes par langue : {"fr": [...], "ar": [...], "en": [...]}.
  keywords        jsonb NOT NULL DEFAULT '{}'::jsonb,
  yallah_priority smallint NOT NULL DEFAULT 50 CHECK (yallah_priority BETWEEN 0 AND 100),
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 1000,
  CONSTRAINT job_categories_hierarchy CHECK (
    (level = 'secteur' AND parent_id IS NULL) OR (level = 'metier' AND parent_id IS NOT NULL)
  )
);
CREATE INDEX job_categories_parent_idx ON job_categories (parent_id);

CREATE TABLE skills (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code     text NOT NULL UNIQUE,
  label_fr text NOT NULL,
  label_ar text,
  label_en text,
  kind     text NOT NULL DEFAULT 'competence' CHECK (kind IN ('competence', 'document', 'avantage'))
);

-- -----------------------------------------------------------------------------
-- 4. Sources et exécutions de collecte
-- -----------------------------------------------------------------------------

CREATE TABLE job_sources (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('rss', 'sitemap', 'api', 'manuel', 'fichier')),
  base_url             text,
  feed_url             text,
  -- Ce que l'application a le droit de conserver pour cette source.
  collection_mode      text NOT NULL DEFAULT 'manuel'
    CHECK (collection_mode IN ('desactive', 'manuel', 'index_liens', 'extrait', 'texte_complet')),
  is_active            boolean NOT NULL DEFAULT false,
  -- Conformité : une source automatisée ne peut pas être activée sans base
  -- juridique consignée et sans vérification datée des conditions d'utilisation.
  legal_basis          text,
  permission_status    text NOT NULL DEFAULT 'non_demandee'
    CHECK (permission_status IN ('non_requise', 'non_demandee', 'demandee', 'accordee', 'refusee')),
  permission_reference text,
  terms_url            text,
  terms_summary        text,
  terms_checked_at     timestamptz,
  robots_summary       text,
  robots_checked_at    timestamptz,
  -- Politesse et limites
  user_agent           text,
  min_delay_ms         integer NOT NULL DEFAULT 5000 CHECK (min_delay_ms >= 1000),
  max_requests_per_run integer NOT NULL DEFAULT 30 CHECK (max_requests_per_run BETWEEN 1 AND 500),
  frequency_minutes    integer NOT NULL DEFAULT 360 CHECK (frequency_minutes >= 60),
  max_excerpt_chars    integer NOT NULL DEFAULT 300 CHECK (max_excerpt_chars BETWEEN 0 AND 5000),
  -- Traitements autorisés
  allow_ai_processing  boolean NOT NULL DEFAULT false,
  store_contacts       boolean NOT NULL DEFAULT false,
  keep_unclassified    boolean NOT NULL DEFAULT false,
  country_default      char(2),
  reliability_score    smallint NOT NULL DEFAULT 50 CHECK (reliability_score BETWEEN 0 AND 100),
  config               jsonb NOT NULL DEFAULT '{}'::jsonb,
  http_cache           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- État d'exploitation (mode dégradé)
  last_run_at          timestamptz,
  last_success_at      timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  paused_until         timestamptz,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_sources_activation_conforme CHECK (
    NOT is_active
    OR kind IN ('manuel', 'fichier')
    OR (legal_basis IS NOT NULL AND length(btrim(legal_basis)) >= 10
        AND terms_checked_at IS NOT NULL
        AND permission_status IN ('non_requise', 'accordee')
        AND collection_mode IN ('index_liens', 'extrait', 'texte_complet'))
  ),
  CONSTRAINT job_sources_texte_complet_autorise CHECK (
    collection_mode <> 'texte_complet' OR kind IN ('manuel', 'fichier') OR permission_status = 'accordee'
  )
);
CREATE TRIGGER job_sources_touch BEFORE UPDATE ON job_sources
  FOR EACH ROW EXECUTE FUNCTION ys_touch_updated_at();

CREATE TABLE scraping_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id            uuid NOT NULL REFERENCES job_sources (id) ON DELETE CASCADE,
  trigger_kind         text NOT NULL CHECK (trigger_kind IN ('planifie', 'manuel', 'import')),
  status               text NOT NULL DEFAULT 'en_cours'
    CHECK (status IN ('en_cours', 'succes', 'partiel', 'echec', 'ignore')),
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  http_requests        integer NOT NULL DEFAULT 0,
  robots_blocked_count integer NOT NULL DEFAULT 0,
  fetched_count        integer NOT NULL DEFAULT 0,
  new_count            integer NOT NULL DEFAULT 0,
  updated_count        integer NOT NULL DEFAULT 0,
  unchanged_count      integer NOT NULL DEFAULT 0,
  duplicate_count      integer NOT NULL DEFAULT 0,
  rejected_count       integer NOT NULL DEFAULT 0,
  error_count          integer NOT NULL DEFAULT 0,
  message              text,
  details              jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by         uuid REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX scraping_runs_source_idx ON scraping_runs (source_id, started_at DESC);
-- Une seule exécution à la fois par source (deux workers ne doublent jamais les requêtes).
CREATE UNIQUE INDEX scraping_runs_une_seule_en_cours ON scraping_runs (source_id) WHERE status = 'en_cours';

-- Trace des éléments écartés (hors Maroc, hors taxonomie…) : sert à l'audit de
-- qualité et évite de retélécharger une page déjà écartée. Aucun contenu stocké.
CREATE TABLE ingestion_rejections (
  id         bigserial PRIMARY KEY,
  run_id     uuid REFERENCES scraping_runs (id) ON DELETE SET NULL,
  source_id  uuid NOT NULL REFERENCES job_sources (id) ON DELETE CASCADE,
  url_hash   text NOT NULL,
  source_url text,
  title      text,
  reason     text NOT NULL CHECK (reason IN (
    'hors_maroc', 'hors_taxonomie', 'contenu_vide', 'robots_interdit', 'erreur_extraction', 'doublon_exact'
  )),
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingestion_rejections_lookup_idx ON ingestion_rejections (source_id, url_hash);

-- -----------------------------------------------------------------------------
-- 5. Employeurs (CRM)
-- -----------------------------------------------------------------------------

CREATE TABLE employers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         text NOT NULL UNIQUE,
  employer_type     text NOT NULL CHECK (employer_type IN (
    'famille', 'particulier', 'residence', 'riad', 'hotel', 'spa', 'salon', 'entreprise', 'autre'
  )),
  -- Pour une famille ou un particulier, utiliser un libellé non identifiant
  -- (« Famille B. — Californie ») : l'identité complète va dans les champs chiffrés.
  name              text NOT NULL CHECK (length(btrim(name)) >= 2),
  name_normalized   text NOT NULL,
  contact_name_enc  text,
  phone_enc         text,
  phone_bidx        text,
  email_enc         text,
  address_enc       text,
  city_code         text REFERENCES cities (code),
  district          text,
  status            text NOT NULL DEFAULT 'prospect' CHECK (status IN (
    'prospect', 'a_contacter', 'contacte', 'besoin_qualifie', 'candidats_proposes', 'placement_realise', 'cloture'
  )),
  origin            text NOT NULL DEFAULT 'saisie' CHECK (origin IN (
    'saisie', 'offre', 'demande_entrante', 'recommandation', 'site_yallah', 'import'
  )),
  -- Base de traitement des coordonnées (loi 09-08), surtout pour les particuliers.
  contact_basis     text NOT NULL DEFAULT 'non_renseignee' CHECK (contact_basis IN (
    'demande_entrante', 'relation_existante', 'annonce_publique', 'consentement', 'non_renseignee'
  )),
  do_not_contact    boolean NOT NULL DEFAULT false,
  next_follow_up_at timestamptz,
  notes             text,
  -- Fiche fictive du jeu de démonstration (jamais mélangée aux données réelles).
  is_demo           boolean NOT NULL DEFAULT false,
  assigned_to       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employers_status_idx ON employers (status);
CREATE INDEX employers_city_idx ON employers (city_code);
CREATE INDEX employers_follow_up_idx ON employers (next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX employers_name_trgm_idx ON employers USING gin (name_normalized gin_trgm_ops);
CREATE INDEX employers_phone_bidx_idx ON employers (phone_bidx) WHERE phone_bidx IS NOT NULL;
CREATE TRIGGER employers_touch BEFORE UPDATE ON employers
  FOR EACH ROW EXECUTE FUNCTION ys_touch_updated_at();

CREATE TABLE employer_interactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id    uuid NOT NULL REFERENCES employers (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('appel', 'whatsapp', 'email', 'visite', 'note')),
  summary        text NOT NULL CHECK (length(btrim(summary)) >= 2),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  next_action_at timestamptz,
  user_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employer_interactions_employer_idx ON employer_interactions (employer_id, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- 6. Offres d'emploi
-- -----------------------------------------------------------------------------

CREATE TABLE job_offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             text NOT NULL UNIQUE,
  -- Provenance
  source_id             uuid NOT NULL REFERENCES job_sources (id) ON DELETE RESTRICT,
  source_external_id    text NOT NULL,
  source_url            text,
  canonical_url         text,
  -- Contenu
  title                 text NOT NULL CHECK (length(btrim(title)) >= 3),
  title_normalized      text NOT NULL,
  employer_name         text,
  employer_normalized   text,
  employer_type_guess   text CHECK (employer_type_guess IS NULL OR employer_type_guess IN (
    'famille', 'particulier', 'residence', 'riad', 'hotel', 'spa', 'salon', 'entreprise', 'autre'
  )),
  employer_id           uuid REFERENCES employers (id) ON DELETE SET NULL,
  description_excerpt   text,
  description_full      text,
  ai_summary            text,
  content_language      text NOT NULL DEFAULT 'fr' CHECK (content_language IN ('fr', 'ar', 'en', 'mixte')),
  -- Localisation : le Maroc est une contrainte de la base, pas une convention.
  country_code          char(2) NOT NULL DEFAULT 'MA' CHECK (country_code = 'MA'),
  city_code             text REFERENCES cities (code),
  city_label            text,
  district              text,
  region                text,
  -- Classification
  primary_category_id   uuid REFERENCES job_categories (id) ON DELETE SET NULL,
  sector_code           text,
  classification_confidence smallint CHECK (classification_confidence BETWEEN 0 AND 100),
  -- Conditions
  contract_type         text NOT NULL DEFAULT 'non_precise' CHECK (contract_type IN (
    'cdi', 'cdd', 'interim', 'saisonnier', 'journalier', 'stage', 'freelance', 'anapec', 'non_precise'
  )),
  work_time             text NOT NULL DEFAULT 'non_precise' CHECK (work_time IN (
    'temps_plein', 'temps_partiel', 'nuit', 'week_end', 'non_precise'
  )),
  work_mode             text NOT NULL DEFAULT 'non_precise' CHECK (work_mode IN (
    'sur_site', 'a_domicile', 'hybride', 'teletravail', 'non_precise'
  )),
  salary_min            numeric(12, 2) CHECK (salary_min IS NULL OR salary_min > 0),
  salary_max            numeric(12, 2) CHECK (salary_max IS NULL OR salary_max > 0),
  salary_period         text CHECK (salary_period IS NULL OR salary_period IN ('mois', 'semaine', 'jour', 'heure')),
  salary_currency       char(3) NOT NULL DEFAULT 'MAD',
  salary_text           text,
  salary_monthly_estimate numeric(12, 2),
  salary_flag           text CHECK (salary_flag IS NULL OR salary_flag IN ('normal', 'bas', 'sous_minimum_legal', 'eleve')),
  experience_min_years  numeric(4, 1) CHECK (experience_min_years IS NULL OR experience_min_years >= 0),
  experience_level      text NOT NULL DEFAULT 'non_precise' CHECK (experience_level IN (
    'debutant', 'moins_1_an', '1_2_ans', '3_5_ans', 'plus_5_ans', 'non_precise'
  )),
  languages             text[] NOT NULL DEFAULT '{}',
  driving_license       boolean,
  housing               text CHECK (housing IS NULL OR housing IN ('loge', 'non_loge', 'indifferent')),
  meals_provided        boolean,
  schedule_text         text,
  availability_text     text,
  start_date            date,
  headcount             integer CHECK (headcount IS NULL OR headcount > 0),
  is_urgent             boolean NOT NULL DEFAULT false,
  is_bulk_hiring        boolean NOT NULL DEFAULT false,
  -- Contact : jamais conservé pour une source automatisée sans autorisation
  -- (job_sources.store_contacts). has_contact_in_source indique seulement que
  -- l'annonce d'origine en contient un.
  has_contact_in_source boolean NOT NULL DEFAULT false,
  contact_name_enc      text,
  contact_phone_enc     text,
  contact_email_enc     text,
  apply_url             text,
  -- Dates
  published_at          timestamptz,
  date_precision        text NOT NULL DEFAULT 'inconnue' CHECK (date_precision IN ('exacte', 'approximative', 'inconnue')),
  source_updated_at     timestamptz,
  expires_at            timestamptz,
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  last_checked_at       timestamptz NOT NULL DEFAULT now(),
  -- Statut : voir aussi la vue v_job_offers (statut effectif calculé à la lecture).
  status                text NOT NULL CHECK (status IN ('actif', 'expire', 'douteux', 'archive')),
  status_reason         text NOT NULL DEFAULT 'aucun' CHECK (status_reason IN (
    'aucun', 'date_inconnue', 'date_incoherente', 'hors_perimetre_date', 'localisation_inconnue',
    'expiree_source', 'expiree_anciennete', 'non_reverifiee', 'risque_eleve', 'doublon',
    'source_indisponible', 'rejetee_moderation', 'pourvue', 'archivage_manuel'
  )),
  status_changed_at     timestamptz NOT NULL DEFAULT now(),
  verification_status   text NOT NULL DEFAULT 'non_requise' CHECK (verification_status IN (
    'non_requise', 'a_verifier', 'verifiee', 'rejetee'
  )),
  requires_human_review boolean NOT NULL DEFAULT false,
  reviewed_by           uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  review_notes          text,
  -- Doublons : l'offre secondaire pointe vers l'offre principale.
  duplicate_of_id       uuid REFERENCES job_offers (id) ON DELETE SET NULL,
  duplicate_score       smallint CHECK (duplicate_score BETWEEN 0 AND 100),
  fingerprint           text NOT NULL,
  content_hash          text NOT NULL,
  -- Scores (0 à 100) et explications
  relevance_score       smallint NOT NULL DEFAULT 0 CHECK (relevance_score BETWEEN 0 AND 100),
  freshness_score       smallint NOT NULL DEFAULT 0 CHECK (freshness_score BETWEEN 0 AND 100),
  quality_score         smallint NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),
  risk_score            smallint NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  placement_score       smallint NOT NULL DEFAULT 0 CHECK (placement_score BETWEEN 0 AND 100),
  risk_flags            text[] NOT NULL DEFAULT '{}',
  score_details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Extraction
  extraction_method     text NOT NULL DEFAULT 'regles' CHECK (extraction_method IN ('regles', 'llm', 'mixte', 'manuel')),
  search_keywords       text NOT NULL DEFAULT '',
  search_vector         tsvector,
  -- Jeu de démonstration : explicitement marqué, jamais mélangé sans bandeau.
  is_demo               boolean NOT NULL DEFAULT false,
  created_by            uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_offers_source_unique UNIQUE (source_id, source_external_id),
  CONSTRAINT job_offers_salary_range CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min),
  CONSTRAINT job_offers_not_self_duplicate CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id),
  -- Règle absolue : une offre ne peut pas être « active » sans date de
  -- publication connue, ni si elle est le doublon d'une autre offre.
  CONSTRAINT job_offers_actif_verifiable CHECK (
    status <> 'actif'
    OR (published_at IS NOT NULL AND date_precision <> 'inconnue' AND duplicate_of_id IS NULL)
  ),
  CONSTRAINT job_offers_review_coherent CHECK (
    (reviewed_at IS NULL AND reviewed_by IS NULL) OR reviewed_at IS NOT NULL
  )
);
CREATE INDEX job_offers_status_idx ON job_offers (status, published_at DESC);
CREATE INDEX job_offers_city_idx ON job_offers (city_code);
CREATE INDEX job_offers_category_idx ON job_offers (primary_category_id);
CREATE INDEX job_offers_sector_idx ON job_offers (sector_code);
CREATE INDEX job_offers_published_idx ON job_offers (published_at DESC NULLS LAST);
CREATE INDEX job_offers_relevance_idx ON job_offers (relevance_score DESC);
CREATE INDEX job_offers_fingerprint_idx ON job_offers (fingerprint);
CREATE INDEX job_offers_duplicate_idx ON job_offers (duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;
CREATE INDEX job_offers_verification_idx ON job_offers (verification_status) WHERE verification_status = 'a_verifier';
CREATE INDEX job_offers_employer_idx ON job_offers (employer_normalized);
CREATE INDEX job_offers_canonical_url_idx ON job_offers (canonical_url) WHERE canonical_url IS NOT NULL;
CREATE INDEX job_offers_title_trgm_idx ON job_offers USING gin (title_normalized gin_trgm_ops);
CREATE INDEX job_offers_search_idx ON job_offers USING gin (search_vector);
CREATE TRIGGER job_offers_touch BEFORE UPDATE ON job_offers
  FOR EACH ROW EXECUTE FUNCTION ys_touch_updated_at();

CREATE TABLE job_offer_categories (
  job_offer_id uuid NOT NULL REFERENCES job_offers (id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES job_categories (id) ON DELETE CASCADE,
  confidence   smallint NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  is_primary   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (job_offer_id, category_id)
);
CREATE INDEX job_offer_categories_category_idx ON job_offer_categories (category_id);

CREATE TABLE job_offer_skills (
  job_offer_id uuid NOT NULL REFERENCES job_offers (id) ON DELETE CASCADE,
  skill_id     uuid NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  PRIMARY KEY (job_offer_id, skill_id)
);

-- Suivi des changements d'une offre (salaire, ville, statut, date…).
CREATE TABLE job_offer_versions (
  id             bigserial PRIMARY KEY,
  job_offer_id   uuid NOT NULL REFERENCES job_offers (id) ON DELETE CASCADE,
  observed_at    timestamptz NOT NULL DEFAULT now(),
  origin         text NOT NULL CHECK (origin IN ('collecte', 'moderation', 'maintenance', 'fusion_doublon', 'saisie')),
  changed_fields text[] NOT NULL,
  changes        jsonb NOT NULL,
  run_id         uuid REFERENCES scraping_runs (id) ON DELETE SET NULL,
  user_id        uuid REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX job_offer_versions_offer_idx ON job_offer_versions (job_offer_id, observed_at DESC);

-- Besoins exprimés par un employeur (créés depuis une offre ou saisis).
CREATE TABLE employer_needs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference      text NOT NULL UNIQUE,
  employer_id    uuid NOT NULL REFERENCES employers (id) ON DELETE CASCADE,
  job_offer_id   uuid REFERENCES job_offers (id) ON DELETE SET NULL,
  category_id    uuid REFERENCES job_categories (id) ON DELETE SET NULL,
  title          text NOT NULL CHECK (length(btrim(title)) >= 3),
  headcount      integer NOT NULL DEFAULT 1 CHECK (headcount > 0),
  city_code      text REFERENCES cities (code),
  district       text,
  contract_type  text NOT NULL DEFAULT 'non_precise' CHECK (contract_type IN (
    'cdi', 'cdd', 'interim', 'saisonnier', 'journalier', 'stage', 'freelance', 'anapec', 'non_precise'
  )),
  work_time      text NOT NULL DEFAULT 'non_precise' CHECK (work_time IN (
    'temps_plein', 'temps_partiel', 'nuit', 'week_end', 'non_precise'
  )),
  housing        text CHECK (housing IS NULL OR housing IN ('loge', 'non_loge', 'indifferent')),
  salary_min     numeric(12, 2),
  salary_max     numeric(12, 2),
  salary_period  text CHECK (salary_period IS NULL OR salary_period IN ('mois', 'semaine', 'jour', 'heure')),
  languages      text[] NOT NULL DEFAULT '{}',
  driving_license boolean,
  experience_min_years numeric(4, 1),
  start_date     date,
  is_urgent      boolean NOT NULL DEFAULT false,
  requirements   text,
  status         text NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert', 'en_cours', 'pourvu', 'annule')),
  -- Formule de frais employeur : Premium / Sérénité (grille du site Yallah) ou sur mesure.
  fee_plan       text CHECK (fee_plan IS NULL OR fee_plan IN ('premium', 'serenite', 'sur_mesure')),
  fee_amount     numeric(12, 2) CHECK (fee_amount IS NULL OR fee_amount >= 0),
  notes          text,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employer_needs_employer_idx ON employer_needs (employer_id);
CREATE INDEX employer_needs_status_idx ON employer_needs (status);
CREATE TRIGGER employer_needs_touch BEFORE UPDATE ON employer_needs
  FOR EACH ROW EXECUTE FUNCTION ys_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 7. Candidats
-- -----------------------------------------------------------------------------
-- candidates          : identité (chiffrée), consentement, cycle de vie.
-- candidate_profiles  : profil professionnel non identifiant, seul utilisé par
--                       l'appariement et seul visible par le rôle « lecteur ».

CREATE TABLE candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           text NOT NULL UNIQUE,
  external_ref        text,
  status              text NOT NULL DEFAULT 'nouveau' CHECK (status IN (
    'nouveau', 'contacte', 'entretien', 'propose', 'place', 'refuse', 'indisponible'
  )),
  full_name_enc       text,
  name_bidx           text[] NOT NULL DEFAULT '{}',
  phone_enc           text,
  phone_bidx          text,
  email_enc           text,
  notes_enc           text,
  -- Conservé uniquement pour la compatibilité d'import avec le formulaire du
  -- site ; jamais lu par l'appariement ni par les scores.
  origin_country_enc  text,
  -- Âge déclaré : sert uniquement à refuser les mineurs (loi 19-12).
  declared_age        smallint CHECK (declared_age IS NULL OR declared_age BETWEEN 18 AND 80),
  -- Consentement (loi 09-08) : obligatoire pour créer une fiche.
  consent_given_at    timestamptz NOT NULL,
  consent_version     text NOT NULL,
  consent_channel     text NOT NULL CHECK (consent_channel IN ('formulaire', 'whatsapp', 'papier', 'telephone', 'import')),
  whatsapp_opt_in     boolean NOT NULL DEFAULT false,
  origin              text NOT NULL DEFAULT 'saisie' CHECK (origin IN ('saisie', 'formulaire_yallah', 'import', 'recommandation')),
  -- Conservation : 12 mois après la dernière activité pour un candidat non placé.
  last_activity_at    timestamptz NOT NULL DEFAULT now(),
  retention_until     date NOT NULL,
  anonymized_at       timestamptz,
  anonymized_reason   text CHECK (anonymized_reason IS NULL OR anonymized_reason IN ('demande_candidat', 'fin_conservation', 'retrait_consentement')),
  -- Fiche fictive du jeu de démonstration (jamais mélangée aux données réelles).
  is_demo             boolean NOT NULL DEFAULT false,
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Une fiche anonymisée ne contient plus aucune donnée identifiante.
  CONSTRAINT candidates_anonymisation_complete CHECK (
    anonymized_at IS NULL
    OR (full_name_enc IS NULL AND phone_enc IS NULL AND phone_bidx IS NULL AND email_enc IS NULL
        AND notes_enc IS NULL AND origin_country_enc IS NULL AND name_bidx = '{}' AND declared_age IS NULL
        AND external_ref IS NULL)
  ),
  CONSTRAINT candidates_identite_presente CHECK (anonymized_at IS NOT NULL OR full_name_enc IS NOT NULL)
);
CREATE INDEX candidates_status_idx ON candidates (status);
CREATE INDEX candidates_phone_bidx_idx ON candidates (phone_bidx) WHERE phone_bidx IS NOT NULL;
CREATE INDEX candidates_name_bidx_idx ON candidates USING gin (name_bidx);
CREATE INDEX candidates_retention_idx ON candidates (retention_until) WHERE anonymized_at IS NULL;
CREATE TRIGGER candidates_touch BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION ys_touch_updated_at();

CREATE TABLE candidate_profiles (
  candidate_id         uuid PRIMARY KEY REFERENCES candidates (id) ON DELETE CASCADE,
  primary_category_id  uuid REFERENCES job_categories (id) ON DELETE SET NULL,
  city_code            text REFERENCES cities (code),
  district             text,
  accepted_city_codes  text[] NOT NULL DEFAULT '{}',
  experience_level     text NOT NULL DEFAULT 'non_precise' CHECK (experience_level IN (
    'debutant', 'moins_1_an', '1_2_ans', '3_5_ans', 'plus_5_ans', 'non_precise'
  )),
  experience_years     numeric(4, 1) CHECK (experience_years IS NULL OR experience_years >= 0),
  languages            text[] NOT NULL DEFAULT '{}',
  expected_salary      numeric(12, 2) CHECK (expected_salary IS NULL OR expected_salary > 0),
  salary_period        text NOT NULL DEFAULT 'mois' CHECK (salary_period IN ('mois', 'semaine', 'jour', 'heure')),
  housing_preference   text NOT NULL DEFAULT 'indifferent' CHECK (housing_preference IN ('loge', 'non_loge', 'indifferent')),
  work_times           text[] NOT NULL DEFAULT '{}',
  days_per_week        smallint CHECK (days_per_week IS NULL OR days_per_week BETWEEN 1 AND 7),
  available_from       date,
  driving_license      boolean NOT NULL DEFAULT false,
  documents            text[] NOT NULL DEFAULT '{}',
  references_count     smallint NOT NULL DEFAULT 0 CHECK (references_count >= 0),
  summary              text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_profiles_category_idx ON candidate_profiles (primary_category_id);
CREATE INDEX candidate_profiles_city_idx ON candidate_profiles (city_code);
CREATE TRIGGER candidate_profiles_touch BEFORE UPDATE ON candidate_profiles
  FOR EACH ROW EXECUTE FUNCTION ys_touch_updated_at();

CREATE TABLE candidate_profile_categories (
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES job_categories (id) ON DELETE CASCADE,
  PRIMARY KEY (candidate_id, category_id)
);
CREATE INDEX candidate_profile_categories_category_idx ON candidate_profile_categories (category_id);

CREATE TABLE candidate_skills (
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  skill_id     uuid NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  PRIMARY KEY (candidate_id, skill_id)
);

-- Références professionnelles : jamais publiées, jamais exportées en clair.
CREATE TABLE candidate_references (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  position     smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
  name_enc     text NOT NULL,
  phone_enc    text,
  relation     text NOT NULL DEFAULT 'autre' CHECK (relation IN (
    'ancien_employeur', 'employeur_actuel', 'responsable_entreprise', 'collegue', 'famille_recommandante', 'autre'
  )),
  checked_at   timestamptz,
  checked_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  check_notes  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, position)
);

-- -----------------------------------------------------------------------------
-- 8. Correspondances, placements, commissions
-- -----------------------------------------------------------------------------

CREATE TABLE matches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      uuid NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  job_offer_id      uuid REFERENCES job_offers (id) ON DELETE CASCADE,
  employer_need_id  uuid REFERENCES employer_needs (id) ON DELETE CASCADE,
  score             smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  explanation       jsonb NOT NULL,
  algorithm_version text NOT NULL,
  status            text NOT NULL DEFAULT 'suggere' CHECK (status IN (
    'suggere', 'retenu', 'propose', 'entretien', 'accepte', 'refuse_candidat', 'refuse_employeur', 'ecarte'
  )),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  status_changed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_une_cible CHECK (num_nonnulls(job_offer_id, employer_need_id) = 1)
);
CREATE UNIQUE INDEX matches_candidate_offer_unique ON matches (candidate_id, job_offer_id) WHERE job_offer_id IS NOT NULL;
CREATE UNIQUE INDEX matches_candidate_need_unique ON matches (candidate_id, employer_need_id) WHERE employer_need_id IS NOT NULL;
CREATE INDEX matches_offer_idx ON matches (job_offer_id, score DESC);
CREATE INDEX matches_need_idx ON matches (employer_need_id, score DESC);

CREATE TABLE placements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         text NOT NULL UNIQUE,
  employer_id       uuid NOT NULL REFERENCES employers (id) ON DELETE RESTRICT,
  candidate_id      uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  job_offer_id      uuid REFERENCES job_offers (id) ON DELETE SET NULL,
  employer_need_id  uuid REFERENCES employer_needs (id) ON DELETE SET NULL,
  match_id          uuid REFERENCES matches (id) ON DELETE SET NULL,
  category_id       uuid REFERENCES job_categories (id) ON DELETE SET NULL,
  city_code         text REFERENCES cities (code),
  start_date        date NOT NULL,
  contract_type     text NOT NULL DEFAULT 'non_precise' CHECK (contract_type IN (
    'cdi', 'cdd', 'interim', 'saisonnier', 'journalier', 'stage', 'freelance', 'anapec', 'non_precise'
  )),
  agreed_salary     numeric(12, 2) CHECK (agreed_salary IS NULL OR agreed_salary > 0),
  salary_period     text NOT NULL DEFAULT 'mois' CHECK (salary_period IN ('mois', 'semaine', 'jour', 'heure')),
  status            text NOT NULL DEFAULT 'en_cours' CHECK (status IN (
    'en_cours', 'confirme', 'termine', 'rompu', 'annule'
  )),
  -- Fin de la période de remplacement prévue par la formule (Premium : 6 mois, Sérénité : 2 mois).
  replacement_until date,
  notes             text,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX placements_employer_idx ON placements (employer_id);
CREATE INDEX placements_candidate_idx ON placements (candidate_id);
CREATE INDEX placements_start_idx ON placements (start_date DESC);
CREATE TRIGGER placements_touch BEFORE UPDATE ON placements
  FOR EACH ROW EXECUTE FUNCTION ys_touch_updated_at();

CREATE TABLE commissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          text NOT NULL UNIQUE,
  placement_id       uuid NOT NULL REFERENCES placements (id) ON DELETE RESTRICT,
  payer              text NOT NULL CHECK (payer IN ('employeur', 'travailleur')),
  calc_mode          text NOT NULL CHECK (calc_mode IN ('forfait', 'pourcentage')),
  base_amount        numeric(12, 2) CHECK (base_amount IS NULL OR base_amount > 0),
  rate_percent       numeric(5, 2) CHECK (rate_percent IS NULL OR (rate_percent > 0 AND rate_percent <= 100)),
  amount             numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency           char(3) NOT NULL DEFAULT 'MAD',
  label              text,
  status             text NOT NULL DEFAULT 'du' CHECK (status IN ('du', 'facture', 'encaisse', 'annule')),
  due_date           date,
  invoiced_at        timestamptz,
  paid_at            timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  payment_method     text CHECK (payment_method IS NULL OR payment_method IN ('especes', 'virement', 'cheque', 'autre')),
  document_type      text CHECK (document_type IS NULL OR document_type IN ('facture', 'recu')),
  document_number    text UNIQUE,
  -- Commission côté travailleur : interdite par défaut (article 480 du Code du
  -- travail, promesse « Aucun frais, jamais » du site). Elle exige un accusé de
  -- lecture explicite, nominatif et daté.
  compliance_ack_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  compliance_ack_at  timestamptz,
  compliance_note    text,
  notes              text,
  created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commissions_calcul_coherent CHECK (
    (calc_mode = 'forfait' AND rate_percent IS NULL)
    OR (calc_mode = 'pourcentage' AND rate_percent IS NOT NULL AND base_amount IS NOT NULL)
  ),
  CONSTRAINT commissions_statut_coherent CHECK (
    (status <> 'facture' OR invoiced_at IS NOT NULL)
    AND (status <> 'encaisse' OR paid_at IS NOT NULL)
    AND (status <> 'annule' OR cancelled_at IS NOT NULL)
  ),
  CONSTRAINT commissions_travailleur_accuse CHECK (
    payer <> 'travailleur'
    OR (compliance_ack_at IS NOT NULL AND compliance_note IS NOT NULL AND length(btrim(compliance_note)) >= 20)
  )
);
CREATE INDEX commissions_placement_idx ON commissions (placement_id);
CREATE INDEX commissions_status_idx ON commissions (status);
CREATE TRIGGER commissions_touch BEFORE UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION ys_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 9. Alertes, notifications, recherches
-- -----------------------------------------------------------------------------

CREATE TABLE alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) >= 2),
  -- Critères : {"texte", "categories", "secteurs", "villes", "contrats",
  --             "salaireMin", "urgentSeulement", "massifSeulement", "pertinenceMin"}
  criteria     jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels     text[] NOT NULL DEFAULT '{interne}',
  frequency    text NOT NULL DEFAULT 'quotidien' CHECK (frequency IN ('immediat', 'quotidien', 'hebdomadaire')),
  is_active    boolean NOT NULL DEFAULT true,
  last_run_at  timestamptz,
  last_sent_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alerts_channels_valides CHECK (
    channels <@ ARRAY['interne', 'email', 'whatsapp']::text[] AND cardinality(channels) >= 1
  )
);
CREATE INDEX alerts_user_idx ON alerts (user_id);
CREATE TRIGGER alerts_touch BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION ys_touch_updated_at();

CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  alert_id     uuid REFERENCES alerts (id) ON DELETE CASCADE,
  job_offer_id uuid REFERENCES job_offers (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN (
    'nouvelle_offre', 'offre_modifiee', 'offre_urgente', 'recrutement_massif', 'recruteur_recurrent', 'resume', 'relance'
  )),
  channel      text NOT NULL CHECK (channel IN ('interne', 'email', 'whatsapp')),
  -- « simule » : aucun fournisseur d'envoi n'est configuré, rien n'est parti.
  status       text NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'envoye', 'simule', 'echec', 'lu')),
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  read_at      timestamptz
);
CREATE UNIQUE INDEX notifications_dedup_idx ON notifications (alert_id, job_offer_id, kind, channel)
  WHERE alert_id IS NOT NULL AND job_offer_id IS NOT NULL;
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE search_queries (
  id           bigserial PRIMARY KEY,
  user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  query_text   text NOT NULL DEFAULT '',
  filters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_count integer NOT NULL DEFAULT 0,
  duration_ms  integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_queries_created_idx ON search_queries (created_at DESC);

-- -----------------------------------------------------------------------------
-- 10. Journal d'audit (ajout seul)
-- -----------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  actor_label   text NOT NULL DEFAULT 'systeme',
  actor_role    text,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text,
  summary       text NOT NULL DEFAULT '',
  -- Jamais de donnée personnelle en clair ici : uniquement des noms de champs,
  -- des références et des valeurs non identifiantes.
  changes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash       text
);
CREATE INDEX audit_logs_occurred_idx ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION ys_audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Seule exception : la mise à NULL de actor_user_id par la clé étrangère
  -- (suppression d'un compte utilisateur), qui ne modifie aucune autre colonne.
  IF TG_OP = 'UPDATE'
     AND NEW.actor_user_id IS NULL
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Le journal d''audit est en ajout seul (%).', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION ys_audit_logs_immutable();
