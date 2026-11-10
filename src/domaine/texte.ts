/**
 * Normalisation de texte français / arabe / anglais.
 *
 * Tout le moteur (classification, détection de ville, doublons, recherche)
 * compare des textes passés par ces fonctions : une seule définition de
 * « même mot » pour toute l'application. Module pur, sans dépendance.
 */
import { createHash } from 'node:crypto';

const DIACRITIQUES_LATINS = /[\u0300-\u036f]/g;
// Voyelles brèves, signes coraniques, hamza combinée, tatweel.
const SIGNES_ARABES = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const LETTRE_ARABE = /[\u0621-\u064A\u0671-\u06D3]/;
const LETTRES_ARABES_GLOBAL = /[\u0621-\u064A\u0671-\u06D3]/g;

/** Unifie les variantes orthographiques arabes courantes. */
export function normaliserArabe(texte: string): string {
  return texte
    .replace(SIGNES_ARABES, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627') // آ أ إ ٱ → ا
    .replace(/\u0649/g, '\u064A') // ى → ي
    .replace(/\u0629/g, '\u0647') // ة → ه
    .replace(/\u0624/g, '\u0648') // ؤ → و
    .replace(/\u0626/g, '\u064A') // ئ → ي
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660)) // chiffres arabes-indiens
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0)); // chiffres persans
}

/**
 * Forme « préparée » : minuscules, sans accents, arabe unifié, mais ponctuation
 * et chiffres conservés. Sert aux expressions régulières d'extraction
 * (salaires, dates, téléphones).
 */
export function preparer(texte: string): string {
  return normaliserArabe(
    texte
      .normalize('NFKD')
      .replace(DIACRITIQUES_LATINS, '')
      .replace(/[\u00a0\u202f\u2009\u2007]/g, ' ')
      .replace(/[’‘`´]/g, "'")
      .replace(/[–—−]/g, '-'),
  )
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

/** Forme « normalisée » : uniquement lettres et chiffres séparés par une espace. */
export function normaliserTexte(texte: string): string {
  return preparer(texte)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Singulier approximatif : « gouvernantes » → « gouvernante », « femmes » → « femme ». */
export function racine(mot: string): string {
  if (mot.length >= 4 && mot.endsWith('s') && !LETTRE_ARABE.test(mot)) return mot.slice(0, -1);
  return mot;
}

export function tokeniser(texte: string): string[] {
  const normalise = normaliserTexte(texte);
  return normalise ? normalise.split(' ').map(racine) : [];
}

/**
 * Clé de correspondance : mots au singulier séparés par une espace, encadrés
 * d'espaces. « contient(cle(texte), cle(expression)) » teste alors la présence
 * de l'expression en respectant les limites de mots.
 */
export function cle(texte: string): string {
  return ` ${tokeniser(texte).join(' ')} `;
}

const PREFIXES_ARABES = new Set(['\u0648', '\u0641', '\u0628', '\u0644', '\u0643']); // و ف ب ل ك

/**
 * Variante « allégée » d'une clé : chaque mot arabe perd sa conjonction ou
 * préposition collée (« بالدار » → « الدار », « والرباط » → « الرباط »).
 */
export function cleArabeAllegee(cleTexte: string): string {
  return cleTexte
    .split(' ')
    .map((mot) => {
      const premiere = mot[0];
      if (mot.length > 3 && premiere && PREFIXES_ARABES.has(premiere) && LETTRE_ARABE.test(mot)) return mot.slice(1);
      return mot;
    })
    .join(' ');
}

/** Présence d'une expression (déjà passée par cle()) dans une clé de texte. */
export function contient(cleTexte: string, cleExpression: string): boolean {
  return cleExpression.trim().length > 0 && cleTexte.includes(cleExpression);
}

export function contientLArabe(texte: string): boolean {
  return LETTRE_ARABE.test(texte);
}

const MOTS_ANGLAIS = new Set([
  'the', 'and', 'for', 'with', 'our', 'you', 'are', 'will', 'we', 'looking', 'experience', 'required', 'job',
  'full', 'time', 'must', 'have', 'team', 'work', 'your', 'years', 'position', 'hiring', 'needed', 'wanted',
]);
const MOTS_FRANCAIS = new Set([
  'le', 'la', 'les', 'des', 'du', 'de', 'et', 'pour', 'avec', 'nous', 'vous', 'est', 'une', 'un', 'au', 'aux',
  'sur', 'dans', 'poste', 'recherche', 'recherchons', 'profil', 'ans', 'experience', 'emploi', 'offre',
]);

export type Langue = 'fr' | 'ar' | 'en' | 'mixte';

/** Langue dominante d'un texte d'annonce. */
export function detecterLangue(texte: string): Langue {
  const lettres = texte.match(/\p{L}/gu)?.length ?? 0;
  if (lettres === 0) return 'fr';
  const arabes = texte.match(LETTRES_ARABES_GLOBAL)?.length ?? 0;
  const partArabe = arabes / lettres;
  if (partArabe >= 0.6) return 'ar';
  if (partArabe >= 0.2) return 'mixte';
  let fr = 0;
  let en = 0;
  for (const mot of normaliserTexte(texte).split(' ')) {
    if (MOTS_FRANCAIS.has(mot)) fr += 1;
    if (MOTS_ANGLAIS.has(mot)) en += 1;
  }
  if (en > fr * 1.5 && en >= 2) return 'en';
  return 'fr';
}

const ENTITES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê',
  agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï',
  euml: 'ë', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—',
  laquo: '«', raquo: '»', euro: '€', deg: '°', oelig: 'œ',
};

export function decoderEntites(texte: string): string {
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, corps: string) => {
    if (corps[0] === '#') {
      const code = corps[1]?.toLowerCase() === 'x' ? Number.parseInt(corps.slice(2), 16) : Number.parseInt(corps.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return ENTITES[corps.toLowerCase()] ?? tout;
  });
}

/** Convertit du HTML en texte brut lisible (aucun balisage conservé). */
export function htmlVersTexte(html: string): string {
  return decoderEntites(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Coupe proprement à `max` caractères, sur une limite de mot. */
export function tronquer(texte: string, max: number): string {
  const propre = texte.replace(/\s+/g, ' ').trim();
  if (max <= 0) return '';
  if (propre.length <= max) return propre;
  const coupe = propre.slice(0, max - 1);
  const dernierEspace = coupe.lastIndexOf(' ');
  return `${(dernierEspace > max * 0.6 ? coupe.slice(0, dernierEspace) : coupe).trimEnd()}…`;
}

export function sha256(texte: string): string {
  return createHash('sha256').update(texte, 'utf8').digest('hex');
}

/** Similarité de Jaccard entre deux ensembles de mots (0 à 1). */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const ensembleA = new Set(a);
  const ensembleB = new Set(b);
  if (ensembleA.size === 0 && ensembleB.size === 0) return 0;
  let communs = 0;
  for (const mot of ensembleA) if (ensembleB.has(mot)) communs += 1;
  return communs / (ensembleA.size + ensembleB.size - communs);
}
