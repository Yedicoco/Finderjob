/**
 * Lien entre Next.js (cookies, en-têtes) et l'authentification.
 *
 * C'est ICI que se font les contrôles d'accès réels : chaque page appelle
 * exigerSession() ou exigerPermission(), chaque Server Action passe par
 * executerAction() (src/serveur/actions.ts). Le proxy n'est qu'un confort.
 */
import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Acteur } from './audit';
import { acteurDe, peut, utilisateurDeSession, type Permission, type Utilisateur } from './auth';
import { apercuIntegre, config } from './config';

export const COOKIE_SESSION = 'ys_session';

export type Session = { utilisateur: Utilisateur; acteur: Acteur; peut: (permission: Permission) => boolean };

export async function ipClient(): Promise<string | null> {
  const entetes = await headers();
  const transmise = entetes.get('x-forwarded-for')?.split(',')[0]?.trim();
  return transmise || entetes.get('x-real-ip') || null;
}

async function connexionSecurisee(): Promise<boolean> {
  if (apercuIntegre() || process.env.YS_COOKIE_SECURISE === '1') return true;
  if (config.urlPublique()?.startsWith('https://')) return true;
  const entetes = await headers();
  return entetes.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
}

/** Session de la requête en cours (une seule lecture en base par rendu). */
export const sessionCourante = cache(async (): Promise<Session | null> => {
  const jeton = (await cookies()).get(COOKIE_SESSION)?.value;
  const utilisateur = await utilisateurDeSession(jeton);
  if (!utilisateur) return null;
  return { utilisateur, acteur: acteurDe(utilisateur, await ipClient()), peut: (permission) => peut(utilisateur.role_code, permission) };
});

/** Pour les pages : renvoie la session ou redirige vers la connexion. */
export async function exigerSession(options: { autoriserMotDePasseProvisoire?: boolean } = {}): Promise<Session> {
  const session = await sessionCourante();
  if (!session) redirect('/connexion');
  if (session.utilisateur.must_change_password && !options.autoriserMotDePasseProvisoire) redirect('/compte?motif=provisoire');
  return session;
}

/** Pour les pages réservées : sans la permission, retour à l'accueil avec un message. */
export async function exigerPermission(permission: Permission): Promise<Session> {
  const session = await exigerSession();
  if (!session.peut(permission)) redirect('/?refus=1');
  return session;
}

export async function ouvrirSession(jeton: string, expireLe: Date): Promise<void> {
  const securise = await connexionSecurisee();
  const integre = apercuIntegre();
  (await cookies()).set(COOKIE_SESSION, jeton, {
    httpOnly: true,
    secure: securise,
    // Dans une iframe d'aperçu, seul un cookie SameSite=None partitionné est accepté par le navigateur.
    sameSite: integre ? 'none' : 'lax',
    partitioned: integre,
    path: '/',
    expires: expireLe,
  });
}

export async function fermerSession(): Promise<string | null> {
  const magasin = await cookies();
  const jeton = magasin.get(COOKIE_SESSION)?.value ?? null;
  const integre = apercuIntegre();
  magasin.set(COOKIE_SESSION, '', { httpOnly: true, secure: await connexionSecurisee(), sameSite: integre ? 'none' : 'lax', partitioned: integre, path: '/', maxAge: 0 });
  return jeton;
}
