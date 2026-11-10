'use server';

import { coche, executerAction, liste, nombreOuNul, texte } from '@/serveur/actions';
import { ErreurAlerte, basculerAlerte, creerAlerte, marquerLues, supprimerAlerte } from '@/serveur/alertes';
import type { EtatAction } from '@/serveur/etat-action';

export async function creerAlerteAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('alertes.gerer', async ({ utilisateur, acteur }) => {
    const salaireMin = nombreOuNul(donnees, 'salaireMin');
    const pertinenceMin = nombreOuNul(donnees, 'pertinenceMin');
    if (Number.isNaN(salaireMin) || Number.isNaN(pertinenceMin)) throw new ErreurAlerte('Le salaire et la pertinence minimale doivent être des nombres.');
    const un = (nom: string) => (texte(donnees, nom) ? [texte(donnees, nom)] : []);
    await creerAlerte(
      utilisateur.id,
      {
        nom: texte(donnees, 'nom'),
        criteres: {
          texte: texte(donnees, 'texte'),
          categories: un('metier'),
          secteurs: un('secteur'),
          villes: un('ville'),
          contrats: un('contrat'),
          salaireMin: salaireMin ?? undefined,
          pertinenceMin: pertinenceMin ?? undefined,
          urgentSeulement: coche(donnees, 'urgentSeulement'),
          massifSeulement: coche(donnees, 'massifSeulement'),
        },
        canaux: liste(donnees, 'canaux'),
        frequence: texte(donnees, 'frequence') || 'quotidien',
      },
      acteur,
    );
    return { message: 'Alerte créée. Elle signalera les offres qui arriveront à partir de maintenant.' };
  });
}

export async function basculerAlerteAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('alertes.gerer', async ({ utilisateur }) => {
    const active = texte(donnees, 'active') === '1';
    await basculerAlerte(texte(donnees, 'id'), utilisateur.id, active);
    return { message: active ? 'Alerte réactivée.' : 'Alerte mise en pause.' };
  });
}

export async function supprimerAlerteAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('alertes.gerer', async ({ utilisateur, acteur }) => {
    await supprimerAlerte(texte(donnees, 'id'), utilisateur.id, acteur);
    return { message: 'Alerte supprimée.' };
  });
}

export async function marquerLuesAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction(null, async ({ utilisateur }) => {
    await marquerLues(utilisateur.id, texte(donnees, 'id') || undefined);
    return { message: 'Notifications marquées comme lues.' };
  });
}
