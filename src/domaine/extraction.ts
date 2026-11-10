/**
 * Extraction par règles : transforme le texte libre d'une annonce (français,
 * arabe, anglais) en champs structurés.
 *
 * C'est l'extracteur de référence : déterministe, gratuit, testable, et le seul
 * autorisé pour les sources dont les conditions n'acceptent pas le traitement
 * par IA. L'extracteur LLM (src/ia) ne fait que compléter ses résultats.
 *
 * Règle d'or : ne rien inventer. Un champ absent du texte reste vide.
 *
 * Les expressions régulières s'appliquent au texte passé par `preparer()` :
 * minuscules, sans accents, arabe unifié (ة → ه, أ → ا, ى → ي…). Les motifs
 * arabes sont donc écrits sous cette forme unifiée.
 */
import { horlogeMarocVersInstant, instantMaroc } from './fuseau';
import { cle, contient, preparer } from './texte';

export type PeriodeSalaire = 'mois' | 'semaine' | 'jour' | 'heure';
export type Contrat = 'cdi' | 'cdd' | 'interim' | 'saisonnier' | 'journalier' | 'stage' | 'freelance' | 'anapec' | 'non_precise';
export type TempsTravail = 'temps_plein' | 'temps_partiel' | 'nuit' | 'week_end' | 'non_precise';
export type ModeTravail = 'sur_site' | 'a_domicile' | 'hybride' | 'teletravail' | 'non_precise';
export type NiveauExperience = 'debutant' | 'moins_1_an' | '1_2_ans' | '3_5_ans' | 'plus_5_ans' | 'non_precise';
export type TypeEmployeur = 'famille' | 'particulier' | 'residence' | 'riad' | 'hotel' | 'spa' | 'salon' | 'entreprise' | 'autre';
export type PrecisionDate = 'exacte' | 'approximative' | 'inconnue';

export type SalaireExtrait = {
  min: number | null;
  max: number | null;
  periode: PeriodeSalaire | null;
  /** true si la période n'était pas écrite et a été déduite du montant. */
  periodeDeduite: boolean;
  /** Passage de l'annonce d'où vient le montant (transparence). */
  texte: string | null;
  mensuelEstime: number | null;
  /** Montant exprimé en euros, dollars, riyals… : indice de poste hors Maroc. */
  deviseEtrangere: string | null;
};

export type Extraction = {
  salaire: SalaireExtrait;
  contrat: Contrat;
  tempsTravail: TempsTravail;
  modeTravail: ModeTravail;
  experience: { anneesMin: number | null; niveau: NiveauExperience };
  langues: string[];
  permis: boolean | null;
  logement: 'loge' | 'non_loge' | null;
  repas: boolean | null;
  horaires: string | null;
  disponibilite: string | null;
  nombrePostes: number | null;
  urgent: boolean;
  recrutementMassif: boolean;
  typeEmployeur: TypeEmployeur | null;
  contacts: { telephones: string[]; emails: string[]; whatsapp: boolean };
  dates: { publication: Date | null; precision: PrecisionDate; expiration: Date | null };
};

/** Lettre arabe : `\b` ne fonctionne pas avec l'arabe en JavaScript. */
const AR = String.raw`[\u0621-\u064A]`;

// ---------------------------------------------------------------------------
// Nombres et salaires
// ---------------------------------------------------------------------------

