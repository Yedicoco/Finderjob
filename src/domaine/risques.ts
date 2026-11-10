/**
 * Score de risque d'une annonce (0 à 100) : fraude, incohérence, illégalité.
 *
 * Additif et explicable : chaque signal a un poids fixe et un libellé affiché
 * au courtier. Niveaux : faible < 25, modéré 25–49, élevé ≥ 50. Un risque élevé
 * rend l'offre « douteuse » et impose une vérification humaine.
 *
 * Ce score ne « prouve » rien : il attire l'attention. La décision reste humaine.
 */
import type { Extraction } from './extraction';
import type { Parametres } from './parametres';
import { preparer } from './texte';

export type CodeSignal =
  | 'frais_demandes'
  | 'travail_mineur'
  | 'contenu_suspect'
  | 'criteres_discriminatoires'
  | 'salaire_sous_minimum'
  | 'salaire_bas'
  | 'salaire_eleve'
  | 'devise_etrangere'
  | 'date_manquante'
  | 'ville_manquante'
  | 'employeur_anonyme';

export type Signal = { code: CodeSignal; poids: number; libelle: string; extrait?: string };
export type NiveauRisque = 'faible' | 'modere' | 'eleve';
export type DrapeauSalaire = 'normal' | 'bas' | 'sous_minimum_legal' | 'eleve' | null;

export type EvaluationRisque = {
  score: number;
  niveau: NiveauRisque;
  signaux: Signal[];
  drapeauSalaire: DrapeauSalaire;
};

export const POIDS_SIGNAUX: Record<CodeSignal, number> = {
  frais_demandes: 60,
  travail_mineur: 70,
  contenu_suspect: 60,
  criteres_discriminatoires: 25,
  salaire_sous_minimum: 35,
  salaire_bas: 25,
  salaire_eleve: 20,
  devise_etrangere: 15,
  date_manquante: 15,
  ville_manquante: 10,
  employeur_anonyme: 10,
};

export const LIBELLES_SIGNAUX: Record<CodeSignal, string> = {
  frais_demandes: 'L’annonce demande de l’argent au candidat (frais, caution, avance)',
  travail_mineur: 'L’annonce vise une personne de moins de 18 ans',
  contenu_suspect: 'Formulation typique d’une arnaque ou d’une activité illicite',
  criteres_discriminatoires: 'Critère possiblement discriminatoire (origine, religion, situation familiale, apparence) : à ne pas relayer',
  salaire_sous_minimum: 'Salaire annoncé inférieur au minimum légal de référence',
  salaire_bas: 'Salaire annoncé anormalement bas',
  salaire_eleve: 'Salaire annoncé anormalement élevé pour ce type de poste',
  devise_etrangere: 'Salaire exprimé dans une devise étrangère',
  date_manquante: 'Date de publication inconnue',
  ville_manquante: 'Ville non précisée',
  employeur_anonyme: 'Employeur non identifié',
};

const NEGATION_AVANT = /(?:sans|aucuns?|aucune|pas de|ni|zero|0|jamais de|بدون|لا توجد|دون)\s+(?:\S+\s+)?$/;

