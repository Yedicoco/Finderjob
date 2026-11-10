/**
 * Détection des doublons : la même offre publiée sur plusieurs sites, republiée,
 * ou publiée en français et en arabe.
 *
 *   1. Empreinte exacte   mots significatifs du titre + employeur + ville.
 *   2. Similarité (0–1)   titre 45 % · employeur 20 % · ville 15 % · date 10 % · métier 10 %.
 *                         ≥ 0,82 : doublon rattaché automatiquement
 *                         0,65 – 0,82 : doublon probable, signalé au courtier
 *                         Sans employeur commun, le score est plafonné à 0,80
 *                         sauf si les textes des deux annonces sont très proches.
 *   3. Deux langues       le titre ne se compare pas : même métier + même
 *                         employeur + même ville + dates proches.
 */
import { jaccard, normaliserTexte, sha256, tokeniser } from './texte';

const MOTS_VIDES = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'ou', 'a', 'au', 'aux', 'en', 'pour', 'sur', 'd', 'l', 'h', 'f', 'hf', 'fh',
  'urgent', 'urgente', 'recrute', 'recrutement', 'recherche', 'recherchon', 'cherche', 'cherchon', 'offre', 'emploi', 'poste', 'besoin',
  'job', 'hiring', 'wanted', 'the', 'for', 'and', 'in', 'at', 'مطلوب', 'مطلوبه', 'عاجل', 'في', 'عن', 'من', 'الي', 'تبحث', 'نبحث', 'يبحث',
]);

/** Mots significatifs d'un titre (sans mots vides, sans doublons). */
export function motsSignificatifs(titre: string): string[] {
  return [...new Set(tokeniser(titre).filter((mot) => mot.length > 1 && !MOTS_VIDES.has(mot)))];
}

const FORMES_JURIDIQUES = /\b(?:sarl|sa|sas|sarlau|ste|societe|groupe|group|cie|compagnie|the|hotel|riad|spa|salon|famille)\b/g;

/** Nom d'employeur normalisé pour comparaison (« Hôtel Atlas SARL » → « atlas »). */
export function normaliserEmployeur(nom: string | null | undefined): string {
  if (!nom) return '';
  const normalise = normaliserTexte(nom);
  const sansForme = normalise.replace(FORMES_JURIDIQUES, ' ').replace(/\s+/g, ' ').trim();
  return sansForme || normalise;
}

export function empreinte(entree: { titre: string; employeur?: string | null; ville?: string | null }): string {
  const mots = motsSignificatifs(entree.titre).sort().join(' ');
  return sha256(`${mots}|${normaliserEmployeur(entree.employeur)}|${entree.ville ?? ''}`);
}

/** Empreinte du contenu : sert à savoir si une offre déjà connue a changé. */
export function empreinteContenu(champs: Record<string, unknown>): string {
  const cles = Object.keys(champs).sort();
  return sha256(JSON.stringify(cles.map((cle) => [cle, champs[cle] ?? null])));
}

/** URL canonique : sans fragment, sans paramètres de suivi, sans « www. », sans barre finale. */
export function urlCanonique(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    for (const cle of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|source$|src$|from$)/i.test(cle)) u.searchParams.delete(cle);
    }
    u.searchParams.sort();
    const hote = u.hostname.toLowerCase().replace(/^www\./, '');
    const chemin = u.pathname.replace(/\/+$/, '') || '/';
    const requete = u.searchParams.toString();
    return `https://${hote}${chemin}${requete ? `?${requete}` : ''}`;
  } catch {
    return null;
  }
}

export type OffreComparable = {
  titre: string;
  employeur: string | null;
  ville: string | null;
  metier: string | null;
  publieLe: Date | null;
  langue: string;
  salaireMin?: number | null;
  urlCanonique?: string | null;
  /** Extrait ou texte de l'annonce, s'il est conservé. */
  description?: string | null;
};

export type ResultatSimilarite = { score: number; raisons: string[] };

const JOUR_MS = 86_400_000;

function ecartJours(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.abs(a.getTime() - b.getTime()) / JOUR_MS;
}

