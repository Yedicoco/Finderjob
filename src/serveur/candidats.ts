/**
 * Candidats.
 *
 *   - Aucune fiche sans consentement daté (loi n° 09-08).
 *   - Aucun mineur : l'âge déclaré ne sert qu'à refuser les moins de 18 ans.
 *   - Identité, téléphone, e-mail et notes sont chiffrés ; la recherche passe
 *     par des index aveugles.
 *   - Le profil professionnel (métier, ville, expérience…) est séparé de
 *     l'identité : c'est le seul que lit l'appariement.
 *   - Chaque consultation d'une fiche nominative est journalisée.
 *   - Anonymisation à la demande, au retrait du consentement, ou à la fin de
 *     la durée de conservation.
 */
import type { ProfilCandidat } from '@/domaine/appariement';
import { niveauExperience, type PeriodeSalaire } from '@/domaine/extraction';
import { villeParCode } from '@/domaine/geographie';
import { CANAUX_CONSENTEMENT, COMPETENCES, DOCUMENTS_CANDIDAT, LANGUES, LIENS_REFERENCE, LOGEMENT, PERIODES_SALAIRE, STATUTS_CANDIDAT, TEMPS_TRAVAIL } from '@/domaine/referentiels';
import { metierParCode } from '@/domaine/taxonomie';
import { journaliser, type Acteur } from './audit';
import { chiffrer, chiffresTelephone, dechiffrerOuVide, indexNom, indexTelephone } from './chiffrement';
import { executer, prochaineReference, requete, transaction, uneLigne, type Executeur } from './db';
import { chargerParametres } from './parametres';
import { idsCategories, idsCompetences } from './referentiel';
import { ErreurMetier } from '@/domaine/erreurs';
import { dateSaisieMaroc } from '@/domaine/fuseau';

export class ErreurCandidat extends ErreurMetier {}

export type SaisieCandidat = {
  nom: string;
  telephone?: string | null;
  email?: string | null;
  notes?: string | null;
  ageDeclare?: number | null;
  consentementDonne: boolean;
  consentementCanal: string;
  consentementDate?: string | null;
  whatsappOptIn?: boolean;
  origine?: 'saisie' | 'formulaire_yallah' | 'import' | 'recommandation';
  referenceExterne?: string | null;
  metiers: string[];
  ville?: string | null;
  quartier?: string | null;
  villesAcceptees?: string[];
  experienceAnnees?: number | null;
  langues?: string[];
  salaireAttendu?: number | null;
  periodeSalaire?: string;
  logement?: string;
  rythmes?: string[];
  joursParSemaine?: number | null;
  disponibleLe?: string | null;
  permis?: boolean;
  documents?: string[];
  competences?: string[];
  resume?: string | null;
};

type SaisieValidee = Required<Pick<SaisieCandidat, 'nom' | 'metiers'>> & {
  telephone: string | null; email: string | null; notes: string | null; age: number | null; canal: string; consentementLe: Date; whatsapp: boolean;
  origine: string; referenceExterne: string | null; ville: string | null; quartier: string | null; villesAcceptees: string[]; experience: number | null;
  langues: string[]; salaire: number | null; periode: string; logement: string; rythmes: string[]; jours: number | null; disponibleLe: string | null;
  permis: boolean; documents: string[]; competences: string[]; resume: string | null;
};

/** Une liste de codes venant d'un formulaire : tout code inconnu est refusé, jamais ignoré en silence. */
function codesValides(valeurs: string[] | undefined, accepte: (code: string) => boolean, libelle: string): string[] {
  const codes = [...new Set(valeurs ?? [])].filter(Boolean);
  const inconnu = codes.find((code) => !accepte(code));
  if (inconnu !== undefined) throw new ErreurCandidat(`${libelle} inconnu(e) : ${inconnu.slice(0, 40)}`);
  return codes;
}

