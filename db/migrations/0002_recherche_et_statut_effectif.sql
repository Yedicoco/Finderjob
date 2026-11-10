-- =============================================================================
-- Recherche plein texte (français + arabe) et statut effectif des offres
-- =============================================================================

-- Configuration française insensible aux accents : « hôtel » = « hotel »,
-- « gouvernantes » = « gouvernante ».
CREATE TEXT SEARCH CONFIGURATION ys_fr (COPY = french);
ALTER TEXT SEARCH CONFIGURATION ys_fr
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;

-- Le vecteur de recherche combine :
--   A  le titre                       (français + arabe)
--   B  les mots-clés de la taxonomie  (libellés FR/AR/EN du métier détecté :
--      c'est ce qui permet de retrouver « عاملة نظافة » en cherchant
--      « femme de ménage » ou « housekeeper »), l'employeur et le lieu
--   C  l'extrait de description
--   D  le texte complet lorsqu'il est autorisé pour la source
CREATE OR REPLACE FUNCTION ys_job_offers_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
       setweight(to_tsvector('ys_fr',  coalesce(NEW.title, '')), 'A')
    || setweight(to_tsvector('arabic', coalesce(NEW.title, '')), 'A')
    || setweight(to_tsvector('ys_fr',  coalesce(NEW.search_keywords, '')), 'B')
    || setweight(to_tsvector('arabic', coalesce(NEW.search_keywords, '')), 'B')
    || setweight(to_tsvector('ys_fr',
         concat_ws(' ', NEW.employer_name, NEW.city_label, NEW.district, NEW.region)), 'B')
    || setweight(to_tsvector('ys_fr',  coalesce(NEW.description_excerpt, '')), 'C')
    || setweight(to_tsvector('arabic', coalesce(NEW.description_excerpt, '')), 'C')
    || setweight(to_tsvector('ys_fr',  coalesce(NEW.description_full, '')), 'D');
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_offers_search_vector_trg
  BEFORE INSERT OR UPDATE OF title, search_keywords, employer_name, city_label, district, region,
                             description_excerpt, description_full
  ON job_offers
  FOR EACH ROW EXECUTE FUNCTION ys_job_offers_search_vector();

-- -----------------------------------------------------------------------------
-- Paramètres numériques lus par la base
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ys_setting_int(p_key text, p_default integer) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::numeric::integer END
       FROM app_settings WHERE key = p_key),
    p_default
  );
$$;

-- -----------------------------------------------------------------------------
-- Statut effectif
-- -----------------------------------------------------------------------------
-- Le statut stocké est mis à jour par le worker. Mais l'interface ne doit
-- JAMAIS présenter comme active une offre expirée ou invérifiable, même si le
-- worker est arrêté : le statut effectif est donc recalculé à chaque lecture.
-- Cette fonction est le miroir exact de statutEffectif() dans
-- src/domaine/statuts.ts ; un test d'intégration vérifie que les deux
-- implémentations donnent le même résultat. Les délais sont comptés en heures
-- (jours × 24) pour ne pas dépendre du fuseau horaire de la session.

CREATE OR REPLACE FUNCTION ys_effective_status(
  p_status          text,
  p_published_at    timestamptz,
  p_date_precision  text,
  p_expires_at      timestamptz,
  p_last_checked_at timestamptz,
  p_validity_days   integer,
  p_stale_days      integer,
  p_now             timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_status <> 'actif' THEN p_status
    WHEN p_published_at IS NULL OR p_date_precision = 'inconnue' THEN 'douteux'
    WHEN p_expires_at IS NOT NULL AND p_expires_at <= p_now THEN 'expire'
    WHEN p_expires_at IS NULL
         AND p_published_at < p_now - make_interval(hours => p_validity_days * 24) THEN 'expire'
    WHEN p_last_checked_at < p_now - make_interval(hours => p_stale_days * 24) THEN 'douteux'
    ELSE 'actif'
  END;
$$;

CREATE OR REPLACE FUNCTION ys_effective_reason(
  p_status          text,
  p_status_reason   text,
  p_published_at    timestamptz,
  p_date_precision  text,
  p_expires_at      timestamptz,
  p_last_checked_at timestamptz,
  p_validity_days   integer,
  p_stale_days      integer,
  p_now             timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_status <> 'actif' THEN p_status_reason
    WHEN p_published_at IS NULL OR p_date_precision = 'inconnue' THEN 'date_inconnue'
    WHEN p_expires_at IS NOT NULL AND p_expires_at <= p_now THEN 'expiree_source'
    WHEN p_expires_at IS NULL
         AND p_published_at < p_now - make_interval(hours => p_validity_days * 24) THEN 'expiree_anciennete'
    WHEN p_last_checked_at < p_now - make_interval(hours => p_stale_days * 24) THEN 'non_reverifiee'
    ELSE 'aucun'
  END;
$$;

-- Toutes les lectures de l'application passent par cette vue.
-- (La liste des colonnes d'une vue « o.* » est figée à sa création : après un
-- ALTER TABLE job_offers, recréer la vue dans la même migration.)
CREATE VIEW v_job_offers AS
SELECT
  o.*,
  ys_effective_status(
    o.status, o.published_at, o.date_precision, o.expires_at, o.last_checked_at,
    p.validity_days, p.stale_days, now()
  ) AS effective_status,
  ys_effective_reason(
    o.status, o.status_reason, o.published_at, o.date_precision, o.expires_at, o.last_checked_at,
    p.validity_days, p.stale_days, now()
  ) AS effective_reason
FROM job_offers o
CROSS JOIN LATERAL (
  SELECT ys_setting_int('offres.duree_validite_jours', 45)  AS validity_days,
         ys_setting_int('offres.delai_reverification_jours', 21) AS stale_days
) p;
