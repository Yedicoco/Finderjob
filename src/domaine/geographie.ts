/**
 * Géographie : villes et quartiers du Maroc, détection du pays d'une offre.
 *
 * Les 14 villes « Yallah » (statut, phase) et leurs quartiers cibles sont
 * repris tels quels de `site.config.json` du dépôt Yedicoco/yallah.services
 * (clés `villes`, `villesRetirees`, `zonesCiblage`). Les autres villes servent
 * uniquement à situer une offre au Maroc et à la filtrer.
 */
import { cle, cleArabeAllegee, contient, preparer } from './texte';

export type StatutYallah = 'confirmee' | 'pole' | 'candidate' | 'retiree' | 'hors_zone';

export type Ville = {
  code: string;
  nom: string;
  nomAr: string;
  region: string;
  statut: StatutYallah;
  phase?: 1 | 2 | 3;
  alias?: string[];
  /** Alias trop ambigus pour être reconnus hors d'un contexte de lieu (« Salé »). */
  strict?: boolean;
};

export type Quartier = { ville: string; nom: string; cible: boolean; alias?: string[]; detectable?: boolean };

const CS = 'Casablanca-Settat';
const RSK = 'Rabat-Salé-Kénitra';
const MS = 'Marrakech-Safi';
const TTA = 'Tanger-Tétouan-Al Hoceïma';
const SM = 'Souss-Massa';
const FM = 'Fès-Meknès';
const OR = 'Oriental';
const BMK = 'Béni Mellal-Khénifra';
const DT = 'Drâa-Tafilalet';
const GON = 'Guelmim-Oued Noun';
const LSH = 'Laâyoune-Sakia El Hamra';
const DOD = 'Dakhla-Oued Ed-Dahab';

export const REGIONS = [CS, RSK, MS, TTA, SM, FM, OR, BMK, DT, GON, LSH, DOD];

