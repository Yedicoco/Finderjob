/**
 * Maintenance périodique (worker). Chaque étape est idempotente.
 *
 * Le statut affiché ne dépend PAS de ces tâches : la vue v_job_offers calcule
 * le statut effectif à la lecture. Ici, on se contente de l'inscrire en base
 * (pour l'historique) et de tenir les scores et la conservation à jour.
 */
import { accord, compter } from '@/domaine/accord';
import { rafraichirScores } from './appariements';
import { ACTEUR_SYSTEME, journaliser } from './audit';
import { purgerSessions } from './auth';
import { purgerCandidatsExpires } from './candidats';
import { executer } from './db';

export type BilanMaintenance = { statutsFiges: number; scores: number; candidatsAnonymises: number; sessions: number; tracesPurgees: number };

/** Inscrit en base les expirations que la vue constate déjà (offre trop ancienne, date dépassée, non revérifiée). */
export async function figerStatuts(maintenant = new Date()): Promise<number> {
  // Une seule instruction : la mise à jour et la ligne d'historique sont écrites ensemble ou pas du tout.
  return executer(
    `WITH cibles AS (
       SELECT id, effective_status, effective_reason FROM v_job_offers WHERE status = 'actif' AND effective_status <> 'actif'
     ), maj AS (
       UPDATE job_offers o
          SET status = c.effective_status, status_reason = c.effective_reason, status_changed_at = $1,
              verification_status = CASE WHEN c.effective_status = 'douteux' THEN 'a_verifier' ELSE o.verification_status END,
              requires_human_review = CASE WHEN c.effective_status = 'douteux' THEN true ELSE o.requires_human_review END
         FROM cibles c WHERE o.id = c.id AND o.status = 'actif'
       RETURNING o.id, c.effective_status, c.effective_reason
     )
     INSERT INTO job_offer_versions (job_offer_id, origin, changed_fields, changes)
     SELECT id, 'maintenance', ARRAY['status'], jsonb_build_object('status', jsonb_build_array('actif', effective_status), 'status_reason', jsonb_build_array('aucun', effective_reason)) FROM maj`,
    [maintenant],
  );
}

/** Traces techniques : conservées le temps utile, puis supprimées. */
export async function purgerTraces(): Promise<number> {
  let total = 0;
  total += await executer(`DELETE FROM ingestion_rejections WHERE created_at < now() - interval '90 days'`);
  total += await executer(`DELETE FROM search_queries WHERE created_at < now() - interval '180 days'`);
  total += await executer(`DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'`);
  total += await executer(`DELETE FROM notifications WHERE created_at < now() - interval '180 days'`);
  total += await executer(`DELETE FROM scraping_runs WHERE started_at < now() - interval '365 days'`);
  // Une exécution restée « en cours » après un arrêt brutal est close : elle bloquerait la source.
  total += await executer(`UPDATE scraping_runs SET status = 'echec', finished_at = now(), message = 'Exécution interrompue (arrêt du processus)' WHERE status = 'en_cours' AND started_at < now() - interval '2 hours'`);
  return total;
}

export async function executerMaintenance(maintenant = new Date()): Promise<BilanMaintenance> {
  const bilan: BilanMaintenance = {
    statutsFiges: await figerStatuts(maintenant),
    scores: await rafraichirScores(undefined, maintenant),
    candidatsAnonymises: await purgerCandidatsExpires(ACTEUR_SYSTEME, maintenant),
    sessions: await purgerSessions(),
    tracesPurgees: await purgerTraces(),
  };
  if (bilan.statutsFiges || bilan.candidatsAnonymises) {
    await journaliser({ acteur: ACTEUR_SYSTEME, action: 'maintenance.execution', entite: 'systeme', resume: `Maintenance : ${compter(bilan.statutsFiges, 'offre')} ${accord(bilan.statutsFiges, 'expirée')}, ${compter(bilan.candidatsAnonymises, 'fiche')} ${accord(bilan.candidatsAnonymises, 'anonymisée')}`, changements: bilan });
  }
  return bilan;
}
