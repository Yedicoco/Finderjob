/**
 * Comptes, rôles, sessions.
 *
 *   - Sessions côté serveur : le cookie porte un jeton aléatoire de 256 bits,
 *     la base ne stocke que son empreinte. Une session se révoque à tout moment.
 *   - Limitation des tentatives de connexion : 8 par quart d'heure et par
 *     couple (e-mail, adresse) — les compteurs sont indexés par une empreinte.
 *   - Réponse identique que le compte existe ou non (pas d'énumération).
 */
import type { CodeRole } from '@/domaine/referentiels';
import { ROLES } from '@/domaine/referentiels';
import { ACTEUR_SYSTEME, journaliser, type Acteur } from './audit';
import { empreinteIp, hacherJeton, hacherMotDePasse, indexAveugle, nouveauJeton, validerMotDePasse, verifierMotDePasse } from './chiffrement';
import { config } from './config';
import { executer, requete, uneLigne, type Executeur } from './db';
import { ErreurMetier } from '@/domaine/erreurs';

export type Permission =
  | 'offres.lire'
  | 'offres.moderer'
  | 'offres.importer'
  | 'candidats.lire'
  | 'candidats.gerer'
  | 'employeurs.lire'
  | 'employeurs.gerer'
  | 'placements.lire'
  | 'placements.gerer'
  | 'alertes.gerer'
  | 'tableau.lire'
  | 'collecte.lancer'
  | 'sources.gerer'
  | 'utilisateurs.gerer'
  | 'parametres.gerer'
  | 'journal.lire'
  | 'exports.creer';

const LECTEUR: Permission[] = ['offres.lire', 'tableau.lire', 'alertes.gerer'];
const COURTIER: Permission[] = [...LECTEUR, 'offres.moderer', 'offres.importer', 'candidats.lire', 'candidats.gerer', 'employeurs.lire', 'employeurs.gerer', 'placements.lire', 'placements.gerer'];
const ADMINISTRATEUR: Permission[] = [...COURTIER, 'collecte.lancer', 'sources.gerer', 'utilisateurs.gerer', 'parametres.gerer', 'journal.lire', 'exports.creer'];

export const PERMISSIONS: Record<CodeRole, ReadonlySet<Permission>> = {
  lecteur: new Set(LECTEUR),
  courtier: new Set(COURTIER),
  administrateur: new Set(ADMINISTRATEUR),
};

export function peut(role: string | null | undefined, permission: Permission): boolean {
  return ROLES.est(role) && PERMISSIONS[role].has(permission);
}

export type Utilisateur = {
  id: string;
  email: string;
  full_name: string;
  role_code: CodeRole;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: Date | null;
  created_at: Date;
};

export class ErreurAcces extends ErreurMetier {
  constructor(
    message: string,
    readonly code: 'non_connecte' | 'interdit' | 'trop_de_tentatives' | 'identifiants' | 'invalide' = 'interdit',
  ) {
    super(message);
  }
}

export function acteurDe(utilisateur: Pick<Utilisateur, 'id' | 'full_name' | 'role_code'>, ip?: string | null): Acteur {
  return { id: utilisateur.id, libelle: utilisateur.full_name, role: utilisateur.role_code, ipHash: empreinteIp(ip) };
}

const COLONNES = 'id, email, full_name, role_code, is_active, must_change_password, last_login_at, created_at';

// ------------------------------------------------------ limitation de débit --

/** true si l'appel est autorisé ; incrémente le compteur de la fenêtre courante. */
export async function consommerQuota(cle: string, max: number, fenetreMinutes: number, maintenant = new Date()): Promise<boolean> {
  const fenetreMs = fenetreMinutes * 60_000;
  const debut = new Date(Math.floor(maintenant.getTime() / fenetreMs) * fenetreMs);
  const ligne = await uneLigne<{ hits: number }>(
    `INSERT INTO rate_limits (bucket, window_start, hits) VALUES ($1, $2, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1
     RETURNING hits`,
    [indexAveugle(`quota:${cle}`), debut],
  );
  return (ligne?.hits ?? 1) <= max;
}

// ------------------------------------------------------------- connexion ----

// Empreinte factice : même coût de calcul quand le compte n'existe pas.
let empreinteFactice: Promise<string> | null = null;

