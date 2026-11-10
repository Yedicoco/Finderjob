'use server';

import { accord, compter } from '@/domaine/accord';
import { executerAction, texte } from '@/serveur/actions';
import { calculerPourBesoin, calculerPourCandidat, calculerPourOffre, changerStatutCorrespondance, type BilanAppariement } from '@/serveur/appariements';
import type { EtatAction } from '@/serveur/etat-action';

const bilan = (b: BilanAppariement, quoi: 'candidat' | 'poste'): string => {
  const compares = `${compter(b.evalues, quoi)} ${accord(b.evalues, 'comparé')}`;
  return b.retenus > 0 ? `${compares} : ${compter(b.retenus, 'suggestion')} à examiner.` : `${compares} : aucun ne correspond assez (métier, lieu, disponibilité).`;
};

export async function chercherCandidatsPourOffre(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('candidats.gerer', async ({ acteur }) => ({ message: bilan(await calculerPourOffre(texte(donnees, 'id'), acteur), 'candidat') }));
}

export async function chercherCandidatsPourBesoin(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('candidats.gerer', async ({ acteur }) => ({ message: bilan(await calculerPourBesoin(texte(donnees, 'id'), acteur), 'candidat') }));
}

export async function chercherPostesPourCandidat(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('candidats.gerer', async ({ acteur }) => ({ message: bilan(await calculerPourCandidat(texte(donnees, 'id'), acteur), 'poste') }));
}

export async function changerStatutRapprochement(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('candidats.gerer', async ({ acteur }) => {
    await changerStatutCorrespondance(texte(donnees, 'id'), texte(donnees, 'statut'), acteur);
    return { message: 'Statut mis à jour.' };
  });
}
