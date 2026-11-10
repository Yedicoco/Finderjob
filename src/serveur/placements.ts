/**
 * Placements et commissions.
 *
 * Rappel de conformité : la commission côté travailleur est désactivée par
 * défaut. L'article 480 du Code du travail interdit aux agences de recrutement
 * privées de percevoir des frais des demandeurs d'emploi, et le site Yallah
 * Services promet « Aucun frais, jamais » aux candidats. Le logiciel ne
 * l'accepte qu'après activation explicite du paramètre, accusé de lecture
 * nominatif et justification écrite — trois traces conservées au journal.
 */
import {
  arrondir, calculerMontant, ErreurCommission, finRemplacement, totaliser, transitionAutorisee, verifierPayeur,
  type ModeCalcul, type Payeur, type StatutCommission, type TotauxCommissions,
} from '@/domaine/commissions';
import { villeParCode } from '@/domaine/geographie';
import { CONTRATS, MODES_CALCUL, MOYENS_PAIEMENT, PAYEURS, PERIODES_SALAIRE, STATUTS_COMMISSION, STATUTS_PLACEMENT } from '@/domaine/referentiels';
import { metierParCode } from '@/domaine/taxonomie';
import { journaliser, type Acteur } from './audit';
import { changerStatutCandidat } from './candidats';
import { dechiffrerOuVide } from './chiffrement';
import { changerStatutBesoin, changerStatutEmployeur } from './employeurs';
import { executer, prochaineReference, requete, transaction, uneLigne, type Executeur } from './db';
import { chargerParametres } from './parametres';
import { idsCategories } from './referentiel';
import { ErreurMetier } from '@/domaine/erreurs';
import { jourEcritMaroc } from '@/domaine/fuseau';

export class ErreurPlacement extends ErreurMetier {}
export { ErreurCommission };

export type SaisiePlacement = {
  employeurId: string;
  candidatId: string;
  offreId?: string | null;
  besoinId?: string | null;
  correspondanceId?: string | null;
  metier?: string | null;
  ville?: string | null;
  debut: string;
  contrat?: string;
  salaire?: number | null;
  periodeSalaire?: string;
  notes?: string | null;
  /** Crée la commission employeur prévue par la formule du besoin (Premium, Sérénité, sur mesure). */
  avecCommissionFormule?: boolean;
};

