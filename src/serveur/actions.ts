/**
 * Socle commun des Server Actions.
 *
 * Une Server Action est un point d'entrée public : n'importe qui peut envoyer
 * la même requête POST. Chaque action passe donc par executerAction(), qui
 *   1. relit la session en base et vérifie la permission ;
 *   2. exécute le service métier (qui valide lui-même la saisie) ;
 *   3. traduit une erreur métier en message pour l'utilisateur, et masque
 *      toute erreur technique derrière une référence d'incident.
 */
import 'server-only';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ErreurMetier } from '@/domaine/erreurs';
import type { Permission } from './auth';
import type { EtatAction } from './etat-action';
import { sessionCourante, type Session } from './session-next';

export type ResultatAction = { message?: string; redirection?: string } | void;

type Options = { autoriserMotDePasseProvisoire?: boolean };

/** Session + permission + traduction des erreurs, communes à toutes les actions. */
async function proteger<T>(permission: Permission | null, travail: (session: Session) => Promise<T>, options: Options): Promise<{ ok: true; valeur: T } | { ok: false; erreur: string }> {
  const session = await sessionCourante();
  if (!session) redirect('/connexion');
  if (session.utilisateur.must_change_password && !options.autoriserMotDePasseProvisoire) return { ok: false, erreur: 'Changez d’abord votre mot de passe provisoire (menu « Mon compte »).' };
  if (permission && !session.peut(permission)) return { ok: false, erreur: 'Votre rôle ne permet pas cette action.' };
  try {
    return { ok: true, valeur: await travail(session) };
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) return { ok: false, erreur: erreur.message };
    const incident = randomBytes(4).toString('hex');
    console.error(`[incident ${incident}]`, erreur);
    return { ok: false, erreur: `Une erreur technique est survenue (référence ${incident}). Réessayez ; si le problème persiste, communiquez cette référence à l’administrateur.` };
  }
}

export async function executerAction(permission: Permission | null, travail: (session: Session) => Promise<ResultatAction>, options: Options = {}): Promise<EtatAction> {
  const resultat = await proteger(permission, travail, options);
  if (!resultat.ok) return { erreur: resultat.erreur };
  revalidatePath('/', 'layout');
  if (resultat.valeur?.redirection) redirect(resultat.valeur.redirection);
  return { message: resultat.valeur?.message ?? 'Enregistré.' };
}

/** Variante pour les actions qui renvoient une donnée à afficher (aperçu d'import…). `ecrit` : l'action a modifié la base. */
export async function executerActionAvecResultat<T>(permission: Permission | null, travail: (session: Session) => Promise<T>, options: Options & { ecrit?: boolean } = {}): Promise<{ erreur: string } | { resultat: T }> {
  const resultat = await proteger(permission, travail, options);
  if (!resultat.ok) return { erreur: resultat.erreur };
  if (options.ecrit !== false) revalidatePath('/', 'layout');
  return { resultat: resultat.valeur };
}

// --------------------------------------------------- lecture des formulaires --

export const texte = (donnees: FormData, nom: string): string => {
  const valeur = donnees.get(nom);
  return typeof valeur === 'string' ? valeur.trim() : '';
};
export const texteOuNul = (donnees: FormData, nom: string): string | null => texte(donnees, nom) || null;
export const liste = (donnees: FormData, nom: string): string[] => donnees.getAll(nom).filter((valeur): valeur is string => typeof valeur === 'string' && valeur.trim() !== '').map((valeur) => valeur.trim());
export const coche = (donnees: FormData, nom: string): boolean => ['on', '1', 'true', 'oui'].includes(texte(donnees, nom));
/** Nombre saisi à la française (« 3 500 », « 3500,50 ») ; null si vide ; NaN si illisible (le service refusera). */
export const nombreOuNul = (donnees: FormData, nom: string): number | null => {
  const brut = texte(donnees, nom).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!brut) return null;
  return /^-?\d+(\.\d+)?$/.test(brut) ? Number(brut) : Number.NaN;
};
/** « oui » / « non » / vide → true / false / null. */
export const ouiNonOuNul = (donnees: FormData, nom: string): boolean | null => {
  const valeur = texte(donnees, nom);
  return valeur === 'oui' ? true : valeur === 'non' ? false : null;
};
