'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ErreurMetier } from '@/domaine/erreurs';
import { connecter, deconnecter } from '@/serveur/auth';
import type { EtatAction } from '@/serveur/etat-action';
import { fermerSession, ipClient, ouvrirSession } from '@/serveur/session-next';

/** Seuls les chemins internes sont acceptés comme page de retour (jamais une adresse externe). */
function cheminInterne(valeur: FormDataEntryValue | null): string {
  const chemin = typeof valeur === 'string' ? valeur : '';
  return /^\/[a-z0-9/_-]*$/i.test(chemin) && !chemin.startsWith('//') && !chemin.startsWith('/connexion') ? chemin : '/';
}

export async function seConnecter(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  const email = String(donnees.get('email') ?? '');
  const motDePasse = String(donnees.get('motDePasse') ?? '');
  if (!email.trim() || !motDePasse) return { erreur: 'Saisissez votre adresse e-mail et votre mot de passe.' };
  let suite = cheminInterne(donnees.get('suite'));
  try {
    const session = await connecter(email, motDePasse, { ip: await ipClient(), userAgent: (await headers()).get('user-agent') });
    await ouvrirSession(session.jeton, session.expireLe);
    if (session.utilisateur.must_change_password) suite = '/compte?motif=provisoire';
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) return { erreur: erreur.message };
    console.error('[connexion]', erreur);
    return { erreur: 'Connexion impossible pour le moment. Réessayez dans un instant.' };
  }
  redirect(suite);
}

export async function seDeconnecter(): Promise<void> {
  await deconnecter(await fermerSession());
  redirect('/connexion');
}
