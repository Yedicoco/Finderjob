/**
 * Tableau de bord : chiffres lus directement en base, sans cache ni
 * estimation. Les offres sont comptées selon leur statut EFFECTIF.
 */
import { totaliser, type Payeur, type StatutCommission, type TotauxCommissions } from '@/domaine/commissions';
import { requete, uneLigne } from './db';

export type TableauDeBord = {
  offres: { actives: number; nouvelles7j: number; aVerifier: number; douteuses: number; expirees: number; archivees: number; urgentes: number; massives: number; fictives: number };
  parSecteur: { code: string; n: number }[];
  parVille: { code: string | null; n: number }[];
  parMetier: { code: string; n: number; candidats: number }[];
  parSource: { code: string; nom: string; actives: number; total: number }[];
  parJour: { jour: string; n: number }[];
  collecte: {
    sourcesActives: number; sourcesEnPause: number; dernieresExecutions: { id: string; source: string; statut: string; debut: Date; nouvelles: number; rejetees: number; message: string | null }[];
    rejets30j: { motif: string; n: number }[];
  };
  candidats: { total: number; disponibles: number; places: number; parStatut: { statut: string; n: number }[]; finConservation30j: number };
  employeurs: { total: number; parStatut: { statut: string; n: number }[]; relancesDues: number; besoinsOuverts: number; postesOuverts: number };
  appariements: { suggeres: number; proposes: number };
  placements: { total: number; enCours: number; parMois: { mois: string; n: number }[] };
  commissions: TotauxCommissions & { nombreTravailleur: number };
  tension: { metier: string; ville: string | null; offres: number; candidats: number }[];
};