const NOMBRE = String.raw`\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const DEVISE_MAD = String.raw`dhs?\b|mad\b|dirhams?\b|درهم|دراهم`;
const DEVISE_ETRANGERE = String.raw`€|euros?\b|eur\b|\$|usd\b|dollars?\b|aed\b|sar\b|qar\b|riyals?\b|يورو|دولار|ريال`;

export function versNombre(brut: string): number {
  let s = brut.replace(/\s/g, '');
  const decimales = s.match(/[.,](\d{1,2})$/);
  let fraction = '';
  if (decimales) {
    fraction = decimales[1] ?? '';
    s = s.slice(0, -decimales[0].length);
  }
  s = s.replace(/[.,]/g, '');
  return Number(fraction ? `${s}.${fraction}` : s);
}

// Un montant précédé de l'un de ces mots n'est pas un salaire.
const CONTEXTE_NON_SALAIRE = /(?:\bfrais\b|\bcaution\b|\binscription\b|\bdossier\b|\bprimes?\b|\bbonus\b|\bcommissions?\b|chiffre d'affaires|\bca de\b|\bbudget\b|\bamende\b|\bavance\b|\bvaleur\b|\bpourboires?\b|رسوم|تسبيق|كفاله|عموله)[^.\n]{0,22}$/;
const CONTEXTE_SALAIRE = /(?:salaire|remuneration|\bpaie\b|\bpaye\b|\bnet\b|\bbrut\b|راتب|الراتب|اجر|الاجر|salary|\bpay\b|\bwage)/;

const PERIODES: { periode: PeriodeSalaire; motif: RegExp }[] = [
  { periode: 'heure', motif: /\/\s*h\b|par heure|\/\s*heure|de l'heure|per hour|hourly|للساعه|في الساعه/ },
  { periode: 'jour', motif: /\/\s*j\b|par jour|\/\s*jour|la journee|par journee|\/\s*journee|journalier|per day|daily|a day|يوميا|لليوم|في اليوم/ },
  { periode: 'semaine', motif: /par semaine|\/\s*semaine|hebdomadaire|per week|weekly|اسبوعيا|في الاسبوع/ },
  { periode: 'mois', motif: /\/\s*mois|par mois|mensuel|le mois|per month|monthly|a month|شهريا|في الشهر|للشهر/ },
];

function periodeLaPlusProche(extrait: string): PeriodeSalaire | null {
  let meilleure: { periode: PeriodeSalaire; position: number } | null = null;
  for (const { periode, motif } of PERIODES) {
    const position = extrait.search(motif);
    if (position >= 0 && (!meilleure || position < meilleure.position)) meilleure = { periode, position };
  }
  return meilleure?.periode ?? null;
}

function periodeAutour(texte: string, debut: number, fin: number): PeriodeSalaire | null {
  const apres = texte.slice(fin, fin + 30).split(/[.\n;]/)[0] ?? '';
  const trouvee = periodeLaPlusProche(apres);
  if (trouvee) return trouvee;
  const avant = texte.slice(Math.max(0, debut - 30), debut).split(/[.\n;]/).pop() ?? '';
  return periodeLaPlusProche(avant);
}

/**
 * Période supposée quand l'annonce ne la précise pas : 1 000 DH et plus = mois,
 * 100 à 999 DH = jour, moins de 100 DH = heure. (La journée au SMIG vaut
 * environ 143 DH : un tarif journalier sous 100 DH n'est pas plausible.)
 */
function periodeParDefaut(montant: number): PeriodeSalaire {
  if (montant >= 1000) return 'mois';
  if (montant >= 100) return 'jour';
  return 'heure';
}

/** Équivalent mensuel : 26 jours ouvrables, 191 heures (durée légale mensuelle), 4,33 semaines. */
export function mensualiser(montant: number, periode: PeriodeSalaire): number {
  const facteur = periode === 'mois' ? 1 : periode === 'semaine' ? 4.33 : periode === 'jour' ? 26 : 191;
  return Math.round(montant * facteur);
}

type CandidatSalaire = { min: number; max: number | null; debut: number; fin: number; avecLibelle: boolean };

const SALAIRE_VIDE: SalaireExtrait = { min: null, max: null, periode: null, periodeDeduite: false, texte: null, mensuelEstime: null, deviseEtrangere: null };

export function extraireSalaire(texteBrut: string): SalaireExtrait {
  const texte = preparer(texteBrut);

  const etrangere =
    new RegExp(String.raw`(?:${NOMBRE})\s*(?:k\b)?\s*(${DEVISE_ETRANGERE})`).exec(texte) ??
    new RegExp(String.raw`(€|\$|\busd|\beur|\baed|\bsar|\bqar)\s*(?:${NOMBRE})`).exec(texte);
  const deviseEtrangere = etrangere ? (etrangere[1] ?? '').trim() : null;

  const candidats: CandidatSalaire[] = [];
  const ajouter = (min: number, max: number | null, debut: number, fin: number) => {
    if (!Number.isFinite(min) || min <= 0) return;
    if (CONTEXTE_NON_SALAIRE.test(texte.slice(Math.max(0, debut - 30), debut))) return;
    const avecLibelle = CONTEXTE_SALAIRE.test(texte.slice(Math.max(0, debut - 45), fin + 12));
    candidats.push({ min, max: max !== null && Number.isFinite(max) && max > min ? max : null, debut, fin, avecLibelle });
  };
  const chevauche = (position: number) => candidats.some((c) => position >= c.debut - 2 && position < c.fin);

  // « 4 000 à 5 000 DH », « entre 4000 et 5000 dhs », « 3500-4500 MAD », « من 3000 إلى 4000 درهم »
  const fourchette = new RegExp(
    String.raw`(${NOMBRE})\s*(k\b)?\s*(?:${DEVISE_MAD})?\s*(?:-|a|et|au|to|الي)\s*(${NOMBRE})\s*(k\b)?\s*(?:${DEVISE_MAD})`,
    'g',
  );
  for (const m of texte.matchAll(fourchette)) {
    const a = versNombre(m[1] ?? '') * (m[2] ? 1000 : 1);
    const b = versNombre(m[3] ?? '') * (m[4] ? 1000 : 1);
    // « 2 à 3 000 dh » : la première borne est implicitement en milliers.
    const min = a < 100 && b >= 1000 ? a * 1000 : a;
    if (b > min) ajouter(min, b, m.index, m.index + m[0].length);
  }
  // « 4 000 DH », « 5k dh », « 5000 درهم »
  const simple = new RegExp(String.raw`(${NOMBRE})\s*(k\b)?\s*(?:${DEVISE_MAD})`, 'g');
  for (const m of texte.matchAll(simple)) {
    if (chevauche(m.index)) continue;
    ajouter(versNombre(m[1] ?? '') * (m[2] ? 1000 : 1), null, m.index, m.index + m[0].length);
  }
  // « MAD 5000 », « DH : 4 000 »
  const deviseAvant = new RegExp(String.raw`(?:\bdhs?\b|\bmad\b|درهم)\s*:?\s*(${NOMBRE})`, 'g');
  for (const m of texte.matchAll(deviseAvant)) {
    if (chevauche(m.index)) continue;
    ajouter(versNombre(m[1] ?? ''), null, m.index, m.index + m[0].length);
  }
  // « Salaire : 4500 » sans devise (montant plausible uniquement)
  if (candidats.length === 0 && !etrangere) {
    const sansDevise = new RegExp(
      String.raw`(?:salaire|remuneration|راتب|الراتب|salary)\s*(?:mensuel|net|brut|de|propose|:|-|=|\s){0,4}\s*(${NOMBRE})(?![\d.,]|\s*(?:%|ans\b|an\b|h\b|heures|jours|postes))`,
      'g',
    );
    for (const m of texte.matchAll(sansDevise)) {
      const valeur = versNombre(m[1] ?? '');
      if (valeur >= 500 && valeur <= 100000) ajouter(valeur, null, m.index, m.index + m[0].length);
    }
  }

  if (candidats.length === 0) {
    return etrangere ? { ...SALAIRE_VIDE, deviseEtrangere, texte: etrangere[0].trim() } : SALAIRE_VIDE;
  }

  const retenu = candidats.find((c) => c.avecLibelle) ?? candidats[0]!;
  const ecrite = periodeAutour(texte, retenu.debut, retenu.fin);
  const periode = ecrite ?? periodeParDefaut(retenu.max ?? retenu.min);
  const reference = retenu.max ? (retenu.min + retenu.max) / 2 : retenu.min;
  return {
    min: retenu.min,
    max: retenu.max,
    periode,
    periodeDeduite: ecrite === null,
    texte: texte.slice(Math.max(0, retenu.debut - 20), Math.min(texte.length, retenu.fin + 20)).replace(/\s+/g, ' ').trim(),
    mensuelEstime: mensualiser(reference, periode),
    deviseEtrangere,
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MOIS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, january: 1, يناير: 1,
  fevrier: 2, fevr: 2, fev: 2, february: 2, feb: 2, فبراير: 2,
  mars: 3, march: 3, mar: 3, مارس: 3,
  avril: 4, avr: 4, april: 4, apr: 4, ابريل: 4,
  mai: 5, may: 5, ماي: 5, مايو: 5,
  juin: 6, june: 6, jun: 6, يونيو: 6,
  juillet: 7, juil: 7, july: 7, jul: 7, يوليوز: 7, يوليو: 7,
  aout: 8, august: 8, aug: 8, غشت: 8, اغسطس: 8,
  septembre: 9, sept: 9, sep: 9, september: 9, شتنبر: 9, سبتمبر: 9,
  octobre: 10, oct: 10, october: 10, اكتوبر: 10,
  novembre: 11, nov: 11, november: 11, نونبر: 11, نوفمبر: 11,
  decembre: 12, dec: 12, december: 12, دجنبر: 12, ديسمبر: 12,
};
const NOMS_MOIS = Object.keys(MOIS).sort((a, b) => b.length - a.length).join('|');

/**
 * Date « jour seul » : midi à Casablanca. Le Maroc est à UTC+1, sauf pendant le
 * ramadan (UTC+0) : 11 h UTC tombe le bon jour dans les deux cas.
 */
function dateLocale(annee: number, mois: number, jour: number): Date | null {
  if (annee < 2000 || annee > 2100 || mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
  const date = new Date(Date.UTC(annee, mois - 1, jour, 11, 0, 0));
  return date.getUTCMonth() === mois - 1 ? date : null;
}

/** Lit une date écrite : ISO 8601, RFC 822, « 15/06/2026 », « 15 juin 2026 », « June 15, 2026 ». */
export function lireDate(brut: string | null | undefined): Date | null {
  if (!brut) return null;
  const texte = preparer(brut).trim();
  let m = /(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(z|[+-]\d{2}:?\d{2})?)?/.exec(texte);
  if (m) {
    if (m[4] !== undefined) {
      // Sans fuseau écrit, l'heure est celle de Casablanca (UTC+1, UTC+0 pendant le ramadan).
      if (!m[7]) return instantMaroc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? '0'));
      const decalage = m[7] === 'z' ? 'Z' : m[7].includes(':') ? m[7] : `${m[7].slice(0, 3)}:${m[7].slice(3)}`;
      const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${decalage}`);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return dateLocale(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  // RFC 822 des flux RSS : « Tue, 10 Nov 2026 08:00:00 +0000 »
  m = /(?:[a-z]{3},\s*)?\d{1,2}\s+[a-z]{3}\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?(?:\s*(?:[+-]\d{4}|gmt|utc|z))?/.exec(texte);
  if (m) {
    const avecFuseau = /[+-]\d{4}|gmt|utc|z$/.test(m[0]);
    const date = new Date(avecFuseau ? m[0] : `${m[0]} +0000`);
    if (!Number.isNaN(date.getTime())) return avecFuseau ? date : horlogeMarocVersInstant(date);
  }
  m = /(?<!\d)(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})(?!\d)/.exec(texte);
  if (m) return dateLocale(Number(m[3]), Number(m[2]), Number(m[1]));
  m = new RegExp(String.raw`(?<!\d)(\d{1,2})(?:er)?\s+(${NOMS_MOIS})\.?,?\s+(\d{4})`).exec(texte);
  if (m) return dateLocale(Number(m[3]), MOIS[m[2] ?? ''] ?? 0, Number(m[1]));
  m = new RegExp(String.raw`(${NOMS_MOIS})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`).exec(texte);
  if (m) return dateLocale(Number(m[3]), MOIS[m[1] ?? ''] ?? 0, Number(m[2]));
  return null;
}

