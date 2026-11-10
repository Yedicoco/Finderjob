/**
 * Configuration lue dans l'environnement. Aucun secret n'a de valeur par
 * défaut : sans YS_CLE_SECRETE, l'application refuse de démarrer.
 */
import { hkdfSync } from 'node:crypto';

export class ErreurConfig extends Error {}

export const estProduction = () => process.env.NODE_ENV === 'production';

/**
 * Aperçu intégré dans une autre page (iframe d'un environnement de
 * prévisualisation). Relâche deux protections qui, sinon, empêchent toute
 * connexion dans une iframe : le cookie passe en SameSite=None + Partitioned
 * et l'en-tête frame-ancestors est levé. À NE JAMAIS activer en production.
 */
export const apercuIntegre = () => process.env.YS_APERCU_INTEGRE === '1';

let cleMaitre: Buffer | null = null;

function lireCleMaitre(): Buffer {
  if (cleMaitre) return cleMaitre;
  const brut = process.env.YS_CLE_SECRETE?.trim();
  if (!brut) {
    throw new ErreurConfig('YS_CLE_SECRETE est absent. Générez-le avec : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  }
  const cle = /^[0-9a-f]{64,}$/i.test(brut) ? Buffer.from(brut, 'hex') : Buffer.from(brut, 'base64');
  if (cle.length < 32) throw new ErreurConfig('YS_CLE_SECRETE doit contenir au moins 32 octets (base64 ou hexadécimal).');
  cleMaitre = cle;
  return cle;
}

const derivees = new Map<string, Buffer>();

/** Clé dérivée par usage (HKDF-SHA256) : compromettre l'une ne donne pas les autres. */
export function cleDerivee(usage: 'chiffrement' | 'index' | 'ip' | 'jeton'): Buffer {
  const existante = derivees.get(usage);
  if (existante) return existante;
  const cle = Buffer.from(hkdfSync('sha256', lireCleMaitre(), Buffer.from('yallah-job-radar'), Buffer.from(`v1:${usage}`), 32));
  derivees.set(usage, cle);
  return cle;
}

/** Tests uniquement : oublie les clés dérivées après un changement de YS_CLE_SECRETE. */
export function reinitialiserCles(): void {
  cleMaitre = null;
  derivees.clear();
}

export function entier(nom: string, defaut: number, min: number, max: number): number {
  const valeur = Number.parseInt(process.env[nom] ?? '', 10);
  return Number.isFinite(valeur) && valeur >= min && valeur <= max ? valeur : defaut;
}

export const config = {
  dureeSessionHeures: () => entier('YS_SESSION_HEURES', 12, 1, 72),
  /** Fournisseur d'e-mails (facultatif). Sans lui, les envois sont « simulés » et marqués comme tels. */
  emailUrl: () => process.env.YS_EMAIL_API_URL?.trim() || null,
  emailCle: () => process.env.YS_EMAIL_API_CLE?.trim() || null,
  emailExpediteur: () => process.env.YS_EMAIL_EXPEDITEUR?.trim() || null,
  /** WhatsApp Business Cloud API (facultatif). */
  whatsappUrl: () => process.env.YS_WHATSAPP_API_URL?.trim() || null,
  whatsappCle: () => process.env.YS_WHATSAPP_API_CLE?.trim() || null,
  /** Modèle de langage (facultatif, API compatible « chat completions »). */
  iaUrl: () => process.env.YS_IA_API_URL?.trim() || null,
  iaCle: () => process.env.YS_IA_API_CLE?.trim() || null,
  iaModele: () => process.env.YS_IA_MODELE?.trim() || null,
  /** Adresse publique de l'outil (liens dans les e-mails). Facultatif. */
  urlPublique: () => process.env.YS_URL_PUBLIQUE?.trim().replace(/\/+$/, '') || null,
};