export const VILLES: Ville[] = [
  // Villes de la couverture Yallah Services (ordre et phases du site vitrine)
  { code: 'casablanca', nom: 'Casablanca', nomAr: 'الدار البيضاء', region: CS, statut: 'confirmee', phase: 1, alias: ['casa', 'البيضاء', 'كازا', 'كازابلانكا', 'dar el beida'] },
  { code: 'bouskoura', nom: 'Bouskoura', nomAr: 'بوسكورة', region: CS, statut: 'pole', phase: 1, alias: ['ville verte bouskoura'] },
  { code: 'dar-bouazza', nom: 'Dar Bouazza', nomAr: 'دار بوعزة', region: CS, statut: 'confirmee', phase: 1, alias: ['darbouazza', 'dar bouaza', 'tamaris'] },
  { code: 'rabat', nom: 'Rabat', nomAr: 'الرباط', region: RSK, statut: 'confirmee', phase: 1 },
  { code: 'marrakech', nom: 'Marrakech', nomAr: 'مراكش', region: MS, statut: 'confirmee', phase: 1, alias: ['marrakesh', 'marakech', 'marrakch'] },
  { code: 'tanger', nom: 'Tanger', nomAr: 'طنجة', region: TTA, statut: 'confirmee', phase: 2, alias: ['tangier', 'tanja'] },
  { code: 'agadir', nom: 'Agadir', nomAr: 'أكادير', region: SM, statut: 'confirmee', phase: 2, alias: ['اكادير', 'أگادير'] },
  { code: 'mohammedia', nom: 'Mohammedia', nomAr: 'المحمدية', region: CS, statut: 'confirmee', phase: 2, alias: ['mohammadia', 'mohamedia'] },
  { code: 'kenitra', nom: 'Kénitra', nomAr: 'القنيطرة', region: RSK, statut: 'confirmee', phase: 2 },
  { code: 'fes', nom: 'Fès', nomAr: 'فاس', region: FM, statut: 'confirmee', phase: 3, alias: ['fez'] },
  { code: 'temara', nom: 'Témara', nomAr: 'تمارة', region: RSK, statut: 'confirmee', phase: 3 },
  { code: 'bouznika', nom: 'Bouznika', nomAr: 'بوزنيقة', region: CS, statut: 'confirmee', phase: 3 },
  { code: 'sale', nom: 'Salé', nomAr: 'سلا', region: RSK, statut: 'confirmee', phase: 3, strict: true },
  { code: 'el-jadida', nom: 'El Jadida', nomAr: 'الجديدة', region: CS, statut: 'candidate', phase: 3, alias: ['al jadida', 'eljadida', 'mazagan'] },
  // Villes retirées de la couverture Yallah (restent filtrables)
  { code: 'meknes', nom: 'Meknès', nomAr: 'مكناس', region: FM, statut: 'retiree' },
  { code: 'oujda', nom: 'Oujda', nomAr: 'وجدة', region: OR, statut: 'retiree' },
  { code: 'tetouan', nom: 'Tétouan', nomAr: 'تطوان', region: TTA, statut: 'retiree', alias: ['tetuan'] },
  // Autres villes du Maroc
  { code: 'essaouira', nom: 'Essaouira', nomAr: 'الصويرة', region: MS, statut: 'hors_zone', alias: ['mogador'] },
  { code: 'safi', nom: 'Safi', nomAr: 'آسفي', region: MS, statut: 'hors_zone', alias: ['اسفي'] },
  { code: 'settat', nom: 'Settat', nomAr: 'سطات', region: CS, statut: 'hors_zone' },
  { code: 'berrechid', nom: 'Berrechid', nomAr: 'برشيد', region: CS, statut: 'hors_zone' },
  { code: 'benslimane', nom: 'Benslimane', nomAr: 'بنسليمان', region: CS, statut: 'hors_zone', alias: ['ben slimane'] },
  { code: 'nouaceur', nom: 'Nouaceur', nomAr: 'النواصر', region: CS, statut: 'hors_zone', alias: ['nouasseur'] },
  { code: 'skhirat', nom: 'Skhirat', nomAr: 'الصخيرات', region: RSK, statut: 'hors_zone' },
  { code: 'khemisset', nom: 'Khémisset', nomAr: 'الخميسات', region: RSK, statut: 'hors_zone' },
  { code: 'nador', nom: 'Nador', nomAr: 'الناظور', region: OR, statut: 'hors_zone' },
  { code: 'berkane', nom: 'Berkane', nomAr: 'بركان', region: OR, statut: 'hors_zone' },
  { code: 'saidia', nom: 'Saïdia', nomAr: 'السعيدية', region: OR, statut: 'hors_zone' },
  { code: 'al-hoceima', nom: 'Al Hoceïma', nomAr: 'الحسيمة', region: TTA, statut: 'hors_zone', alias: ['al hoceima', 'alhoceima', 'hoceima'] },
  { code: 'larache', nom: 'Larache', nomAr: 'العرائش', region: TTA, statut: 'hors_zone' },
  { code: 'chefchaouen', nom: 'Chefchaouen', nomAr: 'شفشاون', region: TTA, statut: 'hors_zone', alias: ['chaouen'] },
  { code: 'mdiq', nom: 'M\'diq', nomAr: 'المضيق', region: TTA, statut: 'hors_zone', alias: ['mdiq', 'm diq'] },
  { code: 'asilah', nom: 'Asilah', nomAr: 'أصيلة', region: TTA, statut: 'hors_zone', alias: ['assilah'] },
  { code: 'ifrane', nom: 'Ifrane', nomAr: 'إفران', region: FM, statut: 'hors_zone' },
  { code: 'taza', nom: 'Taza', nomAr: 'تازة', region: FM, statut: 'hors_zone' },
  { code: 'beni-mellal', nom: 'Béni Mellal', nomAr: 'بني ملال', region: BMK, statut: 'hors_zone', alias: ['benimellal'] },
  { code: 'khouribga', nom: 'Khouribga', nomAr: 'خريبكة', region: BMK, statut: 'hors_zone' },
  { code: 'khenifra', nom: 'Khénifra', nomAr: 'خنيفرة', region: BMK, statut: 'hors_zone' },
  { code: 'ouarzazate', nom: 'Ouarzazate', nomAr: 'ورزازات', region: DT, statut: 'hors_zone' },
  { code: 'errachidia', nom: 'Errachidia', nomAr: 'الرشيدية', region: DT, statut: 'hors_zone' },
  { code: 'merzouga', nom: 'Merzouga', nomAr: 'مرزوكة', region: DT, statut: 'hors_zone' },
  { code: 'taroudant', nom: 'Taroudant', nomAr: 'تارودانت', region: SM, statut: 'hors_zone' },
  { code: 'tiznit', nom: 'Tiznit', nomAr: 'تزنيت', region: SM, statut: 'hors_zone' },
  { code: 'taghazout', nom: 'Taghazout', nomAr: 'تغازوت', region: SM, statut: 'hors_zone' },
  { code: 'guelmim', nom: 'Guelmim', nomAr: 'كلميم', region: GON, statut: 'hors_zone' },
  { code: 'laayoune', nom: 'Laâyoune', nomAr: 'العيون', region: LSH, statut: 'hors_zone', alias: ['el aaiun'] },
  { code: 'dakhla', nom: 'Dakhla', nomAr: 'الداخلة', region: DOD, statut: 'hors_zone' },
];