const UNITES_RELATIVES: { motif: RegExp; ms: number }[] = [
  { motif: /^(?:minute|minutes|min|mn|دقيقه|دقايق)$/, ms: 60_000 },
  { motif: /^(?:heure|heures|h|hour|hours|ساعه|ساعات)$/, ms: 3_600_000 },
  { motif: /^(?:jour|jours|j|day|days|يوم|ايام)$/, ms: 86_400_000 },
  { motif: /^(?:semaine|semaines|week|weeks|اسبوع|اسابيع)$/, ms: 7 * 86_400_000 },
  { motif: /^(?:mois|month|months|شهر|اشهر|شهور)$/, ms: 30 * 86_400_000 },
];

const DUELS_ARABES: Record<string, [number, number]> = {
  يومين: [2, 86_400_000], يوم: [1, 86_400_000], ساعتين: [2, 3_600_000], ساعه: [1, 3_600_000],
  اسبوعين: [2, 7 * 86_400_000], اسبوع: [1, 7 * 86_400_000], شهرين: [2, 30 * 86_400_000], شهر: [1, 30 * 86_400_000],
};

const CONTEXTE_PUBLICATION = /publi|post|ajout|mise? en ligne|parue?|نشر/;

/** « il y a 3 jours », « hier », « 2 days ago », « منذ 3 أيام » → date approximative. */
export function lireDateRelative(brut: string, maintenant: Date): Date | null {
  const texte = preparer(brut);
  if (/\baujourd'?\s?hui\b|\btoday\b|اليوم/.test(texte) && CONTEXTE_PUBLICATION.test(texte)) return new Date(maintenant);
  if (/\bhier\b|\byesterday\b|امس/.test(texte) && CONTEXTE_PUBLICATION.test(texte)) return new Date(maintenant.getTime() - 86_400_000);
  const m =
    /(?:il y a|منذ)\s+(\d{1,3}|une?|يومين|يوم|ساعتين|ساعه|اسبوعين|اسبوع|شهرين|شهر)\+?\s*([a-z\u0621-\u064A]+)?/.exec(texte) ??
    /(?<![\d.,])(\d{1,3}|an?)\+?\s+([a-z]+)\s+ago\b/.exec(texte);
  if (!m) return null;
  const duel = DUELS_ARABES[m[1] ?? ''];
  if (duel) return m[2] ? null : new Date(maintenant.getTime() - duel[0] * duel[1]);
  const quantite = /^\d+$/.test(m[1] ?? '') ? Number(m[1]) : 1;
  const unite = UNITES_RELATIVES.find((u) => u.motif.test(m[2] ?? ''));
  if (!unite || quantite > 400) return null;
  return new Date(maintenant.getTime() - quantite * unite.ms);
}

const LIBELLES_PUBLICATION = /(?:publiee? le|publiee? :|date de publication|mise? en ligne le|postee? le|ajoutee? le|parue? le|posted on|posted:|date posted|نشر في|نشر بتاريخ|تاريخ النشر)\s*:?\s*([^\n|]{4,40})/g;
const LIBELLES_EXPIRATION = /(?:expire le|expire :|date d'expiration|date limite(?: de candidature| de depot)?|cloture le|avant le|jusqu'au|deadline|closing date|expires on|اخر اجل|تاريخ الانتهاء)\s*:?\s*([^\n|]{4,40})/g;

function premiereDate(texte: string, motif: RegExp): Date | null {
  for (const trouve of texte.matchAll(motif)) {
    const date = lireDate(trouve[1]);
    if (date) return date;
  }
  return null;
}

/**
 * Dates d'une annonce collée ou d'une page. Une date relative (« il y a 2
 * jours ») n'est retenue que sur une ligne courte ou qui parle de publication,
 * pour ne pas confondre avec « société créée il y a 3 mois ».
 */
export function extraireDates(texteBrut: string, maintenant: Date): Extraction['dates'] {
  const texte = preparer(texteBrut);
  let publication = premiereDate(texte, LIBELLES_PUBLICATION);
  let precision: PrecisionDate = publication ? 'exacte' : 'inconnue';

  if (!publication) {
    for (const ligne of texte.split(/\n|\|/)) {
      const courte = ligne.trim();
      if (!courte || (courte.length > 45 && !CONTEXTE_PUBLICATION.test(courte))) continue;
      const relative = lireDateRelative(courte, maintenant);
      if (relative) {
        publication = relative;
        precision = 'approximative';
        break;
      }
    }
  }
  return { publication, precision, expiration: premiereDate(texte, LIBELLES_EXPIRATION) };
}

// ---------------------------------------------------------------------------
// Contrat, rythme, mode
// ---------------------------------------------------------------------------

function premier<T extends string>(cleTexte: string, regles: [T, string[]][]): T | null {
  for (const [code, expressions] of regles) {
    if (expressions.some((expression) => contient(cleTexte, cle(expression)))) return code;
  }
  return null;
}

// Ordre = priorité : une mention explicite (CDI, CDD) l'emporte sur un indice.
const REGLES_CONTRAT: [Contrat, string[]][] = [
  ['stage', ['stage', 'stagiaire', 'pfe', 'internship', 'intern', 'تدريب']],
  ['anapec', ['anapec', 'contrat d\'insertion', 'contrat insertion', 'idmaj']],
  ['cdi', ['cdi', 'contrat à durée indéterminée', 'durée indéterminée', 'permanent contract', 'poste permanent', 'عقد دائم', 'عقد غير محدد المدة']],
  ['cdd', ['cdd', 'contrat à durée déterminée', 'durée déterminée', 'fixed-term', 'temporary contract', 'contrat temporaire', 'عقد محدد المدة', 'عقد مؤقت']],
  ['interim', ['intérim', 'intérimaire', 'mission d\'intérim', 'travail temporaire']],
  ['saisonnier', ['saisonnier', 'saisonnière', 'contrat saisonnier', 'emploi saisonnier', 'pour la saison', 'seasonal', 'موسمي']],
  ['journalier', ['journalier', 'journalière', 'à la journée', 'à la tâche', 'daily worker', 'مياوم']],
  ['freelance', ['freelance', 'indépendant', 'indépendante', 'auto-entrepreneur', 'auto entrepreneur', 'self-employed']],
];

const REGLES_TEMPS: [TempsTravail, string[]][] = [
  ['temps_partiel', ['temps partiel', 'mi-temps', 'mi temps', 'demi-journée', 'demi journée', 'part-time', 'part time', 'quelques heures', 'دوام جزئي', 'نصف دوام']],
  ['nuit', ['de nuit', 'veilleur de nuit', 'veilleuse de nuit', 'night shift', 'garde de nuit', 'poste de nuit', 'équipe de nuit', 'دوام ليلي', 'عمل ليلي']],
  ['week_end', ['week-end', 'weekend', 'week end', 'samedi et dimanche', 'نهاية الأسبوع']],
  ['temps_plein', ['temps plein', 'plein temps', 'temps complet', 'full-time', 'full time', 'دوام كامل']],
];

const REGLES_MODE: [ModeTravail, string[]][] = [
  ['teletravail', ['télétravail', 'teletravail', 'remote', 'à distance', 'work from home', 'عن بعد']],
  ['hybride', ['hybride', 'hybrid']],
  ['a_domicile', ['à domicile', 'au domicile', 'chez un particulier', 'chez une famille', 'chez particulier', 'dans une villa', 'في المنزل', 'بالمنزل']],
  ['sur_site', ['présentiel', 'sur site', 'sur place', 'on-site', 'on site']],
];

// ---------------------------------------------------------------------------
// Expérience
// ---------------------------------------------------------------------------

export function niveauExperience(annees: number | null): NiveauExperience {
  if (annees === null) return 'non_precise';
  if (annees <= 0) return 'debutant';
  if (annees < 1) return 'moins_1_an';
  if (annees <= 2) return '1_2_ans';
  if (annees <= 5) return '3_5_ans';
  return 'plus_5_ans';
}

const CHIFFRES_LETTRES: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, one: 1, two: 2, three: 3, four: 4, five: 5 };
const N = String.raw`\b(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|dix|one|two|three|four|five)`;

