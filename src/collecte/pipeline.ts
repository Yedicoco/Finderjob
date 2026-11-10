/**
 * Pipeline d'analyse : annonce brute → offre qualifiée, ou rejet motivé.
 *
 *   1. pays          hors Maroc → rejet (rien n'est conservé)
 *   2. métier        hors taxonomie → rejet pour une source automatisée
 *   3. extraction    salaire, contrat, expérience, langues, logement, dates…
 *   4. lieu          ville, quartier, région
 *   5. risque        signaux de fraude ou d'illégalité
 *   6. statut        actif / expiré / douteux / archivé + besoin de revue humaine
 *   7. scores        fraîcheur, qualité, pertinence, indice de placement
 *   8. conservation  ce que la source autorise à garder (extrait, texte, contacts)
 *
 * Fonction pure : aucune base, aucun réseau. Même entrée, même sortie.
 */
import { classer } from '@/domaine/classification';
import { empreinte, empreinteContenu, normaliserEmployeur, urlCanonique } from '@/domaine/doublons';
import { extraire, masquerContacts, mensualiser, niveauExperience, type Contrat, type Extraction, type PrecisionDate, type TempsTravail, type TypeEmployeur } from '@/domaine/extraction';
import { detecterLieu, evaluerPays, villeParCode } from '@/domaine/geographie';
import type { Parametres } from '@/domaine/parametres';
import { COMPETENCES, CONTRATS, TEMPS_TRAVAIL, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { evaluerRisque, type Signal } from '@/domaine/risques';
import { indicePlacement, scoreFraicheur, scorePertinence, scoreQualite, type LigneScore } from '@/domaine/scores';
import { statutInitial, type MotifStatut, type StatutOffre, type StatutVerification } from '@/domaine/statuts';
import { motsClesRecherche } from '@/domaine/taxonomie';
import { cle, contient, detecterLangue, normaliserTexte, tronquer, type Langue } from '@/domaine/texte';
import type { ModeCollecte, MotifRejet, OffreBrute, TypeSource } from './types';

export type PolitiqueSource = {
  kind: TypeSource;
  collection_mode: ModeCollecte;
  max_excerpt_chars: number;
  store_contacts: boolean;
  keep_unclassified: boolean;
  country_default: string | null;
  reliability_score: number;
};

/** Compléments proposés par un modèle de langage (facultatif, jamais prioritaire sur les règles). */
export type ComplementIA = {
  resume?: string | null;
  employeur?: string | null;
  contrat?: string | null;
  tempsTravail?: string | null;
  experienceAnnees?: number | null;
  langues?: string[];
  logement?: 'loge' | 'non_loge' | null;
  nombrePostes?: number | null;
};

export type CategorieOffre = { code: string; confiance: number; principal: boolean };

export type OffreAnalysee = {
  source_external_id: string;
  source_url: string | null;
  canonical_url: string | null;
  title: string;
  title_normalized: string;
  employer_name: string | null;
  employer_normalized: string | null;
  employer_type_guess: TypeEmployeur | null;
  description_excerpt: string | null;
  description_full: string | null;
  ai_summary: string | null;
  content_language: Langue;
  city_code: string | null;
  city_label: string | null;
  district: string | null;
  region: string | null;
  categories: CategorieOffre[];
  sector_code: string | null;
  classification_confidence: number | null;
  contract_type: Contrat;
  work_time: TempsTravail;
  work_mode: Extraction['modeTravail'];
  salary_min: number | null;
  salary_max: number | null;
  salary_period: 'mois' | 'semaine' | 'jour' | 'heure' | null;
  salary_text: string | null;
  salary_monthly_estimate: number | null;
  salary_flag: 'normal' | 'bas' | 'sous_minimum_legal' | 'eleve' | null;
  experience_min_years: number | null;
  experience_level: Extraction['experience']['niveau'];
  languages: string[];
  driving_license: boolean | null;
  housing: 'loge' | 'non_loge' | null;
  meals_provided: boolean | null;
  schedule_text: string | null;
  availability_text: string | null;
  headcount: number | null;
  is_urgent: boolean;
  is_bulk_hiring: boolean;
  has_contact_in_source: boolean;
  /** En clair ici ; chiffrés par la couche serveur avant écriture. null si la source n'autorise pas leur conservation. */
  contact_phone: string | null;
  contact_email: string | null;
  published_at: Date | null;
  date_precision: PrecisionDate;
  source_updated_at: Date | null;
  expires_at: Date | null;
  status: StatutOffre;
  status_reason: MotifStatut;
  verification_status: StatutVerification;
  requires_human_review: boolean;
  fingerprint: string;
  content_hash: string;
  relevance_score: number;
  freshness_score: number;
  quality_score: number;
  risk_score: number;
  placement_score: number;
  risk_flags: string[];
  score_details: {
    risque: Signal[];
    pertinence: LigneScore[];
    qualite: LigneScore[];
    placement: LigneScore[];
    classification: string[];
    pays: string;
    /** Composantes de l'indice de placement qui ne se relisent pas dans les colonnes (pour le recalcul quotidien). */
    composantes: { joignabilite: number; candidats: number | null };
  };
  extraction_method: 'regles' | 'mixte' | 'manuel';
  search_keywords: string;
  competences: string[];
};

export type ResultatAnalyse = { type: 'offre'; offre: OffreAnalysee } | { type: 'rejet'; motif: MotifRejet; detail: string };

export type ContexteAnalyse = { maintenant: Date; parametres: Parametres; complementIA?: ComplementIA | null };

const estAutomatisee = (kind: TypeSource) => kind === 'rss' || kind === 'sitemap' || kind === 'api';

function competencesDans(texte: string): string[] {
  const cleTexte = cle(texte);
  return COMPETENCES.filter((competence) => competence.cles.some((expression) => contient(cleTexte, cle(expression)))).map((competence) => competence.code);
}

export function analyserOffre(brute: OffreBrute, source: PolitiqueSource, contexte: ContexteAnalyse): ResultatAnalyse {
  const { maintenant, parametres } = contexte;
  const titre = brute.titre.replace(/\s+/g, ' ').trim();
  const texte = brute.texte.replace(/\r\n?/g, '\n').trim();
  if (titre.length < 3) return { type: 'rejet', motif: 'contenu_vide', detail: 'titre absent' };

  // 1. Pays --------------------------------------------------------------------
  const pays = evaluerPays({ titre, texte, paysStructure: brute.pays ?? null, lieuStructure: brute.lieu ?? brute.champs?.ville ?? null });
  if (pays.pays === 'etranger') {
    return { type: 'rejet', motif: 'hors_maroc', detail: `${pays.motif}${pays.lieuEtranger ? ` (${pays.lieuEtranger})` : ''}` };
  }
  const extraction = extraire(titre, texte, maintenant);
  if (extraction.salaire.deviseEtrangere && pays.pays === 'inconnu' && estAutomatisee(source.kind)) {
    return { type: 'rejet', motif: 'hors_maroc', detail: `salaire en ${extraction.salaire.deviseEtrangere}, aucun lieu marocain` };
  }
  // Une source déclarée 100 % marocaine situe l'offre au Maroc même sans ville reconnue.
  const paysRetenu: 'MA' | 'inconnu' = pays.pays === 'MA' || source.country_default === 'MA' ? 'MA' : 'inconnu';

  // 2. Métier ------------------------------------------------------------------
  const classement = classer(titre, texte, { confianceMin: parametres.classification.confianceMin });
  if (!classement.principal && estAutomatisee(source.kind) && !source.keep_unclassified) {
    return { type: 'rejet', motif: 'hors_taxonomie', detail: 'aucun métier de la taxonomie Yallah reconnu' };
  }

  // 3. Champs : la donnée structurée de la source prime, puis les règles, puis l'IA.
  const champs = brute.champs ?? {};
  const ia = contexte.complementIA ?? null;
  let methode: OffreAnalysee['extraction_method'] = source.kind === 'manuel' ? 'manuel' : 'regles';
  const depuisIA = <T,>(valeurRegles: T | null, valeurIA: T | null | undefined, vide: (v: T | null) => boolean): T | null => {
    if (!vide(valeurRegles) || valeurIA === null || valeurIA === undefined) return valeurRegles;
    methode = 'mixte';
    return valeurIA;
  };

  const contratStructure = champs.contrat && CONTRATS.est(champs.contrat) ? champs.contrat : null;
  const contratIA = ia?.contrat && CONTRATS.est(ia.contrat) ? ia.contrat : null;
  const contrat = (contratStructure ?? depuisIA(extraction.contrat, contratIA, (v) => v === null || v === 'non_precise') ?? 'non_precise') as Contrat;
  const tempsStructure = champs.tempsTravail && TEMPS_TRAVAIL.est(champs.tempsTravail) ? champs.tempsTravail : null;
  const tempsIA = ia?.tempsTravail && TEMPS_TRAVAIL.est(ia.tempsTravail) ? ia.tempsTravail : null;
  const tempsTravail = (tempsStructure ?? depuisIA(extraction.tempsTravail, tempsIA, (v) => v === null || v === 'non_precise') ?? 'non_precise') as TempsTravail;

  let salaire = extraction.salaire;
  if (champs.salaireMin && (!champs.devise || champs.devise.toUpperCase() === 'MAD')) {
    const periode = champs.periodeSalaire ?? (champs.salaireMin >= 1000 ? 'mois' : champs.salaireMin >= 100 ? 'jour' : 'heure');
    // Un maximum inférieur au minimum est une erreur de saisie : on l'ignore plutôt que d'inventer une fourchette.
    const salaireMax = champs.salaireMax && champs.salaireMax > champs.salaireMin ? champs.salaireMax : null;
    const reference = salaireMax ? (champs.salaireMin + salaireMax) / 2 : champs.salaireMin;
    salaire = {
      min: champs.salaireMin,
      max: salaireMax,
      periode,
      periodeDeduite: !champs.periodeSalaire,
      texte: `${champs.salaireMin}${salaireMax ? ` – ${salaireMax}` : ''} MAD (donnée structurée de la source)`,
      mensuelEstime: mensualiser(reference, periode),
      deviseEtrangere: null,
    };
  } else if (champs.devise && champs.devise.toUpperCase() !== 'MAD' && champs.salaireMin) {
    salaire = { ...salaire, deviseEtrangere: champs.devise.toUpperCase() };
  }

  const experienceAnnees = depuisIA(extraction.experience.anneesMin, ia?.experienceAnnees, (v) => v === null);
  const langues = extraction.langues.length > 0 ? extraction.langues : (ia?.langues ?? []).filter((langue) => ['darija', 'ar', 'fr', 'en', 'amazigh', 'es', 'de', 'it'].includes(langue));
  if (extraction.langues.length === 0 && langues.length > 0) methode = 'mixte';
  const logement = champs.logement ?? depuisIA(extraction.logement, ia?.logement, (v) => v === null);
  const nombrePostes = champs.nombrePostes ?? depuisIA(extraction.nombrePostes, ia?.nombrePostes, (v) => v === null);
  const massif = extraction.recrutementMassif || (nombrePostes !== null && nombrePostes >= 5);
  const urgent = champs.urgent === true || extraction.urgent;

  const employeurNom = (brute.employeur ?? depuisIA<string>(null, ia?.employeur, (v) => v === null))?.replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const typeStructure = champs.typeEmployeur && TYPES_EMPLOYEUR.est(champs.typeEmployeur) ? (champs.typeEmployeur as TypeEmployeur) : null;
  const typeEmployeur = typeStructure ?? extraction.typeEmployeur;

  // 4. Lieu --------------------------------------------------------------------
  const lieu = detecterLieu(titre, texte, [champs.ville, brute.lieu].filter(Boolean).join(', '));
  const ville = (champs.ville ? villeParCode(champs.ville) : undefined) ?? lieu.ville;
  const quartier = champs.quartier?.trim() || lieu.quartier;

  // 5. Dates -------------------------------------------------------------------
  const publieLe = brute.publieLe ?? extraction.dates.publication;
  const precisionDate: PrecisionDate = brute.publieLe ? (brute.precisionDate ?? 'exacte') : extraction.dates.publication ? extraction.dates.precision : 'inconnue';
  const expireLe = brute.expireLe ?? extraction.dates.expiration;

  // 6. Risque et statut ----------------------------------------------------------
  const risque = evaluerRisque({
    titre,
    texte,
    extraction: { salaire, tempsTravail },
    villeConnue: Boolean(ville),
    employeurConnu: Boolean(employeurNom),
    dateConnue: Boolean(publieLe) && precisionDate !== 'inconnue',
    parametres,
  });
  const criteresDiscriminatoires = risque.signaux.some((signal) => signal.code === 'criteres_discriminatoires');
  const decision = statutInitial({
    publieLe,
    precisionDate,
    expireLe,
    pays: paysRetenu,
    villeConnue: Boolean(ville),
    scoreRisque: risque.score,
    estDoublonDe: false,
    revueDemandee: pays.aVerifier === true || criteresDiscriminatoires || !classement.principal,
    maintenant,
    parametres,
  });

  // 7. Conservation selon la politique de la source ------------------------------
  const contactsAutorises = source.store_contacts;
  const texteConservable = contactsAutorises ? texte : masquerContacts(texte);
  const garderTexte = source.collection_mode === 'texte_complet';
  const garderExtrait = source.collection_mode !== 'index_liens' && source.collection_mode !== 'desactive';
  const extrait = garderExtrait && texteConservable ? tronquer(texteConservable, garderTexte ? Math.max(source.max_excerpt_chars, 300) : source.max_excerpt_chars) || null : null;
  const horaires = garderExtrait ? extraction.horaires : null;
  const disponibilite = garderExtrait ? extraction.disponibilite : null;

  // 8. Scores ------------------------------------------------------------------
  const expiree = decision.statut === 'expire';
  const fraicheur = scoreFraicheur(publieLe, maintenant, parametres.offres.demiVieFraicheurJours, expiree);
  const joignable = Boolean(brute.url) || (contactsAutorises && (extraction.contacts.telephones.length > 0 || extraction.contacts.emails.length > 0));
  const qualite = scoreQualite({
    longueurDescription: texte.length,
    ville: Boolean(ville),
    quartier: Boolean(quartier),
    employeur: Boolean(employeurNom),
    salaire: salaire.min !== null,
    contrat: contrat !== 'non_precise',
    precisionDate,
    experience: experienceAnnees !== null,
    rythme: tempsTravail !== 'non_precise' || Boolean(extraction.horaires),
    joignable,
    fiabiliteSource: source.reliability_score,
  });
  const pertinence = scorePertinence({
    metier: classement.principal?.code ?? null,
    confianceMetier: classement.principal?.confiance ?? 0,
    ville: ville?.code ?? null,
    typeEmployeur,
    contrat,
    urgent,
    massif,
    salaireAffiche: salaire.min !== null,
    salaireAnormal: risque.drapeauSalaire !== null && risque.drapeauSalaire !== 'normal',
    scoreRisque: risque.score,
    seuilRisqueEleve: parametres.risque.seuilEleve,
  });
  const contactDirect = contactsAutorises && (extraction.contacts.telephones.length > 0 || extraction.contacts.emails.length > 0);
  const joignabilite = contactDirect ? 100 : brute.url ? 50 : 0;
  const placement = indicePlacement({ pertinence: pertinence.score, fraicheur, qualite: qualite.score, candidatsDisponibles: null, joignabilite });

  const canonique = urlCanonique(brute.url);
  const codes = classement.categories.map((categorie) => categorie.code);
  const offre: OffreAnalysee = {
    source_external_id: brute.idExterne.slice(0, 500),
    source_url: canonique ? brute.url : null,
    canonical_url: canonique,
    title: titre.slice(0, 300),
    title_normalized: normaliserTexte(titre).slice(0, 300),
    employer_name: employeurNom,
    employer_normalized: employeurNom ? normaliserEmployeur(employeurNom) : null,
    employer_type_guess: typeEmployeur,
    description_excerpt: extrait,
    description_full: garderTexte && texteConservable ? texteConservable.slice(0, 20_000) : null,
    ai_summary: garderExtrait && ia?.resume ? tronquer(masquerContacts(ia.resume), 400) : null,
    content_language: detecterLangue(`${titre}\n${texte}`),
    city_code: ville?.code ?? null,
    city_label: ville?.nom ?? null,
    district: quartier ?? null,
    region: ville?.region ?? lieu.region,
    categories: classement.categories.map((categorie, index) => ({ code: categorie.code, confiance: categorie.confiance, principal: index === 0 })),
    sector_code: classement.secteur,
    classification_confidence: classement.principal?.confiance ?? null,
    contract_type: contrat,
    work_time: tempsTravail,
    work_mode: extraction.modeTravail,
    salary_min: salaire.min,
    salary_max: salaire.max,
    salary_period: salaire.periode,
    salary_text: salaire.texte ? tronquer(masquerContacts(salaire.texte), 120) : null,
    salary_monthly_estimate: salaire.mensuelEstime,
    salary_flag: risque.drapeauSalaire,
    experience_min_years: experienceAnnees,
    experience_level: niveauExperience(experienceAnnees),
    languages: langues,
    driving_license: extraction.permis,
    housing: logement,
    meals_provided: extraction.repas,
    schedule_text: horaires ? tronquer(horaires, 160) : null,
    availability_text: disponibilite ? tronquer(disponibilite, 160) : null,
    headcount: nombrePostes,
    is_urgent: urgent,
    is_bulk_hiring: massif,
    has_contact_in_source: extraction.contacts.telephones.length > 0 || extraction.contacts.emails.length > 0 || extraction.contacts.whatsapp,
    contact_phone: contactsAutorises ? (extraction.contacts.telephones[0] ?? null) : null,
    contact_email: contactsAutorises ? (extraction.contacts.emails[0] ?? null) : null,
    published_at: publieLe,
    date_precision: precisionDate,
    source_updated_at: brute.majLe ?? null,
    expires_at: expireLe,
    status: decision.statut,
    status_reason: decision.motif,
    verification_status: decision.verification,
    requires_human_review: decision.revueHumaine,
    fingerprint: empreinte({ titre, employeur: employeurNom, ville: ville?.code ?? null }),
    content_hash: '',
    relevance_score: pertinence.score,
    freshness_score: fraicheur,
    quality_score: qualite.score,
    risk_score: risque.score,
    placement_score: placement.score,
    risk_flags: risque.signaux.map((signal) => signal.code),
    score_details: {
      risque: risque.signaux,
      pertinence: pertinence.lignes,
      qualite: qualite.lignes,
      placement: placement.lignes,
      classification: classement.principal?.indices ?? [],
      pays: pays.motif,
      composantes: { joignabilite, candidats: null },
    },
    extraction_method: methode,
    search_keywords: motsClesRecherche(codes),
    competences: competencesDans(`${titre}\n${texte}`),
  };
  // Empreinte de contenu : ce qui, s'il change, mérite une nouvelle version.
  offre.content_hash = empreinteContenu({
    titre: offre.title,
    employeur: offre.employer_normalized,
    ville: offre.city_code,
    quartier: offre.district,
    salaireMin: offre.salary_min,
    salaireMax: offre.salary_max,
    periode: offre.salary_period,
    contrat: offre.contract_type,
    temps: offre.work_time,
    expire: offre.expires_at?.toISOString() ?? null,
    publie: offre.published_at?.toISOString().slice(0, 10) ?? null,
    postes: offre.headcount,
    urgent: offre.is_urgent,
    texte: normaliserTexte(texte).slice(0, 4000),
  });
  return { type: 'offre', offre };
}