function valider(s: SaisieCandidat, maintenant: Date): SaisieValidee {
  const nom = (s.nom ?? '').replace(/\s+/g, ' ').trim();
  if (nom.length < 2 || nom.length > 120) throw new ErreurCandidat('Nom du candidat : 2 à 120 caractères.');
  if (!s.consentementDonne) throw new ErreurCandidat('Le consentement du candidat est obligatoire : sans lui, aucune fiche ne peut être créée (loi n° 09-08).');
  if (!CANAUX_CONSENTEMENT.est(s.consentementCanal)) throw new ErreurCandidat('Précisez comment le consentement a été recueilli.');
  const consentementLe = s.consentementDate ? dateSaisieMaroc(s.consentementDate, 'midi') : maintenant;
  if (!consentementLe || consentementLe.getTime() > maintenant.getTime() + 86_400_000) throw new ErreurCandidat('Date du consentement invalide.');
  const age = s.ageDeclare ?? null;
  if (age !== null) {
    if (!Number.isInteger(age)) throw new ErreurCandidat('Âge invalide.');
    if (age < 18) throw new ErreurCandidat('Yallah Services ne place aucune personne mineure : la fiche ne peut pas être créée (loi n° 19-12, âge minimum 18 ans).');
    if (age > 80) throw new ErreurCandidat('Âge invalide.');
  }
  let telephone: string | null = null;
  if (s.telephone?.trim()) {
    const chiffres = chiffresTelephone(s.telephone);
    if (!chiffres) throw new ErreurCandidat('Numéro de téléphone invalide.');
    telephone = `+${chiffres}`;
  }
  const email = s.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ErreurCandidat('Adresse e-mail invalide.');
  const metiers = [...new Set(s.metiers ?? [])].filter(Boolean);
  if (metiers.length === 0) throw new ErreurCandidat('Indiquez au moins un métier.');
  if (metiers.length > 5) throw new ErreurCandidat('Cinq métiers au plus.');
  for (const metier of metiers) if (!metierParCode(metier)) throw new ErreurCandidat(`Métier inconnu : ${metier}`);
  if (s.ville && !villeParCode(s.ville)) throw new ErreurCandidat('Ville inconnue du référentiel.');
  const villesAcceptees = codesValides(s.villesAcceptees, (code) => Boolean(villeParCode(code)), 'Ville').filter((code) => code !== s.ville);
  const experience = s.experienceAnnees ?? null;
  if (experience !== null && (!(experience >= 0) || experience > 60)) throw new ErreurCandidat('Années d’expérience invalides.');
  const salaire = s.salaireAttendu ?? null;
  if (salaire !== null && (!(salaire > 0) || salaire > 1_000_000)) throw new ErreurCandidat('Salaire attendu invalide.');
  const periode = s.periodeSalaire ?? 'mois';
  if (!PERIODES_SALAIRE.est(periode)) throw new ErreurCandidat('Période de salaire inconnue.');
  const logement = s.logement ?? 'indifferent';
  if (!LOGEMENT.est(logement)) throw new ErreurCandidat('Préférence de logement inconnue.');
  const jours = s.joursParSemaine ?? null;
  if (jours !== null && (!Number.isInteger(jours) || jours < 1 || jours > 7)) throw new ErreurCandidat('Jours par semaine : de 1 à 7.');
  if (s.disponibleLe && !/^\d{4}-\d{2}-\d{2}$/.test(s.disponibleLe)) throw new ErreurCandidat('Date de disponibilité invalide.');
  const codesCompetences = new Set(COMPETENCES.map((competence) => competence.code));
  return {
    nom, metiers, telephone, email, notes: s.notes?.trim().slice(0, 4000) || null, age, canal: s.consentementCanal, consentementLe, whatsapp: Boolean(s.whatsappOptIn),
    origine: s.origine ?? 'saisie', referenceExterne: s.referenceExterne?.trim().slice(0, 60) || null, ville: s.ville || null, quartier: s.quartier?.trim().slice(0, 80) || null,
    villesAcceptees, experience, langues: codesValides(s.langues, LANGUES.est, 'Langue'), salaire, periode, logement,
    rythmes: codesValides(s.rythmes, (code) => TEMPS_TRAVAIL.est(code) && code !== 'non_precise', 'Rythme'), jours, disponibleLe: s.disponibleLe || null, permis: Boolean(s.permis),
    documents: codesValides(s.documents, DOCUMENTS_CANDIDAT.est, 'Document'), competences: codesValides(s.competences, (code) => codesCompetences.has(code), 'Compétence'),
    resume: s.resume?.trim().slice(0, 1000) || null,
  };
}

function finConservation(depuis: Date, mois: number): string {
  const date = new Date(depuis);
  date.setUTCMonth(date.getUTCMonth() + mois);
  return date.toISOString().slice(0, 10);
}

