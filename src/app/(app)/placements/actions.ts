'use server';

import { ErreurCommission } from '@/domaine/commissions';
import { coche, executerAction, nombreOuNul, texte, texteOuNul } from '@/serveur/actions';
import type { EtatAction } from '@/serveur/etat-action';
import { ErreurPlacement, changerStatutCommission, changerStatutPlacement, creerCommission, creerPlacement } from '@/serveur/placements';

export async function creerPlacementAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('placements.gerer', async ({ acteur }) => {
    const salaire = nombreOuNul(donnees, 'salaire');
    if (Number.isNaN(salaire)) throw new ErreurPlacement('Le salaire convenu doit être un nombre.');
    const cree = await creerPlacement(
      {
        employeurId: texte(donnees, 'employeur'),
        candidatId: texte(donnees, 'candidat'),
        offreId: texteOuNul(donnees, 'offre'),
        besoinId: texteOuNul(donnees, 'besoin'),
        correspondanceId: texteOuNul(donnees, 'rapprochement'),
        debut: texte(donnees, 'debut'),
        contrat: texte(donnees, 'contrat') || 'non_precise',
        salaire,
        periodeSalaire: texte(donnees, 'periodeSalaire') || 'mois',
        notes: texteOuNul(donnees, 'notes'),
        avecCommissionFormule: coche(donnees, 'avecCommission'),
      },
      acteur,
    );
    return { redirection: `/placements/${cree.id}` };
  });
}

export async function changerStatutPlacementAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('placements.gerer', async ({ acteur }) => {
    await changerStatutPlacement(texte(donnees, 'id'), texte(donnees, 'statut'), acteur, texteOuNul(donnees, 'note'));
    return { message: 'Statut du placement mis à jour.' };
  });
}

export async function creerCommissionAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('placements.gerer', async ({ acteur }) => {
    const nombres = { montant: nombreOuNul(donnees, 'montant'), base: nombreOuNul(donnees, 'base'), taux: nombreOuNul(donnees, 'taux') };
    if (Object.values(nombres).some((valeur) => Number.isNaN(valeur))) throw new ErreurCommission('Montant, base et taux doivent être des nombres.');
    const cree = await creerCommission(
      texte(donnees, 'placement'),
      {
        payeur: texte(donnees, 'payeur') || 'employeur',
        mode: texte(donnees, 'mode') || 'forfait',
        ...nombres,
        libelle: texteOuNul(donnees, 'libelle'),
        echeance: texteOuNul(donnees, 'echeance'),
        notes: texteOuNul(donnees, 'notes'),
        accuseLecture: coche(donnees, 'accuseLecture'),
        justification: texteOuNul(donnees, 'justification'),
      },
      acteur,
    );
    return { message: `Commission ${cree.reference} créée.` };
  });
}

export async function changerStatutCommissionAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('placements.gerer', async ({ acteur }) => {
    await changerStatutCommission(texte(donnees, 'id'), texte(donnees, 'statut'), { moyen: texteOuNul(donnees, 'moyen'), motif: texteOuNul(donnees, 'motif'), numeroFacture: texteOuNul(donnees, 'numeroFacture') }, acteur);
    return { message: 'Commission mise à jour.' };
  });
}
