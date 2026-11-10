/** Mise en forme partagée (français, heure de Casablanca). Fonctions pures. */
import { accord } from '@/domaine/accord';
import { instantVersHorlogeMaroc, premierDuMois } from '@/domaine/fuseau';

const JOUR_MS = 86_400_000;

// L'heure de Casablanca est calculée par domaine/fuseau (qui connaît le retour du Maroc à GMT en
// septembre 2026 même si la base des fuseaux du serveur est ancienne), puis écrite « en UTC ».
const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDateLongue = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtHeure = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const fmtNombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

type DateEntree = Date | string | null | undefined;

function versDate(valeur: DateEntree): Date | null {
  if (!valeur) return null;
  // Une date SQL « AAAA-MM-JJ » (sans heure) est placée à midi : aucun décalage de jour.
  const date = valeur instanceof Date ? valeur : new Date(/^\d{4}-\d{2}-\d{2}$/.test(valeur) ? `${valeur}T12:00:00Z` : valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const dateCourte = (valeur: DateEntree): string => {
  const date = versDate(valeur);
  return date ? fmtDate.format(instantVersHorlogeMaroc(date)) : '—';
};
/** « mardi 10 novembre 2026 », « jeudi 1er janvier 2026 ». */
export const dateLongue = (valeur: DateEntree): string => {
  const date = versDate(valeur);
  return date ? premierDuMois(fmtDateLongue.format(instantVersHorlogeMaroc(date))) : '—';
};
export const dateHeure = (valeur: DateEntree): string => {
  const date = versDate(valeur);
  return date ? fmtHeure.format(instantVersHorlogeMaroc(date)).replace(':', ' h ') : '—';
};
/** Valeur d'un <input type="date"> (jour de Casablanca). */
export const dateIso = (valeur: DateEntree): string => {
  const date = versDate(valeur);
  return date ? instantVersHorlogeMaroc(date).toISOString().slice(0, 10) : '';
};

export const nombre = (valeur: number | null | undefined): string => (valeur === null || valeur === undefined ? '—' : fmtNombre.format(valeur));
export const dirhams = (valeur: number | null | undefined): string => (valeur === null || valeur === undefined ? '—' : `${fmtNombre.format(valeur)} DH`);
export { accord };

/** « 1 offre », « 12 offres », « 1 200 offres » : nombre au format français suivi du mot accordé. */
export const pluriel = (n: number, singulier: string, plurielForme = `${singulier}s`): string => `${fmtNombre.format(n)} ${accord(n, singulier, plurielForme)}`;

/**
 * « aujourd'hui », « hier », « il y a 5 jours », « il y a 3 semaines »…
 * Compté en jours civils de Casablanca, pas en tranches de 24 heures : une
 * annonce datée d'aujourd'hui (jour seul, placé en milieu de journée) est
 * « aujourd'hui » dès le matin, et celle d'hier soir est « hier ».
 */
export function ilYA(valeur: DateEntree, maintenant: Date = new Date()): string {
  const date = versDate(valeur);
  if (!date) return 'date inconnue';
  const jours = Math.round((Date.parse(dateIso(maintenant)) - Date.parse(dateIso(date))) / JOUR_MS);
  if (jours < 0) return `dans ${pluriel(-jours, 'jour')}`;
  if (jours === 0) return 'aujourd’hui';
  if (jours === 1) return 'hier';
  if (jours < 14) return `il y a ${jours} jours`;
  if (jours < 60) return `il y a ${Math.round(jours / 7)} semaines`;
  return `il y a ${Math.round(jours / 30)} mois`;
}

/** « dans 3 jours », « aujourd'hui », « en retard de 2 jours ». */
export function echeance(valeur: DateEntree, maintenant: Date = new Date()): { texte: string; retard: boolean } {
  const date = versDate(valeur);
  if (!date) return { texte: '—', retard: false };
  const jours = Math.round((new Date(dateIso(date)).getTime() - new Date(dateIso(maintenant)).getTime()) / JOUR_MS);
  if (jours === 0) return { texte: 'aujourd’hui', retard: false };
  if (jours > 0) return { texte: jours === 1 ? 'demain' : `dans ${jours} jours`, retard: false };
  return { texte: `en retard de ${pluriel(-jours, 'jour')}`, retard: true };
}

const PERIODES: Record<string, string> = { mois: 'par mois', semaine: 'par semaine', jour: 'par jour', heure: 'de l’heure' };

export function salaire(min: number | null | undefined, max: number | null | undefined, periode: string | null | undefined): string | null {
  if (min == null && max == null) return null;
  const suffixe = periode ? ` ${PERIODES[periode] ?? ''}` : '';
  if (min != null && max != null && max !== min) return `${fmtNombre.format(min)} – ${fmtNombre.format(max)} DH${suffixe}`;
  return `${fmtNombre.format((min ?? max)!)} DH${suffixe}`;
}

/** Vrai si le texte contient des lettres arabes (affichage de droite à gauche). */
export const estArabe = (texte: string | null | undefined): boolean => Boolean(texte && /[\u0600-\u06FF]/.test(texte));

export function initiales(nom: string): string {
  return nom.split(/\s+/).filter(Boolean).slice(0, 2).map((mot) => mot[0]!.toUpperCase()).join('');
}
