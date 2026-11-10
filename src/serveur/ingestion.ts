/**
 * Enregistrement des offres analysées et exécution des collectes.
 *
 *   enregistrerOffre   création, mise à jour versionnée ou rattachement d'un doublon
 *   executerCollecte   une exécution polie d'une source automatisée (RSS, sitemap)
 *   importerSaisie     import manuel assisté d'une annonce lue par un courtier
 *   importerFichier    import d'un fichier CSV / JSON remis par un partenaire
 *
 * Règles tenues ici
 *   - une décision humaine (vérification, rejet, archivage, correction) n'est
 *     jamais écrasée par une collecte ultérieure ;
 *   - un doublon est rattaché à l'offre la plus ancienne, jamais supprimé ;
 *   - une source désactivée, en pause ou non conforme ne déclenche aucune requête.
 */
import { collecterRss } from '@/collecte/connecteurs/rss';
import { collecterSitemap } from '@/collecte/connecteurs/sitemap';
import { analyserFichier } from '@/collecte/connecteurs/fichier';
import { offreDepuisSaisie, type SaisieManuelle } from '@/collecte/connecteurs/manuel';
import { ClientPoli, ErreurCollecte } from '@/collecte/http';
import { analyserOffre, type ComplementIA, type OffreAnalysee, type PolitiqueSource, type ResultatAnalyse } from '@/collecte/pipeline';
import { resumerRobots } from '@/collecte/robots';
import type { MotifRejet, OffreBrute, Source } from '@/collecte/types';
import { deciderDoublon, similarite, urlCanonique, type OffreComparable } from '@/domaine/doublons';
import type { Parametres } from '@/domaine/parametres';
import { accord, compter } from '@/domaine/accord';
import { sha256 } from '@/domaine/texte';
import { ACTEUR_SYSTEME, journaliser, type Acteur } from './audit';
import { chiffrer } from './chiffrement';
import { executer, prochaineReference, requete, transaction, uneLigne, type Executeur } from './db';
import { chargerParametres } from './parametres';
import { idsCategories, idsCompetences } from './referentiel';
import { ErreurSource, obstaclesActivation, sourceParCode, sourceParId, type SourceComplete } from './sources';
import { ErreurMetier } from '@/domaine/erreurs';

// Colonnes de job_offers alimentées telles quelles par l'analyse.
const COLONNES_ANALYSE = [
  'source_external_id', 'source_url', 'canonical_url', 'title', 'title_normalized', 'employer_name', 'employer_normalized', 'employer_type_guess',
  'description_excerpt', 'description_full', 'ai_summary', 'content_language', 'city_code', 'city_label', 'district', 'region', 'sector_code',
  'classification_confidence', 'contract_type', 'work_time', 'work_mode', 'salary_min', 'salary_max', 'salary_period', 'salary_text',
  'salary_monthly_estimate', 'salary_flag', 'experience_min_years', 'experience_level', 'languages', 'driving_license', 'housing', 'meals_provided',
  'schedule_text', 'availability_text', 'headcount', 'is_urgent', 'is_bulk_hiring', 'has_contact_in_source', 'published_at', 'date_precision',
  'source_updated_at', 'expires_at', 'fingerprint', 'content_hash', 'relevance_score', 'freshness_score', 'quality_score', 'risk_score',
  'placement_score', 'risk_flags', 'extraction_method', 'search_keywords',
] as const satisfies readonly (keyof OffreAnalysee)[];

/** Champs dont un changement est historisé dans job_offer_versions. */
const CHAMPS_SUIVIS = [
  'title', 'employer_name', 'city_code', 'district', 'contract_type', 'work_time', 'salary_min', 'salary_max', 'salary_period', 'published_at',
  'expires_at', 'headcount', 'is_urgent', 'housing', 'description_excerpt',
] as const satisfies readonly (keyof OffreAnalysee)[];

const MOTIFS_DECISION_HUMAINE = ['rejetee_moderation', 'pourvue', 'archivage_manuel', 'doublon'];

export type ResultatEnregistrement = {
  type: 'nouvelle' | 'mise_a_jour' | 'inchangee' | 'doublon';
  id: string;
  reference: string;
  statut: string;
  motif: string;
  champsModifies?: string[];
  doublonDe?: { id: string; reference: string; score: number } | null;
  doublonProbable?: { id: string; reference: string; score: number; titre: string } | null;
};

export type ContexteEnregistrement = {
  sourceId: string;
  maintenant: Date;
  parametres: Parametres;
  runId?: string | null;
  acteur?: Acteur;
  origine: 'collecte' | 'saisie';
  estDemo?: boolean;
};

type LigneExistante = Record<string, unknown> & {
  id: string;
  reference: string;
  content_hash: string;
  status: string;
  status_reason: string;
  verification_status: string;
  score_details: Record<string, unknown>;
};