async function ecrireProfil(id: string, v: SaisieValidee, tx: Executeur): Promise<void> {
  const categories = await idsCategories(tx);
  const competences = await idsCompetences(tx);
  await executer(
    `INSERT INTO candidate_profiles (candidate_id, primary_category_id, city_code, district, accepted_city_codes, experience_level, experience_years, languages,
                                     expected_salary, salary_period, housing_preference, work_times, days_per_week, available_from, driving_license, documents, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (candidate_id) DO UPDATE SET primary_category_id = EXCLUDED.primary_category_id, city_code = EXCLUDED.city_code, district = EXCLUDED.district,
       accepted_city_codes = EXCLUDED.accepted_city_codes, experience_level = EXCLUDED.experience_level, experience_years = EXCLUDED.experience_years,
       languages = EXCLUDED.languages, expected_salary = EXCLUDED.expected_salary, salary_period = EXCLUDED.salary_period,
       housing_preference = EXCLUDED.housing_preference, work_times = EXCLUDED.work_times, days_per_week = EXCLUDED.days_per_week,
       available_from = EXCLUDED.available_from, driving_license = EXCLUDED.driving_license, documents = EXCLUDED.documents, summary = EXCLUDED.summary`,
    [id, categories.get(v.metiers[0]!) ?? null, v.ville, v.quartier, v.villesAcceptees, niveauExperience(v.experience), v.experience, v.langues, v.salaire, v.periode,
      v.logement, v.rythmes, v.jours, v.disponibleLe, v.permis, v.documents, v.resume],
    tx,
  );
  await executer(`DELETE FROM candidate_profile_categories WHERE candidate_id = $1`, [id], tx);
  for (const metier of v.metiers) {
    const idCategorie = categories.get(metier);
    if (idCategorie) await executer(`INSERT INTO candidate_profile_categories (candidate_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, idCategorie], tx);
  }
  await executer(`DELETE FROM candidate_skills WHERE candidate_id = $1`, [id], tx);
  for (const code of v.competences) {
    const idCompetence = competences.get(code);
    if (idCompetence) await executer(`INSERT INTO candidate_skills (candidate_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, idCompetence], tx);
  }
}

export async function creerCandidat(saisie: SaisieCandidat, acteur: Acteur, maintenant = new Date(), options: { estDemo?: boolean } = {}): Promise<{ id: string; reference: string }> {
  const v = valider(saisie, maintenant);
  const parametres = await chargerParametres();
  return transaction(async (tx) => {
    const indexTel = indexTelephone(v.telephone);
    if (indexTel) {
      const doublon = await uneLigne<{ reference: string }>(`SELECT reference FROM candidates WHERE phone_bidx = $1 AND anonymized_at IS NULL`, [indexTel], tx);
      if (doublon) throw new ErreurCandidat(`Un candidat existe déjà avec ce numéro de téléphone (${doublon.reference}).`);
    }
    const cree = await uneLigne<{ id: string; reference: string }>(
      `INSERT INTO candidates (reference, external_ref, full_name_enc, name_bidx, phone_enc, phone_bidx, email_enc, notes_enc, declared_age, consent_given_at,
                               consent_version, consent_channel, whatsapp_opt_in, origin, last_activity_at, retention_until, created_by, is_demo)
       VALUES (${prochaineReference('CA', Boolean(options.estDemo))}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id, reference`,
      [v.referenceExterne, chiffrer(v.nom), indexNom(v.nom), chiffrer(v.telephone), indexTel, chiffrer(v.email), chiffrer(v.notes), v.age, v.consentementLe,
        parametres.candidats.versionConsentement, v.canal, v.whatsapp, v.origine, maintenant, finConservation(maintenant, parametres.candidats.conservationMois), acteur.id, Boolean(options.estDemo)],
      tx,
    );
    await ecrireProfil(cree!.id, v, tx);
    await journaliser({ acteur, action: 'candidat.creation', entite: 'candidat', id: cree!.id, resume: `Fiche ${cree!.reference} créée`, changements: { consentement: v.canal, metiers: v.metiers, ville: v.ville } }, tx);
    return cree!;
  });
}

