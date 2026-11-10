/**
 * Appariement candidats ↔ offres ou besoins.
 *
 * Le calcul ne lit que le profil professionnel (métier, lieu, disponibilité,
 * expérience, langues, salaire, logement, permis, compétences) : jamais le
 * nom, l'âge, la nationalité ou l'origine. Chaque score est stocké avec son
 * explication critère par critère et la version de l'algorithme.
 */
import { apparier, estSuggerable, VERSION_APPARIEMENT, type CritereAppariement, type PosteAPourvoir } from '@/domaine/appariement';
import { accord, compter } from '@/domaine/accord';
import type { PeriodeSalaire } from '@/domaine/extraction';
import { STATUTS_CORRESPONDANCE } from '@/domaine/referentiels';
import { indicePlacement, scoreFraicheur } from '@/domaine/scores';
import { journaliser, type Acteur } from './audit';
import { besoinParId, changerStatutEmployeur, posteDepuisBesoin } from './employeurs';
import { profilsPourAppariement, type ProfilAvecCle } from './candidats';
import { dechiffrerOuVide } from './chiffrement';
import { executer, requete, transaction, uneLigne, type Executeur } from './db';
import { chargerParametres } from './parametres';
import { ErreurMetier } from '@/domaine/erreurs';

export class ErreurAppariement extends ErreurMetier {}

type Cible = { offreId: string } | { besoinId: string };
export type Explication = { criteres: CritereAppariement[]; pointsForts: string[]; pointsFaibles: string[]; bloquants: string[] };

export async function postePourOffre(offreId: string, tx?: Executeur): Promise<(PosteAPourvoir & { reference: string; titre: string; estDemo: boolean }) | null> {
  const o = await uneLigne<{
    reference: string; title: string; effective_status: string; city_code: string | null; experience_min_years: number | null; languages: string[] | null;
    salary_min: number | null; salary_max: number | null; salary_period: PeriodeSalaire | null; housing: PosteAPourvoir['logement']; work_time: string;
    driving_license: boolean | null; is_urgent: boolean; is_demo: boolean; metiers: string[]; competences: string[];
  }>(
    `SELECT o.reference, o.title, o.effective_status, o.city_code, o.experience_min_years, o.languages, o.salary_min, o.salary_max, o.salary_period, o.housing, o.work_time,
            o.driving_license, o.is_urgent, o.is_demo,
            COALESCE((SELECT array_agg(c.code ORDER BY jc.is_primary DESC, jc.confidence DESC) FROM job_offer_categories jc JOIN job_categories c ON c.id = jc.category_id WHERE jc.job_offer_id = o.id), '{}') AS metiers,
            COALESCE((SELECT array_agg(s.code) FROM job_offer_skills js JOIN skills s ON s.id = js.skill_id WHERE js.job_offer_id = o.id), '{}') AS competences
       FROM v_job_offers o WHERE o.id = $1`,
    [offreId],
    tx,
  );
  if (!o) return null;
  return {
    reference: o.reference, titre: o.title, estDemo: o.is_demo, ouvert: o.effective_status === 'actif', metiers: o.metiers, ville: o.city_code, experienceMinAnnees: o.experience_min_years,
    langues: o.languages ?? [], salaireMin: o.salary_min, salaireMax: o.salary_max, periodeSalaire: o.salary_period, logement: o.housing, tempsTravail: o.work_time,
    permis: o.driving_license, urgent: o.is_urgent, competences: o.competences,
  };
}