const MOTIFS_EXPERIENCE: RegExp[] = [
  new RegExp(String.raw`${N}\s*(?:a|-|et|to)\s*\d{1,2}\s*ans?\b[^.\n]{0,25}experience`),
  new RegExp(String.raw`experience[^.\d]{0,40}?${N}\s*(?:a|-|et)\s*\d{1,2}\s*ans?\b`),
  new RegExp(String.raw`${N}\s*\+?\s*ans?\b\s*(?:minimum\s*)?(?:d'\s*|de\s+)?experience`),
  new RegExp(String.raw`experience[^.\d]{0,40}?${N}\s*\+?\s*ans?\b`),
  new RegExp(String.raw`${N}\s*\+?\s*years?\b[^.\n]{0,15}experience`),
  new RegExp(String.raw`experience[^.\d]{0,30}?${N}\s*\+?\s*years?\b`),
  // « 2 ans minimum » sans le mot « expérience » : accepté sauf s'il s'agit d'un âge.
  new RegExp(String.raw`${N}\s*ans?\b\s*(?:minimum|min\b|au moins)`),
];

export function extraireExperience(texteBrut: string): Extraction['experience'] {
  const texte = preparer(texteBrut);
  const lire = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : CHIFFRES_LETTRES[v ?? ''] ?? null);

  if (/(?:sans|aucune)\s+experience|debutante?s?\s+accepte|debutante?s?\s+bienvenu|experience\s+non\s+(?:exigee|requise|obligatoire)|no experience|بدون خبره|لا تشترط الخبره/.test(texte)) {
    return { anneesMin: 0, niveau: 'debutant' };
  }
  let annees: number | null = null;
  for (const motif of MOTIFS_EXPERIENCE) {
    const m = motif.exec(texte);
    if (!m) continue;
    const valeur = lire(m[1]);
    // Un âge (« âgée de 25 à 40 ans ») n'est pas une ancienneté.
    const contexte = texte.slice(Math.max(0, m.index - 20), m.index + m[0].length);
    if (valeur === null || valeur > 15 || /\bagee?s?\b/.test(contexte)) continue;
    annees = valeur;
    break;
  }
  if (annees === null) {
    const mois = /(\d{1,2})\s*mois\s*(?:d'\s*|de\s+)?experience|experience[^.\n\d]{0,30}?(\d{1,2})\s*mois/.exec(texte);
    if (mois) annees = Math.round((Number(mois[1] ?? mois[2]) / 12) * 10) / 10;
  }
  if (annees === null) {
    const arabe = /خبره[^.\n\d]{0,20}?(\d{1,2})\s*(?:سنوات|سنه|سنين|اعوام|عام)|(\d{1,2})\s*(?:سنوات|سنه|سنين)\s*(?:من\s*)?(?:ال)?خبره/.exec(texte);
    if (arabe) annees = Number(arabe[1] ?? arabe[2]);
    else if (/خبره\s*(?:لا تقل عن\s*)?سنتين|سنتين\s*(?:من\s*)?(?:ال)?خبره/.test(texte)) annees = 2;
    else if (/خبره\s*(?:لا تقل عن\s*)?سنه|سنه\s*(?:من\s*)?(?:ال)?خبره/.test(texte)) annees = 1;
    if (annees !== null && annees > 15) annees = null;
  }
  return { anneesMin: annees, niveau: niveauExperience(annees) };
}