export async function modifierCandidat(id: string, saisie: SaisieCandidat, acteur: Acteur, maintenant = new Date()): Promise<void> {
  const v = valider({ ...saisie, consentementDonne: true }, maintenant);
  const parametres = await chargerParametres();
  await transaction(async (tx) => {
    const actuel = await uneLigne<{ reference: string; anonymized_at: Date | null }>(`SELECT reference, anonymized_at FROM candidates WHERE id = $1 FOR UPDATE`, [id], tx);
    if (!actuel) throw new ErreurCandidat('Candidat introuvable.');
    if (actuel.anonymized_at) throw new ErreurCandidat('Cette fiche est anonymisée : elle ne peut plus être modifiée.');
    const indexTel = indexTelephone(v.telephone);
    if (indexTel) {
      const doublon = await uneLigne<{ reference: string }>(`SELECT reference FROM candidates WHERE phone_bidx = $1 AND id <> $2 AND anonymized_at IS NULL`, [indexTel, id], tx);
      if (doublon) throw new ErreurCandidat(`Un autre candidat porte déjà ce numéro (${doublon.reference}).`);
    }
    await executer(
      `UPDATE candidates SET full_name_enc = $2, name_bidx = $3, phone_enc = $4, phone_bidx = $5, email_enc = $6, notes_enc = $7, declared_age = $8,
              whatsapp_opt_in = $9, last_activity_at = $10, retention_until = $11 WHERE id = $1`,
      [id, chiffrer(v.nom), indexNom(v.nom), chiffrer(v.telephone), indexTel, chiffrer(v.email), chiffrer(v.notes), v.age, v.whatsapp, maintenant, finConservation(maintenant, parametres.candidats.conservationMois)],
      tx,
    );
    await ecrireProfil(id, v, tx);
    await journaliser({ acteur, action: 'candidat.modification', entite: 'candidat', id, resume: `Fiche ${actuel.reference} modifiée` }, tx);
  });
}

export async function changerStatutCandidat(id: string, statut: string, acteur: Acteur, maintenant = new Date(), tx?: Executeur): Promise<void> {
  if (!STATUTS_CANDIDAT.est(statut)) throw new ErreurCandidat('Statut inconnu.');
  const parametres = await chargerParametres();
  const avant = await uneLigne<{ status: string; reference: string; anonymized_at: Date | null }>(`SELECT status, reference, anonymized_at FROM candidates WHERE id = $1`, [id], tx);
  if (!avant) throw new ErreurCandidat('Candidat introuvable.');
  if (avant.anonymized_at) throw new ErreurCandidat('Cette fiche est anonymisée.');
  if (avant.status === statut) return;
  await executer(`UPDATE candidates SET status = $2, last_activity_at = $3, retention_until = $4 WHERE id = $1`, [id, statut, maintenant, finConservation(maintenant, parametres.candidats.conservationMois)], tx);
  await journaliser({ acteur, action: 'candidat.statut', entite: 'candidat', id, resume: `${avant.reference} : ${avant.status} › ${statut}`, changements: { avant: avant.status, apres: statut } }, tx);
}

/**
 * Changement de statut demandé par un courtier. « Placé » ne se décide pas à la
 * main : il découle d'un placement enregistré, et se défait en clôturant ce placement.
 */
export async function changerStatutManuel(id: string, statut: string, acteur: Acteur, maintenant = new Date()): Promise<void> {
  if (statut === 'place') throw new ErreurCandidat('Le statut « Placé » est attribué automatiquement quand un placement est enregistré.');
  const ouvert = await uneLigne<{ reference: string }>(`SELECT reference FROM placements WHERE candidate_id = $1 AND status IN ('en_cours', 'confirme')`, [id]);
  if (ouvert) throw new ErreurCandidat(`Ce candidat a un placement en cours (${ouvert.reference}) : clôturez-le pour changer son statut.`);
  await changerStatutCandidat(id, statut, acteur, maintenant);
}

export type CandidatListe = {
  id: string; reference: string; status: string; nom: string | null; anonymise: boolean; metier: string | null; metiers: string[]; city_code: string | null;
  experience_years: number | null; available_from: string | null; housing_preference: string; languages: string[]; last_activity_at: Date; retention_until: string;
  whatsapp_opt_in: boolean; is_demo: boolean;
};