/** Quartiers cibles du site Yallah (`zonesCiblage`) + quartiers fréquents dans les annonces. */
export const QUARTIERS: Quartier[] = [
  ...['Anfa', 'Aïn Diab', 'Californie', 'Racine', 'Gauthier', 'CIL', 'CFC'].map((nom) => ({ ville: 'casablanca', nom, cible: true })),
  ...['Maârif', 'Bourgogne', 'Aïn Sebaâ', 'Sidi Maârouf', 'Oulfa', 'Hay Hassani', 'Lissasfa', 'Aïn Chock', 'Sidi Bernoussi', 'Oasis', 'Palmier', 'Oukacha', 'Derb Ghallef', 'Roches Noires', 'Belvédère', 'Polo', 'Val Fleuri', 'Triangle d\'Or', 'Sidi Moumen'].map((nom) => ({ ville: 'casablanca', nom, cible: false })),
  ...['Souissi', 'Hay Riad', 'Les Ambassadeurs', 'Agdal', 'Haut Agdal'].map((nom) => ({ ville: 'rabat', nom, cible: true })),
  ...['Hassan', 'Océan', 'Yaacoub El Mansour', 'Akkari', 'Aviation', 'Orangers'].map((nom) => ({ ville: 'rabat', nom, cible: false })),
  ...['Hivernage', 'Palmeraie', 'Agdal', 'Targa', 'Amelkis', 'Guéliz'].map((nom) => ({ ville: 'marrakech', nom, cible: true })),
  ...['Médina', 'Agafay', 'Massira', 'Mhamid', 'Sidi Ghanem', 'Route de l\'Ourika', 'Semlalia'].map((nom) => ({ ville: 'marrakech', nom, cible: false, detectable: nom !== 'Médina' })),
  ...['Malabata', 'Cap Spartel', 'Jbel Kbir', 'Iberia', 'Achakar'].map((nom) => ({ ville: 'tanger', nom, cible: true })),
  ...['Mghogha', 'Boukhalef', 'Marshan', 'Moujahidine'].map((nom) => ({ ville: 'tanger', nom, cible: false })),
  ...['Founty', 'Haut-Founty', 'Quartier Suisse', 'Sonaba'].map((nom) => ({ ville: 'agadir', nom, cible: true })),
  { ville: 'agadir', nom: 'Marina', cible: true, detectable: false },
  ...['Route d\'Imouzzer', 'Champs de Course', 'Narjiss'].map((nom) => ({ ville: 'fes', nom, cible: true })),
  { ville: 'fes', nom: 'Ville Nouvelle', cible: true, detectable: false },
  ...['Mimosas', 'Maamora', 'Bir Rami'].map((nom) => ({ ville: 'kenitra', nom, cible: true })),
  { ville: 'kenitra', nom: 'Centre-ville', cible: true, detectable: false },
  ...['Monica', 'Manesmann', 'Fedala'].map((nom) => ({ ville: 'mohammedia', nom, cible: true })),
  { ville: 'mohammedia', nom: 'Parc', cible: true, detectable: false },
  ...['Harhoura', 'Guich Loudaya', 'Wifaq'].map((nom) => ({ ville: 'temara', nom, cible: true })),
  { ville: 'temara', nom: 'Témara Centre', cible: true, detectable: false },
  ...['Haouzia', 'Sidi Bouzid'].map((nom) => ({ ville: 'el-jadida', nom, cible: true })),
  { ville: 'el-jadida', nom: 'Centre-ville résidentiel', cible: true, detectable: false },
  ...['Centre', 'Front de mer', 'Secteurs résidentiels'].map((nom) => ({ ville: 'bouznika', nom, cible: true, detectable: false })),
  ...['Rahma', 'Tamaris'].map((nom) => ({ ville: 'dar-bouazza', nom, cible: false })),
  ...['Ville Verte'].map((nom) => ({ ville: 'bouskoura', nom, cible: false })),
];