const MOTIFS_FRAIS: RegExp[] = [
  /frais\s+(?:de\s+|d')(?:dossier|inscription|traitement|visa|formation|placement|candidature|recrutement|uniforme|tenue)/g,
  /(?:verser|payer|envoyer|regler|deposer)\s+[^.\n]{0,40}?\d[\d .]*\s*(?:dhs?|mad|dirhams?)\b/g,
  /(?:virement|transfert|versement|paiement|mandat)\s+(?:de\s+)?\d[\d .]*\s*(?:dhs?|mad|dirhams?)\b/g,
  /\bcaution\s+(?:de\s+|:\s*)?\d/g,
  /paiement\s+(?:a l'avance|d'avance|prealable|avant)/g,
  /(?:wafacash|cash\s?plus|western union|moneygram)/g,
  /رسوم\s+(?:التسجيل|الملف|التكوين)/g,
  /(?:دفع|ارسال|تحويل)\s+مبلغ/g,
  /تسبيق/g,
];

const MOTIFS_MINEUR: RegExp[] = [
  /petites?\s+bonnes?/,
  /mineure?s?\s+acceptee?s?/,
  /a\s+partir\s+de\s+1[0-7]\s*ans\b/,
  /age\s+(?:minimum|min\.?|requis)?\s*:?\s*1[0-7]\s*ans\b/,
  /entre\s+1[0-7]\s+et\s+\d{2}\s*ans\b/,
  /\bde\s+1[0-7]\s+a\s+\d{2}\s*ans\b/,
  /moins\s+de\s+18\s*ans\s+accepte/,
  /خادمه\s+صغيره|قاصر(?:ه|ات)?\s+للعمل|فتاه\s+قاصر/,
];

const MOTIFS_SUSPECTS: RegExp[] = [
  /massages?\s+(?:erotique|sensuel|naturiste|tantrique|body)/,
  /\bescort/,
  /sans\s+tabou/,
  /argent\s+facile|gains?\s+rapides?|revenus?\s+garantis?|devenez\s+riche|gagnez\s+jusqu'a/,
  /investissement\s+(?:minimum|de depart|initial)/,
  /marketing\s+de\s+reseau|\bmlm\b|parrainage\s+obligatoire/,
  /(?:remise|depot|confiscation|retenue)\s+du\s+passeport|passeport\s+(?:sera\s+)?(?:conserve|retenu|garde)/,
  /ربح\s+سريع|اربح\s+من\s+منزلك|دخل\s+مضمون/,
];

const MOTIFS_DISCRIMINATION: RegExp[] = [
  /nationalite\s+\S+\s+(?:exigee|obligatoire|uniquement|requise)/,
  /\b(?:marocaine?s?|subsaharienne?s?|africaine?s?|philippine?s?|europeenne?s?|etrangere?s?)\s+(?:uniquement|seulement|exclusivement|de preference)/,
  /\b(?:uniquement|seulement|exclusivement)\s+(?:des?\s+)?(?:marocaine?s?|subsaharienne?s?|africaine?s?|philippine?s?|etrangere?s?)\b/,
  /\bpas\s+(?:de\s+|d')(?:subsaharien|africain|etranger|marocain)/,
  /\b(?:musulmane?s?|chretienne?s?|voilee?s?|non\s+voilee?s?)\s+(?:uniquement|seulement|exigee?|de preference|obligatoire)/,
  /\b(?:celibataires?|non\s+mariee?s?|sans\s+enfants?|divorcee?s?|veuves?)\s+(?:uniquement|seulement|exigee?|de preference|obligatoire|souhaitee?)/,
  /\b(?:celibataire|sans\s+enfants?)\s+(?:et\s+)?(?:sans\s+engagement|libre)/,
  /\b(?:belle|jolie|tres\s+belle|physique\s+agreable|belle\s+apparence|taille\s+mannequin)\b/,
  /غير\s+متزوجه|بدون\s+اطفال|جميله\s+المظهر/,
];

function premierMotif(texte: string, motifs: RegExp[], refuserNegation = false): string | undefined {
  for (const motif of motifs) {
    if (motif.global) {
      for (const trouve of texte.matchAll(motif)) {
        if (refuserNegation && NEGATION_AVANT.test(texte.slice(Math.max(0, trouve.index - 28), trouve.index))) continue;
        return trouve[0];
      }
    } else {
      const trouve = motif.exec(texte);
      if (trouve) return trouve[0];
    }
  }
  return undefined;
}

/** Drapeau « salaire anormal » (affiché même hors calcul du risque). */
export function evaluerSalaire(
  salaire: Extraction['salaire'],
  tempsTravail: Extraction['tempsTravail'],
  parametres: Parametres['salaires'],
): DrapeauSalaire {
  if (salaire.min === null || salaire.periode === null || salaire.mensuelEstime === null) return null;
  // Période devinée sur un petit montant : trop incertain pour juger.
  if (salaire.periodeDeduite && salaire.min < 1000) return null;
  const reference = salaire.max ?? salaire.min;
  if (salaire.periode === 'jour') {
    if (reference < parametres.seuilBasJournalier) return 'bas';
    if (salaire.min > parametres.seuilEleveJournalier) return 'eleve';
    return 'normal';
  }
  if (salaire.periode === 'heure') return 'normal';
  const mensuel = salaire.periode === 'mois' ? reference : salaire.mensuelEstime;
  const mensuelMin = salaire.periode === 'mois' ? salaire.min : salaire.mensuelEstime;
  if (mensuelMin > parametres.seuilEleveMensuel) return 'eleve';
  // Un temps partiel ou quelques heures par semaine peut légitimement être sous les seuils mensuels.
  if (tempsTravail === 'temps_partiel' || tempsTravail === 'week_end') return 'normal';
  if (mensuel < parametres.plancherDomestiqueMensuel) return 'sous_minimum_legal';
  if (mensuel < parametres.seuilBasMensuel) return 'bas';
  return 'normal';
}

export function niveauRisque(score: number, seuils: Parametres['risque']): NiveauRisque {
  if (score >= seuils.seuilEleve) return 'eleve';
  if (score >= seuils.seuilModere) return 'modere';
  return 'faible';
}

export function evaluerRisque(entree: {
  titre: string;
  texte: string;
  extraction: Pick<Extraction, 'salaire' | 'tempsTravail'>;
  villeConnue: boolean;
  employeurConnu: boolean;
  dateConnue: boolean;
  parametres: Pick<Parametres, 'salaires' | 'risque'>;
}): EvaluationRisque {
  const texte = preparer(`${entree.titre}\n${entree.texte}`);
  const signaux: Signal[] = [];
  const ajouter = (code: CodeSignal, extrait?: string) =>
    signaux.push({ code, poids: POIDS_SIGNAUX[code], libelle: LIBELLES_SIGNAUX[code], ...(extrait ? { extrait: extrait.slice(0, 80) } : {}) });

  const frais = premierMotif(texte, MOTIFS_FRAIS, true);
  if (frais) ajouter('frais_demandes', frais);
  const mineur = premierMotif(texte, MOTIFS_MINEUR);
  if (mineur) ajouter('travail_mineur', mineur);
  const suspect = premierMotif(texte, MOTIFS_SUSPECTS);
  if (suspect) ajouter('contenu_suspect', suspect);
  const discrimination = premierMotif(texte, MOTIFS_DISCRIMINATION);
  if (discrimination) ajouter('criteres_discriminatoires', discrimination);

  const drapeauSalaire = evaluerSalaire(entree.extraction.salaire, entree.extraction.tempsTravail, entree.parametres.salaires);
  if (drapeauSalaire === 'sous_minimum_legal') ajouter('salaire_sous_minimum', entree.extraction.salaire.texte ?? undefined);
  if (drapeauSalaire === 'bas') ajouter('salaire_bas', entree.extraction.salaire.texte ?? undefined);
  if (drapeauSalaire === 'eleve') ajouter('salaire_eleve', entree.extraction.salaire.texte ?? undefined);
  if (entree.extraction.salaire.deviseEtrangere) ajouter('devise_etrangere', entree.extraction.salaire.deviseEtrangere);

  if (!entree.dateConnue) ajouter('date_manquante');
  if (!entree.villeConnue) ajouter('ville_manquante');
  if (!entree.employeurConnu) ajouter('employeur_anonyme');

  const score = Math.min(100, signaux.reduce((total, signal) => total + signal.poids, 0));
  return { score, niveau: niveauRisque(score, entree.parametres.risque), signaux, drapeauSalaire };
}
