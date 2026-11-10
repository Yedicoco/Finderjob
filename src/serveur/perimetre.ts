/**
 * Début de la recherche (paramètre « perimetre.dateMin ») appliqué aux offres
 * DÉJÀ enregistrées.
 *
 * À l'enregistrement, statutInitial() archive « hors périmètre » toute annonce
 * publiée avant le début de la recherche. Quand ce début change — réglage
 * modifié par un administrateur, ou nouvelle valeur par défaut après une mise
 * à jour —, les offres en base doivent suivre :
 *
 *   - écartées : celles qui ne sont pas archivées et ont été publiées avant le
 *     début de la recherche passent en « archivée — avant le début de la
 *     recherche » ;
 *   - reprises : celles qui avaient été archivées pour ce seul motif et se
 *     retrouvent dans la période sont réévaluées comme à l'enregistrement
 *     (date, échéance, lieu, risque), à partir de ce qui est stocké ;
 *   - relèves : une annonce de la période n'est jamais masquée par une annonce
 *     plus ancienne que le début de la recherche. Si l'offre principale d'un
 *     groupe de doublons est écartée alors qu'un de ses doublons a été publié
 *     dans la période, le plus ancien de ces doublons devient l'offre
 *     principale, et l'ancienne lui est rattachée (comptée parmi les reprises).
 *
 * Rien n'est supprimé et chaque changement laisse une ligne d'historique.
 * L'opération est idempotente : elle est appelée au démarrage (initialisation),
 * à chaque maintenance et dès que le réglage change.
 */
import { accord, compter } from '@/domaine/accord';
import type { PrecisionDate } from '@/domaine/extraction';
import { jourEcritMaroc } from '@/domaine/fuseau';
import { evaluerPays } from '@/domaine/geographie';
import type { Parametres } from '@/domaine/parametres';
import { statutInitial, TOLERANCE_FUTUR_MS } from '@/domaine/statuts';
import { ACTEUR_SYSTEME, journaliser, type Acteur } from './audit';
import { executer, requete, type Executeur } from './db';

export type BilanPerimetre = { ecartees: number; reprises: number };

/** « 3 offres écartées, 1 offre reprise » — pour un message, le journal ou la console. */
export function phraseBilanPerimetre(bilan: BilanPerimetre): string {
  return `${compter(bilan.ecartees, 'offre')} ${accord(bilan.ecartees, 'écartée')}, ${compter(bilan.reprises, 'offre')} ${accord(bilan.reprises, 'reprise')}`;
}

type LigneReprise = {
  id: string; published_at: Date; date_precision: PrecisionDate; expires_at: Date | null; city_code: string | null; risk_score: number; risk_flags: string[];
  verification_status: string; primary_category_id: string | null; title: string; motif_pays: string | null; pays_source: string | null;
};
type LigneReleve = LigneReprise & { reference: string; duplicate_score: number | null; racine_id: string; racine_reference: string };

/** Colonnes lues pour réévaluer une offre (alias `o`, source `s`). */
const COLONNES_REPRISE = `o.id, o.published_at, o.date_precision, o.expires_at, o.city_code, o.risk_score, o.risk_flags, o.verification_status, o.primary_category_id, o.title,
            o.score_details->>'pays' AS motif_pays, s.country_default AS pays_source`;

/** Motifs d'evaluerPays() qui situent l'annonce au Maroc (conservés dans score_details.pays). */
const MOTIFS_PAYS_MAROC = ['pays_structure_maroc', 'ville_marocaine', 'maroc_mentionne'];

/**
 * Statut d'une offre qui revient dans la période, recalculé avec les mêmes
 * règles qu'à l'enregistrement. Une vérification faite par un courtier reste
 * acquise (lieu et risque levés, comme dans verifierOffre) ; à défaut, les
 * demandes de revue de l'analyse d'origine sont reconstituées : revue en
 * attente, métier non classé, critère discriminatoire, lieu étranger cité
 * dans le titre.
 */
function decisionReprise(o: LigneReprise, maintenant: Date, parametres: Parametres) {
  const verifiee = o.verification_status === 'verifiee';
  const auMaroc = verifiee || Boolean(o.city_code) || o.pays_source === 'MA' || MOTIFS_PAYS_MAROC.includes(o.motif_pays ?? '');
  const revueDemandee =
    !verifiee &&
    (o.verification_status === 'a_verifier' || !o.primary_category_id || o.risk_flags.includes('criteres_discriminatoires') || Boolean(evaluerPays({ titre: o.title }).lieuEtranger));
  const decision = statutInitial({
    publieLe: new Date(o.published_at),
    precisionDate: o.date_precision,
    expireLe: o.expires_at ? new Date(o.expires_at) : null,
    pays: auMaroc ? 'MA' : 'inconnu',
    villeConnue: verifiee || Boolean(o.city_code),
    scoreRisque: verifiee ? 0 : o.risk_score,
    estDoublonDe: false,
    revueDemandee,
    maintenant,
    parametres,
  });
  return { ...decision, verification: verifiee ? ('verifiee' as const) : decision.verification };
}