const VILLE_PAR_CODE = new Map(VILLES.map((ville) => [ville.code, ville]));

export function villeParCode(code: string | null | undefined): Ville | undefined {
  return code ? VILLE_PAR_CODE.get(code) : undefined;
}

export function nomVille(code: string | null | undefined): string {
  return villeParCode(code)?.nom ?? 'Ville non précisée';
}

export function quartiersDeVille(code: string): Quartier[] {
  return QUARTIERS.filter((quartier) => quartier.ville === code);
}

export function estZoneYallah(code: string | null | undefined): boolean {
  const statut = villeParCode(code)?.statut;
  return statut === 'confirmee' || statut === 'pole';
}

// ---------------------------------------------------------------------------
// Détection de la ville et du quartier
// ---------------------------------------------------------------------------

type AliasVille = { cle: string; ville: Ville };

const ALIAS_VILLES: AliasVille[] = VILLES.flatMap((ville) =>
  [ville.nom, ville.nomAr, ville.code.replace(/-/g, ' '), ...(ville.alias ?? [])]
    .map((alias) => ({ cle: cle(alias), ville }))
    .filter((alias) => alias.cle.trim().length >= 2),
).sort((a, b) => b.cle.length - a.cle.length);

const CLES_REGIONS = REGIONS.map((region) => ({ cle: cle(region), region }));

// « Salé » : reconnu seulement s'il est écrit avec son accent, en majuscules
// dans un titre, ou précédé d'une préposition de lieu.
const MOTIF_SALE = /(?:^|[^\p{L}])(?:Salé|SALÉ|SALE(?=\s*(?:[-–|,)]|$))|(?:à|a|de|sur|ville de|région de)\s+Sale(?![\p{L}]))/u;

export type LieuDetecte = {
  ville: Ville | null;
  quartier: string | null;
  region: string | null;
  autresVilles: string[];
  /** true si un lieu marocain (ville, région ou le mot « Maroc ») a été reconnu. */
  marocMentionne: boolean;
};

function retirerRegions(cleTexte: string): { cleSansRegion: string; region: string | null } {
  let region: string | null = null;
  let sortie = cleTexte;
  for (const candidat of CLES_REGIONS) {
    if (sortie.includes(candidat.cle)) {
      region ??= candidat.region;
      sortie = sortie.split(candidat.cle).join(' ');
    }
  }
  return { cleSansRegion: sortie, region };
}