// ---------------------------------------------------------------------------
// Langues, logement, permis, urgence, effectifs
// ---------------------------------------------------------------------------

// Le nom d'une langue est masculin (« le français ») : « cuisine française »,
// « clientèle italienne » ne sont donc pas des langues exigées. La forme
// féminine n'est reconnue qu'après « langue ».
const MOTS_LANGUES: [string, RegExp][] = [
  ['darija', /\bdarija\b|\bdialecte marocain\b|الدارجه|دارجه/g],
  ['ar', /\barabe\b|\barabic\b|\barabophone\b|العربيه/g],
  ['fr', /\bfrancais\b|\blangue francaise\b|\bfrench\b|\bfrancophone\b|الفرنسيه/g],
  ['en', /\banglais\b|\blangue anglaise\b|\benglish\b|\banglophone\b|الانجليزيه|الانكليزيه/g],
  ['es', /\bespagnol\b|\blangue espagnole\b|\bspanish\b|\bhispanophone\b|الاسبانيه/g],
  ['de', /\ballemand\b|\blangue allemande\b|\bgerman\b|الالمانيه/g],
  ['it', /\bitalien\b|\blangue italienne\b|\bitalian\b|الايطاليه/g],
  ['amazigh', /\bamazigh\b|\btamazight\b|\bberbere\b|\btachelhit\b|الامازيغيه/g],
];
// « restaurant italien », « groupe français », « petit-déjeuner anglais » : pas une langue.
const AVANT_NON_LANGUE = /(?:restaurant|chef|groupe|client|clients|traiteur|style|menu|plat|dejeuner|etablissement|lycee|institut|centre|salon|jardin|marche|public|ressortissant|مطبخ)\s+(?:\S+\s+)?$/;