export async function connecter(
  email: string,
  motDePasse: string,
  contexte: { ip?: string | null; userAgent?: string | null; maintenant?: Date } = {},
): Promise<{ jeton: string; utilisateur: Utilisateur; expireLe: Date }> {
  const maintenant = contexte.maintenant ?? new Date();
  const adresse = email.trim().toLowerCase().slice(0, 254);
  if (!(await consommerQuota(`connexion:${adresse}:${contexte.ip ?? '-'}`, 8, 15, maintenant))) {
    throw new ErreurAcces('Trop de tentatives. Réessayez dans un quart d’heure.', 'trop_de_tentatives');
  }
  const ligne = await uneLigne<Utilisateur & { password_hash: string }>(`SELECT ${COLONNES}, password_hash FROM users WHERE email = $1`, [adresse]);
  empreinteFactice ??= hacherMotDePasse(nouveauJeton());
  const valide = await verifierMotDePasse(motDePasse, ligne?.password_hash ?? (await empreinteFactice));
  if (!ligne || !valide || !ligne.is_active) {
    await journaliser({ acteur: { ...ACTEUR_SYSTEME, ipHash: empreinteIp(contexte.ip) }, action: 'connexion.echec', entite: 'utilisateur', id: ligne?.id ?? null, resume: 'Tentative de connexion refusée' });
    throw new ErreurAcces('Adresse e-mail ou mot de passe incorrect.', 'identifiants');
  }
  const jeton = nouveauJeton();
  const expireLe = new Date(maintenant.getTime() + config.dureeSessionHeures() * 3_600_000);
  await executer(`INSERT INTO sessions (user_id, token_hash, expires_at, ip_hash, user_agent) VALUES ($1, $2, $3, $4, $5)`, [
    ligne.id,
    hacherJeton(jeton),
    expireLe,
    empreinteIp(contexte.ip),
    contexte.userAgent?.slice(0, 200) ?? null,
  ]);
  await executer(`UPDATE users SET last_login_at = $2 WHERE id = $1`, [ligne.id, maintenant]);
  const { password_hash: _ignore, ...utilisateur } = ligne;
  void _ignore;
  await journaliser({ acteur: acteurDe(utilisateur, contexte.ip), action: 'connexion.reussie', entite: 'utilisateur', id: utilisateur.id, resume: 'Connexion' });
  return { jeton, utilisateur, expireLe };
}

export async function utilisateurDeSession(jeton: string | null | undefined, maintenant = new Date()): Promise<Utilisateur | null> {
  if (!jeton || jeton.length < 20 || jeton.length > 200) return null;
  const ligne = await uneLigne<Utilisateur & { session_id: string; last_seen_at: Date }>(
    `SELECT u.id, u.email, u.full_name, u.role_code, u.is_active, u.must_change_password, u.last_login_at, u.created_at,
            s.id AS session_id, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.is_active`,
    [hacherJeton(jeton), maintenant],
  );
  if (!ligne) return null;
  const { session_id, last_seen_at, ...utilisateur } = ligne;
  // Une écriture toutes les cinq minutes au plus.
  if (maintenant.getTime() - new Date(last_seen_at).getTime() > 300_000) {
    await executer(`UPDATE sessions SET last_seen_at = $2 WHERE id = $1`, [session_id, maintenant]).catch(() => undefined);
  }
  return utilisateur;
}

export async function deconnecter(jeton: string | null | undefined): Promise<void> {
  if (jeton) await executer(`DELETE FROM sessions WHERE token_hash = $1`, [hacherJeton(jeton)]);
}

export async function purgerSessions(maintenant = new Date()): Promise<number> {
  await executer(`DELETE FROM rate_limits WHERE window_start < $1`, [new Date(maintenant.getTime() - 86_400_000)]);
  return executer(`DELETE FROM sessions WHERE expires_at <= $1`, [maintenant]);
}

// ---------------------------------------------------------- utilisateurs ----

export async function listerUtilisateurs(): Promise<Utilisateur[]> {
  return requete<Utilisateur>(`SELECT ${COLONNES} FROM users ORDER BY is_active DESC, full_name`);
}

export async function utilisateurParId(id: string): Promise<Utilisateur | null> {
  return uneLigne<Utilisateur>(`SELECT ${COLONNES} FROM users WHERE id = $1`, [id]);
}

