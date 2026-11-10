/**
 * Statut d'une offre : actif, expiré, douteux, archivé.
 *
 * Deux moments :
 *   1. À l'enregistrement, `statutInitial()` décide du statut stocké.
 *   2. À chaque lecture, `statutEffectif()` recalcule ce qui dépend du temps
 *      (expiration, ancienneté, absence de revérification). C'est le miroir
 *      exact des fonctions SQL ys_effective_status / ys_effective_reason
 *      (db/migrations/0002) ; un test d'intégration compare les deux.
 *
 * Règle absolue : sans date de publication connue, une offre n'est jamais « active ».
 */
import type { PrecisionDate } from './extraction';
import type { Parametres } from './parametres';

export type StatutOffre = 'actif' | 'expire' | 'douteux' | 'archive';
export type MotifStatut =
  | 'aucun' | 'date_inconnue' | 'date_incoherente' | 'hors_perimetre_date' | 'localisation_inconnue'
  | 'expiree_source' | 'expiree_anciennete' | 'non_reverifiee' | 'risque_eleve' | 'doublon'
  | 'source_indisponible' | 'rejetee_moderation' | 'pourvue' | 'archivage_manuel';
export type StatutVerification = 'non_requise' | 'a_verifier' | 'verifiee' | 'rejetee';

const JOUR_MS = 86_400_000;
/** Tolérance pour une date « dans le futur » (décalage horaire ou horloge de la source). */
export const TOLERANCE_FUTUR_MS = 2 * JOUR_MS;

export type DecisionStatut = {
  statut: StatutOffre;
  motif: MotifStatut;
  verification: StatutVerification;
  revueHumaine: boolean;
};

export function statutInitial(entree: {
  publieLe: Date | null;
  precisionDate: PrecisionDate;
  expireLe: Date | null;
  /** 'MA' = lieu marocain reconnu ; 'inconnu' = aucun lieu trouvé. (Une offre étrangère n'arrive jamais ici.) */
  pays: 'MA' | 'inconnu';
  villeConnue: boolean;
  scoreRisque: number;
  estDoublonDe: boolean;
  /** Lieu étranger cité dans le titre, critère discriminatoire… : revue demandée sans changer le statut. */
  revueDemandee?: boolean;
  maintenant: Date;
  parametres: Pick<Parametres, 'perimetre' | 'offres' | 'risque'>;
}): DecisionStatut {
  const { publieLe, maintenant, parametres } = entree;
  const dateMin = new Date(parametres.perimetre.dateMin);

  // 1. Date : inconnue ou incohérente → jamais active.
  if (!publieLe || entree.precisionDate === 'inconnue') {
    return { statut: 'douteux', motif: 'date_inconnue', verification: 'a_verifier', revueHumaine: true };
  }
  if (publieLe.getTime() > maintenant.getTime() + TOLERANCE_FUTUR_MS) {
    return { statut: 'douteux', motif: 'date_incoherente', verification: 'a_verifier', revueHumaine: true };
  }
  // 2. Périmètre : publiée avant le début de la recherche (paramètre) → archivée, hors des résultats.
  if (publieLe.getTime() < dateMin.getTime()) {
    return { statut: 'archive', motif: 'hors_perimetre_date', verification: 'non_requise', revueHumaine: false };
  }
  // 3. Doublon : rattachée à l'offre principale.
  if (entree.estDoublonDe) {
    return { statut: 'archive', motif: 'doublon', verification: 'non_requise', revueHumaine: false };
  }
  // 4. Lieu non confirmé au Maroc.
  if (entree.pays === 'inconnu') {
    return { statut: 'douteux', motif: 'localisation_inconnue', verification: 'a_verifier', revueHumaine: true };
  }
  // 5. Risque élevé.
  if (entree.scoreRisque >= parametres.risque.seuilEleve) {
    return { statut: 'douteux', motif: 'risque_eleve', verification: 'a_verifier', revueHumaine: true };
  }
  // 6. Expiration.
  if (entree.expireLe && entree.expireLe.getTime() <= maintenant.getTime()) {
    return { statut: 'expire', motif: 'expiree_source', verification: 'non_requise', revueHumaine: false };
  }
  if (!entree.expireLe && publieLe.getTime() < maintenant.getTime() - parametres.offres.dureeValiditeJours * JOUR_MS) {
    return { statut: 'expire', motif: 'expiree_anciennete', verification: 'non_requise', revueHumaine: false };
  }
  const revue = Boolean(entree.revueDemandee) || !entree.villeConnue;
  return { statut: 'actif', motif: 'aucun', verification: revue ? 'a_verifier' : 'non_requise', revueHumaine: revue };
}

/**
 * Motifs de statutInitial() qui disent que l'annonce n'a pas de date fiable
 * dans la période de recherche (règles 1 et 2). Tout autre motif signifie
 * qu'elle a été publiée dans la période. Sert aux doublons : une annonce de
 * la période n'est jamais masquée par une annonce plus ancienne que le début
 * de la recherche.
 */
export const MOTIFS_HORS_PERIODE: readonly MotifStatut[] = ['date_inconnue', 'date_incoherente', 'hors_perimetre_date'];

export type EntreeStatutEffectif = {
  statut: StatutOffre;
  motif: MotifStatut;
  publieLe: Date | null;
  precisionDate: PrecisionDate;
  expireLe: Date | null;
  verifieLe: Date;
};

/** Statut tel qu'il doit être affiché maintenant (miroir de ys_effective_status). */
export function statutEffectif(
  offre: EntreeStatutEffectif,
  maintenant: Date,
  delais: { dureeValiditeJours: number; delaiReverificationJours: number },
): { statut: StatutOffre; motif: MotifStatut } {
  if (offre.statut !== 'actif') return { statut: offre.statut, motif: offre.motif };
  if (!offre.publieLe || offre.precisionDate === 'inconnue') return { statut: 'douteux', motif: 'date_inconnue' };
  if (offre.expireLe && offre.expireLe.getTime() <= maintenant.getTime()) return { statut: 'expire', motif: 'expiree_source' };
  if (!offre.expireLe && offre.publieLe.getTime() < maintenant.getTime() - delais.dureeValiditeJours * JOUR_MS) {
    return { statut: 'expire', motif: 'expiree_anciennete' };
  }
  if (offre.verifieLe.getTime() < maintenant.getTime() - delais.delaiReverificationJours * JOUR_MS) {
    return { statut: 'douteux', motif: 'non_reverifiee' };
  }
  return { statut: 'actif', motif: 'aucun' };
}

/** Âge d'une offre en jours entiers (pour l'affichage « il y a 3 jours »). */
export function ageEnJours(publieLe: Date | null, maintenant: Date): number | null {
  if (!publieLe) return null;
  return Math.max(0, Math.floor((maintenant.getTime() - publieLe.getTime()) / JOUR_MS));
}