export function similarite(a: OffreComparable, b: OffreComparable): ResultatSimilarite {
  const raisons: string[] = [];
  if (a.urlCanonique && b.urlCanonique && a.urlCanonique === b.urlCanonique) {
    return { score: 1, raisons: ['même adresse d’annonce'] };
  }
  const employeurA = normaliserEmployeur(a.employeur);
  const employeurB = normaliserEmployeur(b.employeur);
  const memeEmployeur = employeurA !== '' && employeurA === employeurB;
  const employeursDifferents = employeurA !== '' && employeurB !== '' && employeurA !== employeurB;
  const memeVille = a.ville !== null && a.ville === b.ville;
  const villesDifferentes = a.ville !== null && b.ville !== null && a.ville !== b.ville;
  const memeMetier = a.metier !== null && a.metier === b.metier;
  const ecart = ecartJours(a.publieLe, b.publieLe);

  // Deux villes différentes ou deux employeurs différents : ce sont deux offres.
  if (villesDifferentes || employeursDifferents) return { score: 0, raisons: [] };

  // Même annonce dans deux langues.
  if (a.langue !== b.langue && memeMetier && memeVille) {
    if (memeEmployeur && ecart !== null && ecart <= 3) {
      return { score: 0.86, raisons: ['même métier, même employeur, même ville, dates proches (langues différentes)'] };
    }
    const memeSalaire = a.salaireMin != null && a.salaireMin === b.salaireMin;
    if (!employeurA && !employeurB && memeSalaire && ecart !== null && ecart <= 1) {
      return { score: 0.7, raisons: ['même métier, même ville, même salaire, même jour (langues différentes)'] };
    }
  }

  const titre = jaccard(motsSignificatifs(a.titre), motsSignificatifs(b.titre));
  if (titre >= 0.99) raisons.push('même titre');
  else if (titre >= 0.6) raisons.push('titres très proches');
  const employeur = memeEmployeur ? 1 : 0.4;
  if (memeEmployeur) raisons.push('même employeur');
  const ville = memeVille ? 1 : 0.4;
  if (memeVille) raisons.push('même ville');
  const date = ecart === null ? 0.3 : ecart <= 3 ? 1 : ecart <= 14 ? 0.6 : ecart <= 30 ? 0.3 : 0;
  if (ecart !== null && ecart <= 3) raisons.push('dates proches');
  const metier = memeMetier ? 1 : a.metier === null || b.metier === null ? 0.4 : 0;

  let score = titre * 0.45 + employeur * 0.2 + ville * 0.15 + date * 0.1 + metier * 0.1;

  // Sans employeur commun, un titre générique (« Femme de ménage ») ne suffit
  // pas : deux familles différentes publient la même phrase le même jour. Il
  // faut alors des textes très proches pour rattacher automatiquement.
  const motsA = a.description ? motsSignificatifs(a.description) : [];
  const motsB = b.description ? motsSignificatifs(b.description) : [];
  const textes = motsA.length >= 8 && motsB.length >= 8 ? jaccard(motsA, motsB) : null;
  if (textes !== null && textes >= 0.8 && !villesDifferentes) {
    score = Math.max(score, 0.9);
    raisons.push('textes quasi identiques');
  } else if (!memeEmployeur) {
    if (textes !== null && textes >= 0.6) {
      score = Math.max(score, 0.84);
      raisons.push('textes très proches');
    } else {
      score = Math.min(score, 0.8);
    }
  }
  return { score: Math.round(score * 100) / 100, raisons };
}

export type DecisionDoublon = 'doublon' | 'probable' | 'distinct';

export function deciderDoublon(score: number, seuils: { seuilLien: number; seuilProbable: number }): DecisionDoublon {
  if (score >= seuils.seuilLien) return 'doublon';
  if (score >= seuils.seuilProbable) return 'probable';
  return 'distinct';
}

export type CandidatDoublon = {
  /** Offre principale à laquelle l'annonce serait rattachée. */
  id: string;
  decision: 'doublon' | 'probable';
  /** Cette offre principale est archivée parce qu'elle a été publiée avant le début de la recherche. */
  horsPeriode: boolean;
};

/**
 * Que faire des annonces ressemblantes trouvées en base (triées, la plus
 * ressemblante d'abord) ?
 *
 *   lie         l'annonce est rattachée à cette offre principale, et archivée ;
 *   remplacees  offres principales écartées (publiées avant le début de la
 *               recherche) dont l'annonce prend la place : ce sont elles qui
 *               lui sont rattachées, et non l'inverse ;
 *   probable    ressemblance à signaler au courtier, sans rattachement.
 *
 * Règle : une annonce publiée dans la période de recherche n'est jamais masquée
 * par une annonce plus ancienne que le début de la recherche. Elle n'est donc
 * rattachée qu'à une offre de la période ; à défaut, c'est elle qui devient
 * l'offre principale. Une ressemblance seulement probable avec une annonce
 * écartée n'est pas signalée : la réponse du courtier ne changerait rien.
 * Une annonce hors période (ou sans date fiable) suit la règle générale :
 * rattachée à l'offre la plus ressemblante, quelle qu'elle soit.
 */
export function deciderRattachement<T extends CandidatDoublon>(annonceDansLaPeriode: boolean, candidats: readonly T[]): { lie: T | null; remplacees: T[]; probable: T | null } {
  if (!annonceDansLaPeriode) {
    const lie = candidats.find((candidat) => candidat.decision === 'doublon') ?? null;
    return { lie, remplacees: [], probable: lie ? null : (candidats[0] ?? null) };
  }
  const dansLaPeriode = candidats.filter((candidat) => !candidat.horsPeriode);
  const lie = dansLaPeriode.find((candidat) => candidat.decision === 'doublon') ?? null;
  if (lie) return { lie, remplacees: [], probable: null };
  // Une même offre principale peut être trouvée par plusieurs de ses doublons : on ne la garde qu'une fois.
  const remplacees = [...new Map(candidats.filter((candidat) => candidat.horsPeriode && candidat.decision === 'doublon').map((candidat) => [candidat.id, candidat])).values()];
  return { lie: null, remplacees, probable: dansLaPeriode[0] ?? null };
}
