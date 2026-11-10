/**
 * Offres : recherche, lecture, modération.
 *
 * Toutes les lectures passent par la vue v_job_offers, qui recalcule le
 * statut EFFECTIF à chaque requête : une offre expirée ou non revérifiée
 * n'est jamais présentée comme active, même si le worker est arrêté.
 */
import type { Contrat, PrecisionDate, TypeEmployeur } from '@/domaine/extraction';
import { villeParCode } from '@/domaine/geographie';
import { CONTRATS, PERIODES_SALAIRE, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { mensualiser } from '@/domaine/extraction';
import { normaliserEmployeur } from '@/domaine/doublons';
import { indicePlacement, scoreFraicheur, scorePertinence } from '@/domaine/scores';
import { statutInitial } from '@/domaine/statuts';
import { metierParCode, motsClesRecherche } from '@/domaine/taxonomie';
import { compter } from '@/domaine/accord';
import { normaliserTexte } from '@/domaine/texte';
import { journaliser, type Acteur } from './audit';
import { dechiffrerOuVide } from './chiffrement';
import { executer, requete, transaction, uneLigne, type Executeur } from './db';
import { chargerParametres } from './parametres';
import { idsCategories } from './referentiel';
import { ErreurMetier } from '@/domaine/erreurs';
import { dateSaisieMaroc } from '@/domaine/fuseau';

export type Offre = {
  id: string;
  reference: string;
  source_id: string;
  source_name: string;
  source_code: string;
  source_kind: string;
  source_url: string | null;
  title: string;
  employer_name: string | null;
  employer_type_guess: TypeEmployeur | null;
  employer_id: string | null;
  description_excerpt: string | null;
  description_full: string | null;
  ai_summary: string | null;
  content_language: string;
  city_code: string | null;
  city_label: string | null;
  district: string | null;
  region: string | null;
  metier: string | null;
  sector_code: string | null;
  classification_confidence: number | null;
  contract_type: Contrat;
  work_time: string;
  work_mode: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_period: 'mois' | 'semaine' | 'jour' | 'heure' | null;
  salary_text: string | null;
  salary_monthly_estimate: number | null;
  salary_flag: string | null;
  experience_min_years: number | null;
  experience_level: string;
  languages: string[];
  driving_license: boolean | null;
  housing: 'loge' | 'non_loge' | 'indifferent' | null;
  meals_provided: boolean | null;
  schedule_text: string | null;
  availability_text: string | null;
  headcount: number | null;
  is_urgent: boolean;
  is_bulk_hiring: boolean;
  has_contact_in_source: boolean;
  a_contact: boolean;
  published_at: Date | null;
  date_precision: PrecisionDate;
  expires_at: Date | null;
  first_seen_at: Date;
  last_seen_at: Date;
  last_checked_at: Date;
  status: string;
  status_reason: string;
  effective_status: 'actif' | 'expire' | 'douteux' | 'archive';
  effective_reason: string;
  verification_status: string;
  requires_human_review: boolean;
  reviewed_at: Date | null;
  review_notes: string | null;
  duplicate_of_id: string | null;
  duplicate_score: number | null;
  relevance_score: number;
  freshness_score: number;
  quality_score: number;
  risk_score: number;
  placement_score: number;
  risk_flags: string[];
  score_details: Record<string, unknown>;
  extraction_method: string;
  is_demo: boolean;
  created_at: Date;
};

const COLONNES = `o.id, o.reference, o.source_id, s.name AS source_name, s.code AS source_code, s.kind AS source_kind, o.source_url, o.title,
  o.employer_name, o.employer_type_guess, o.employer_id, o.description_excerpt, o.description_full, o.ai_summary, o.content_language, o.city_code,
  o.city_label, o.district, o.region, c.code AS metier, o.sector_code, o.classification_confidence, o.contract_type, o.work_time, o.work_mode,
  o.salary_min, o.salary_max, o.salary_period, o.salary_text, o.salary_monthly_estimate, o.salary_flag, o.experience_min_years, o.experience_level,
  o.languages, o.driving_license, o.housing, o.meals_provided, o.schedule_text, o.availability_text, o.headcount, o.is_urgent, o.is_bulk_hiring,
  o.has_contact_in_source, (o.contact_phone_enc IS NOT NULL OR o.contact_email_enc IS NOT NULL) AS a_contact, o.published_at, o.date_precision,
  o.expires_at, o.first_seen_at, o.last_seen_at, o.last_checked_at, o.status, o.status_reason, o.effective_status, o.effective_reason,
  o.verification_status, o.requires_human_review, o.reviewed_at, o.review_notes, o.duplicate_of_id, o.duplicate_score, o.relevance_score,
  o.freshness_score, o.quality_score, o.risk_score, o.placement_score, o.risk_flags, o.score_details, o.extraction_method, o.is_demo, o.created_at`;

const DEPUIS = `v_job_offers o JOIN job_sources s ON s.id = o.source_id LEFT JOIN job_categories c ON c.id = o.primary_category_id`;

export const TRIS = ['pertinence', 'date', 'salaire', 'placement', 'risque'] as const;
export type Tri = (typeof TRIS)[number];
export const STATUTS_FILTRE = ['actif', 'douteux', 'expire', 'archive', 'tous'] as const;

export type FiltresOffres = {
  q?: string;
  statut?: (typeof STATUTS_FILTRE)[number];
  secteur?: string;
  metier?: string;
  ville?: string;
  contrat?: string;
  temps?: string;
  logement?: string;
  employeur?: string;
  source?: string;
  salaireMin?: number;
  depuisJours?: number;
  urgent?: boolean;
  massif?: boolean;
  aVerifier?: boolean;
  tri?: Tri;
  page?: number;
  parPage?: number;
};

type Clause = { conditions: string[]; valeurs: unknown[]; rang: string | null };

function construireClause(filtres: FiltresOffres, avecStatut: boolean): Clause {
  const conditions: string[] = [];
  const valeurs: unknown[] = [];
  const p = (valeur: unknown) => `$${valeurs.push(valeur)}`;
  let rang: string | null = null;

  const q = filtres.q?.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (q) {
    const texte = p(q);
    const normalise = p(normaliserTexte(q));
    const requeteFts = `(websearch_to_tsquery('ys_fr', ${texte}) || websearch_to_tsquery('arabic', ${texte}))`;
    conditions.push(`(o.search_vector @@ ${requeteFts} OR position(${normalise} IN o.title_normalized) > 0 OR o.reference = upper(${texte}))`);
    rang = `ts_rank_cd(o.search_vector, ${requeteFts})`;
  }
  const statut = filtres.statut ?? 'actif';
  if (avecStatut && statut !== 'tous') conditions.push(`o.effective_status = ${p(statut)}`);
  if (filtres.secteur) conditions.push(`o.sector_code = ${p(filtres.secteur)}`);
  if (filtres.metier) {
    conditions.push(`EXISTS (SELECT 1 FROM job_offer_categories jc JOIN job_categories c2 ON c2.id = jc.category_id WHERE jc.job_offer_id = o.id AND c2.code = ${p(filtres.metier)})`);
  }
  if (filtres.ville) conditions.push(`o.city_code = ${p(filtres.ville)}`);
  if (filtres.contrat) conditions.push(`o.contract_type = ${p(filtres.contrat)}`);
  if (filtres.temps) conditions.push(`o.work_time = ${p(filtres.temps)}`);
  if (filtres.logement) conditions.push(`o.housing = ${p(filtres.logement)}`);
  if (filtres.employeur) conditions.push(`o.employer_type_guess = ${p(filtres.employeur)}`);
  if (filtres.source) conditions.push(`s.code = ${p(filtres.source)}`);
  if (filtres.salaireMin && filtres.salaireMin > 0) conditions.push(`o.salary_monthly_estimate >= ${p(filtres.salaireMin)}`);
  if (filtres.depuisJours && filtres.depuisJours > 0) conditions.push(`o.published_at >= now() - make_interval(days => ${p(Math.min(Math.round(filtres.depuisJours), 400))})`);
  if (filtres.urgent) conditions.push(`o.is_urgent`);
  if (filtres.massif) conditions.push(`o.is_bulk_hiring`);
  if (filtres.aVerifier) conditions.push(`o.requires_human_review`);
  return { conditions, valeurs, rang };
}

export type ResultatRecherche = { offres: Offre[]; total: number; page: number; parPage: number; parStatut: Record<string, number>; dureeMs: number };

export async function rechercherOffres(filtres: FiltresOffres = {}, utilisateurId?: string | null): Promise<ResultatRecherche> {
  const debut = Date.now();
  const parPage = Math.min(Math.max(filtres.parPage ?? 20, 1), 100);
  const page = Math.max(filtres.page ?? 1, 1);
  const clause = construireClause(filtres, true);
  const ou = clause.conditions.length ? `WHERE ${clause.conditions.join(' AND ')}` : '';
  const tris: Record<Tri, string> = {
    pertinence: `${clause.rang ? `${clause.rang} DESC, ` : ''}o.relevance_score DESC, o.published_at DESC NULLS LAST`,
    date: `o.published_at DESC NULLS LAST, o.relevance_score DESC`,
    salaire: `o.salary_monthly_estimate DESC NULLS LAST, o.relevance_score DESC`,
    placement: `o.placement_score DESC, o.published_at DESC NULLS LAST`,
    risque: `o.risk_score DESC, o.published_at DESC NULLS LAST`,
  };
  const tri = filtres.tri && TRIS.includes(filtres.tri) ? filtres.tri : 'pertinence';
  const lignes = await requete<Offre & { total: number }>(
    `SELECT ${COLONNES}, count(*) OVER() AS total FROM ${DEPUIS} ${ou}
      ORDER BY ${tris[tri]}, o.id LIMIT ${parPage} OFFSET ${(page - 1) * parPage}`,
    clause.valeurs,
  );
  const sansStatut = construireClause(filtres, false);
  const comptes = await requete<{ statut: string; n: number }>(
    `SELECT o.effective_status AS statut, count(*)::int AS n FROM ${DEPUIS} ${sansStatut.conditions.length ? `WHERE ${sansStatut.conditions.join(' AND ')}` : ''} GROUP BY 1`,
    sansStatut.valeurs,
  );
  const parStatut: Record<string, number> = { actif: 0, douteux: 0, expire: 0, archive: 0 };
  for (const ligne of comptes) parStatut[ligne.statut] = ligne.n;
  const parametres = await chargerParametres();
  const maintenant = new Date();
  const total = Number(lignes[0]?.total ?? 0);
  const offres = lignes.map(({ total: _total, ...offre }) => {
    void _total;
    return rafraichir(offre as Offre, maintenant, parametres.offres.demiVieFraicheurJours);
  });
  const dureeMs = Date.now() - debut;
  if (page === 1 && (filtres.q || Object.keys(filtres).some((cle) => !['page', 'parPage', 'tri', 'statut'].includes(cle) && filtres[cle as keyof FiltresOffres]))) {
    const { page: _p, parPage: _pp, q: _q, ...autres } = filtres;
    void _p; void _pp; void _q;
    await executer(`INSERT INTO search_queries (user_id, query_text, filters, result_count, duration_ms) VALUES ($1, $2, $3::jsonb, $4, $5)`, [utilisateurId ?? null, (filtres.q ?? '').slice(0, 200), JSON.stringify(autres), total, dureeMs]).catch(() => undefined);
  }
  return { offres, total, page, parPage, parStatut, dureeMs };
}

/** La fraîcheur dépend du jour de lecture : elle est recalculée à l'affichage. */
function rafraichir(offre: Offre, maintenant: Date, demiVie: number): Offre {
  return { ...offre, freshness_score: scoreFraicheur(offre.published_at ? new Date(offre.published_at) : null, maintenant, demiVie, offre.effective_status === 'expire') };
}

export type OffreDetaillee = Offre & {
  categories: { code: string; confiance: number; principal: boolean }[];
  competences: string[];
  versions: { id: number; observed_at: Date; origin: string; changed_fields: string[]; changes: Record<string, [unknown, unknown]>; auteur: string | null }[];
  doublons: { id: string; reference: string; title: string; source_name: string; source_url: string | null; duplicate_score: number | null }[];
  principale: { id: string; reference: string; title: string } | null;
  source: { terms_url: string | null; collection_mode: string };
};

export async function offreParId(id: string): Promise<OffreDetaillee | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const offre = await uneLigne<Offre>(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE o.id = $1`, [id]);
  if (!offre) return null;
  const parametres = await chargerParametres();
  const [categories, competences, versions, doublons, principale, source] = await Promise.all([
    requete<{ code: string; confiance: number; principal: boolean }>(
      `SELECT c.code, jc.confidence AS confiance, jc.is_primary AS principal FROM job_offer_categories jc JOIN job_categories c ON c.id = jc.category_id WHERE jc.job_offer_id = $1 ORDER BY jc.is_primary DESC, jc.confidence DESC`,
      [id],
    ),
    requete<{ code: string }>(`SELECT k.code FROM job_offer_skills js JOIN skills k ON k.id = js.skill_id WHERE js.job_offer_id = $1 ORDER BY k.label_fr`, [id]),
    requete<OffreDetaillee['versions'][number]>(
      `SELECT v.id, v.observed_at, v.origin, v.changed_fields, v.changes, u.full_name AS auteur FROM job_offer_versions v LEFT JOIN users u ON u.id = v.user_id WHERE v.job_offer_id = $1 ORDER BY v.observed_at DESC, v.id DESC LIMIT 30`,
      [id],
    ),
    requete<OffreDetaillee['doublons'][number]>(
      `SELECT d.id, d.reference, d.title, s.name AS source_name, d.source_url, d.duplicate_score FROM job_offers d JOIN job_sources s ON s.id = d.source_id WHERE d.duplicate_of_id = $1 ORDER BY d.first_seen_at`,
      [id],
    ),
    offre.duplicate_of_id ? uneLigne<{ id: string; reference: string; title: string }>(`SELECT id, reference, title FROM job_offers WHERE id = $1`, [offre.duplicate_of_id]) : Promise.resolve(null),
    uneLigne<{ terms_url: string | null; collection_mode: string }>(`SELECT terms_url, collection_mode FROM job_sources WHERE id = $1`, [offre.source_id]),
  ]);
  return { ...rafraichir(offre, new Date(), parametres.offres.demiVieFraicheurJours), categories, competences: competences.map((ligne) => ligne.code), versions, doublons, principale, source: source! };
}

/** Coordonnées de l'annonce : réservées aux courtiers, et chaque consultation est journalisée. */
export async function contactOffre(id: string, acteur: Acteur): Promise<{ telephone: string | null; email: string | null }> {
  const ligne = await uneLigne<{ reference: string; contact_phone_enc: string | null; contact_email_enc: string | null }>(`SELECT reference, contact_phone_enc, contact_email_enc FROM job_offers WHERE id = $1`, [id]);
  if (!ligne) return { telephone: null, email: null };
  if (ligne.contact_phone_enc || ligne.contact_email_enc) {
    await journaliser({ acteur, action: 'offre.contact_consulte', entite: 'offre', id, resume: `Coordonnées de ${ligne.reference} consultées` });
  }
  return { telephone: dechiffrerOuVide(ligne.contact_phone_enc), email: dechiffrerOuVide(ligne.contact_email_enc) };
}

// -------------------------------------------------------------------- modération --

export class ErreurOffre extends ErreurMetier {}

type LigneBrute = {
  id: string; reference: string; status: string; status_reason: string; verification_status: string; published_at: Date | null; date_precision: PrecisionDate;
  expires_at: Date | null; city_code: string | null; risk_score: number; duplicate_of_id: string | null; score_details: Record<string, unknown>;
  employer_type_guess: TypeEmployeur | null; contract_type: Contrat; is_urgent: boolean; is_bulk_hiring: boolean; salary_min: number | null; salary_flag: string | null;
  quality_score: number; classification_confidence: number | null; primary_category_id: string | null; title: string; employer_name: string | null;
  district: string | null; salary_max: number | null; salary_period: string | null;
};

async function charger(id: string, tx: Executeur): Promise<LigneBrute> {
  const ligne = await uneLigne<LigneBrute>(`SELECT * FROM job_offers WHERE id = $1 FOR UPDATE`, [id], tx);
  if (!ligne) throw new ErreurOffre('Offre introuvable.');
  return ligne;
}

async function historiser(tx: Executeur, id: string, origine: 'moderation' | 'maintenance' | 'fusion_doublon', changements: Record<string, [unknown, unknown]>, acteur: Acteur): Promise<void> {
  const champs = Object.keys(changements);
  if (champs.length === 0) return;
  await executer(`INSERT INTO job_offer_versions (job_offer_id, origin, changed_fields, changes, user_id) VALUES ($1, $2, $3, $4::jsonb, $5)`, [id, origine, champs, JSON.stringify(changements), acteur.id], tx);
}

/** Un courtier confirme qu'il a vérifié l'annonce. Elle ne devient active que si elle peut l'être. */
export async function verifierOffre(id: string, acteur: Acteur, note?: string | null, maintenant = new Date()): Promise<{ statut: string; motif: string }> {
  const parametres = await chargerParametres();
  return transaction(async (tx) => {
    const offre = await charger(id, tx);
    if (offre.duplicate_of_id) throw new ErreurOffre('Cette offre est rattachée à une autre comme doublon : dissociez-la d’abord.');
    if (!offre.published_at || offre.date_precision === 'inconnue') throw new ErreurOffre('Renseignez d’abord la date de publication : une offre sans date vérifiable ne peut pas être active.');
    // Lever un risque élevé est une décision qui engage : elle doit être motivée par écrit (et reste au journal).
    const risqueEleve = offre.risk_score >= parametres.risque.seuilEleve;
    if (risqueEleve && (note ?? '').trim().length < 10) {
      throw new ErreurOffre('Cette offre porte des signaux de risque élevé : expliquez en quelques mots pourquoi vous la jugez fiable (10 caractères au moins), ou écartez-la.');
    }
    const decision = statutInitial({
      publieLe: new Date(offre.published_at), precisionDate: offre.date_precision, expireLe: offre.expires_at ? new Date(offre.expires_at) : null,
      // Le courtier atteste avoir vérifié l'annonce : lieu et risque sont considérés comme levés.
      pays: 'MA', villeConnue: true, scoreRisque: 0, estDoublonDe: false, maintenant, parametres,
    });
    if (decision.motif === 'hors_perimetre_date') throw new ErreurOffre('Offre antérieure au 1er janvier 2026 : hors périmètre, elle reste archivée.');
    if (decision.motif === 'date_incoherente') throw new ErreurOffre('La date de publication est dans le futur : corrigez-la avant de vérifier l’offre.');
    await executer(
      `UPDATE job_offers SET status = $2, status_reason = $3, verification_status = 'verifiee', requires_human_review = false, reviewed_by = $4, reviewed_at = $5,
              review_notes = $6, last_checked_at = $5, status_changed_at = CASE WHEN status = $2 THEN status_changed_at ELSE $5 END WHERE id = $1`,
      [id, decision.statut, decision.motif, acteur.id, maintenant, note?.trim().slice(0, 1000) || null],
      tx,
    );
    await historiser(tx, id, 'moderation', { status: [offre.status, decision.statut], verification_status: [offre.verification_status, 'verifiee'] }, acteur);
    await journaliser({
      acteur, action: risqueEleve ? 'offre.verification_risque_leve' : 'offre.verification', entite: 'offre', id,
      resume: `${offre.reference} vérifiée › ${decision.statut}${risqueEleve ? ` (risque ${offre.risk_score}/100 levé par le courtier)` : ''}`,
      changements: { avant: offre.status, apres: decision.statut, ...(risqueEleve ? { risque: offre.risk_score, motif: note?.trim().slice(0, 300) } : {}) },
    }, tx);
    return { statut: decision.statut, motif: decision.motif };
  });
}

const MOTIFS_ARCHIVAGE = { rejetee_moderation: 'rejetee', pourvue: null, archivage_manuel: null } as const;

export async function archiverOffre(id: string, motif: keyof typeof MOTIFS_ARCHIVAGE, acteur: Acteur, note?: string | null, maintenant = new Date()): Promise<void> {
  if (!Object.hasOwn(MOTIFS_ARCHIVAGE, motif)) throw new ErreurOffre('Motif inconnu.');
  if (motif === 'rejetee_moderation' && (note ?? '').trim().length < 5) throw new ErreurOffre('Indiquez en quelques mots pourquoi l’offre est écartée.');
  await transaction(async (tx) => {
    const offre = await charger(id, tx);
    await executer(
      `UPDATE job_offers SET status = 'archive', status_reason = $2, verification_status = CASE WHEN $3::text IS NULL THEN verification_status ELSE $3 END,
              requires_human_review = false, reviewed_by = $4, reviewed_at = $5, review_notes = COALESCE($6, review_notes), status_changed_at = $5 WHERE id = $1`,
      [id, motif, MOTIFS_ARCHIVAGE[motif], acteur.id, maintenant, note?.trim().slice(0, 1000) || null],
      tx,
    );
    await historiser(tx, id, 'moderation', { status: [offre.status, 'archive'], status_reason: [offre.status_reason, motif] }, acteur);
    await journaliser({ acteur, action: 'offre.archivage', entite: 'offre', id, resume: `${offre.reference} archivée (${motif})`, changements: { motif } }, tx);
  });
}

export async function lierDoublon(id: string, principaleId: string, acteur: Acteur, maintenant = new Date()): Promise<void> {
  if (id === principaleId) throw new ErreurOffre('Une offre ne peut pas être son propre doublon.');
  await transaction(async (tx) => {
    const offre = await charger(id, tx);
    const principale = await charger(principaleId, tx);
    const racine = principale.duplicate_of_id ?? principale.id;
    if (racine === id) throw new ErreurOffre('Ces deux offres sont déjà liées dans l’autre sens.');
    await executer(
      `UPDATE job_offers SET duplicate_of_id = $2, duplicate_score = COALESCE(duplicate_score, 100), status = 'archive', status_reason = 'doublon', requires_human_review = false,
              reviewed_by = $3, reviewed_at = $4, status_changed_at = $4 WHERE id = $1`,
      [id, racine, acteur.id, maintenant],
      tx,
    );
    // Les doublons de l'offre absorbée suivent.
    await executer(`UPDATE job_offers SET duplicate_of_id = $2 WHERE duplicate_of_id = $1`, [id, racine], tx);
    await historiser(tx, id, 'fusion_doublon', { duplicate_of: [null, principale.reference], status: [offre.status, 'archive'] }, acteur);
    await journaliser({ acteur, action: 'offre.doublon_lie', entite: 'offre', id, resume: `${offre.reference} rattachée à ${principale.reference}` }, tx);
  });
}

export async function dissocierDoublon(id: string, acteur: Acteur, maintenant = new Date()): Promise<void> {
  await transaction(async (tx) => {
    const offre = await charger(id, tx);
    if (!offre.duplicate_of_id) throw new ErreurOffre('Cette offre n’est pas un doublon.');
    // Elle redevient « douteuse, à vérifier » : c'est le courtier qui la réactive en la vérifiant.
    await executer(
      `UPDATE job_offers SET duplicate_of_id = NULL, duplicate_score = NULL, status = 'douteux', status_reason = 'aucun', verification_status = 'a_verifier',
              requires_human_review = true, status_changed_at = $2,
              score_details = score_details - 'doublonProbable' WHERE id = $1`,
      [id, maintenant],
      tx,
    );
    await historiser(tx, id, 'fusion_doublon', { duplicate_of: ['lié', null], status: [offre.status, 'douteux'] }, acteur);
    await journaliser({ acteur, action: 'offre.doublon_dissocie', entite: 'offre', id, resume: `${offre.reference} dissociée` }, tx);
  });
}

export async function ecarterDoublonProbable(id: string, acteur: Acteur): Promise<void> {
  await executer(`UPDATE job_offers SET score_details = score_details - 'doublonProbable' WHERE id = $1`, [id]);
  await journaliser({ acteur, action: 'offre.doublon_ecarte', entite: 'offre', id, resume: 'Doublon probable écarté : offres distinctes' });
}

export type CorrectionOffre = Partial<{
  datePublication: string | null;
  dateExpiration: string | null;
  ville: string | null;
  quartier: string | null;
  metier: string | null;
  employeur: string | null;
  typeEmployeur: string | null;
  contrat: string;
  salaireMin: number | null;
  salaireMax: number | null;
  periodeSalaire: string | null;
}>;

function dateSaisie(valeur: string, finDeJournee = false): Date {
  // Une date sans heure est placée à 12 h (ou en fin de journée), heure de Casablanca.
  const date = dateSaisieMaroc(valeur, finDeJournee ? 'fin' : 'midi');
  if (!date) throw new ErreurOffre('Date invalide.');
  return date;
}

/**
 * Correction humaine d'une offre. Les champs corrigés sont « verrouillés » :
 * une collecte ultérieure ne les écrasera pas. Le statut et les scores sont
 * recalculés avec les mêmes règles que l'ingestion.
 */
export async function corrigerOffre(id: string, c: CorrectionOffre, acteur: Acteur, maintenant = new Date()): Promise<{ statut: string; motif: string }> {
  const parametres = await chargerParametres();
  const categories = await idsCategories();
  return transaction(async (tx) => {
    const offre = await charger(id, tx);
    const changements: Record<string, [unknown, unknown]> = {};
    const verrous = new Set(Array.isArray(offre.score_details?.champsVerrouilles) ? (offre.score_details.champsVerrouilles as string[]) : []);
    const suivante = { ...offre };
    const noter = <K extends keyof LigneBrute>(champ: K, valeur: LigneBrute[K], verrou: string = champ) => {
      if (String(offre[champ] ?? '') === String(valeur ?? '')) return;
      changements[champ] = [offre[champ] ?? null, valeur ?? null];
      suivante[champ] = valeur;
      verrous.add(verrou);
    };

    if (c.datePublication !== undefined) {
      if (!c.datePublication) throw new ErreurOffre('La date de publication ne peut pas être effacée.');
      const date = dateSaisie(c.datePublication);
      if (date.getTime() > maintenant.getTime() + 2 * 86_400_000) throw new ErreurOffre('La date de publication ne peut pas être dans le futur.');
      noter('published_at', date);
      noter('date_precision', 'exacte');
    }
    if (c.dateExpiration !== undefined) noter('expires_at', c.dateExpiration ? dateSaisie(c.dateExpiration, true) : null);
    if (c.ville !== undefined) {
      if (c.ville && !villeParCode(c.ville)) throw new ErreurOffre('Ville inconnue du référentiel marocain.');
      noter('city_code', c.ville || null);
    }
    if (c.quartier !== undefined) noter('district', c.quartier?.trim().slice(0, 80) || null);
    if (c.employeur !== undefined) noter('employer_name', c.employeur?.replace(/\s+/g, ' ').trim().slice(0, 200) || null);
    if (c.typeEmployeur !== undefined) {
      if (c.typeEmployeur && !TYPES_EMPLOYEUR.est(c.typeEmployeur)) throw new ErreurOffre('Type d’employeur inconnu.');
      noter('employer_type_guess', (c.typeEmployeur || null) as TypeEmployeur | null);
    }
    if (c.contrat !== undefined) {
      if (!CONTRATS.est(c.contrat)) throw new ErreurOffre('Contrat inconnu.');
      noter('contract_type', c.contrat);
    }
    if (c.salaireMin !== undefined || c.salaireMax !== undefined || c.periodeSalaire !== undefined) {
      const min = c.salaireMin === undefined ? offre.salary_min : c.salaireMin;
      const max = c.salaireMax === undefined ? offre.salary_max : c.salaireMax;
      const periode = c.periodeSalaire === undefined ? offre.salary_period : c.periodeSalaire;
      if (min !== null && (!(min > 0) || min > 1_000_000)) throw new ErreurOffre('Salaire minimum invalide.');
      if (max !== null && (min === null || max < min)) throw new ErreurOffre('Le salaire maximum doit être supérieur au minimum.');
      if (min !== null && (!periode || !PERIODES_SALAIRE.est(periode))) throw new ErreurOffre('Précisez la période du salaire (mois, semaine, jour, heure).');
      noter('salary_min', min);
      noter('salary_max', max);
      noter('salary_period', min === null ? null : periode);
    }
    let metier: string | null | undefined;
    if (c.metier !== undefined) {
      if (c.metier && !metierParCode(c.metier)) throw new ErreurOffre('Métier inconnu de la taxonomie.');
      metier = c.metier || null;
      const idCategorie = metier ? (categories.get(metier) ?? null) : null;
      if (idCategorie !== offre.primary_category_id) {
        changements.primary_category = [offre.primary_category_id ? 'ancienne catégorie' : null, metier];
        suivante.primary_category_id = idCategorie;
        verrous.add('categories');
      } else metier = undefined;
    }
    if (Object.keys(changements).length === 0) return { statut: offre.status, motif: offre.status_reason };

    const ville = villeParCode(suivante.city_code);
    const metierCode = metier !== undefined ? metier : ((await uneLigne<{ code: string }>(`SELECT code FROM job_categories WHERE id = $1`, [suivante.primary_category_id], tx))?.code ?? null);
    const publieLe = suivante.published_at ? new Date(suivante.published_at) : null;
    const expireLe = suivante.expires_at ? new Date(suivante.expires_at) : null;
    // Une décision humaine antérieure (rejet, archivage, doublon) n'est pas défaite par une correction de champ.
    const decisionFigee = ['rejetee_moderation', 'pourvue', 'archivage_manuel', 'doublon'].includes(offre.status_reason);
    const decision = decisionFigee
      ? { statut: offre.status, motif: offre.status_reason, verification: offre.verification_status, revueHumaine: false }
      : statutInitial({
          publieLe, precisionDate: suivante.date_precision, expireLe, pays: ville ? 'MA' : offre.status_reason === 'localisation_inconnue' ? 'inconnu' : 'MA',
          villeConnue: Boolean(ville), scoreRisque: offre.verification_status === 'verifiee' ? 0 : offre.risk_score, estDoublonDe: false,
          revueDemandee: offre.verification_status !== 'verifiee' && !metierCode, maintenant, parametres,
        });
    const pertinence = scorePertinence({
      metier: metierCode, confianceMetier: metier !== undefined && metier ? 100 : (offre.classification_confidence ?? 0), ville: ville?.code ?? null,
      typeEmployeur: suivante.employer_type_guess, contrat: suivante.contract_type, urgent: offre.is_urgent, massif: offre.is_bulk_hiring,
      salaireAffiche: suivante.salary_min !== null, salaireAnormal: offre.salary_flag !== null && offre.salary_flag !== 'normal', scoreRisque: offre.risk_score, seuilRisqueEleve: parametres.risque.seuilEleve,
    });
    const fraicheur = scoreFraicheur(publieLe, maintenant, parametres.offres.demiVieFraicheurJours, decision.statut === 'expire');
    const composantes = (offre.score_details?.composantes ?? {}) as { joignabilite?: number; candidats?: number | null };
    const placement = indicePlacement({ pertinence: pertinence.score, fraicheur, qualite: offre.quality_score, candidatsDisponibles: composantes.candidats ?? null, joignabilite: composantes.joignabilite ?? 0 });
    const details = { ...offre.score_details, pertinence: pertinence.lignes, placement: placement.lignes, champsVerrouilles: [...verrous] };
    const mensuel = suivante.salary_min !== null && suivante.salary_period ? mensualiser(suivante.salary_max ? (suivante.salary_min + suivante.salary_max) / 2 : suivante.salary_min, suivante.salary_period as 'mois') : null;

    await executer(
      `UPDATE job_offers SET published_at = $2, date_precision = $3, expires_at = $4, city_code = $5, city_label = $6, region = $7, district = $8, employer_name = $9,
              employer_normalized = $10, employer_type_guess = $11, contract_type = $12, salary_min = $13, salary_max = $14, salary_period = $15,
              salary_monthly_estimate = $16, primary_category_id = $17, sector_code = $18, status = $19, status_reason = $20,
              verification_status = $21, requires_human_review = $22, relevance_score = $23, freshness_score = $24, placement_score = $25,
              score_details = $26::jsonb, search_keywords = $27, last_checked_at = $28,
              classification_confidence = CASE WHEN $29 THEN 100 ELSE classification_confidence END,
              status_changed_at = CASE WHEN status = $19 THEN status_changed_at ELSE $28 END
        WHERE id = $1`,
      [
        id, publieLe, suivante.date_precision, expireLe, ville?.code ?? null, ville?.nom ?? null, ville?.region ?? null, suivante.district, suivante.employer_name,
        suivante.employer_name ? normaliserEmployeur(suivante.employer_name) : null, suivante.employer_type_guess, suivante.contract_type, suivante.salary_min,
        suivante.salary_max, suivante.salary_period, mensuel, suivante.primary_category_id, metierCode ? (metierParCode(metierCode)?.secteur ?? null) : null,
        decision.statut, decision.motif, decision.verification, decision.revueHumaine, pertinence.score, fraicheur, placement.score, JSON.stringify(details),
        metierCode ? motsClesRecherche([metierCode]) : '', maintenant, metier !== undefined && Boolean(metier),
      ],
      tx,
    );
    if (metier !== undefined) {
      await executer(`DELETE FROM job_offer_categories WHERE job_offer_id = $1`, [id], tx);
      if (suivante.primary_category_id) await executer(`INSERT INTO job_offer_categories (job_offer_id, category_id, confidence, is_primary) VALUES ($1, $2, 100, true)`, [id, suivante.primary_category_id], tx);
    }
    await historiser(tx, id, 'moderation', changements, acteur);
    await journaliser({ acteur, action: 'offre.correction', entite: 'offre', id, resume: `${offre.reference} corrigée`, changements: { champs: Object.keys(changements), statut: [offre.status, decision.statut] } }, tx);
    return { statut: decision.statut, motif: decision.motif };
  });
}

/** Offres en attente d'un regard humain, les plus pertinentes d'abord. */
export async function offresAVerifier(limite = 50): Promise<Offre[]> {
  return requete<Offre>(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE o.requires_human_review AND o.status <> 'archive' ORDER BY o.relevance_score DESC, o.first_seen_at DESC LIMIT $1`, [limite]);
}