export async function listerCandidats(filtres: { q?: string; statut?: string; metier?: string; ville?: string; page?: number } = {}): Promise<{ candidats: CandidatListe[]; total: number }> {
  const conditions: string[] = [];
  const valeurs: unknown[] = [];
  const p = (valeur: unknown) => `$${valeurs.push(valeur)}`;
  const q = filtres.q?.trim();
  if (q) {
    // Recherche exacte par référence, téléphone ou mot du nom : aucune donnée en clair n'est comparée.
    const tel = indexTelephone(q);
    const noms = indexNom(q);
    conditions.push(`(k.reference = upper(${p(q)})${tel ? ` OR k.phone_bidx = ${p(tel)}` : ''}${noms.length ? ` OR k.name_bidx @> ${p(noms)}::text[]` : ''})`);
  }
  if (filtres.statut) conditions.push(`k.status = ${p(filtres.statut)}`);
  if (filtres.ville) conditions.push(`(pr.city_code = ${p(filtres.ville)} OR ${p(filtres.ville)} = ANY(pr.accepted_city_codes))`);
  if (filtres.metier) conditions.push(`EXISTS (SELECT 1 FROM candidate_profile_categories pc JOIN job_categories c ON c.id = pc.category_id WHERE pc.candidate_id = k.id AND c.code = ${p(filtres.metier)})`);
  const page = Math.max(filtres.page ?? 1, 1);
  const lignes = await requete<Omit<CandidatListe, 'nom' | 'anonymise'> & { full_name_enc: string | null; anonymized_at: Date | null; total: number }>(
    `SELECT k.id, k.reference, k.status, k.full_name_enc, k.anonymized_at, k.last_activity_at, k.retention_until, k.whatsapp_opt_in, k.is_demo, c1.code AS metier,
            COALESCE((SELECT array_agg(c.code ORDER BY c.sort_order) FROM candidate_profile_categories pc JOIN job_categories c ON c.id = pc.category_id WHERE pc.candidate_id = k.id), '{}') AS metiers,
            pr.city_code, pr.experience_years, pr.available_from, pr.housing_preference, pr.languages, count(*) OVER() AS total
       FROM candidates k LEFT JOIN candidate_profiles pr ON pr.candidate_id = k.id LEFT JOIN job_categories c1 ON c1.id = pr.primary_category_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY (k.anonymized_at IS NOT NULL), k.last_activity_at DESC LIMIT 30 OFFSET ${(page - 1) * 30}`,
    valeurs,
  );
  return {
    total: Number(lignes[0]?.total ?? 0),
    candidats: lignes.map(({ full_name_enc, anonymized_at, total: _t, ...reste }) => {
      void _t;
      return { ...reste, nom: dechiffrerOuVide(full_name_enc), anonymise: Boolean(anonymized_at) };
    }),
  };
}

export type CandidatDetail = CandidatListe & {
  telephone: string | null; email: string | null; notes: string | null; declared_age: number | null; consent_given_at: Date; consent_version: string;
  consent_channel: string; origin: string; anonymized_at: Date | null; anonymized_reason: string | null; created_at: Date; district: string | null;
  accepted_city_codes: string[]; expected_salary: number | null; salary_period: string; work_times: string[]; days_per_week: number | null; driving_license: boolean;
  documents: string[]; summary: string | null; competences: string[];
  references: { id: string; position: number; nom: string | null; telephone: string | null; relation: string; checked_at: Date | null; check_notes: string | null }[];
};