function villesDans(texte: string): Ville[] {
  if (!texte.trim()) return [];
  const { cleSansRegion } = retirerRegions(cle(texte));
  const allegee = cleArabeAllegee(cleSansRegion);
  const trouvees: { ville: Ville; position: number }[] = [];
  for (const alias of ALIAS_VILLES) {
    if (alias.ville.strict && !/[\u0600-\u06FF]/.test(alias.cle)) {
      if (!MOTIF_SALE.test(texte)) continue;
    }
    let position = cleSansRegion.indexOf(alias.cle);
    if (position < 0) position = allegee.indexOf(alias.cle);
    if (position < 0) continue;
    if (!trouvees.some((t) => t.ville.code === alias.ville.code)) trouvees.push({ ville: alias.ville, position });
  }
  return trouvees.sort((a, b) => a.position - b.position).map((t) => t.ville);
}

// « marocain(e) » n'est volontairement pas dans la liste : « cuisine marocaine »
// ne dit rien du lieu de travail.
const CLES_MAROC = [' maroc ', ' morocco ', ' المغرب ', ' بالمغرب '];

export function detecterLieu(titre: string, texte = '', lieuStructure = ''): LieuDetecte {
  const sources = [lieuStructure, titre, texte];
  const toutes: Ville[] = [];
  for (const source of sources) {
    for (const ville of villesDans(source)) if (!toutes.some((v) => v.code === ville.code)) toutes.push(ville);
  }
  // Priorité : lieu structuré, puis titre, puis corps. Une commune de la
  // périphérie citée avec sa métropole l'emporte (« Bouskoura, Casablanca »).
  let ville = toutes[0] ?? null;
  const premieresSources = villesDans(`${lieuStructure} ${titre}`);
  if (premieresSources.length > 1) {
    const precise = premieresSources.find((v) => v.statut !== 'hors_zone' && v.code !== 'casablanca' && v.code !== 'rabat');
    const metropole = premieresSources.find((v) => v.code === 'casablanca' || v.code === 'rabat');
    if (precise && metropole && precise.region === metropole.region) ville = precise;
  }

  const cleComplete = cle(sources.join(' \n '));
  const { region: regionTexte } = retirerRegions(cleComplete);
  const region = ville?.region ?? regionTexte;

  let quartier: string | null = null;
  if (ville) {
    for (const candidat of quartiersDeVille(ville.code)) {
      if (candidat.detectable === false) continue;
      const cles = [candidat.nom, ...(candidat.alias ?? [])].map(cle);
      if (cles.some((c) => contient(cleComplete, c))) {
        quartier = candidat.nom;
        break;
      }
    }
  }

  const marocMentionne = Boolean(ville) || Boolean(region) || CLES_MAROC.some((c) => cleComplete.includes(c));
  return {
    ville,
    quartier,
    region,
    autresVilles: toutes.filter((v) => v.code !== ville?.code).map((v) => v.code),
    marocMentionne,
  };
}

// ---------------------------------------------------------------------------
// Pays : une offre hors du Maroc est rejetée
// ---------------------------------------------------------------------------

const LIEUX_ETRANGERS = [
  'france', 'paris', 'lyon', 'marseille', 'canada', 'québec', 'montréal', 'belgique', 'bruxelles', 'espagne', 'madrid',
  'barcelone', 'italie', 'allemagne', 'suisse', 'genève', 'luxembourg', 'royaume-uni', 'angleterre', 'londres',
  'états-unis', 'usa', 'dubaï', 'dubai', 'émirats', 'emirats arabes unis', 'abu dhabi', 'abou dabi', 'qatar', 'doha',
  'arabie saoudite', 'djeddah', 'koweït', 'bahreïn', 'oman', 'tunisie', 'tunis', 'algérie', 'alger',
  'sénégal', 'dakar', 'côte d\'ivoire', 'abidjan', 'égypte', 'turquie', 'istanbul', 'pays-bas', 'portugal',
  'lisbonne', 'golfe', 'pays du golfe', 'europe',
  'فرنسا', 'كندا', 'دبي', 'الامارات', 'قطر', 'السعوديه', 'الكويت', 'البحرين', 'اسبانيا', 'بلجيكا', 'المانيا', 'ايطاليا', 'الخليج', 'اوروبا', 'تركيا',
  'saudi arabia', 'uae', 'united arab emirates', 'kuwait', 'bahrain', 'germany', 'spain', 'italy', 'united kingdom', 'gulf',
];
const CLES_ETRANGERS = LIEUX_ETRANGERS.map((lieu) => ({ cle: cle(lieu), lieu }));

