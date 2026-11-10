'use server';

import { MOTIFS_STATUT, STATUTS_OFFRE } from '@/domaine/referentiels';
import { executerAction, texte, texteOuNul } from '@/serveur/actions';
import { employeurDepuisOffre } from '@/serveur/employeurs';
import type { EtatAction } from '@/serveur/etat-action';
import { ErreurOffre, archiverOffre, contactOffre, corrigerOffre, dissocierDoublon, ecarterDoublonProbable, lierDoublon, offreParId, verifierOffre } from '@/serveur/offres';
import { correctionDepuisSaisie, valeursCorrection, type ValeursCorrection } from './correction';

const decrire = (decision: { statut: string; motif: string }): string => {
  const motif = decision.motif !== 'aucun' ? ` (${MOTIFS_STATUT.libelle(decision.motif).toLowerCase()})` : '';
  return `${STATUTS_OFFRE.libelle(decision.statut).toLowerCase()}${motif}`;
};

export async function verifierOffreAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('offres.moderer', async ({ acteur }) => {
    const decision = await verifierOffre(texte(donnees, 'id'), acteur, texteOuNul(donnees, 'note'));
    return {
      message:
        decision.statut === 'actif'
          ? 'Vérification enregistrée : l’offre est active.'
          : `Vérification enregistrée, mais l’offre reste ${decrire(decision)}. Corrigez la donnée manquante pour qu’elle puisse devenir active.`,
    };
  });
}

export async function archiverOffreAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('offres.moderer', async ({ acteur }) => {
    await archiverOffre(texte(donnees, 'id'), texte(donnees, 'motif') as Parameters<typeof archiverOffre>[1], acteur, texteOuNul(donnees, 'note'));
    return { message: 'Offre archivée.' };
  });
}

export async function corrigerOffreAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('offres.moderer', async ({ acteur }) => {
    const id = texte(donnees, 'id');
    const offre = await offreParId(id);
    if (!offre) throw new ErreurOffre('Offre introuvable.');
    const correction = correctionDepuisSaisie(valeursCorrection(offre), (nom: keyof ValeursCorrection) => texte(donnees, nom));
    if (Object.keys(correction).length === 0) return { message: 'Aucune modification à enregistrer.' };
    const decision = await corrigerOffre(id, correction, acteur);
    return { message: `Correction enregistrée. Statut : ${decrire(decision)}.` };
  });
}

export async function revelerContact(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('offres.moderer', async ({ acteur }) => {
    const contact = await contactOffre(texte(donnees, 'id'), acteur);
    const parties = [contact.telephone ? `Téléphone : ${contact.telephone}` : null, contact.email ? `E-mail : ${contact.email}` : null].filter(Boolean);
    return { message: parties.length ? `${parties.join(' · ')} — consultation journalisée.` : 'Aucune coordonnée n’est conservée pour cette annonce : utilisez le lien vers l’annonce d’origine.' };
  });
}

export async function creerEmployeurDepuisOffre(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('employeurs.gerer', async ({ acteur }) => {
    const employeur = await employeurDepuisOffre(texte(donnees, 'id'), acteur);
    return { redirection: `/employeurs/${employeur.id}` };
  });
}

export async function lierDoublonAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('offres.moderer', async ({ acteur }) => {
    await lierDoublon(texte(donnees, 'id'), texte(donnees, 'principale'), acteur);
    return { message: 'Offre rattachée comme doublon et archivée.' };
  });
}

export async function dissocierDoublonAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('offres.moderer', async ({ acteur }) => {
    await dissocierDoublon(texte(donnees, 'id'), acteur);
    return { message: 'Offre dissociée : elle est à vérifier avant de redevenir active.' };
  });
}

export async function ecarterDoublonAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('offres.moderer', async ({ acteur }) => {
    await ecarterDoublonProbable(texte(donnees, 'id'), acteur);
    return { message: 'Noté : ce sont deux offres distinctes.' };
  });
}