function comparable(valeur: unknown): string {
  if (valeur instanceof Date) return valeur.toISOString();
  if (valeur === null || valeur === undefined) return '';
  return typeof valeur === 'object' ? JSON.stringify(valeur) : String(valeur);
}

export type DoublonTrouve = { id: string; reference: string; titre: string; score: number; decision: 'doublon' | 'probable'; raisons: string[] };

/** Offres existantes qui ressemblent à cette analyse (aucune écriture). */
export async function chercherDoublons(offre: OffreAnalysee, contexte: { maintenant: Date; parametres: Parametres; exclureId?: string | null; estDemo?: boolean }, tx?: Executeur): Promise<DoublonTrouve[]> {
  const categories = await idsCategories(tx);
  const categorie = offre.categories[0] ? (categories.get(offre.categories[0].code) ?? null) : null;
  const pivot = offre.published_at ?? contexte.maintenant;
  const fenetre = contexte.parametres.doublons.fenetreJours * 86_400_000;
  const lignes = await requete<{
    id: string; reference: string; title: string; employer_normalized: string | null; city_code: string | null; metier: string | null;
    published_at: Date | null; content_language: string; salary_min: number | null; canonical_url: string | null; description: string | null;
    duplicate_of_id: string | null; racine_reference: string | null;
  }>(
    `SELECT o.id, o.reference, o.title, o.employer_normalized, o.city_code, c.code AS metier, o.published_at, o.content_language, o.salary_min,
            o.canonical_url, COALESCE(o.description_full, o.description_excerpt) AS description, o.duplicate_of_id, r.reference AS racine_reference
       FROM job_offers o
       LEFT JOIN job_categories c ON c.id = o.primary_category_id
       LEFT JOIN job_offers r ON r.id = o.duplicate_of_id
      WHERE ($1::uuid IS NULL OR o.id <> $1)
        AND o.is_demo = $2
        AND o.status_reason <> 'rejetee_moderation'
        AND (
              (o.canonical_url IS NOT NULL AND o.canonical_url = $3)
           OR (COALESCE(o.published_at, o.first_seen_at) BETWEEN $4 AND $5
               AND (o.city_code IS NULL OR $6::text IS NULL OR o.city_code = $6)
               AND (o.fingerprint = $7 OR o.primary_category_id IS NOT DISTINCT FROM $8::uuid OR similarity(o.title_normalized, $9) > 0.35))
        )
      ORDER BY (o.fingerprint = $7) DESC, o.first_seen_at ASC
      LIMIT 60`,
    [contexte.exclureId ?? null, contexte.estDemo ?? false, offre.canonical_url, new Date(pivot.getTime() - fenetre), new Date(pivot.getTime() + fenetre),
      offre.city_code, offre.fingerprint, categorie, offre.title_normalized],
    tx,
  );
  const nouvelle: OffreComparable = {
    titre: offre.title, employeur: offre.employer_normalized, ville: offre.city_code, metier: offre.categories[0]?.code ?? null, publieLe: offre.published_at,
    langue: offre.content_language, salaireMin: offre.salary_min, urlCanonique: offre.canonical_url, description: offre.description_full ?? offre.description_excerpt,
  };
  const trouves: DoublonTrouve[] = [];
  for (const ligne of lignes) {
    const resultat = similarite(nouvelle, {
      titre: ligne.title, employeur: ligne.employer_normalized, ville: ligne.city_code, metier: ligne.metier, publieLe: ligne.published_at,
      langue: ligne.content_language, salaireMin: ligne.salary_min, urlCanonique: ligne.canonical_url, description: ligne.description,
    });
    const decision = deciderDoublon(resultat.score, contexte.parametres.doublons);
    if (decision === 'distinct') continue;
    // On rattache toujours à la racine : jamais de chaîne « doublon d'un doublon ».
    trouves.push({ id: ligne.duplicate_of_id ?? ligne.id, reference: ligne.racine_reference ?? ligne.reference, titre: ligne.title, score: Math.round(resultat.score * 100), decision, raisons: resultat.raisons });
  }
  return trouves.sort((a, b) => b.score - a.score);
}

async function ecrireLiens(id: string, offre: OffreAnalysee, tx: Executeur): Promise<string | null> {
  const categories = await idsCategories(tx);
  const competences = await idsCompetences(tx);
  await executer(`DELETE FROM job_offer_categories WHERE job_offer_id = $1`, [id], tx);
  await executer(`DELETE FROM job_offer_skills WHERE job_offer_id = $1`, [id], tx);
  let principale: string | null = null;
  for (const categorie of offre.categories) {
    const idCategorie = categories.get(categorie.code);
    if (!idCategorie) continue;
    if (categorie.principal) principale = idCategorie;
    await executer(`INSERT INTO job_offer_categories (job_offer_id, category_id, confidence, is_primary) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [id, idCategorie, categorie.confiance, categorie.principal], tx);
  }
  for (const code of offre.competences) {
    const idCompetence = competences.get(code);
    if (idCompetence) await executer(`INSERT INTO job_offer_skills (job_offer_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, idCompetence], tx);
  }
  return principale;
}

