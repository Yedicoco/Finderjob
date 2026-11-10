-- =============================================================================
-- 0003 — Heure légale du Maroc dans les requêtes
--
-- Le Maroc est revenu à l'heure GMT (UTC+0) permanente le 20 septembre 2026 à
-- 2 h du matin. Auparavant, depuis octobre 2018, il était à UTC+1, sauf pendant
-- le ramadan.
--
-- « AT TIME ZONE 'Africa/Casablanca' » dépend de la base des fuseaux du serveur
-- PostgreSQL : antérieure à juillet 2026 (tzdata < 2026c), elle ignore ce retour
-- à GMT. ys_heure_maroc() applique alors la règle connue ; une base à jour est
-- suivie telle quelle, y compris si la règle change de nouveau.
--
-- Miroir exact de decalageMaroc() dans src/domaine/fuseau.ts : un test
-- d'intégration compare les deux.
-- =============================================================================

CREATE OR REPLACE FUNCTION ys_heure_maroc(p_instant timestamptz)
RETURNS timestamp LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_instant >= timestamptz '2026-09-20 01:00:00+00'
         -- La base du serveur connaît-elle le retour à GMT ? Sinon, on l'applique ici.
         AND (timestamptz '2026-11-10 12:00:00+00' AT TIME ZONE 'Africa/Casablanca') <> timestamp '2026-11-10 12:00:00'
      THEN p_instant AT TIME ZONE 'UTC'
    ELSE p_instant AT TIME ZONE 'Africa/Casablanca'
  END
$$;

COMMENT ON FUNCTION ys_heure_maroc(timestamptz) IS
  'Heure légale du Maroc (date et heure lues sur une horloge de Casablanca), y compris le retour à GMT du 20 septembre 2026.';

-- La numérotation change d'année à minuit, heure du Maroc.
CREATE OR REPLACE FUNCTION ys_next_reference(p_scope text, p_year integer DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_year  integer := COALESCE(p_year, extract(year FROM ys_heure_maroc(now()))::integer);
  v_value integer;
BEGIN
  INSERT INTO counters (scope, year, last_value) VALUES (p_scope, v_year, 1)
  ON CONFLICT (scope, year) DO UPDATE SET last_value = counters.last_value + 1
  RETURNING last_value INTO v_value;
  RETURN 'YS-' || p_scope || '-' || v_year::text || '-' || lpad(v_value::text, 4, '0');
END;
$$;