export function extraireLangues(texteBrut: string): string[] {
  const texte = preparer(texteBrut);
  const trouvees: string[] = [];
  for (const [code, motif] of MOTS_LANGUES) {
    for (const m of texte.matchAll(motif)) {
      if (AVANT_NON_LANGUE.test(texte.slice(Math.max(0, m.index - 30), m.index))) continue;
      trouvees.push(code);
      break;
    }
  }
  return trouvees;
}

function extraireLogement(texte: string): 'loge' | 'non_loge' | null {
  if (/non\s+logee?s?\b|non\s+couchante|sans\s+logement|sans\s+hebergement|live[- ]out|بدون مبيت|بدون سكن|غير مقيمه/.test(texte)) return 'non_loge';
  const loge = new RegExp(
    String.raw`\blogee?s?\b|\bcouchante\b|hebergement\s+(?:fourni|assure|inclus|sur place|offert)|logement\s+(?:fourni|assure|inclus|de fonction|offert|sur place|possible)|possibilite\s+de\s+logement|avec\s+logement|avec\s+hebergement|live[- ]in|accommodation\s+provided|السكن متوفر|مع السكن|مع المبيت|بالمبيت|(?<!${AR})مبيت(?!${AR})|(?<!${AR})مقيمه(?!${AR})`,
  );
  return loge.test(texte) ? 'loge' : null;
}