export async function creerPlacement(s: SaisiePlacement, acteur: Acteur, maintenant = new Date()): Promise<{ id: string; reference: string; commissionId: string | null }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.debut ?? '')) throw new ErreurPlacement('Date de début invalide.');
  const contrat = s.contrat ?? 'non_precise';
  if (!CONTRATS.est(contrat)) throw new ErreurPlacement('Contrat inconnu.');
  const periode = s.periodeSalaire ?? 'mois';
  if (!PERIODES_SALAIRE.est(periode)) throw new ErreurPlacement('Période de salaire inconnue.');
  const salaire = s.salaire ?? null;
  if (salaire !== null && (!(salaire > 0) || salaire > 1_000_000)) throw new ErreurPlacement('Salaire convenu invalide.');
  if (s.metier && !metierParCode(s.metier)) throw new ErreurPlacement('Métier inconnu.');
  if (s.ville && !villeParCode(s.ville)) throw new ErreurPlacement('Ville inconnue du référentiel.');
  const parametres = await chargerParametres();
  const categories = await idsCategories();

  return transaction(async (tx) => {
    const candidat = await uneLigne<{ reference: string; status: string; anonymized_at: Date | null; is_demo: boolean }>(`SELECT reference, status, anonymized_at, is_demo FROM candidates WHERE id = $1 FOR UPDATE`, [s.candidatId], tx);
    if (!candidat) throw new ErreurPlacement('Candidat introuvable.');
    if (candidat.anonymized_at) throw new ErreurPlacement('Fiche candidat anonymisée : placement impossible.');
    const enCours = await uneLigne<{ reference: string }>(`SELECT reference FROM placements WHERE candidate_id = $1 AND status IN ('en_cours', 'confirme')`, [s.candidatId], tx);
    if (enCours) throw new ErreurPlacement(`Ce candidat a déjà un placement en cours (${enCours.reference}).`);
    const employeur = await uneLigne<{ reference: string; is_demo: boolean }>(`SELECT reference, is_demo FROM employers WHERE id = $1 FOR UPDATE`, [s.employeurId], tx);
    if (!employeur) throw new ErreurPlacement('Employeur introuvable.');
    if (employeur.is_demo !== candidat.is_demo) throw new ErreurPlacement('Une fiche fictive du jeu de démonstration ne peut pas être associée à une fiche réelle.');
    const besoin = s.besoinId
      ? await uneLigne<{ employer_id: string; category_id: string | null; city_code: string | null; headcount: number; fee_plan: 'premium' | 'serenite' | 'sur_mesure' | null; fee_amount: number | null; contract_type: string }>(
          `SELECT employer_id, category_id, city_code, headcount, fee_plan, fee_amount, contract_type FROM employer_needs WHERE id = $1 FOR UPDATE`, [s.besoinId], tx)
      : null;
    if (s.besoinId && !besoin) throw new ErreurPlacement('Besoin introuvable.');
    if (besoin && besoin.employer_id !== s.employeurId) throw new ErreurPlacement('Ce besoin appartient à un autre employeur.');
    const offre = s.offreId ? await uneLigne<{ primary_category_id: string | null; city_code: string | null }>(`SELECT primary_category_id, city_code FROM job_offers WHERE id = $1`, [s.offreId], tx) : null;
    if (s.offreId && !offre) throw new ErreurPlacement('Offre introuvable.');

    const categorie = s.metier ? (categories.get(s.metier) ?? null) : (besoin?.category_id ?? offre?.primary_category_id ?? null);
    const ville = s.ville || besoin?.city_code || offre?.city_code || null;
    const moisRemplacement = besoin?.fee_plan === 'premium' || besoin?.fee_plan === 'serenite' ? parametres.commissions.formules[besoin.fee_plan].remplacementMois : null;
    const cree = await uneLigne<{ id: string; reference: string }>(
      `INSERT INTO placements (reference, employer_id, candidate_id, job_offer_id, employer_need_id, match_id, category_id, city_code, start_date, contract_type, agreed_salary,
                               salary_period, replacement_until, notes, created_by)
       VALUES (${prochaineReference('PL', employeur.is_demo)}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id, reference`,
      [s.employeurId, s.candidatId, s.offreId || null, s.besoinId || null, s.correspondanceId || null, categorie, ville, s.debut,
        contrat === 'non_precise' && besoin ? besoin.contract_type : contrat, salaire, periode, moisRemplacement ? finRemplacement(s.debut, moisRemplacement) : null,
        s.notes?.trim().slice(0, 2000) || null, acteur.id],
      tx,
    );
    await changerStatutCandidat(s.candidatId, 'place', acteur, maintenant, tx);
    await changerStatutEmployeur(s.employeurId, 'placement_realise', acteur, tx);
    if (s.correspondanceId) await executer(`UPDATE matches SET status = 'accepte', status_changed_at = $2, status_changed_by = $3 WHERE id = $1 AND candidate_id = $4`, [s.correspondanceId, maintenant, acteur.id, s.candidatId], tx);
    if (s.besoinId && besoin) {
      const places = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM placements WHERE employer_need_id = $1 AND status NOT IN ('annule', 'rompu')`, [s.besoinId], tx))!.n;
      await changerStatutBesoin(s.besoinId, places >= besoin.headcount ? 'pourvu' : 'en_cours', acteur, tx);
    }
    await journaliser({ acteur, action: 'placement.creation', entite: 'placement', id: cree!.id, resume: `Placement ${cree!.reference} : ${candidat.reference} chez ${employeur.reference}`, changements: { debut: s.debut, contrat, salaire } }, tx);

    let commissionId: string | null = null;
    if (s.avecCommissionFormule && besoin?.fee_plan && besoin.fee_amount !== null && besoin.fee_amount > 0) {
      const libelle = besoin.fee_plan === 'sur_mesure' ? 'Frais de placement (sur mesure)' : `Formule ${parametres.commissions.formules[besoin.fee_plan].libelle}`;
      commissionId = (await creerCommission(cree!.id, { payeur: 'employeur', mode: 'forfait', montant: besoin.fee_amount, libelle, echeance: s.debut }, acteur, maintenant, tx)).id;
    }
    return { ...cree!, commissionId };
  });
}

const SUITES_PLACEMENT: Record<string, string[]> = {
  en_cours: ['confirme', 'rompu', 'annule'],
  confirme: ['termine', 'rompu'],
  termine: [],
  rompu: [],
  annule: [],
};
export const suitesPlacement = (statut: string): string[] => SUITES_PLACEMENT[statut] ?? [];

export async function changerStatutPlacement(id: string, statut: string, acteur: Acteur, note?: string | null, maintenant = new Date()): Promise<void> {
  if (!STATUTS_PLACEMENT.est(statut)) throw new ErreurPlacement('Statut inconnu.');
  await transaction(async (tx) => {
    const p = await uneLigne<{ status: string; reference: string; candidate_id: string; employer_need_id: string | null; notes: string | null }>(`SELECT status, reference, candidate_id, employer_need_id, notes FROM placements WHERE id = $1 FOR UPDATE`, [id], tx);
    if (!p) throw new ErreurPlacement('Placement introuvable.');
    if (p.status === statut) return;
    if (!suitesPlacement(p.status).includes(statut)) throw new ErreurPlacement(`Passage impossible de « ${STATUTS_PLACEMENT.libelle(p.status)} » à « ${STATUTS_PLACEMENT.libelle(statut)} ».`);
    if ((statut === 'rompu' || statut === 'annule') && (note ?? '').trim().length < 5) throw new ErreurPlacement('Indiquez le motif en quelques mots.');
    const notes = note?.trim() ? [p.notes, `${jourEcritMaroc(maintenant)} — ${STATUTS_PLACEMENT.libelle(statut)} : ${note.trim().slice(0, 500)}`].filter(Boolean).join('\n') : p.notes;
    await executer(`UPDATE placements SET status = $2, notes = $3 WHERE id = $1`, [id, statut, notes], tx);
    if (statut === 'rompu' || statut === 'annule' || statut === 'termine') {
      // Le candidat peut de nouveau être proposé : il repasse à « Contacté » (sauf fiche anonymisée).
      const candidat = await uneLigne<{ anonymized_at: Date | null; status: string }>(`SELECT anonymized_at, status FROM candidates WHERE id = $1`, [p.candidate_id], tx);
      if (candidat && !candidat.anonymized_at && candidat.status === 'place') await changerStatutCandidat(p.candidate_id, 'contacte', acteur, maintenant, tx);
      if (p.employer_need_id && statut !== 'termine') await executer(`UPDATE employer_needs SET status = 'en_cours' WHERE id = $1 AND status = 'pourvu'`, [p.employer_need_id], tx);
    }
    await journaliser({ acteur, action: 'placement.statut', entite: 'placement', id, resume: `${p.reference} : ${p.status} › ${statut}`, changements: { avant: p.status, apres: statut, note: note ?? null } }, tx);
  });
}

export type PlacementListe = {
  id: string; reference: string; status: string; start_date: string; contract_type: string; agreed_salary: number | null; salary_period: string; replacement_until: string | null;
  city_code: string | null; metier: string | null; employer_id: string; employeur: string; candidate_id: string; candidat_reference: string; candidat_nom: string | null;
  job_offer_id: string | null; employer_need_id: string | null; notes: string | null; created_at: Date; commissions_dues: number; commissions_encaissees: number;
  /** Placement du jeu de démonstration (employeur et candidat inventés). */
  fictif: boolean;
};

const SELECT_PLACEMENT = `SELECT p.id, p.reference, p.status, p.start_date, p.contract_type, p.agreed_salary, p.salary_period, p.replacement_until, p.city_code, c.code AS metier,
            p.employer_id, e.name AS employeur, e.is_demo AS fictif, p.candidate_id, k.reference AS candidat_reference, k.full_name_enc, p.job_offer_id, p.employer_need_id, p.notes, p.created_at,
            COALESCE((SELECT sum(amount) FROM commissions co WHERE co.placement_id = p.id AND co.status IN ('du', 'facture')), 0)::float AS commissions_dues,
            COALESCE((SELECT sum(amount) FROM commissions co WHERE co.placement_id = p.id AND co.status = 'encaisse'), 0)::float AS commissions_encaissees
       FROM placements p JOIN employers e ON e.id = p.employer_id JOIN candidates k ON k.id = p.candidate_id LEFT JOIN job_categories c ON c.id = p.category_id`;

const versPlacement = ({ full_name_enc, ...reste }: Omit<PlacementListe, 'candidat_nom'> & { full_name_enc: string | null }): PlacementListe => ({ ...reste, candidat_nom: dechiffrerOuVide(full_name_enc) });

export async function listerPlacements(filtres: { statut?: string; employeur?: string; candidat?: string } = {}): Promise<PlacementListe[]> {
  const conditions: string[] = [];
  const valeurs: unknown[] = [];
  const p = (valeur: unknown) => `$${valeurs.push(valeur)}`;
  if (filtres.statut) conditions.push(`p.status = ${p(filtres.statut)}`);
  if (filtres.employeur) conditions.push(`p.employer_id = ${p(filtres.employeur)}`);
  if (filtres.candidat) conditions.push(`p.candidate_id = ${p(filtres.candidat)}`);
  const lignes = await requete<Omit<PlacementListe, 'candidat_nom'> & { full_name_enc: string | null }>(`${SELECT_PLACEMENT} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY p.start_date DESC, p.created_at DESC LIMIT 200`, valeurs);
  return lignes.map(versPlacement);
}

export async function placementParId(id: string): Promise<(PlacementListe & { commissions: Commission[] }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const ligne = await uneLigne<Omit<PlacementListe, 'candidat_nom'> & { full_name_enc: string | null }>(`${SELECT_PLACEMENT} WHERE p.id = $1`, [id]);
  if (!ligne) return null;
  return { ...versPlacement(ligne), commissions: await listerCommissions({ placement: id }) };
}

// -------------------------------------------------------------------- commissions --

export type SaisieCommission = {
  payeur: string;
  mode: string;
  montant?: number | null;
  base?: number | null;
  taux?: number | null;
  libelle?: string | null;
  echeance?: string | null;
  notes?: string | null;
  accuseLecture?: boolean;
  justification?: string | null;
};

export async function creerCommission(placementId: string, s: SaisieCommission, acteur: Acteur, maintenant = new Date(), tx?: Executeur): Promise<{ id: string; reference: string; montant: number }> {
  if (!PAYEURS.est(s.payeur)) throw new ErreurCommission('Payeur inconnu.');
  if (!MODES_CALCUL.est(s.mode)) throw new ErreurCommission('Mode de calcul inconnu.');
  if (s.echeance && !/^\d{4}-\d{2}-\d{2}$/.test(s.echeance)) throw new ErreurCommission('Date d’échéance invalide.');
  const parametres = await chargerParametres();
  const refus = verifierPayeur({ payeur: s.payeur as Payeur, commissionTravailleurActive: parametres.commissions.travailleurActive, accuseLecture: Boolean(s.accuseLecture), justification: s.justification });
  if (refus.length) throw new ErreurCommission(refus.join(' '));
  const montant = calculerMontant({ mode: s.mode as ModeCalcul, montantForfait: s.montant, base: s.base, taux: s.taux });
  if (montant > 1_000_000) throw new ErreurCommission('Montant hors limites.');
  const travailleur = s.payeur === 'travailleur';
  const travail = async (t: Executeur) => {
    const placement = await uneLigne<{ reference: string; status: string; fictif: boolean }>(
      `SELECT p.reference, p.status, e.is_demo AS fictif FROM placements p JOIN employers e ON e.id = p.employer_id WHERE p.id = $1`, [placementId], t);
    if (!placement) throw new ErreurCommission('Placement introuvable.');
    if (placement.status === 'annule') throw new ErreurCommission('Ce placement est annulé : aucune commission ne peut lui être rattachée.');
    const cree = await uneLigne<{ id: string; reference: string }>(
      `INSERT INTO commissions (reference, placement_id, payer, calc_mode, base_amount, rate_percent, amount, label, due_date, compliance_ack_by, compliance_ack_at, compliance_note, notes, created_by)
       VALUES (${prochaineReference('CO', placement.fictif)}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, reference`,
      [placementId, s.payeur, s.mode, s.mode === 'pourcentage' ? s.base : null, s.mode === 'pourcentage' ? s.taux : null, montant, s.libelle?.trim().slice(0, 160) || null, s.echeance || null,
        travailleur ? acteur.id : null, travailleur ? maintenant : null, travailleur ? s.justification!.trim().slice(0, 2000) : null, s.notes?.trim().slice(0, 2000) || null, acteur.id],
      t,
    );
    await journaliser(
      {
        acteur, action: travailleur ? 'commission.creation_travailleur' : 'commission.creation', entite: 'commission', id: cree!.id,
        resume: `${cree!.reference} : ${montant} MAD à la charge ${travailleur ? 'du TRAVAILLEUR (dérogation justifiée)' : 'de l’employeur'} — ${placement.reference}`,
        changements: { payeur: s.payeur, mode: s.mode, montant, justification: travailleur ? s.justification : undefined },
      },
      t,
    );
    return { ...cree!, montant };
  };
  return tx ? travail(tx) : transaction(travail);
}

export async function changerStatutCommission(id: string, vers: string, options: { moyen?: string | null; motif?: string | null; numeroFacture?: string | null }, acteur: Acteur, maintenant = new Date()): Promise<void> {
  if (!STATUTS_COMMISSION.est(vers)) throw new ErreurCommission('Statut inconnu.');
  await transaction(async (tx) => {
    const c = await uneLigne<{ status: StatutCommission; reference: string; document_number: string | null; amount: number; fictif: boolean }>(
      `SELECT co.status, co.reference, co.document_number, co.amount, e.is_demo AS fictif
         FROM commissions co JOIN placements p ON p.id = co.placement_id JOIN employers e ON e.id = p.employer_id WHERE co.id = $1 FOR UPDATE OF co`, [id], tx);
    if (!c) throw new ErreurCommission('Commission introuvable.');
    if (c.status === vers) return;
    if (!transitionAutorisee(c.status, vers as StatutCommission)) throw new ErreurCommission(`Passage impossible de « ${STATUTS_COMMISSION.libelle(c.status)} » à « ${STATUTS_COMMISSION.libelle(vers)} ».`);
    if (vers === 'facture') {
      const numero = options.numeroFacture?.trim().slice(0, 60) || null;
      if (numero && (await uneLigne(`SELECT 1 FROM commissions WHERE document_number = $1 AND id <> $2`, [numero, id], tx))) throw new ErreurCommission('Ce numéro de facture est déjà utilisé.');
      await executer(`UPDATE commissions SET status = 'facture', invoiced_at = $2, document_type = CASE WHEN $3::text IS NULL THEN document_type ELSE 'facture' END, document_number = COALESCE($3, document_number) WHERE id = $1`, [id, maintenant, numero], tx);
    } else if (vers === 'encaisse') {
      if (!options.moyen || !MOYENS_PAIEMENT.est(options.moyen)) throw new ErreurCommission('Précisez le moyen de paiement.');
      // Sans numéro de facture, un numéro de reçu interne (non fiscal) est attribué.
      await executer(
        `UPDATE commissions SET status = 'encaisse', paid_at = $2, payment_method = $3, document_type = COALESCE(document_type, 'recu'),
                document_number = COALESCE(document_number, ${prochaineReference('RE', c.fictif)}) WHERE id = $1`,
        [id, maintenant, options.moyen],
        tx,
      );
    } else if (vers === 'annule') {
      const motif = options.motif?.trim() ?? '';
      if (motif.length < 5) throw new ErreurCommission('Indiquez le motif de l’annulation.');
      await executer(`UPDATE commissions SET status = 'annule', cancelled_at = $2, cancel_reason = $3 WHERE id = $1`, [id, maintenant, motif.slice(0, 500)], tx);
    } else {
      await executer(`UPDATE commissions SET status = 'du', invoiced_at = NULL WHERE id = $1`, [id], tx);
    }
    await journaliser({ acteur, action: 'commission.statut', entite: 'commission', id, resume: `${c.reference} : ${c.status} › ${vers} (${c.amount} MAD)`, changements: { avant: c.status, apres: vers, moyen: options.moyen ?? null, motif: options.motif ?? null } }, tx);
  });
}

export type Commission = {
  id: string; reference: string; placement_id: string; placement_reference: string; payer: Payeur; calc_mode: ModeCalcul; base_amount: number | null; rate_percent: number | null;
  amount: number; currency: string; label: string | null; status: StatutCommission; due_date: string | null; invoiced_at: Date | null; paid_at: Date | null; cancelled_at: Date | null;
  cancel_reason: string | null; payment_method: string | null; document_type: string | null; document_number: string | null; compliance_ack_at: Date | null; compliance_note: string | null;
  accuse_par: string | null; notes: string | null; created_at: Date; employeur: string; employer_id: string; candidat_reference: string; candidate_id: string;
  /** Commission du jeu de démonstration : jamais comptée dans un total. */
  fictif: boolean;
};

const SELECT_COMMISSION = `SELECT co.id, co.reference, co.placement_id, p.reference AS placement_reference, co.payer, co.calc_mode, co.base_amount, co.rate_percent, co.amount, co.currency,
       co.label, co.status, co.due_date, co.invoiced_at, co.paid_at, co.cancelled_at, co.cancel_reason, co.payment_method, co.document_type, co.document_number,
       co.compliance_ack_at, co.compliance_note, u.full_name AS accuse_par, co.notes, co.created_at, e.name AS employeur, e.is_demo AS fictif, p.employer_id, k.reference AS candidat_reference, p.candidate_id
  FROM commissions co JOIN placements p ON p.id = co.placement_id JOIN employers e ON e.id = p.employer_id JOIN candidates k ON k.id = p.candidate_id
  LEFT JOIN users u ON u.id = co.compliance_ack_by`;

export async function listerCommissions(filtres: { statut?: string; payeur?: string; placement?: string; depuis?: string; jusque?: string } = {}): Promise<Commission[]> {
  const conditions: string[] = [];
  const valeurs: unknown[] = [];
  const p = (valeur: unknown) => `$${valeurs.push(valeur)}`;
  if (filtres.statut) conditions.push(`co.status = ${p(filtres.statut)}`);
  if (filtres.payeur) conditions.push(`co.payer = ${p(filtres.payeur)}`);
  if (filtres.placement) conditions.push(`co.placement_id = ${p(filtres.placement)}`);
  // Jours civils du Maroc : le résultat ne dépend pas du fuseau réglé sur le serveur de base de données.
  if (filtres.depuis) conditions.push(`ys_heure_maroc(co.created_at)::date >= ${p(filtres.depuis)}::date`);
  if (filtres.jusque) conditions.push(`ys_heure_maroc(co.created_at)::date <= ${p(filtres.jusque)}::date`);
  return requete<Commission>(`${SELECT_COMMISSION} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY co.created_at DESC LIMIT 500`, valeurs);
}

export async function commissionParId(id: string): Promise<Commission | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return uneLigne<Commission>(`${SELECT_COMMISSION} WHERE co.id = $1`, [id]);
}

/** Totaux réels : les commissions du jeu de démonstration n'entrent dans aucun montant. */
export const commissionsReelles = (commissions: Commission[]): Commission[] => commissions.filter((commission) => !commission.fictif);

export async function totauxCommissions(filtres: { depuis?: string; jusque?: string } = {}): Promise<TotauxCommissions> {
  return totaliser(commissionsReelles(await listerCommissions(filtres)));
}

export { arrondir };
