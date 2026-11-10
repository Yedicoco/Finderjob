/**
 * Commissions : calcul, règles de statut et garde-fou de conformité.
 *
 * ⚠ Commission côté travailleur
 *   Le cahier des charges demande de pouvoir suivre une commission payée par
 *   l'employeur ET une commission payée par le travailleur. Or :
 *     - l'article 480 du Code du travail (loi n° 65-99) interdit aux agences
 *       de recrutement privées de percevoir, directement ou indirectement, des
 *       émoluments ou frais des demandeurs d'emploi ;
 *     - le site Yallah Services promet aux candidats « Aucun frais, jamais ».
 *   Le modèle de données sait donc enregistrer les deux, mais la saisie côté
 *   travailleur est DÉSACTIVÉE par défaut et, une fois activée par un
 *   administrateur, exige un accusé de lecture nominatif et motivé. Ce module
 *   ne donne pas d'avis juridique : faire valider par un conseil.
 */
import { ErreurMetier } from './erreurs';
export type Payeur = 'employeur' | 'travailleur';
export type ModeCalcul = 'forfait' | 'pourcentage';
export type StatutCommission = 'du' | 'facture' | 'encaisse' | 'annule';

export const AVERTISSEMENT_COMMISSION_TRAVAILLEUR =
  'Facturer un travailleur est en principe interdit aux agences de recrutement privées (article 480 du Code du travail) et contredit la promesse « Aucun frais, jamais » faite aux candidats sur le site Yallah Services. À n’utiliser qu’après validation juridique.';

export const LONGUEUR_MIN_JUSTIFICATION = 20;

export function arrondir(montant: number): number {
  return Math.round((montant + Number.EPSILON) * 100) / 100;
}

export function calculerMontant(entree: { mode: ModeCalcul; montantForfait?: number | null; base?: number | null; taux?: number | null }): number {
  if (entree.mode === 'forfait') {
    if (entree.montantForfait == null || !Number.isFinite(entree.montantForfait) || entree.montantForfait < 0) {
      throw new ErreurCommission('Le montant fixe est obligatoire et ne peut pas être négatif.');
    }
    return arrondir(entree.montantForfait);
  }
  if (entree.base == null || !Number.isFinite(entree.base) || entree.base <= 0) {
    throw new ErreurCommission('La base de calcul (salaire) est obligatoire pour une commission en pourcentage.');
  }
  if (entree.taux == null || !Number.isFinite(entree.taux) || entree.taux <= 0 || entree.taux > 100) {
    throw new ErreurCommission('Le taux doit être compris entre 0 et 100 %.');
  }
  return arrondir((entree.base * entree.taux) / 100);
}

export class ErreurCommission extends ErreurMetier {}

/** Vérifie qu'une commission peut être créée pour ce payeur. Renvoie la liste des refus (vide = autorisé). */
export function verifierPayeur(entree: {
  payeur: Payeur;
  commissionTravailleurActive: boolean;
  accuseLecture: boolean;
  justification: string | null | undefined;
}): string[] {
  if (entree.payeur === 'employeur') return [];
  const refus: string[] = [];
  if (!entree.commissionTravailleurActive) {
    refus.push('La commission côté travailleur est désactivée (Administration › Paramètres).');
  }
  if (!entree.accuseLecture) {
    refus.push('Vous devez confirmer avoir lu l’avertissement juridique.');
  }
  if (!entree.justification || entree.justification.trim().length < LONGUEUR_MIN_JUSTIFICATION) {
    refus.push(`Une justification d’au moins ${LONGUEUR_MIN_JUSTIFICATION} caractères est obligatoire (base juridique, validation obtenue).`);
  }
  return refus;
}

const TRANSITIONS: Record<StatutCommission, StatutCommission[]> = {
  du: ['facture', 'encaisse', 'annule'],
  facture: ['encaisse', 'annule', 'du'],
  encaisse: ['annule'],
  annule: [],
};

export function transitionAutorisee(depuis: StatutCommission, vers: StatutCommission): boolean {
  return TRANSITIONS[depuis].includes(vers);
}

export function transitionsPossibles(depuis: StatutCommission): StatutCommission[] {
  return TRANSITIONS[depuis];
}

/** Date de fin de la période de remplacement prévue par la formule (Premium 6 mois, Sérénité 2 mois). */
export function finRemplacement(dateDebut: string, mois: number): string {
  const [annee, moisDebut, jour] = dateDebut.split('-').map(Number) as [number, number, number];
  const cible = new Date(Date.UTC(annee, moisDebut - 1 + mois, 1));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(jour, dernierJour));
  return cible.toISOString().slice(0, 10);
}

export type TotauxCommissions = Record<StatutCommission, number> & { parPayeur: Record<Payeur, number> };

export function totaliser(commissions: { status: StatutCommission; amount: number; payer: Payeur }[]): TotauxCommissions {
  const totaux: TotauxCommissions = { du: 0, facture: 0, encaisse: 0, annule: 0, parPayeur: { employeur: 0, travailleur: 0 } };
  for (const commission of commissions) {
    totaux[commission.status] = arrondir(totaux[commission.status] + commission.amount);
    if (commission.status !== 'annule') {
      totaux.parPayeur[commission.payer] = arrondir(totaux.parPayeur[commission.payer] + commission.amount);
    }
  }
  return totaux;
}