// Mots tolérés entre « recrute » et le nombre de postes.
const REMPLISSAGE_EFFECTIF = String.raw`(?:\s+(?:en\s+urgence|urgent(?:e|s|es)?|immediat(?:e|ement)?|actuellement|de|des))*`;
// Le nombre ne doit pas être une durée, un âge, un montant ou un classement (« 2 ans », « de 18 à 35 ans », « 4 étoiles »).
const PAS_UNE_DUREE = String.raw`(?!ans?\b|annees?\b|mois\b|semaines?\b|jours?\b|heures?\b|h\b|dhs?\b|mad\b|etoiles?\b|a\s+\d|years?\b|months?\b|weeks?\b|days?\b|hours?\b|stars?\b|to\s+\d|\d)`;

function extraireEffectif(texte: string): { nombre: number | null; massif: boolean } {
  let nombre: number | null = null;
  const m =
    /(?:postes?\s+vacants?|nombre\s+de\s+postes?)\s*:?\s*(\d{1,3})(?!\d)/.exec(texte) ??
    /(?<![\d.,])(\d{1,3})\s*postes?\b/.exec(texte) ??
    // « recrute 12 femmes de chambre », « recrute en urgence 6… », « recrutement urgent : 6… », « cherche 3 serveurs »
    new RegExp(String.raw`recrut\w*${REMPLISSAGE_EFFECTIF}\s*:?\s*(\d{1,3})\s+${PAS_UNE_DUREE}`).exec(texte) ??
    new RegExp(String.raw`(?:recherch\w*|cherch\w*|embauch\w*|besoin\s+de|hiring|looking\s+for|seeking)\s+(\d{1,3})\s+${PAS_UNE_DUREE}`).exec(texte) ??
    new RegExp(String.raw`مطلوب\s+(\d{1,3})\s+(?!(?:سنه|سنوات|سنين|عام|اعوام)(?!${AR})|\d)`).exec(texte) ??
    new RegExp(String.raw`(?<![\d.,])(\d{1,3})\s*(?:positions\b|openings\b|vacancies\b|مناصب(?!${AR})|منصب(?!${AR}))`).exec(texte);
  if (m) {
    const valeur = Number(m[1]);
    if (valeur >= 1 && valeur <= 500) nombre = valeur;
  }
  const massif =
    (nombre !== null && nombre >= 5) ||
    /plusieurs\s+postes|recrutement\s+(?:massif|en masse|de masse)|campagne\s+de\s+recrutement|journee\s+de\s+recrutement|job\s?dating|en\s+vue\s+de\s+l'ouverture|pre-?ouverture|nouvelle\s+ouverture|ouverture\s+prochaine|ouverture\s+(?:du|de l'|d'un|d'une|de notre)\s+(?:nouvel?\s+|nouvelle\s+)?(?:[a-z' -]{0,30}\s)?(?:hotel|palace|resort|spa|riad|restaurant|etablissement|salon|centre|club|site)|عده مناصب|توظيف جماعي|multiple positions|mass hiring/.test(texte);
  return { nombre, massif };
}

// Le type d'employeur retenu est celui cité en premier dans l'annonce
// (« Hôtel 5* avec spa recrute… » → hôtel ; « Spa de l'hôtel X recrute… » → spa).
const REGLES_EMPLOYEUR: [TypeEmployeur, RegExp][] = [
  ['riad', /\briads?\b|\bryads?\b|maisons? d'hotes?|guest ?house|رياض|دار الضيافه/],
  ['spa', /\bspa\b|\bhammam\b|centre de bien-?etre|thalasso|سبا/],
  ['salon', /salon de (?:coiffure|beaute)|salon d'esthetique|institut de beaute|centre (?:d'esthetique|esthetique|de beaute)|barbershop|\bbarber shop\b|\bonglerie\b|nail bar|صالون/],
  ['hotel', /\bhotels?\b|\bpalace\b|\bresort\b|\bauberge\b|hotellerie|club de vacances|فندق|فنادق/],
  ['famille', /\bfamille\b|عايله|اسره|\bfamily\b/],
  ['particulier', /(?<!en )\bparticuliers?\b|\bvilla privee\b|chez un prive|\bprivate household\b|individual employer/],
  ['residence', /\bresidence\b|\bsyndic\b|copropriete|\bimmeuble\b|اقامه سكنيه/],
  ['entreprise', /\bsociete\b|\bentreprise\b|\bgroupe\b|\bsarl\b|\bagence\b|\bcabinet\b|\bcompany\b|شركه/],
];

export function devinerTypeEmployeur(texteBrut: string): TypeEmployeur | null {
  const texte = preparer(texteBrut);
  let meilleur: { type: TypeEmployeur; position: number } | null = null;
  for (const [type, motif] of REGLES_EMPLOYEUR) {
    const position = texte.search(motif);
    if (position >= 0 && (!meilleur || position < meilleur.position)) meilleur = { type, position };
  }
  return meilleur?.type ?? null;
}

const TELEPHONE = /(?<![\d+])(?:\+212|00212|0)[\s.-]?[5-7](?:[\s.-]?\d){8}(?!\d)/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Normalise un numéro marocain au format du site Yallah : « +212 6XX XXX XXX ». */
export function formaterTelephone(brut: string): string | null {
  const chiffres = brut.replace(/[^\d+]/g, '').replace(/^00/, '+');
  const national = chiffres.startsWith('+212')
    ? chiffres.slice(4).replace(/^0/, '')
    : chiffres.startsWith('212') && chiffres.length === 12
      ? chiffres.slice(3)
      : chiffres.startsWith('0')
        ? chiffres.slice(1)
        : chiffres;
  if (!/^[5-7]\d{8}$/.test(national)) return null;
  return `+212 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

export function extraireContacts(texteBrut: string): Extraction['contacts'] {
  const texte = preparer(texteBrut);
  const telephones = [...new Set([...texte.matchAll(TELEPHONE)].map((m) => formaterTelephone(m[0])).filter((t): t is string => Boolean(t)))];
  const emails = [...new Set([...texte.matchAll(EMAIL)].map((m) => m[0].toLowerCase()))];
  return { telephones, emails, whatsapp: /whats?\s?app|واتساب|واتس اب|\bwa\.me\b/.test(texte) };
}

/** Remplace téléphones et e-mails par un marqueur (extraits conservés sans coordonnées). */
export function masquerContacts(texte: string): string {
  return texte.replace(TELEPHONE, '[téléphone masqué]').replace(EMAIL, '[e-mail masqué]');
}

function phraseAutour(texteBrut: string, motif: RegExp, max = 120): string | null {
  const m = motif.exec(texteBrut);
  if (!m) return null;
  const debutLigne = texteBrut.lastIndexOf('\n', m.index) + 1;
  const finLigne = texteBrut.indexOf('\n', m.index);
  const fin = Math.min(finLigne < 0 ? texteBrut.length : finLigne, m.index + max);
  const debut = m.index - debutLigne <= 40 ? debutLigne : m.index;
  return masquerContacts(texteBrut.slice(debut, fin)).replace(/\s+/g, ' ').trim() || null;
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export function extraire(titre: string, texteBrut: string, maintenant: Date): Extraction {
  const complet = `${titre}\n${texteBrut}`;
  const texte = preparer(complet);
  const cleTexte = cle(complet);
  const effectif = extraireEffectif(texte);

  const permis = /permis(?:\s+de\s+conduire|\s+b)?\s+(?:non|pas)\s+(?:exige|requis|obligatoire|necessaire)|sans\s+permis/.test(texte)
    ? false
    : /permis\s+(?:de\s+conduire|b\b|categorie b|exige|obligatoire|requis)|\bvehiculee?\b|driving\s+licen[cs]e|driver'?s?\s+licen[cs]e|رخصه السياقه|رخصه القياده/.test(texte)
      ? true
      : null;

  const repas = /\bnourrie?s?\b|repas\s+(?:fournis?|assures?|inclus|offerts?|pris en charge)|restauration\s+(?:sur place|assuree|offerte)|meals?\s+(?:provided|included)|الوجبات|التغذيه/.test(texte) ? true : null;

  const urgent = /\burgent(?:e|s|es)?\b|\burgence\b|immediat(?:e|ement)?|des que possible|au plus tot|\basap\b|a pourvoir (?:rapidement|de suite)|tout de suite|عاجل|مستعجل|فورا|immediately|immediate start/.test(texte);

  return {
    salaire: extraireSalaire(complet),
    contrat: premier(cleTexte, REGLES_CONTRAT) ?? 'non_precise',
    tempsTravail: premier(cleTexte, REGLES_TEMPS) ?? 'non_precise',
    modeTravail: premier(cleTexte, REGLES_MODE) ?? 'non_precise',
    experience: extraireExperience(complet),
    langues: extraireLangues(complet),
    permis,
    logement: extraireLogement(texte),
    repas,
    horaires: phraseAutour(complet, /horaires?\s*:|de\s+\d{1,2}\s*h\d{0,2}\s*(?:à|a|-)\s*\d{1,2}\s*h|du lundi au|\d\s*j(?:ours)?\s*\/\s*7|\d\s*jours? (?:sur|par) (?:7|semaine)|ساعات العمل/i),
    disponibilite: phraseAutour(complet, /disponibilit[ée]\s*:|disponible\s+(?:imm[ée]diatement|de suite|d[èe]s)|[àa] pourvoir|date de d[ée]but|start date|تاريخ البدء/i, 90),
    nombrePostes: effectif.nombre,
    urgent,
    recrutementMassif: effectif.massif,
    typeEmployeur: devinerTypeEmployeur(complet),
    contacts: extraireContacts(complet),
    dates: extraireDates(complet, maintenant),
  };
}