async function historiser(tx: Executeur, id: string, origine: 'maintenance' | 'fusion_doublon', changements: Record<string, [unknown, unknown]>, maintenant: Date, acteur: Acteur | null): Promise<void> {
  await executer(
    `INSERT INTO job_offer_versions (job_offer_id, observed_at, origin, changed_fields, changes, user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [id, maintenant, origine, Object.keys(changements), JSON.stringify(changements), acteur?.id ?? null],
    tx,
  );
}

/**
 * L'offre principale `ancienne`, écartée parce qu'elle précède le début de la
 * recherche, devient le doublon de `nouvelle` — la même annonce, publiée dans
 * la période. Ses propres doublons suivent : jamais de « doublon d'un doublon ».
 * Sans effet si l'ancienne offre a changé d'état entre-temps.
 */
export async function rattacherAncienne(
  ancienne: { id: string },
  nouvelle: { id: string; reference: string },
  options: { score: number | null; maintenant: Date; acteur?: Acteur | null; tx: Executeur },
): Promise<boolean> {
  const { maintenant, tx } = options;
  const rattachee = await executer(
    `UPDATE job_offers SET duplicate_of_id = $2, duplicate_score = COALESCE($3::int, 100), status_reason = 'doublon', requires_human_review = false, status_changed_at = $4
      WHERE id = $1 AND id <> $2 AND status = 'archive' AND status_reason = 'hors_perimetre_date' AND duplicate_of_id IS NULL`,
    [ancienne.id, nouvelle.id, options.score, maintenant],
    tx,
  );
  if (!rattachee) return false;
  await executer(`UPDATE job_offers SET duplicate_of_id = $2 WHERE duplicate_of_id = $1 AND id <> $2`, [ancienne.id, nouvelle.id], tx);
  await historiser(tx, ancienne.id, 'fusion_doublon', { duplicate_of: [null, nouvelle.reference], status_reason: ['hors_perimetre_date', 'doublon'] }, maintenant, options.acteur ?? null);
  return true;
}

/**
 * Relèves : pour chaque offre principale écartée (toutes, ou seulement
 * `racineId`), le plus ancien de ses doublons publiés dans la période prend sa
 * place — ou `prefereId`, s'il en fait partie. Son statut est recalculé comme
 * pour une reprise.
 */
async function relever(
  parametres: Parametres, maintenant: Date, acteur: Acteur, tx: Executeur, racineId: string | null, prefereId: string | null = null,
): Promise<{ id: string; reference: string; ancienne: string }[]> {
  const debut = new Date(parametres.perimetre.dateMin);
  const candidats = await requete<LigneReleve>(
    `SELECT ${COLONNES_REPRISE}, o.reference, o.duplicate_score, r.id AS racine_id, r.reference AS racine_reference
       FROM job_offers r
       JOIN job_offers o ON o.duplicate_of_id = r.id
       JOIN job_sources s ON s.id = o.source_id
      WHERE r.status = 'archive' AND r.status_reason = 'hors_perimetre_date' AND r.duplicate_of_id IS NULL AND r.published_at < $1
        AND ($3::uuid IS NULL OR r.id = $3)
        AND o.status = 'archive' AND o.status_reason = 'doublon'
        AND o.published_at IS NOT NULL AND o.date_precision <> 'inconnue' AND o.published_at >= $1 AND o.published_at <= $2
      ORDER BY r.id, (o.id = $4::uuid) DESC NULLS LAST, o.published_at, o.first_seen_at, o.id
        FOR UPDATE OF r, o`,
    [debut, new Date(maintenant.getTime() + TOLERANCE_FUTUR_MS), racineId, prefereId],
    tx,
  );
  const relevees: { id: string; reference: string; ancienne: string }[] = [];
  const traitees = new Set<string>();
  for (const offre of candidats) {
    // Un seul remplaçant par offre principale : le premier de la liste — l'offre préférée, sinon la plus ancienne de la période.
    if (traitees.has(offre.racine_id)) continue;
    traitees.add(offre.racine_id);
    const decision = decisionReprise(offre, maintenant, parametres);
    if (decision.statut === 'archive') continue;
    await executer(
      `UPDATE job_offers SET duplicate_of_id = NULL, duplicate_score = NULL, status = $2, status_reason = $3, verification_status = $4, requires_human_review = $5, status_changed_at = $6,
              score_details = score_details - 'doublonProbable' WHERE id = $1`,
      [offre.id, decision.statut, decision.motif, decision.verification, decision.revueHumaine, maintenant],
      tx,
    );
    await historiser(tx, offre.id, 'fusion_doublon', { duplicate_of: [offre.racine_reference, null], status: ['archive', decision.statut], status_reason: ['doublon', decision.motif] }, maintenant, acteur);
    await rattacherAncienne({ id: offre.racine_id }, { id: offre.id, reference: offre.reference }, { score: offre.duplicate_score, maintenant, acteur, tx });
    relevees.push({ id: offre.id, reference: offre.reference, ancienne: offre.racine_reference });
  }
  return relevees;
}

async function appliquer(parametres: Parametres, maintenant: Date, acteur: Acteur, tx: Executeur): Promise<BilanPerimetre> {
  const debut = new Date(parametres.perimetre.dateMin);

  // 1. Écartées. Même règle que statutInitial() : l'annonce est datée, sa date n'est pas « dans le futur », et elle précède le début de la recherche.
  //    Une seule instruction : la mise à jour et la ligne d'historique sont écrites ensemble.
  const ecartees = await executer(
    `WITH cibles AS (
       SELECT id, status, status_reason FROM job_offers
        WHERE status <> 'archive' AND published_at IS NOT NULL AND date_precision <> 'inconnue' AND published_at < $1 AND published_at <= $2
        ORDER BY id FOR UPDATE
     ), maj AS (
       UPDATE job_offers o
          SET status = 'archive', status_reason = 'hors_perimetre_date', requires_human_review = false, status_changed_at = $3::timestamptz
         FROM cibles c WHERE o.id = c.id
       RETURNING o.id, c.status AS ancien_statut, c.status_reason AS ancien_motif
     )
     INSERT INTO job_offer_versions (job_offer_id, observed_at, origin, changed_fields, changes, user_id)
     SELECT id, $3::timestamptz, 'maintenance', ARRAY['status', 'status_reason'],
            jsonb_build_object('status', jsonb_build_array(ancien_statut, 'archive'), 'status_reason', jsonb_build_array(ancien_motif, 'hors_perimetre_date')), $4::uuid
       FROM maj`,
    [debut, new Date(maintenant.getTime() + TOLERANCE_FUTUR_MS), maintenant, acteur.id],
    tx,
  );

  // 2. Reprises : archivées pour ce seul motif, et de nouveau dans la période.
  const aReprendre = await requete<LigneReprise>(
    `SELECT ${COLONNES_REPRISE}
       FROM job_offers o JOIN job_sources s ON s.id = o.source_id
      WHERE o.status = 'archive' AND o.status_reason = 'hors_perimetre_date' AND o.duplicate_of_id IS NULL AND o.published_at >= $1
      ORDER BY o.id FOR UPDATE OF o`,
    [debut],
    tx,
  );
  let reprises = 0;
  for (const offre of aReprendre) {
    const decision = decisionReprise(offre, maintenant, parametres);
    if (decision.statut === 'archive') continue;
    await executer(
      `UPDATE job_offers SET status = $2, status_reason = $3, verification_status = $4, requires_human_review = $5, status_changed_at = $6 WHERE id = $1`,
      [offre.id, decision.statut, decision.motif, decision.verification, decision.revueHumaine, maintenant],
      tx,
    );
    await historiser(tx, offre.id, 'maintenance', { status: ['archive', decision.statut], status_reason: ['hors_perimetre_date', decision.motif] }, maintenant, acteur);
    reprises += 1;
  }

  // 3. Relèves : une offre principale écartée dont un doublon a été publié dans la période lui cède la place.
  reprises += (await relever(parametres, maintenant, acteur, tx, null)).length;

  const bilan = { ecartees, reprises };
  if (ecartees || reprises) {
    await journaliser(
      {
        acteur,
        action: 'perimetre.application',
        entite: 'parametre',
        id: 'perimetre.dateMin',
        resume: `Début de la recherche au ${jourEcritMaroc(debut)} : ${phraseBilanPerimetre(bilan)}`,
        changements: { debut: debut.toISOString(), ...bilan },
      },
      tx,
    );
  }
  return bilan;
}

/**
 * Aligne les offres enregistrées sur le début de la recherche, dans la
 * transaction de l'appelant. `parametres` doit avoir été lu dans cette même
 * transaction (chargerParametres(tx)), jamais repris de la copie mémorisée :
 * une date périmée déferait le réglage qui vient d'être enregistré.
 * Point d'entrée habituel : alignerOffresSurDebutRecherche() (serveur/parametres).
 */
export async function appliquerDebutRecherche(parametres: Parametres, options: { maintenant?: Date; acteur?: Acteur; tx: Executeur }): Promise<BilanPerimetre> {
  return appliquer(parametres, options.maintenant ?? new Date(), options.acteur ?? ACTEUR_SYSTEME, options.tx);
}

/**
 * Relève limitée à une offre principale, à appeler dans la transaction qui
 * vient de l'écarter ou de lui rattacher un doublon (correction de date,
 * rattachement à la main). Renvoie l'offre qui a pris sa place, s'il y en a une :
 * `preferee` si elle a été publiée dans la période, sinon le plus ancien des
 * doublons qui l'ont été.
 */
export async function releverOffrePrincipale(
  racineId: string,
  parametres: Parametres,
  options: { maintenant?: Date; acteur?: Acteur; tx: Executeur; preferee?: string },
): Promise<{ id: string; reference: string; ancienne: string } | null> {
  return (await relever(parametres, options.maintenant ?? new Date(), options.acteur ?? ACTEUR_SYSTEME, options.tx, racineId, options.preferee ?? null))[0] ?? null;
}