function echapper(texte: string): string {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Dans un titre, un lieu étranger ne compte que s'il est écrit comme un lieu :
// « Nounou à Dubaï », « Serveur - Qatar », « (France) ». « Café de Paris » ou
// « Hôtel Paris Plage » sont des noms d'établissement, pas une destination.
const MOTIFS_ETRANGERS_TITRE = LIEUX_ETRANGERS.map((lieu) => ({
  lieu,
  motif: new RegExp(
    `(?:^|[-|,:(/]\\s*|(?<![\\p{L}])(?:a|au|aux|en|pour|sur|vers|in|to)\\s+(?:le\\s+|la\\s+|les\\s+|l')?|(?:في|الي|نحو)\\s+|(?<![\\p{L}])[بل])${echapper(preparer(lieu))}(?![\\p{L}])`,
    'u',
  ),
}));

function lieuEtrangerEcritCommeLieu(titre: string): string | undefined {
  const prepare = preparer(titre).trim();
  return MOTIFS_ETRANGERS_TITRE.find((candidat) => candidat.motif.test(prepare))?.lieu;
}

const MOTIFS_POSTE_ETRANGER: RegExp[] = [
  /\b(?:poste|emploi|travail|mission|contrat)s?\s+(?:est\s+)?(?:base|situe|localise)e?s?\s+(?:a|au|aux|en)\s+(?:l'|la\s+|le\s+)?etranger/,
  /\b(?:travail|emploi|poste|recrutement|opportunite|contrat)s?\s+a\s+l'etranger/,
  /\bhors\s+du\s+maroc\b/,
  /\bexpatriation\b/,
  /\bvisa\s+(?:de\s+travail|pris\s+en\s+charge|fourni|assure)/,
  /\bbillet\s+d'avion\s+(?:pris\s+en\s+charge|offert|paye)/,
  /خارج\s+المغرب/,
  /عقد\s+عمل\s+(?:في|ب)\s*(?:الخارج|دبي|قطر|السعوديه|الامارات|الكويت|فرنسا|كندا)/,
  /للعمل\s+(?:في|ب)\s*(?:الخارج|دبي|قطر|السعوديه|الامارات|الكويت|البحرين|فرنسا|كندا|اسبانيا)/,
  /\bjob\s+abroad\b|\bwork\s+abroad\b|\boverseas\b/,
];

// « basé à Dubaï », « situé au Qatar » : le mot qui suit est comparé aux lieux étrangers.
const MOTIF_BASE_A = /\b(?:base|situe|localise)e?s?\s+(?:a|au|aux|en)\s+([\p{L}' -]{3,30})/gu;
// « recrutement pour le Qatar », « nounou recherchée pour Dubaï ».
const MOTIF_POUR_PAYS = /\b(?:recrut\p{L}*|recherch\p{L}*|besoin|poste|emploi|travail\p{L}*|contrat)\b[^.\n]{0,60}?\bpour\s+(?:le\s+|la\s+|les\s+|l')?([\p{L}' -]{3,25})/gu;

function destinationEtrangere(prepare: string): string | undefined {
  for (const motif of [MOTIF_BASE_A, MOTIF_POUR_PAYS]) {
    for (const trouve of prepare.matchAll(motif)) {
      const suite = cle(trouve[1] ?? '');
      const lieu = CLES_ETRANGERS.find((candidat) => suite.startsWith(candidat.cle));
      if (lieu) return lieu.lieu;
    }
  }
  return undefined;
}

export type EvaluationPays = {
  pays: 'MA' | 'etranger' | 'inconnu';
  motif: string;
  lieuEtranger?: string;
  /** true : offre gardée, mais un lieu étranger est cité dans le titre → vérification humaine. */
  aVerifier?: boolean;
};

function lieuEtrangerDans(cleTexte: string): string | undefined {
  return CLES_ETRANGERS.find((candidat) => cleTexte.includes(candidat.cle))?.lieu;
}

/**
 * Décide si une offre est au Maroc.
 * - pays structuré (JSON-LD `addressCountry`) : il fait foi ;
 * - champ « lieu » structuré qui cite un lieu étranger et aucun lieu marocain : rejet ;
 * - formule explicite de poste à l'étranger : rejet, même si une ville
 *   marocaine est citée pour les entretiens ;
 * - lieu étranger écrit comme une destination dans le titre, sans lieu
 *   marocain dans le titre : rejet ;
 * - lieu marocain reconnu : Maroc (à vérifier si le titre cite aussi un lieu étranger) ;
 * - sinon « inconnu » : l'offre n'est pas rejetée mais part en vérification.
 */
export function evaluerPays(entree: { titre: string; texte?: string; paysStructure?: string | null; lieuStructure?: string | null }): EvaluationPays {
  const paysStructure = entree.paysStructure ? cle(entree.paysStructure).trim() : '';
  if (paysStructure) {
    if (['ma', 'mar', 'maroc', 'morocco', 'المغرب'].includes(paysStructure)) return { pays: 'MA', motif: 'pays_structure_maroc' };
    return { pays: 'etranger', motif: 'pays_structure_etranger', lieuEtranger: entree.paysStructure ?? undefined };
  }

  const lieuStructure = entree.lieuStructure ?? '';
  if (lieuStructure.trim()) {
    const etrangerStructure = lieuEtrangerDans(cle(lieuStructure));
    const marocainStructure = villesDans(lieuStructure).length > 0 || CLES_MAROC.some((c) => cle(lieuStructure).includes(c)) || Boolean(retirerRegions(cle(lieuStructure)).region);
    if (etrangerStructure && !marocainStructure) return { pays: 'etranger', motif: 'lieu_structure_etranger', lieuEtranger: etrangerStructure };
  }

  const texteComplet = `${entree.titre}\n${entree.texte ?? ''}`;
  const prepare = preparer(texteComplet);
  const lieu = detecterLieu(entree.titre, entree.texte ?? '', lieuStructure);
  const cleTitre = cle(`${entree.titre} ${lieuStructure}`);
  const etrangerTitre = lieuEtrangerDans(cle(entree.titre));
  const etrangerTexte = etrangerTitre ?? lieuEtrangerDans(cle(texteComplet));
  const lieuMarocainTitre = villesDans(`${entree.titre} ${lieuStructure}`).length > 0 || CLES_MAROC.some((c) => cleTitre.includes(c));

  if (MOTIFS_POSTE_ETRANGER.some((motif) => motif.test(prepare))) {
    return { pays: 'etranger', motif: 'formule_poste_etranger', lieuEtranger: etrangerTexte };
  }
  const destination = destinationEtrangere(prepare);
  if (destination) return { pays: 'etranger', motif: 'poste_base_a_l_etranger', lieuEtranger: destination };
  const destinationTitre = lieuMarocainTitre ? undefined : lieuEtrangerEcritCommeLieu(entree.titre);
  if (destinationTitre) return { pays: 'etranger', motif: 'lieu_etranger_dans_titre', lieuEtranger: destinationTitre };
  if (lieu.marocMentionne) {
    return {
      pays: 'MA',
      motif: lieu.ville ? 'ville_marocaine' : 'maroc_mentionne',
      ...(etrangerTitre && !lieuMarocainTitre ? { aVerifier: true, lieuEtranger: etrangerTitre } : {}),
    };
  }
  if (etrangerTexte) return { pays: 'inconnu', motif: 'lieu_etranger_cite_sans_lieu_marocain', lieuEtranger: etrangerTexte };
  return { pays: 'inconnu', motif: 'aucun_lieu' };
}