export async function candidatParId(id: string, acteur: Acteur): Promise<CandidatDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const ligne = await uneLigne<Record<string, unknown> & { reference: string }>(
    `SELECT k.*, c1.code AS metier, pr.city_code, pr.district, pr.accepted_city_codes, pr.experience_years, pr.languages, pr.expected_salary, pr.salary_period,
            pr.housing_preference, pr.work_times, pr.days_per_week, pr.available_from, pr.driving_license, pr.documents, pr.summary,
            COALESCE((SELECT array_agg(c.code ORDER BY (c.id = pr.primary_category_id) DESC, c.sort_order) FROM candidate_profile_categories pc JOIN job_categories c ON c.id = pc.category_id WHERE pc.candidate_id = k.id), '{}') AS metiers,
            COALESCE((SELECT array_agg(s.code) FROM candidate_skills cs JOIN skills s ON s.id = cs.skill_id WHERE cs.candidate_id = k.id), '{}') AS competences
       FROM candidates k LEFT JOIN candidate_profiles pr ON pr.candidate_id = k.id LEFT JOIN job_categories c1 ON c1.id = pr.primary_category_id WHERE k.id = $1`,
    [id],
  );
  if (!ligne) return null;
  const references = await requete<{ id: string; position: number; name_enc: string; phone_enc: string | null; relation: string; checked_at: Date | null; check_notes: string | null }>(
    `SELECT id, position, name_enc, phone_enc, relation, checked_at, check_notes FROM candidate_references WHERE candidate_id = $1 ORDER BY position`,
    [id],
  );
  await journaliser({ acteur, action: 'candidat.consultation', entite: 'candidat', id, resume: `Fiche ${ligne.reference} consultée` });
  const { full_name_enc, phone_enc, email_enc, notes_enc, origin_country_enc: _pays, name_bidx: _n, phone_bidx: _p, ...reste } = ligne as Record<string, unknown>;
  void _pays; void _n; void _p;
  return {
    ...(reste as unknown as CandidatDetail),
    nom: dechiffrerOuVide(full_name_enc as string | null),
    telephone: dechiffrerOuVide(phone_enc as string | null),
    email: dechiffrerOuVide(email_enc as string | null),
    notes: dechiffrerOuVide(notes_enc as string | null),
    anonymise: Boolean(ligne.anonymized_at),
    references: references.map((reference) => ({ id: reference.id, position: reference.position, nom: dechiffrerOuVide(reference.name_enc), telephone: dechiffrerOuVide(reference.phone_enc), relation: reference.relation, checked_at: reference.checked_at, check_notes: reference.check_notes })),
  };
}

export async function ajouterReference(candidatId: string, entree: { nom: string; telephone?: string | null; relation: string }, acteur: Acteur): Promise<void> {
  const nom = entree.nom.replace(/\s+/g, ' ').trim();
  if (nom.length < 2) throw new ErreurCandidat('Nom de la référence requis.');
  if (!LIENS_REFERENCE.est(entree.relation)) throw new ErreurCandidat('Lien de référence inconnu.');
  const position = (await uneLigne<{ n: number }>(`SELECT COALESCE(max(position), 0)::int + 1 AS n FROM candidate_references WHERE candidate_id = $1`, [candidatId]))!.n;
  if (position > 5) throw new ErreurCandidat('Cinq références au plus.');
  await executer(`INSERT INTO candidate_references (candidate_id, position, name_enc, phone_enc, relation) VALUES ($1, $2, $3, $4, $5)`, [candidatId, position, chiffrer(nom), chiffrer(entree.telephone), entree.relation]);
  await executer(`UPDATE candidate_profiles SET references_count = (SELECT count(*) FROM candidate_references WHERE candidate_id = $1) WHERE candidate_id = $1`, [candidatId]);
  await journaliser({ acteur, action: 'candidat.reference_ajout', entite: 'candidat', id: candidatId, resume: 'Référence ajoutée' });
}

export async function verifierReference(referenceId: string, note: string | null, acteur: Acteur, maintenant = new Date()): Promise<void> {
  const ligne = await uneLigne<{ candidate_id: string }>(`UPDATE candidate_references SET checked_at = $2, checked_by = $3, check_notes = $4 WHERE id = $1 RETURNING candidate_id`, [referenceId, maintenant, acteur.id, note?.trim().slice(0, 500) || null]);
  if (ligne) await journaliser({ acteur, action: 'candidat.reference_verifiee', entite: 'candidat', id: ligne.candidate_id, resume: 'Référence vérifiée' });
}

const RAISONS = ['demande_candidat', 'fin_conservation', 'retrait_consentement'] as const;