export async function tableauDeBord(): Promise<TableauDeBord> {
  const [offres, parSecteur, parVille, parMetier, parSource, parJour, sources, executions, rejets, candidats, candidatsStatut, employeurs, employeursStatut, besoins, appariements, placements, parMois, commissions, tension] = await Promise.all([
    uneLigne<TableauDeBord['offres']>(
      `SELECT count(*) FILTER (WHERE effective_status = 'actif')::int AS actives,
              count(*) FILTER (WHERE effective_status = 'actif' AND first_seen_at > now() - interval '7 days')::int AS "nouvelles7j",
              count(*) FILTER (WHERE requires_human_review AND status <> 'archive')::int AS "aVerifier",
              count(*) FILTER (WHERE effective_status = 'douteux')::int AS douteuses,
              count(*) FILTER (WHERE effective_status = 'expire')::int AS expirees,
              count(*) FILTER (WHERE effective_status = 'archive')::int AS archivees,
              count(*) FILTER (WHERE effective_status = 'actif' AND is_urgent)::int AS urgentes,
              count(*) FILTER (WHERE effective_status = 'actif' AND is_bulk_hiring)::int AS massives,
              count(*) FILTER (WHERE is_demo)::int AS fictives
         FROM v_job_offers`,
    ),
    requete<{ code: string; n: number }>(`SELECT sector_code AS code, count(*)::int AS n FROM v_job_offers WHERE effective_status = 'actif' AND sector_code IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
    requete<{ code: string | null; n: number }>(`SELECT city_code AS code, count(*)::int AS n FROM v_job_offers WHERE effective_status = 'actif' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`),
    requete<{ code: string; n: number; candidats: number }>(
      `SELECT c.code, count(*)::int AS n,
              (SELECT count(DISTINCT k.id)::int FROM candidate_profile_categories pc JOIN candidates k ON k.id = pc.candidate_id
                WHERE pc.category_id = c.id AND k.anonymized_at IS NULL AND k.status IN ('nouveau', 'contacte', 'entretien', 'propose')) AS candidats
         FROM v_job_offers o JOIN job_categories c ON c.id = o.primary_category_id WHERE o.effective_status = 'actif' GROUP BY c.id, c.code ORDER BY 2 DESC, 1 LIMIT 10`,
    ),
    requete<{ code: string; nom: string; actives: number; total: number }>(
      `SELECT s.code, s.name AS nom, count(*) FILTER (WHERE o.effective_status = 'actif')::int AS actives, count(*)::int AS total
         FROM v_job_offers o JOIN job_sources s ON s.id = o.source_id GROUP BY s.id, s.code, s.name ORDER BY 4 DESC`,
    ),
    requete<{ jour: string; n: number }>(
      `SELECT to_char(j, 'YYYY-MM-DD') AS jour, count(o.id)::int AS n
         FROM generate_series((now() AT TIME ZONE 'Africa/Casablanca')::date - 29, (now() AT TIME ZONE 'Africa/Casablanca')::date, interval '1 day') AS j
         LEFT JOIN job_offers o ON (o.first_seen_at AT TIME ZONE 'Africa/Casablanca')::date = j::date
        GROUP BY j ORDER BY j`,
    ),
    // « Actives » = sources collectées AUTOMATIQUEMENT ; les entrées internes (saisie, annonce confiée, fichier) ne sont pas de la collecte.
    uneLigne<{ actives: number; pause: number }>(
      `SELECT count(*) FILTER (WHERE is_active AND kind IN ('rss', 'sitemap', 'api'))::int AS actives,
              count(*) FILTER (WHERE is_active AND kind IN ('rss', 'sitemap', 'api') AND paused_until > now())::int AS pause FROM job_sources`,
    ),
    requete<TableauDeBord['collecte']['dernieresExecutions'][number]>(
      `SELECT r.id, s.name AS source, r.status AS statut, r.started_at AS debut, r.new_count AS nouvelles, r.rejected_count AS rejetees, r.message
         FROM scraping_runs r JOIN job_sources s ON s.id = r.source_id ORDER BY r.started_at DESC LIMIT 6`,
    ),
    requete<{ motif: string; n: number }>(`SELECT reason AS motif, count(*)::int AS n FROM ingestion_rejections WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC`),
    uneLigne<{ total: number; disponibles: number; places: number; fin: number }>(
      `SELECT count(*) FILTER (WHERE anonymized_at IS NULL)::int AS total,
              count(*) FILTER (WHERE anonymized_at IS NULL AND status IN ('nouveau', 'contacte', 'entretien', 'propose'))::int AS disponibles,
              count(*) FILTER (WHERE status = 'place')::int AS places,
              count(*) FILTER (WHERE anonymized_at IS NULL AND status <> 'place' AND retention_until < (now() + interval '30 days')::date)::int AS fin
         FROM candidates`,
    ),
    requete<{ statut: string; n: number }>(`SELECT status AS statut, count(*)::int AS n FROM candidates WHERE anonymized_at IS NULL GROUP BY 1`),
    uneLigne<{ total: number; relances: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE next_follow_up_at <= now() + interval '1 day' AND NOT do_not_contact AND status <> 'cloture')::int AS relances FROM employers`,
    ),
    requete<{ statut: string; n: number }>(`SELECT status AS statut, count(*)::int AS n FROM employers GROUP BY 1`),
    uneLigne<{ n: number; postes: number }>(`SELECT count(*)::int AS n, COALESCE(sum(headcount), 0)::int AS postes FROM employer_needs WHERE status IN ('ouvert', 'en_cours')`),
    uneLigne<{ suggeres: number; proposes: number }>(`SELECT count(*) FILTER (WHERE status = 'suggere')::int AS suggeres, count(*) FILTER (WHERE status IN ('retenu', 'propose', 'entretien'))::int AS proposes FROM matches`),
    uneLigne<{ total: number; en_cours: number }>(`SELECT count(*) FILTER (WHERE status <> 'annule')::int AS total, count(*) FILTER (WHERE status IN ('en_cours', 'confirme'))::int AS en_cours FROM placements`),
    requete<{ mois: string; n: number }>(
      `SELECT to_char(m, 'YYYY-MM') AS mois, count(p.id)::int AS n
         FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m
         LEFT JOIN placements p ON date_trunc('month', p.start_date::timestamp) = m::timestamp AND p.status <> 'annule'
        GROUP BY m ORDER BY m`,
    ),
    // Aucun montant fictif dans les totaux : les commissions du jeu de démonstration sont écartées.
    requete<{ status: StatutCommission; amount: number; payer: Payeur }>(
      `SELECT co.status, co.amount, co.payer FROM commissions co JOIN placements p ON p.id = co.placement_id JOIN employers e ON e.id = p.employer_id WHERE NOT e.is_demo`,
    ),
    // Tension : métiers et villes où des offres actives existent sans candidat disponible en face.
    requete<TableauDeBord['tension'][number]>(
      `SELECT c.code AS metier, o.city_code AS ville, count(*)::int AS offres,
              (SELECT count(DISTINCT k.id)::int FROM candidates k JOIN candidate_profiles pr ON pr.candidate_id = k.id JOIN candidate_profile_categories pc ON pc.candidate_id = k.id
                WHERE pc.category_id = c.id AND k.anonymized_at IS NULL AND k.status IN ('nouveau', 'contacte', 'entretien', 'propose')
                  AND (o.city_code IS NULL OR pr.city_code = o.city_code OR o.city_code = ANY(pr.accepted_city_codes))) AS candidats
         FROM v_job_offers o JOIN job_categories c ON c.id = o.primary_category_id
        WHERE o.effective_status = 'actif' GROUP BY c.id, c.code, o.city_code ORDER BY 4, 3 DESC, 1 LIMIT 8`,
    ),
  ]);
  return {
    offres: offres!, parSecteur, parVille, parMetier, parSource, parJour,
    collecte: { sourcesActives: sources!.actives, sourcesEnPause: sources!.pause, dernieresExecutions: executions, rejets30j: rejets },
    candidats: { total: candidats!.total, disponibles: candidats!.disponibles, places: candidats!.places, parStatut: candidatsStatut, finConservation30j: candidats!.fin },
    employeurs: { total: employeurs!.total, parStatut: employeursStatut, relancesDues: employeurs!.relances, besoinsOuverts: besoins!.n, postesOuverts: besoins!.postes },
    appariements: appariements!,
    placements: { total: placements!.total, enCours: placements!.en_cours, parMois },
    commissions: { ...totaliser(commissions), nombreTravailleur: commissions.filter((c) => c.payer === 'travailleur' && c.status !== 'annule').length },
    tension,
  };
}

/** Raccourcis de la page d'accueil : ce qui attend une action aujourd'hui. */
export async function aFaire(utilisateurId: string): Promise<{ aVerifier: number; relances: number; suggestions: number; nonLues: number; commissionsDues: number }> {
  const ligne = await uneLigne<{ a: number; r: number; s: number; n: number; c: number }>(
    `SELECT (SELECT count(*)::int FROM job_offers WHERE requires_human_review AND status <> 'archive') AS a,
            (SELECT count(*)::int FROM employers WHERE next_follow_up_at <= now() + interval '1 day' AND NOT do_not_contact AND status <> 'cloture') AS r,
            (SELECT count(*)::int FROM matches WHERE status = 'suggere') AS s,
            (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND channel = 'interne' AND read_at IS NULL) AS n,
            (SELECT count(*)::int FROM commissions co JOIN placements p ON p.id = co.placement_id JOIN employers e ON e.id = p.employer_id
              WHERE co.status IN ('du', 'facture') AND NOT e.is_demo) AS c`,
    [utilisateurId],
  );
  return { aVerifier: ligne!.a, relances: ligne!.r, suggestions: ligne!.s, nonLues: ligne!.n, commissionsDues: ligne!.c };
}