/**
 * Offres réelles pour l'export CSV (jamais les fiches fictives, jamais les coordonnées).
 * L'export est journalisé : c'est une sortie de données de l'outil.
 */
export async function exporterOffres(filtres: FiltresOffres, acteur: Acteur, limite = 5000): Promise<{ offres: Offre[]; tronque: boolean }> {
  const clause = construireClause({ ...filtres, statut: filtres.statut ?? 'tous' }, true);
  clause.conditions.push('NOT o.is_demo');
  const lignes = await requete<Offre>(
    `SELECT ${COLONNES} FROM ${DEPUIS} WHERE ${clause.conditions.join(' AND ')} ORDER BY o.published_at DESC NULLS LAST, o.id LIMIT ${Math.min(Math.max(limite, 1), 20_000) + 1}`,
    clause.valeurs,
  );
  const tronque = lignes.length > limite;
  const offres = lignes.slice(0, limite);
  const { page: _p, parPage: _pp, tri: _t, ...criteres } = filtres;
  void _p; void _pp; void _t;
  await journaliser({ acteur, action: 'export.offres', entite: 'systeme', resume: `Export CSV de ${compter(offres.length, 'offre')}${tronque ? ' (tronqué)' : ''}`, changements: { filtres: criteres, lignes: offres.length } });
  return { offres, tronque };
}

export async function existeJeuDemo(): Promise<boolean> {
  return Boolean(await uneLigne(`SELECT 1 FROM job_offers WHERE is_demo LIMIT 1`));
}