async function enregistrer(candidat: ProfilAvecCle, cible: Cible, poste: PosteAPourvoir, seuil: number, maintenant: Date, tx?: Executeur): Promise<'ecrit' | 'retire' | 'ignore'> {
  const resultat = apparier(candidat, poste, maintenant);
  const colonne = 'offreId' in cible ? 'job_offer_id' : 'employer_need_id';
  const idCible = 'offreId' in cible ? cible.offreId : cible.besoinId;
  const existant = await uneLigne<{ id: string; status: string }>(`SELECT id, status FROM matches WHERE candidate_id = $1 AND ${colonne} = $2`, [candidat.id, idCible], tx);
  const explication: Explication = { criteres: resultat.criteres, pointsForts: resultat.pointsForts, pointsFaibles: resultat.pointsFaibles, bloquants: resultat.bloquants };
  const suggerable = estSuggerable(resultat, seuil);
  if (!existant) {
    if (!suggerable) return 'ignore';
    await executer(
      `INSERT INTO matches (candidate_id, ${colonne}, score, explanation, algorithm_version, computed_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [candidat.id, idCible, resultat.score, JSON.stringify(explication), VERSION_APPARIEMENT, maintenant],
      tx,
    );
    return 'ecrit';
  }
  // Une simple suggestion qui ne tient plus disparaît ; une décision humaine est conservée et seulement recalculée.
  if (existant.status === 'suggere' && !suggerable) {
    await executer(`DELETE FROM matches WHERE id = $1`, [existant.id], tx);
    return 'retire';
  }
  await executer(`UPDATE matches SET score = $2, explanation = $3::jsonb, algorithm_version = $4, computed_at = $5 WHERE id = $1`, [existant.id, resultat.score, JSON.stringify(explication), VERSION_APPARIEMENT, maintenant], tx);
  return 'ecrit';
}

export type BilanAppariement = { evalues: number; retenus: number; retires: number };

export async function calculerPourOffre(offreId: string, acteur: Acteur, maintenant = new Date()): Promise<BilanAppariement> {
  const poste = await postePourOffre(offreId);
  if (!poste) throw new ErreurAppariement('Offre introuvable.');
  if (!poste.ouvert) throw new ErreurAppariement('Cette offre n’est pas active : aucun candidat ne peut lui être proposé. Vérifiez-la d’abord.');
  const parametres = await chargerParametres();
  // Les fiches fictives du jeu de démonstration ne sont jamais comparées aux données réelles.
  const profils = await profilsPourAppariement({ estDemo: poste.estDemo });
  const bilan: BilanAppariement = { evalues: profils.length, retenus: 0, retires: 0 };
  for (const profil of profils) {
    const effet = await enregistrer(profil, { offreId }, poste, parametres.matching.scoreMinSuggestion, maintenant);
    if (effet === 'ecrit') bilan.retenus += 1;
    if (effet === 'retire') bilan.retires += 1;
  }
  await rafraichirScores([offreId], maintenant);
  await journaliser({ acteur, action: 'appariement.calcul', entite: 'offre', id: offreId, resume: `${poste.reference} : ${compter(bilan.retenus, 'candidat')} ${accord(bilan.retenus, 'suggéré')} sur ${bilan.evalues}`, changements: { ...bilan, version: VERSION_APPARIEMENT } });
  return bilan;
}

export async function calculerPourBesoin(besoinId: string, acteur: Acteur, maintenant = new Date()): Promise<BilanAppariement> {
  const besoin = await besoinParId(besoinId);
  if (!besoin) throw new ErreurAppariement('Besoin introuvable.');
  const poste = posteDepuisBesoin(besoin);
  if (!poste.ouvert) throw new ErreurAppariement('Ce besoin est clos.');
  if (poste.metiers.length === 0) throw new ErreurAppariement('Précisez le métier du besoin avant de chercher des candidats.');
  const parametres = await chargerParametres();
  const profils = await profilsPourAppariement({ estDemo: besoin.is_demo });
  const bilan: BilanAppariement = { evalues: profils.length, retenus: 0, retires: 0 };
  for (const profil of profils) {
    const effet = await enregistrer(profil, { besoinId }, poste, parametres.matching.scoreMinSuggestion, maintenant);
    if (effet === 'ecrit') bilan.retenus += 1;
    if (effet === 'retire') bilan.retires += 1;
  }
  await journaliser({ acteur, action: 'appariement.calcul', entite: 'besoin', id: besoinId, resume: `${besoin.reference} : ${compter(bilan.retenus, 'candidat')} ${accord(bilan.retenus, 'suggéré')} sur ${bilan.evalues}`, changements: { ...bilan, version: VERSION_APPARIEMENT } });
  return bilan;
}

/** Pour un candidat : les offres actives et les besoins ouverts de ses métiers. */
export async function calculerPourCandidat(candidatId: string, acteur: Acteur, maintenant = new Date()): Promise<BilanAppariement> {
  const [profil] = await profilsPourAppariement({ id: candidatId });
  if (!profil) throw new ErreurAppariement('Candidat introuvable ou sans profil.');
  if (!profil.consentementValide) throw new ErreurAppariement('Fiche anonymisée : aucun appariement possible.');
  const parametres = await chargerParametres();
  const offres = await requete<{ id: string }>(
    `SELECT DISTINCT o.id, o.relevance_score FROM v_job_offers o JOIN job_offer_categories jc ON jc.job_offer_id = o.id JOIN job_categories c ON c.id = jc.category_id
      WHERE o.effective_status = 'actif' AND o.is_demo = $2 AND c.code = ANY($1::text[]) ORDER BY o.relevance_score DESC LIMIT 300`,
    [profil.metiers, profil.estDemo],
  );
  const besoins = await requete<{ id: string }>(`SELECT n.id FROM employer_needs n JOIN employers e ON e.id = n.employer_id JOIN job_categories c ON c.id = n.category_id WHERE n.status IN ('ouvert', 'en_cours') AND e.is_demo = $2 AND c.code = ANY($1::text[])`, [profil.metiers, profil.estDemo]);
  const bilan: BilanAppariement = { evalues: offres.length + besoins.length, retenus: 0, retires: 0 };
  for (const { id } of offres) {
    const poste = await postePourOffre(id);
    if (!poste) continue;
    const effet = await enregistrer(profil, { offreId: id }, poste, parametres.matching.scoreMinSuggestion, maintenant);
    if (effet === 'ecrit') bilan.retenus += 1;
    if (effet === 'retire') bilan.retires += 1;
  }
  for (const { id } of besoins) {
    const besoin = await besoinParId(id);
    if (!besoin) continue;
    const effet = await enregistrer(profil, { besoinId: id }, posteDepuisBesoin(besoin), parametres.matching.scoreMinSuggestion, maintenant);
    if (effet === 'ecrit') bilan.retenus += 1;
    if (effet === 'retire') bilan.retires += 1;
  }
  await journaliser({ acteur, action: 'appariement.calcul', entite: 'candidat', id: candidatId, resume: `${profil.reference} : ${compter(bilan.retenus, 'poste')} ${accord(bilan.retenus, 'suggéré')} sur ${bilan.evalues}`, changements: { ...bilan, version: VERSION_APPARIEMENT } });
  return bilan;
}

export type Correspondance = {
  id: string; score: number; status: string; explanation: Explication; algorithm_version: string; computed_at: Date; status_changed_at: Date;
  candidate_id: string; candidat_reference: string; candidat_nom: string | null; candidat_statut: string; candidat_ville: string | null; candidat_metier: string | null;
  job_offer_id: string | null; offre_reference: string | null; offre_titre: string | null; offre_statut: string | null; offre_ville: string | null;
  employer_need_id: string | null; besoin_reference: string | null; besoin_titre: string | null; besoin_employeur: string | null; employer_id: string | null;
};

export async function listerCorrespondances(filtre: { id?: string; offreId?: string; besoinId?: string; candidatId?: string; statuts?: string[]; limite?: number }): Promise<Correspondance[]> {
  const conditions: string[] = [];
  const valeurs: unknown[] = [];
  const p = (valeur: unknown) => `$${valeurs.push(valeur)}`;
  if (filtre.id) {
    if (!/^[0-9a-f-]{36}$/i.test(filtre.id)) return [];
    conditions.push(`m.id = ${p(filtre.id)}`);
  }
  if (filtre.offreId) conditions.push(`m.job_offer_id = ${p(filtre.offreId)}`);
  if (filtre.besoinId) conditions.push(`m.employer_need_id = ${p(filtre.besoinId)}`);
  if (filtre.candidatId) conditions.push(`m.candidate_id = ${p(filtre.candidatId)}`);
  if (filtre.statuts?.length) conditions.push(`m.status = ANY(${p(filtre.statuts)}::text[])`);
  const lignes = await requete<Omit<Correspondance, 'candidat_nom'> & { full_name_enc: string | null }>(
    `SELECT m.id, m.score, m.status, m.explanation, m.algorithm_version, m.computed_at, m.status_changed_at, m.candidate_id, k.reference AS candidat_reference,
            k.full_name_enc, k.status AS candidat_statut, pr.city_code AS candidat_ville, kc.code AS candidat_metier,
            m.job_offer_id, o.reference AS offre_reference, o.title AS offre_titre, o.effective_status AS offre_statut, o.city_code AS offre_ville,
            m.employer_need_id, n.reference AS besoin_reference, n.title AS besoin_titre, e.name AS besoin_employeur, COALESCE(n.employer_id, o.employer_id) AS employer_id
       FROM matches m JOIN candidates k ON k.id = m.candidate_id LEFT JOIN candidate_profiles pr ON pr.candidate_id = k.id LEFT JOIN job_categories kc ON kc.id = pr.primary_category_id
       LEFT JOIN v_job_offers o ON o.id = m.job_offer_id LEFT JOIN employer_needs n ON n.id = m.employer_need_id LEFT JOIN employers e ON e.id = n.employer_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY (m.status IN ('ecarte', 'refuse_candidat', 'refuse_employeur')), m.score DESC, m.computed_at DESC LIMIT ${Math.min(filtre.limite ?? 100, 300)}`,
    valeurs,
  );
  return lignes.map(({ full_name_enc, ...reste }) => ({ ...reste, candidat_nom: dechiffrerOuVide(full_name_enc) }));
}

const SUITES: Record<string, string[]> = {
  suggere: ['retenu', 'ecarte'],
  retenu: ['propose', 'ecarte', 'refuse_candidat'],
  propose: ['entretien', 'accepte', 'refuse_candidat', 'refuse_employeur'],
  entretien: ['accepte', 'refuse_candidat', 'refuse_employeur'],
  accepte: ['refuse_candidat', 'refuse_employeur'],
  refuse_candidat: ['retenu'],
  refuse_employeur: ['retenu'],
  ecarte: ['retenu'],
};

export function suitesCorrespondance(statut: string): string[] {
  return SUITES[statut] ?? [];
}

export async function changerStatutCorrespondance(id: string, statut: string, acteur: Acteur, maintenant = new Date()): Promise<void> {
  if (!STATUTS_CORRESPONDANCE.est(statut)) throw new ErreurAppariement('Statut inconnu.');
  await transaction(async (tx) => {
    const m = await uneLigne<{ status: string; candidate_id: string; job_offer_id: string | null; employer_need_id: string | null }>(`SELECT status, candidate_id, job_offer_id, employer_need_id FROM matches WHERE id = $1 FOR UPDATE`, [id], tx);
    if (!m) throw new ErreurAppariement('Correspondance introuvable.');
    if (m.status === statut) return;
    if (!suitesCorrespondance(m.status).includes(statut)) throw new ErreurAppariement(`Passage impossible de « ${STATUTS_CORRESPONDANCE.libelle(m.status)} » à « ${STATUTS_CORRESPONDANCE.libelle(statut)} ».`);
    if (['retenu', 'propose', 'entretien', 'accepte'].includes(statut)) {
      const candidat = await uneLigne<{ status: string; anonymized_at: Date | null }>(`SELECT status, anonymized_at FROM candidates WHERE id = $1`, [m.candidate_id], tx);
      if (candidat?.anonymized_at) throw new ErreurAppariement('Fiche candidat anonymisée.');
      if (candidat?.status === 'place') throw new ErreurAppariement('Ce candidat est déjà placé.');
      if (m.job_offer_id) {
        const offre = await uneLigne<{ effective_status: string }>(`SELECT effective_status FROM v_job_offers WHERE id = $1`, [m.job_offer_id], tx);
        if (offre?.effective_status !== 'actif') throw new ErreurAppariement('L’offre n’est plus active : elle ne peut pas être proposée à un candidat.');
      }
    }
    await executer(`UPDATE matches SET status = $2, status_changed_at = $3, status_changed_by = $4 WHERE id = $1`, [id, statut, maintenant, acteur.id], tx);
    // Effets de bord sur le suivi du candidat et de l'employeur.
    if (statut === 'propose' || statut === 'entretien') {
      const cible = statut === 'propose' ? 'propose' : 'entretien';
      await executer(`UPDATE candidates SET status = $2, last_activity_at = $3 WHERE id = $1 AND status IN ('nouveau', 'contacte', 'entretien', 'propose') AND status <> $2`, [m.candidate_id, cible, maintenant], tx);
      const employeur = m.employer_need_id
        ? await uneLigne<{ id: string; status: string }>(`SELECT e.id, e.status FROM employer_needs n JOIN employers e ON e.id = n.employer_id WHERE n.id = $1`, [m.employer_need_id], tx)
        : await uneLigne<{ id: string; status: string }>(`SELECT e.id, e.status FROM job_offers o JOIN employers e ON e.id = o.employer_id WHERE o.id = $1`, [m.job_offer_id], tx);
      if (employeur && ['prospect', 'a_contacter', 'contacte', 'besoin_qualifie'].includes(employeur.status)) await changerStatutEmployeur(employeur.id, 'candidats_proposes', acteur, tx);
      if (m.employer_need_id) await executer(`UPDATE employer_needs SET status = 'en_cours' WHERE id = $1 AND status = 'ouvert'`, [m.employer_need_id], tx);
    }
    await journaliser({ acteur, action: 'appariement.statut', entite: 'correspondance', id, resume: `${m.status} › ${statut}`, changements: { avant: m.status, apres: statut } }, tx);
  });
}

/**
 * Recalcule fraîcheur, vivier de candidats et indice de placement des offres
 * non archivées (ou de la liste donnée). Appelé par le worker et après un
 * calcul d'appariement.
 */
export async function rafraichirScores(ids?: string[], maintenant = new Date()): Promise<number> {
  const parametres = await chargerParametres();
  const offres = await requete<{ id: string; published_at: Date | null; effective_status: string; relevance_score: number; quality_score: number; score_details: Record<string, unknown>; freshness_score: number; placement_score: number; vivier: number }>(
    `SELECT o.id, o.published_at, o.effective_status, o.relevance_score, o.quality_score, o.score_details, o.freshness_score, o.placement_score,
            (SELECT count(DISTINCT k.id)::int
               FROM candidates k JOIN candidate_profiles pr ON pr.candidate_id = k.id JOIN candidate_profile_categories pc ON pc.candidate_id = k.id
               JOIN job_offer_categories jc ON jc.category_id = pc.category_id AND jc.job_offer_id = o.id
              WHERE k.anonymized_at IS NULL AND k.is_demo = o.is_demo AND k.status IN ('nouveau', 'contacte', 'entretien', 'propose')
                AND (o.city_code IS NULL OR pr.city_code = o.city_code OR o.city_code = ANY(pr.accepted_city_codes))) AS vivier
       FROM v_job_offers o WHERE ${ids ? 'o.id = ANY($1::uuid[])' : `o.status <> 'archive'`}`,
    ids ? [ids] : [],
  );
  let modifiees = 0;
  for (const o of offres) {
    const fraicheur = scoreFraicheur(o.published_at ? new Date(o.published_at) : null, maintenant, parametres.offres.demiVieFraicheurJours, o.effective_status === 'expire');
    const composantes = (o.score_details?.composantes ?? {}) as { joignabilite?: number };
    const placement = indicePlacement({ pertinence: o.relevance_score, fraicheur, qualite: o.quality_score, candidatsDisponibles: o.vivier, joignabilite: composantes.joignabilite ?? 0 });
    const avant = (o.score_details?.composantes as { candidats?: number | null } | undefined)?.candidats;
    if (fraicheur === o.freshness_score && placement.score === o.placement_score && avant === o.vivier) continue;
    await executer(
      `UPDATE job_offers SET freshness_score = $2, placement_score = $3,
              score_details = jsonb_set(jsonb_set(score_details, '{placement}', $4::jsonb), '{composantes}', $5::jsonb) WHERE id = $1`,
      [o.id, fraicheur, placement.score, JSON.stringify(placement.lignes), JSON.stringify({ joignabilite: composantes.joignabilite ?? 0, candidats: o.vivier })],
    );
    modifiees += 1;
  }
  return modifiees;
}