function validerIdentite(email: string, nom: string, role: string): { email: string; nom: string; role: CodeRole } {
  const adresse = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adresse) || adresse.length > 254) throw new ErreurAcces('Adresse e-mail invalide.', 'invalide');
  const nomPropre = nom.replace(/\s+/g, ' ').trim();
  if (nomPropre.length < 2 || nomPropre.length > 120) throw new ErreurAcces('Nom invalide.', 'invalide');
  if (!ROLES.est(role)) throw new ErreurAcces('Rôle inconnu.', 'invalide');
  return { email: adresse, nom: nomPropre, role };
}

export async function creerUtilisateur(
  entree: { email: string; nom: string; role: string; motDePasse: string; doitChanger?: boolean },
  acteur: Acteur,
  tx?: Executeur,
): Promise<Utilisateur> {
  const { email, nom, role } = validerIdentite(entree.email, entree.nom, entree.role);
  const defaut = validerMotDePasse(entree.motDePasse);
  if (defaut) throw new ErreurAcces(defaut, 'invalide');
  if (await uneLigne(`SELECT 1 FROM users WHERE email = $1`, [email], tx)) throw new ErreurAcces('Un compte existe déjà avec cette adresse.', 'invalide');
  const cree = await uneLigne<Utilisateur>(
    `INSERT INTO users (email, password_hash, full_name, role_code, must_change_password) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLONNES}`,
    [email, await hacherMotDePasse(entree.motDePasse), nom, role, entree.doitChanger ?? true],
    tx,
  );
  await journaliser({ acteur, action: 'utilisateur.creation', entite: 'utilisateur', id: cree!.id, resume: `Compte créé (${role})`, changements: { role } }, tx);
  return cree!;
}

export async function modifierUtilisateur(id: string, changements: { role?: string; actif?: boolean; nom?: string }, acteur: Acteur): Promise<void> {
  const actuel = await utilisateurParId(id);
  if (!actuel) throw new ErreurAcces('Compte introuvable.', 'invalide');
  const role = changements.role ?? actuel.role_code;
  if (!ROLES.est(role)) throw new ErreurAcces('Rôle inconnu.', 'invalide');
  const actif = changements.actif ?? actuel.is_active;
  // Il doit toujours rester au moins un administrateur actif.
  if (actuel.role_code === 'administrateur' && actuel.is_active && (role !== 'administrateur' || !actif)) {
    const autres = await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE role_code = 'administrateur' AND is_active AND id <> $1`, [id]);
    if ((autres?.n ?? 0) === 0) throw new ErreurAcces('Impossible : il doit rester au moins un administrateur actif.', 'invalide');
  }
  const nom = changements.nom?.replace(/\s+/g, ' ').trim() || actuel.full_name;
  await executer(`UPDATE users SET role_code = $2, is_active = $3, full_name = $4 WHERE id = $1`, [id, role, actif, nom]);
  if (!actif || role !== actuel.role_code) await executer(`DELETE FROM sessions WHERE user_id = $1`, [id]);
  await journaliser({ acteur, action: 'utilisateur.modification', entite: 'utilisateur', id, resume: 'Compte modifié', changements: { role: [actuel.role_code, role], actif: [actuel.is_active, actif] } });
}

/** Change le mot de passe et ferme toutes les autres sessions du compte. */
export async function changerMotDePasse(id: string, nouveau: string, acteur: Acteur, options: { ancien?: string; doitChanger?: boolean } = {}): Promise<void> {
  const defaut = validerMotDePasse(nouveau);
  if (defaut) throw new ErreurAcces(defaut, 'invalide');
  if (options.ancien !== undefined) {
    const ligne = await uneLigne<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [id]);
    if (!ligne || !(await verifierMotDePasse(options.ancien, ligne.password_hash))) throw new ErreurAcces('Mot de passe actuel incorrect.', 'identifiants');
    if (options.ancien === nouveau) throw new ErreurAcces('Le nouveau mot de passe doit être différent de l’ancien.', 'invalide');
  }
  await executer(`UPDATE users SET password_hash = $2, must_change_password = $3 WHERE id = $1`, [id, await hacherMotDePasse(nouveau), options.doitChanger ?? false]);
  await executer(`DELETE FROM sessions WHERE user_id = $1`, [id]);
  await journaliser({ acteur, action: 'utilisateur.mot_de_passe', entite: 'utilisateur', id, resume: 'Mot de passe changé' });
}