async function enregistrerDansTransaction(offre: OffreAnalysee, contexte: ContexteEnregistrement, tx: Executeur): Promise<ResultatEnregistrement> {
  const { maintenant } = contexte;
  const existante = await uneLigne<LigneExistante>(`SELECT * FROM job_offers WHERE source_id = $1 AND source_external_id = $2 FOR UPDATE`, [contexte.sourceId, offre.source_external_id], tx);

  // ---------------------------------------------------------------- déjà connue --
  if (existante) {
    if (existante.content_hash === offre.content_hash) {
      await executer(`UPDATE job_offers SET last_seen_at = $2, last_checked_at = $2, freshness_score = $3 WHERE id = $1`, [existante.id, maintenant, offre.freshness_score], tx);
      return { type: 'inchangee', id: existante.id, reference: existante.reference, statut: existante.status, motif: existante.status_reason };
    }
    const verrouilles = new Set(Array.isArray(existante.score_details?.champsVerrouilles) ? (existante.score_details.champsVerrouilles as string[]) : []);
    const decisionHumaine = ['verifiee', 'rejetee'].includes(existante.verification_status) || MOTIFS_DECISION_HUMAINE.includes(existante.status_reason);
    const changements: Record<string, [unknown, unknown]> = {};
    for (const champ of CHAMPS_SUIVIS) {
      if (verrouilles.has(champ)) continue;
      if (comparable(existante[champ]) !== comparable(offre[champ])) changements[champ] = [existante[champ] ?? null, offre[champ] ?? null];
    }
    const colonnes = COLONNES_ANALYSE.filter((colonne) => !verrouilles.has(colonne) && colonne !== 'source_external_id');
    const valeurs: unknown[] = [existante.id];
    const affectations = colonnes.map((colonne) => `${colonne} = $${valeurs.push(offre[colonne])}`);
    affectations.push(`score_details = $${valeurs.push(JSON.stringify({ ...offre.score_details, champsVerrouilles: [...verrouilles] }))}::jsonb`);
    affectations.push(`last_seen_at = $${valeurs.push(maintenant)}`, `last_checked_at = $${valeurs.length}`);
    if (offre.contact_phone || offre.contact_email) {
      affectations.push(`contact_phone_enc = $${valeurs.push(chiffrer(offre.contact_phone))}`, `contact_email_enc = $${valeurs.push(chiffrer(offre.contact_email))}`);
    }
    if (!decisionHumaine) {
      // La date peut être verrouillée par une correction humaine : une offre ne redevient pas « douteuse : date inconnue » pour autant.
      const dateVerrouillee = verrouilles.has('published_at');
      if (!(dateVerrouillee && offre.status_reason === 'date_inconnue')) {
        affectations.push(`status = $${valeurs.push(offre.status)}`, `status_reason = $${valeurs.push(offre.status_reason)}`);
        affectations.push(`verification_status = $${valeurs.push(offre.verification_status)}`, `requires_human_review = $${valeurs.push(offre.requires_human_review)}`);
        if (offre.status !== existante.status) affectations.push(`status_changed_at = $${valeurs.push(maintenant)}`);
      }
    } else if (Object.keys(changements).length > 0 && existante.verification_status === 'verifiee') {
      // Le contenu a changé depuis la vérification : on redemande un regard humain sans défaire la décision.
      affectations.push(`requires_human_review = true`);
    }
    await executer(`UPDATE job_offers SET ${affectations.join(', ')} WHERE id = $1`, valeurs, tx);
    if (!verrouilles.has('categories')) {
      const principale = await ecrireLiens(existante.id, offre, tx);
      await executer(`UPDATE job_offers SET primary_category_id = $2 WHERE id = $1`, [existante.id, principale], tx);
    }
    const champs = Object.keys(changements);
    if (champs.length > 0) {
      await executer(
        `INSERT INTO job_offer_versions (job_offer_id, observed_at, origin, changed_fields, changes, run_id, user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [existante.id, maintenant, contexte.origine, champs, JSON.stringify(changements), contexte.runId ?? null, contexte.acteur?.id ?? null],
        tx,
      );
    }
    const relue = await uneLigne<{ status: string; status_reason: string }>(`SELECT status, status_reason FROM job_offers WHERE id = $1`, [existante.id], tx);
    return { type: 'mise_a_jour', id: existante.id, reference: existante.reference, statut: relue!.status, motif: relue!.status_reason, champsModifies: champs };
  }

  // -------------------------------------------------------------------- nouvelle --
  const doublons = await chercherDoublons(offre, { maintenant, parametres: contexte.parametres, estDemo: contexte.estDemo }, tx);
  const lie = doublons.find((doublon) => doublon.decision === 'doublon') ?? null;
  const probable = lie ? null : (doublons[0] ?? null);
  const statut = lie ? 'archive' : offre.status;
  const motif = lie ? 'doublon' : offre.status_reason;
  const details = { ...offre.score_details, ...(probable ? { doublonProbable: { id: probable.id, reference: probable.reference, score: probable.score } } : {}) };

  const colonnes: string[] = [...COLONNES_ANALYSE];
  const valeurs: unknown[] = COLONNES_ANALYSE.map((colonne) => offre[colonne]);
  const ajouter = (colonne: string, valeur: unknown) => {
    colonnes.push(colonne);
    valeurs.push(valeur);
  };
  ajouter('source_id', contexte.sourceId);
  ajouter('status', statut);
  ajouter('status_reason', motif);
  ajouter('verification_status', lie ? 'non_requise' : probable ? 'a_verifier' : offre.verification_status);
  ajouter('requires_human_review', lie ? false : offre.requires_human_review || Boolean(probable));
  ajouter('duplicate_of_id', lie?.id ?? null);
  ajouter('duplicate_score', lie?.score ?? null);
  ajouter('contact_phone_enc', chiffrer(offre.contact_phone));
  ajouter('contact_email_enc', chiffrer(offre.contact_email));
  ajouter('is_demo', contexte.estDemo ?? false);
  ajouter('created_by', contexte.acteur?.id ?? null);
  ajouter('first_seen_at', maintenant);
  ajouter('last_seen_at', maintenant);
  ajouter('last_checked_at', maintenant);
  ajouter('status_changed_at', maintenant);
  const marqueurs = valeurs.map((_, index) => `$${index + 1}`);
  valeurs.push(JSON.stringify(details));
  const cree = await uneLigne<{ id: string; reference: string }>(
    `INSERT INTO job_offers (reference, score_details, ${colonnes.join(', ')})
     VALUES (${prochaineReference('OF', Boolean(contexte.estDemo))}, $${valeurs.length}::jsonb, ${marqueurs.join(', ')}) RETURNING id, reference`,
    valeurs,
    tx,
  );
  const principale = await ecrireLiens(cree!.id, offre, tx);
  if (principale) await executer(`UPDATE job_offers SET primary_category_id = $2 WHERE id = $1`, [cree!.id, principale], tx);
  if (lie) {
    // Revoir la même annonce ailleurs prouve que l'offre principale est toujours d'actualité.
    await executer(`UPDATE job_offers SET last_seen_at = $2, last_checked_at = $2 WHERE id = $1`, [lie.id, maintenant], tx);
    return { type: 'doublon', id: cree!.id, reference: cree!.reference, statut, motif, doublonDe: { id: lie.id, reference: lie.reference, score: lie.score } };
  }
  return { type: 'nouvelle', id: cree!.id, reference: cree!.reference, statut, motif, doublonProbable: probable ? { id: probable.id, reference: probable.reference, score: probable.score, titre: probable.titre } : null };
}

export async function enregistrerOffre(offre: OffreAnalysee, contexte: ContexteEnregistrement, tx?: Executeur): Promise<ResultatEnregistrement> {
  if (tx) return enregistrerDansTransaction(offre, contexte, tx);
  try {
    return await transaction((interne) => enregistrerDansTransaction(offre, contexte, interne));
  } catch (erreur) {
    // Deux écritures simultanées de la même annonce : la seconde devient une mise à jour.
    if ((erreur as { code?: string }).code === '23505') return transaction((interne) => enregistrerDansTransaction(offre, contexte, interne));
    throw erreur;
  }
}

export async function enregistrerRejet(entree: { sourceId: string; runId?: string | null; url: string | null; cle: string; titre?: string | null; motif: MotifRejet; detail?: string | null }, tx?: Executeur): Promise<void> {
  const empreinte = sha256(entree.cle.trim());
  await executer(
    `INSERT INTO ingestion_rejections (run_id, source_id, url_hash, source_url, title, reason, detail)
     SELECT $1, $2, $3, $4, $5, $6, $7
      WHERE NOT EXISTS (SELECT 1 FROM ingestion_rejections WHERE source_id = $2 AND url_hash = $3 AND reason = $6)`,
    [entree.runId ?? null, entree.sourceId, empreinte, entree.url ? entree.url.slice(0, 500) : null, entree.titre ? entree.titre.slice(0, 120) : null, entree.motif, entree.detail?.slice(0, 300) ?? null],
    tx,
  );
}

export function politique(source: Source, surcharge: Partial<PolitiqueSource> = {}): PolitiqueSource {
  return {
    kind: source.kind, collection_mode: source.collection_mode, max_excerpt_chars: source.max_excerpt_chars, store_contacts: source.store_contacts,
    keep_unclassified: source.keep_unclassified, country_default: source.country_default, reliability_score: source.reliability_score, ...surcharge,
  };
}

// ----------------------------------------------------------- collecte automatisée --

export type BilanCollecte = {
  runId: string | null;
  statut: 'succes' | 'partiel' | 'echec' | 'ignore';
  message: string;
  requetes: number;
  lues: number;
  nouvelles: number;
  misesAJour: number;
  inchangees: number;
  doublons: number;
  rejetees: number;
  erreurs: number;
  idsNouvelles: string[];
};

export type OptionsCollecte = {
  declencheur: 'planifie' | 'manuel';
  acteur?: Acteur;
  maintenant?: Date;
  /** Injection pour les tests (faux site). */
  fetch?: typeof fetch;
  attendre?: (ms: number) => Promise<void>;
  autoriserAdressesLocales?: boolean;
  /** Complément facultatif par modèle de langage (jamais appelé si la source ou robots.txt l'interdit). */
  completerIA?: (brute: OffreBrute) => Promise<ComplementIA | null>;
};

const bilanVide = (statut: BilanCollecte['statut'], message: string): BilanCollecte => ({ runId: null, statut, message, requetes: 0, lues: 0, nouvelles: 0, misesAJour: 0, inchangees: 0, doublons: 0, rejetees: 0, erreurs: 0, idsNouvelles: [] });

async function traiterOffres(
  brutes: OffreBrute[],
  source: SourceComplete,
  bilan: BilanCollecte,
  contexte: { runId: string; maintenant: Date; parametres: Parametres; acteur?: Acteur; politique: PolitiqueSource; origine: 'collecte' | 'saisie'; completerIA?: OptionsCollecte['completerIA'] },
): Promise<void> {
  for (const brute of brutes) {
    bilan.lues += 1;
    try {
      let complementIA: ComplementIA | null = null;
      if (contexte.completerIA) complementIA = await contexte.completerIA(brute).catch(() => null);
      const analyse = analyserOffre(brute, contexte.politique, { maintenant: contexte.maintenant, parametres: contexte.parametres, complementIA });
      if (analyse.type === 'rejet') {
        bilan.rejetees += 1;
        await enregistrerRejet({ sourceId: source.id, runId: contexte.runId, url: brute.url, cle: brute.idExterne, titre: brute.titre, motif: analyse.motif, detail: analyse.detail });
        continue;
      }
      const resultat = await enregistrerOffre(analyse.offre, { sourceId: source.id, maintenant: contexte.maintenant, parametres: contexte.parametres, runId: contexte.runId, acteur: contexte.acteur, origine: contexte.origine });
      if (resultat.type === 'nouvelle') {
        bilan.nouvelles += 1;
        bilan.idsNouvelles.push(resultat.id);
      } else if (resultat.type === 'mise_a_jour') bilan.misesAJour += 1;
      else if (resultat.type === 'inchangee') bilan.inchangees += 1;
      else bilan.doublons += 1;
    } catch (erreur) {
      bilan.erreurs += 1;
      await enregistrerRejet({ sourceId: source.id, runId: contexte.runId, url: brute.url, cle: brute.idExterne, titre: brute.titre, motif: 'erreur_extraction', detail: erreur instanceof Error ? erreur.message : 'erreur' }).catch(() => undefined);
    }
  }
}

async function ouvrirExecution(sourceId: string, declencheur: 'planifie' | 'manuel' | 'import', acteur: Acteur | undefined, maintenant: Date): Promise<string | null> {
  await executer(
    `UPDATE scraping_runs SET status = 'echec', finished_at = $2, message = 'Exécution interrompue (processus arrêté)'
      WHERE source_id = $1 AND status = 'en_cours' AND started_at < $2::timestamptz - interval '30 minutes'`,
    [sourceId, maintenant],
  );
  try {
    const ligne = await uneLigne<{ id: string }>(`INSERT INTO scraping_runs (source_id, trigger_kind, started_at, triggered_by) VALUES ($1, $2, $3, $4) RETURNING id`, [sourceId, declencheur, maintenant, acteur?.id ?? null]);
    return ligne!.id;
  } catch (erreur) {
    if ((erreur as { code?: string }).code === '23505') return null;
    throw erreur;
  }
}

async function fermerExecution(bilan: BilanCollecte, details: Record<string, unknown> = {}, robotsBloques = 0): Promise<void> {
  if (!bilan.runId) return;
  await executer(
    `UPDATE scraping_runs SET status = $2, finished_at = now(), http_requests = $3, robots_blocked_count = $4, fetched_count = $5, new_count = $6,
            updated_count = $7, unchanged_count = $8, duplicate_count = $9, rejected_count = $10, error_count = $11, message = $12, details = $13::jsonb
      WHERE id = $1`,
    [bilan.runId, bilan.statut, bilan.requetes, robotsBloques, bilan.lues, bilan.nouvelles, bilan.misesAJour, bilan.inchangees, bilan.doublons, bilan.rejetees, bilan.erreurs, bilan.message.slice(0, 500), JSON.stringify(details)],
  );
}

export async function executerCollecte(sourceId: string, options: OptionsCollecte): Promise<BilanCollecte> {
  const maintenant = options.maintenant ?? new Date();
  const source = await sourceParId(sourceId);
  if (!source) throw new ErreurSource('Source introuvable.');
  if (source.kind !== 'rss' && source.kind !== 'sitemap') throw new ErreurSource('Cette source ne se collecte pas automatiquement.');
  if (!source.is_active) return bilanVide('ignore', 'Source désactivée : aucune requête envoyée.');
  const obstacles = obstaclesActivation(source);
  if (obstacles.length > 0) return bilanVide('ignore', `Source non conforme : ${obstacles.join(' ')}`);
  if (source.paused_until && new Date(source.paused_until) > maintenant) {
    return bilanVide('ignore', `Source en pause jusqu’au ${new Date(source.paused_until).toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
  }
  const runId = await ouvrirExecution(source.id, options.declencheur, options.acteur, maintenant);
  if (!runId) return bilanVide('ignore', 'Une exécution est déjà en cours pour cette source.');

  const bilan: BilanCollecte = { ...bilanVide('succes', ''), runId };
  const parametres = await chargerParametres();
  const client = new ClientPoli({
    userAgent: source.user_agent,
    delaiMinMs: source.min_delay_ms,
    maxRequetes: source.max_requests_per_run,
    cache: source.http_cache,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.attendre ? { attendre: options.attendre } : {}),
    ...(options.autoriserAdressesLocales ? { autoriserAdressesLocales: true } : {}),
  });
  let pause: Date | null = null;
  let avertissements: string[] = [];
  try {
    const resultat =
      source.kind === 'rss'
        ? await collecterRss(source, client)
        : await collecterSitemap(source, client, {
            maintenant,
            dejaConnues: async (urls) => {
              if (urls.length === 0) return new Set<string>();
              const empreintes = new Map(urls.map((url) => [sha256(url.trim()), url]));
              const connues = await requete<{ u: string }>(`SELECT source_external_id AS u FROM job_offers WHERE source_id = $1 AND source_external_id = ANY($2)`, [source.id, urls]);
              const ecartees = await requete<{ h: string }>(
                `SELECT url_hash AS h FROM ingestion_rejections WHERE source_id = $1 AND url_hash = ANY($2) AND reason <> 'erreur_extraction' AND created_at > $3::timestamptz - interval '30 days'`,
                [source.id, [...empreintes.keys()], maintenant],
              );
              return new Set([...connues.map((ligne) => ligne.u), ...ecartees.map((ligne) => empreintes.get(ligne.h)!).filter(Boolean)]);
            },
          });
    avertissements = resultat.avertissements;
    for (const ecartee of resultat.ecartees) {
      bilan.rejetees += 1;
      await enregistrerRejet({ sourceId: source.id, runId, url: ecartee.url, cle: ecartee.url, motif: ecartee.motif, detail: ecartee.detail ?? null });
    }
    // Un site qui refuse l'usage de son contenu par une IA (Content-Signal: ai-input=no) est obéi.
    const iaPermise = source.allow_ai_processing && client.signaux['ai-input'] !== false;
    await traiterOffres(resultat.offres, source, bilan, { runId, maintenant, parametres, acteur: options.acteur, politique: politique(source), origine: 'collecte', completerIA: iaPermise ? options.completerIA : undefined });
    bilan.statut = resultat.partiel || bilan.erreurs > 0 ? 'partiel' : 'succes';
    bilan.message = resultat.inchange
      ? 'Source inchangée depuis la dernière lecture.'
      : `${compter(bilan.nouvelles, 'nouvelle')}, ${compter(bilan.misesAJour, 'mise')} à jour, ${compter(bilan.doublons, 'doublon')}, ${compter(bilan.rejetees, 'écartée')}${resultat.partiel ? ' — exécution partielle (quota de requêtes atteint)' : ''}.`;
  } catch (erreur) {
    bilan.statut = 'echec';
    bilan.message = erreur instanceof Error ? erreur.message : 'Erreur inconnue';
    if (erreur instanceof ErreurCollecte && erreur.code === 'blocage_site') {
      // Le site nous demande d'arrêter : on s'arrête, au moins 24 heures, sans rien contourner.
      pause = new Date(maintenant.getTime() + Math.max(86_400, erreur.details.reessayerApresSecondes ?? 0) * 1000);
      bilan.message += ' Source mise en pause.';
    }
  }
  bilan.requetes = client.requetes;
  const echecs = bilan.statut === 'echec' ? source.consecutive_failures + 1 : 0;
  if (!pause && echecs >= 3) pause = new Date(maintenant.getTime() + 86_400_000);
  const robots = source.base_url || source.feed_url ? await client.lireRobots((source.feed_url ?? source.base_url)!).catch(() => null) : null;
  await executer(
    `UPDATE job_sources SET last_run_at = $2, last_success_at = CASE WHEN $3 THEN $2 ELSE last_success_at END, consecutive_failures = $4, paused_until = $5,
            http_cache = $6::jsonb, robots_summary = COALESCE($7, robots_summary), robots_checked_at = CASE WHEN $7::text IS NULL THEN robots_checked_at ELSE $2 END
      WHERE id = $1`,
    [source.id, maintenant, bilan.statut !== 'echec', echecs, pause, JSON.stringify(client.cache), robots ? resumerRobots(robots, client.userAgent).slice(0, 1000) : null],
  );
  bilan.requetes = client.requetes;
  await fermerExecution(bilan, { avertissements, signaux: client.signaux, pause: pause?.toISOString() ?? null }, client.robotsBloques);
  if (bilan.statut === 'echec' || options.declencheur === 'manuel') {
    await journaliser({ acteur: options.acteur ?? ACTEUR_SYSTEME, action: 'collecte.execution', entite: 'source', id: source.id, resume: `Collecte « ${source.name} » : ${bilan.statut}`, changements: { message: bilan.message, requetes: bilan.requetes } });
  }
  return bilan;
}

/** Sources actives dont la dernière exécution est plus ancienne que leur fréquence. */
export async function sourcesAExecuter(maintenant = new Date()): Promise<{ id: string; code: string; name: string }[]> {
  return requete(
    `SELECT id, code, name FROM job_sources
      WHERE is_active AND kind IN ('rss', 'sitemap')
        AND (paused_until IS NULL OR paused_until <= $1)
        AND (last_run_at IS NULL OR last_run_at <= $1::timestamptz - make_interval(mins => frequency_minutes))
      ORDER BY last_run_at NULLS FIRST`,
    [maintenant],
  );
}

export async function reprendreSource(id: string, acteur: Acteur): Promise<void> {
  await executer(`UPDATE job_sources SET paused_until = NULL, consecutive_failures = 0 WHERE id = $1`, [id]);
  await journaliser({ acteur, action: 'source.reprise', entite: 'source', id, resume: 'Pause levée manuellement' });
}

// ------------------------------------------------------------------ import manuel --

export type SaisieImport = SaisieManuelle & { origine: 'site' | 'employeur' };

export class ErreurImport extends ErreurMetier {}

/** Source à laquelle rattacher une annonce saisie : le site reconnu par son adresse, sinon la source générique. */
export async function sourcePourSaisie(saisie: Pick<SaisieImport, 'url' | 'origine'>): Promise<SourceComplete> {
  if (saisie.origine === 'employeur') return (await sourceParCode('annonce-confiee'))!;
  const canonique = urlCanonique(saisie.url);
  if (canonique) {
    const hote = new URL(canonique).hostname.replace(/^(www|ma|m)\./, '');
    const candidates = await requete<SourceComplete>(`SELECT * FROM job_sources WHERE base_url IS NOT NULL`);
    const reconnue = candidates.find((source) => {
      const hoteSource = new URL(source.base_url!).hostname.replace(/^(www|ma|m)\./, '');
      return hote === hoteSource || hote.endsWith(`.${hoteSource}`);
    });
    if (reconnue) {
      if (reconnue.collection_mode === 'desactive') throw new ErreurImport(`La source « ${reconnue.name} » est désactivée par l’administrateur : aucun import n’est accepté.`);
      return reconnue;
    }
  }
  const generique = await sourceParCode('saisie-manuelle');
  if (!generique) throw new ErreurImport('Source « saisie manuelle » absente : lancez « npm run db:initialiser ».');
  return generique;
}

export type ApercuSaisie = { source: { id: string; name: string; collection_mode: string; store_contacts: boolean }; analyse: ResultatAnalyse; doublons: DoublonTrouve[]; dejaConnue: { id: string; reference: string } | null };

function validerSaisie(saisie: SaisieImport): void {
  const texte = saisie.texte?.trim() ?? '';
  if (texte.length < 20 && !(saisie.titre && saisie.titre.trim().length >= 3)) throw new ErreurImport('Collez le texte de l’annonce (20 caractères au moins) ou saisissez un titre.');
  if (texte.length > 20_000) throw new ErreurImport('Texte trop long (20 000 caractères au plus).');
  if (saisie.url && saisie.url.trim() && !urlCanonique(saisie.url)) throw new ErreurImport('Le lien doit être une adresse web valide, commençant par https:// ou http://.');
  if (saisie.datePublication && Number.isNaN(Date.parse(saisie.datePublication))) throw new ErreurImport('Date de publication invalide.');
}

/** Analyse sans rien écrire : ce que l'application comprendrait de l'annonce. */
export async function apercuSaisie(saisie: SaisieImport, maintenant = new Date()): Promise<ApercuSaisie> {
  validerSaisie(saisie);
  const source = await sourcePourSaisie(saisie);
  const parametres = await chargerParametres();
  const brute = offreDepuisSaisie(saisie);
  const analyse = analyserOffre(brute, politique(source, { kind: 'manuel' }), { maintenant, parametres });
  let doublons: DoublonTrouve[] = [];
  let dejaConnue: ApercuSaisie['dejaConnue'] = null;
  if (analyse.type === 'offre') {
    dejaConnue = await uneLigne(`SELECT id, reference FROM job_offers WHERE source_id = $1 AND source_external_id = $2`, [source.id, analyse.offre.source_external_id]);
    doublons = await chercherDoublons(analyse.offre, { maintenant, parametres, exclureId: dejaConnue?.id ?? null });
  }
  return { source: { id: source.id, name: source.name, collection_mode: source.collection_mode, store_contacts: source.store_contacts }, analyse, doublons, dejaConnue };
}

export type ResultatImport = ({ type: 'rejet'; motif: MotifRejet; detail: string } | ResultatEnregistrement) & { source: string };

export async function importerSaisie(saisie: SaisieImport, acteur: Acteur, maintenant = new Date()): Promise<ResultatImport> {
  validerSaisie(saisie);
  const source = await sourcePourSaisie(saisie);
  const parametres = await chargerParametres();
  const brute = offreDepuisSaisie(saisie);
  const analyse = analyserOffre(brute, politique(source, { kind: 'manuel' }), { maintenant, parametres });
  if (analyse.type === 'rejet') {
    await enregistrerRejet({ sourceId: source.id, url: brute.url, cle: brute.idExterne, titre: brute.titre, motif: analyse.motif, detail: analyse.detail });
    await journaliser({ acteur, action: 'offre.import_refuse', entite: 'offre', resume: `Import refusé : ${analyse.motif}`, changements: { motif: analyse.motif, source: source.code } });
    return { type: 'rejet', motif: analyse.motif, detail: analyse.detail, source: source.name };
  }
  const resultat = await enregistrerOffre(analyse.offre, { sourceId: source.id, maintenant, parametres, acteur, origine: 'saisie' });
  await journaliser({ acteur, action: 'offre.import_manuel', entite: 'offre', id: resultat.id, resume: `Import manuel ${resultat.reference} (${resultat.type})`, changements: { source: source.code, statut: resultat.statut, motif: resultat.motif } });
  return { ...resultat, source: source.name };
}

export async function importerFichier(contenu: string, nomFichier: string, acteur: Acteur, maintenant = new Date()): Promise<BilanCollecte & { erreursFichier: string[] }> {
  if (contenu.length > 5_000_000) throw new ErreurImport('Fichier trop volumineux (5 Mo au plus).');
  const source = await sourceParCode('fichier-partenaire');
  if (!source) throw new ErreurImport('Source « fichier partenaire » absente : lancez « npm run db:initialiser ».');
  if (source.collection_mode === 'desactive') throw new ErreurImport('L’import de fichiers est désactivé par l’administrateur.');
  const lecture = analyserFichier(contenu, nomFichier);
  if (lecture.offres.length === 0) return { ...bilanVide('echec', lecture.erreurs[0] ?? 'Aucune offre lisible dans le fichier.'), erreursFichier: lecture.erreurs };
  const runId = await ouvrirExecution(source.id, 'import', acteur, maintenant);
  if (!runId) throw new ErreurImport('Un import de fichier est déjà en cours.');
  const bilan: BilanCollecte = { ...bilanVide('succes', ''), runId };
  const parametres = await chargerParametres();
  await traiterOffres(lecture.offres, source, bilan, { runId, maintenant, parametres, acteur, politique: politique(source), origine: 'saisie' });
  bilan.erreurs += lecture.erreurs.length;
  bilan.statut = bilan.erreurs > 0 ? 'partiel' : 'succes';
  bilan.message = `${compter(bilan.nouvelles, 'nouvelle')}, ${compter(bilan.misesAJour, 'mise')} à jour, ${compter(bilan.inchangees, 'inchangée')}, ${compter(bilan.doublons, 'doublon')}, ${compter(bilan.rejetees, 'écartée')}, ${compter(lecture.erreurs.length, 'ligne')} ${accord(lecture.erreurs.length, 'illisible')}.`;
  await fermerExecution(bilan, { fichier: nomFichier.slice(0, 120), lignesIllisibles: lecture.erreurs.slice(0, 20) });
  await executer(`UPDATE job_sources SET last_run_at = $2, last_success_at = $2 WHERE id = $1`, [source.id, maintenant]);
  await journaliser({ acteur, action: 'offre.import_fichier', entite: 'source', id: source.id, resume: `Import du fichier « ${nomFichier.slice(0, 80)} »`, changements: { message: bilan.message } });
  return { ...bilan, erreursFichier: lecture.erreurs };
}
