/**
 * Heure légale du Maroc.
 *
 * Depuis le 20 septembre 2026 à 2 h du matin, le Maroc est à l'heure GMT (UTC+0)
 * toute l'année. D'octobre 2018 à cette date, il était à UTC+1, sauf pendant le
 * ramadan où il repassait à UTC+0. On ne code donc jamais un décalage en dur
 * pour une date saisie : il est calculé pour l'instant demandé.
 *
 * Le décalage est lu dans la base des fuseaux du moteur d'exécution
 * (Africa/Casablanca). Une base antérieure à juillet 2026 (tzdata < 2026c)
 * ignore le retour à GMT : dans ce cas seulement, la règle connue est appliquée
 * ici. Une base à jour est suivie telle quelle — y compris si la règle change de
 * nouveau. L'affichage passe par `instantVersHorlogeMaroc()` et jamais par
 * l'option `timeZone` d'Intl, pour donner le même résultat sur tous les serveurs.
 * Miroir SQL : ys_heure_maroc() (db/migrations/0003). Fonctions pures.
 */

export const FUSEAU_MAROC = 'Africa/Casablanca';

/** Retour à UTC+0 : le 20 septembre 2026 à 2 h (heure UTC+1), soit 1 h UTC. Source : base tz, version 2026c. */
export const RETOUR_GMT_MS = Date.UTC(2026, 8, 20, 1, 0, 0);

const horloge = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSEAU_MAROC,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Décalage (en ms) selon la base des fuseaux du moteur d'exécution, sans correction. */
function decalageSelonBase(instant: Date): number {
  const p: Record<string, number> = {};
  for (const partie of horloge.formatToParts(instant)) if (partie.type !== 'literal') p[partie.type] = Number(partie.value);
  const affiche = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  return affiche - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Vrai si la base des fuseaux du moteur d'exécution connaît le retour à GMT de septembre 2026. */
export const baseFuseauxAJour: boolean = decalageSelonBase(new Date(Date.UTC(2026, 10, 10, 12))) === 0;

/**
 * Décalage (en ms) entre l'heure de Casablanca et UTC à l'instant donné.
 * `baseAJour` n'est passé que par les tests, pour exercer les deux chemins.
 */
export function decalageMaroc(instant: Date, baseAJour: boolean = baseFuseauxAJour): number {
  if (!baseAJour && instant.getTime() >= RETOUR_GMT_MS) return 0;
  return decalageSelonBase(instant);
}

/**
 * Date dont les champs UTC valent ce qu'affiche une horloge de Casablanca à
 * l'instant donné. À mettre en forme avec `timeZone: 'UTC'`.
 */
export function instantVersHorlogeMaroc(instant: Date): Date {
  return new Date(instant.getTime() + decalageMaroc(instant));
}

/**
 * Instant correspondant à une date et une heure lues sur une horloge de
 * Casablanca. Renvoie `null` si la date n'existe pas (31 février…).
 */
export function instantMaroc(annee: number, mois: number, jour: number, heure = 0, minute = 0, seconde = 0): Date | null {
  if (![annee, mois, jour, heure, minute, seconde].every(Number.isInteger)) return null;
  if (annee < 1970 || annee > 2100 || mois < 1 || mois > 12 || jour < 1 || jour > 31 || heure < 0 || heure > 23 || minute < 0 || minute > 59 || seconde < 0 || seconde > 59) return null;
  const naif = Date.UTC(annee, mois - 1, jour, heure, minute, seconde);
  const controle = new Date(naif);
  if (controle.getUTCMonth() !== mois - 1 || controle.getUTCDate() !== jour) return null;
  // Deux passes : la première estime le décalage, la seconde le corrige si
  // l'estimation tombait de l'autre côté d'un changement d'heure.
  let instant = naif - decalageMaroc(new Date(naif));
  instant = naif - decalageMaroc(new Date(instant));
  return new Date(instant);
}

/**
 * Interprète comme heure de Casablanca une date qui a été lue comme si elle
 * était en UTC (cas d'une date écrite sans fuseau).
 */
export function horlogeMarocVersInstant(lueCommeUtc: Date): Date {
  const naif = lueCommeUtc.getTime();
  let instant = naif - decalageMaroc(new Date(naif));
  instant = naif - decalageMaroc(new Date(instant));
  return new Date(instant);
}

const jourEcrit = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

/** Usage français : le premier jour du mois s'écrit « 1er » (« 1er janvier 2026 », « jeudi 1er janvier 2026 »). */
export const premierDuMois = (dateEcrite: string): string => dateEcrite.replace(/(^| )1 (?=\p{L})/u, '$11er ');

/** « 10 novembre 2026 », « 1er janvier 2026 » : le jour de Casablanca, écrit en toutes lettres. */
export const jourEcritMaroc = (instant: Date): string => premierDuMois(jourEcrit.format(instantVersHorlogeMaroc(instant)));

const JOUR_SEUL = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Lit un jour « AAAA-MM-JJ » (valeur d'un champ date) et le place à l'heure
 * voulue à Casablanca. Renvoie `null` si le texte n'est pas un jour valide.
 */
export function jourMaroc(texte: string, moment: 'debut' | 'midi' | 'fin' = 'debut'): Date | null {
  const m = JOUR_SEUL.exec(texte.trim());
  if (!m) return null;
  const [heure, minute, seconde] = moment === 'debut' ? [0, 0, 0] : moment === 'midi' ? [12, 0, 0] : [23, 59, 59];
  return instantMaroc(Number(m[1]), Number(m[2]), Number(m[3]), heure, minute, seconde);
}

/**
 * Date saisie dans un formulaire : un jour seul (« AAAA-MM-JJ », placé à l'heure
 * voulue à Casablanca) ou un instant complet avec fuseau. `null` si illisible.
 */
export function dateSaisieMaroc(texte: string, moment: 'debut' | 'midi' | 'fin' = 'midi', heure?: number): Date | null {
  const propre = texte.trim();
  const m = JOUR_SEUL.exec(propre);
  if (m) return heure === undefined ? jourMaroc(propre, moment) : instantMaroc(Number(m[1]), Number(m[2]), Number(m[3]), heure);
  // Un instant complet doit porter son fuseau : sans lui, le résultat dépendrait du réglage du serveur.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(propre)) return null;
  const date = new Date(propre);
  return Number.isNaN(date.getTime()) ? null : date;
}
