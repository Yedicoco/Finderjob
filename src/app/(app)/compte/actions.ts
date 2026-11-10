'use server';

import { headers } from 'next/headers';
import { executerAction, texte } from '@/serveur/actions';
import { definirTelephoneAlertes } from '@/serveur/alertes';
import { changerMotDePasse, connecter } from '@/serveur/auth';
import { ErreurAcces } from '@/serveur/auth';
import type { EtatAction } from '@/serveur/etat-action';
import { ipClient, ouvrirSession } from '@/serveur/session-next';

export async function changerMonMotDePasse(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction(
    null,
    async ({ utilisateur, acteur }) => {
      const ancien = String(donnees.get('ancien') ?? '');
      const nouveau = String(donnees.get('nouveau') ?? '');
      if (nouveau !== String(donnees.get('confirmation') ?? '')) throw new ErreurAcces('Les deux saisies du nouveau mot de passe ne sont pas identiques.', 'invalide');
      await changerMotDePasse(utilisateur.id, nouveau, acteur, { ancien });
      // Toutes les sessions du compte viennent d'être fermées : on en rouvre une pour cet appareil.
      const session = await connecter(utilisateur.email, nouveau, { ip: await ipClient(), userAgent: (await headers()).get('user-agent') });
      await ouvrirSession(session.jeton, session.expireLe);
      return { redirection: '/compte?motif=change' };
    },
    { autoriserMotDePasseProvisoire: true },
  );
}

export async function definirMonTelephone(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction(null, async ({ utilisateur }) => {
    const numero = texte(donnees, 'telephone');
    await definirTelephoneAlertes(utilisateur.id, numero || null);
    return { message: numero ? 'Numéro enregistré.' : 'Numéro supprimé.' };
  });
}