/** Efface toute donnée identifiante. Le profil professionnel anonyme et l'historique des placements sont conservés. */
export async function anonymiserCandidat(id: string, raison: (typeof RAISONS)[number], acteur: Acteur, maintenant = new Date(), tx?: Executeur): Promise<void> {
  if (!RAISONS.includes(raison)) throw new ErreurCandidat('Raison inconnue.');
  const travail = async (t: Executeur) => {
    const actuel = await uneLigne<{ reference: string; anonymized_at: Date | null; status: string }>(`SELECT reference, anonymized_at, status FROM candidates WHERE id = $1 FOR UPDATE`, [id], t);
    if (!actuel) throw new ErreurCandidat('Candidat introuvable.');
    if (actuel.anonymized_at) return;
    await executer(`DELETE FROM candidate_references WHERE candidate_id = $1`, [id], t);
    await executer(`DELETE FROM matches WHERE candidate_id = $1 AND status IN ('suggere', 'retenu', 'ecarte')`, [id], t);
    await executer(`UPDATE candidate_profiles SET summary = NULL, district = NULL, references_count = 0 WHERE candidate_id = $1`, [id], t);
    await executer(
      `UPDATE candidates SET full_name_enc = NULL, name_bidx = '{}', phone_enc = NULL, phone_bidx = NULL, email_enc = NULL, notes_enc = NULL, origin_country_enc = NULL,
              declared_age = NULL, external_ref = NULL, whatsapp_opt_in = false, anonymized_at = $2, anonymized_reason = $3,
              status = CASE WHEN status = 'place' THEN status ELSE 'indisponible' END WHERE id = $1`,
      [id, maintenant, raison],
      t,
    );
    await journaliser({ acteur, action: 'candidat.anonymisation', entite: 'candidat', id, resume: `Fiche ${actuel.reference} anonymisée (${raison})`, changements: { raison } }, t);
  };
  if (tx) await travail(tx);
  else await transaction(travail);
}

/** Fin de conservation : anonymise les candidats non placés restés sans activité. */
export async function purgerCandidatsExpires(acteur: Acteur, maintenant = new Date()): Promise<number> {
  const lignes = await requete<{ id: string }>(`SELECT id FROM candidates WHERE anonymized_at IS NULL AND status <> 'place' AND retention_until < $1::date LIMIT 500`, [maintenant.toISOString().slice(0, 10)]);
  for (const ligne of lignes) await anonymiserCandidat(ligne.id, 'fin_conservation', acteur, maintenant);
  return lignes.length;
}

/** Profil non identifiant utilisé par l'appariement. Jamais de nom, d'âge ni d'origine. */
export type ProfilAvecCle = ProfilCandidat & { id: string; reference: string; estDemo: boolean };

export async function profilsPourAppariement(filtre: { id?: string; estDemo?: boolean } = {}, tx?: Executeur): Promise<ProfilAvecCle[]> {
  const lignes = await requete<{
    id: string; reference: string; status: ProfilCandidat['statut']; anonymise: boolean; is_demo: boolean; metiers: string[]; city_code: string | null; accepted_city_codes: string[] | null;
    experience_years: number | null; languages: string[] | null; expected_salary: number | null; salary_period: PeriodeSalaire | null; housing_preference: ProfilCandidat['logement'] | null;
    work_times: string[] | null; available_from: string | null; driving_license: boolean | null; competences: string[];
  }>(
    `SELECT k.id, k.reference, k.status, (k.anonymized_at IS NOT NULL) AS anonymise, k.is_demo, pr.city_code, pr.accepted_city_codes, pr.experience_years, pr.languages, pr.expected_salary,
            pr.salary_period, pr.housing_preference, pr.work_times, pr.available_from, pr.driving_license,
            COALESCE((SELECT array_agg(c.code ORDER BY (c.id = pr.primary_category_id) DESC, c.sort_order) FROM candidate_profile_categories pc JOIN job_categories c ON c.id = pc.category_id WHERE pc.candidate_id = k.id), '{}') AS metiers,
            COALESCE((SELECT array_agg(s.code) FROM candidate_skills cs JOIN skills s ON s.id = cs.skill_id WHERE cs.candidate_id = k.id), '{}') AS competences
       FROM candidates k JOIN candidate_profiles pr ON pr.candidate_id = k.id
      WHERE ${filtre.id ? 'k.id = $1' : `k.is_demo = $1 AND k.anonymized_at IS NULL AND k.status IN ('nouveau', 'contacte', 'entretien', 'propose')`}`,
    filtre.id ? [filtre.id] : [Boolean(filtre.estDemo)],
    tx,
  );
  return lignes.map((l) => ({
    id: l.id, reference: l.reference, estDemo: l.is_demo, statut: l.status, consentementValide: !l.anonymise, metiers: l.metiers, ville: l.city_code, villesAcceptees: l.accepted_city_codes ?? [],
    experienceAnnees: l.experience_years, langues: l.languages ?? [], salaireAttendu: l.expected_salary, periodeSalaire: l.salary_period ?? 'mois',
    logement: l.housing_preference ?? 'indifferent', rythmes: l.work_times ?? [], disponibleLe: l.available_from, permis: Boolean(l.driving_license), competences: l.competences,
  }));
}
