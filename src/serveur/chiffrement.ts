/**
 * Chiffrement des données personnelles et hachage des secrets.
 *
 *   chiffrer / dechiffrer   AES-256-GCM, IV aléatoire de 96 bits, format
 *                           « v1.<iv>.<étiquette>.<chiffré> » (base64url)
 *   indexAveugle            HMAC-SHA256 tronqué : recherche exacte (téléphone,
 *                           mot d'un nom) sans stocker la valeur en clair
 *   hacherMotDePasse        scrypt (N = 2^15, r = 8, p = 1), sel de 16 octets
 *   hacherJeton             SHA-256 du jeton de session (seule l'empreinte est stockée)
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { normaliserTexte } from '@/domaine/texte';
import { cleDerivee } from './config';

const VERSION = 'v1';

export function chiffrer(clair: string | null | undefined): string | null {
  if (clair === null || clair === undefined) return null;
  const texte = clair.trim();
  if (texte === '') return null;
  const iv = randomBytes(12);
  const chiffreur = createCipheriv('aes-256-gcm', cleDerivee('chiffrement'), iv);
  const chiffre = Buffer.concat([chiffreur.update(texte, 'utf8'), chiffreur.final()]);
  return [VERSION, iv.toString('base64url'), chiffreur.getAuthTag().toString('base64url'), chiffre.toString('base64url')].join('.');
}

export class ErreurDechiffrement extends Error {}

export function dechiffrer(valeur: string | null | undefined): string | null {
  if (!valeur) return null;
  const [version, iv, etiquette, chiffre] = valeur.split('.');
  if (version !== VERSION || !iv || !etiquette || chiffre === undefined) throw new ErreurDechiffrement('Format de donnée chiffrée inconnu');
  try {
    const dechiffreur = createDecipheriv('aes-256-gcm', cleDerivee('chiffrement'), Buffer.from(iv, 'base64url'));
    dechiffreur.setAuthTag(Buffer.from(etiquette, 'base64url'));
    return Buffer.concat([dechiffreur.update(Buffer.from(chiffre, 'base64url')), dechiffreur.final()]).toString('utf8');
  } catch {
    throw new ErreurDechiffrement('Donnée chiffrée illisible (clé différente ou donnée altérée)');
  }
}

/** Déchiffre sans jamais faire échouer l'affichage d'une page. */
export function dechiffrerOuVide(valeur: string | null | undefined): string | null {
  try {
    return dechiffrer(valeur);
  } catch {
    return null;
  }
}

export function indexAveugle(valeur: string): string {
  return createHmac('sha256', cleDerivee('index')).update(valeur).digest('hex').slice(0, 32);
}

/** Téléphone marocain ramené à sa forme internationale sans séparateur (« 212600000001 »). */
export function chiffresTelephone(brut: string | null | undefined): string | null {
  if (!brut) return null;
  let chiffres = brut.replace(/\D/g, '');
  if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);
  if (chiffres.length === 10 && chiffres.startsWith('0')) chiffres = `212${chiffres.slice(1)}`;
  return chiffres.length >= 8 && chiffres.length <= 15 ? chiffres : null;
}

export function indexTelephone(brut: string | null | undefined): string | null {
  const chiffres = chiffresTelephone(brut);
  return chiffres ? indexAveugle(`tel:${chiffres}`) : null;
}

/** Un index par mot du nom (≥ 2 lettres) : permet de retrouver « Amrani » sans lire les noms. */
export function indexNom(nom: string | null | undefined): string[] {
  if (!nom) return [];
  const mots = normaliserTexte(nom).split(' ').filter((mot) => mot.length >= 2);
  return [...new Set(mots)].slice(0, 8).map((mot) => indexAveugle(`nom:${mot}`));
}

export function empreinteIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHmac('sha256', cleDerivee('ip')).update(ip).digest('hex').slice(0, 24);
}

// --------------------------------------------------------- mots de passe ---

const SCRYPT = { N: 1 << 15, r: 8, p: 1, longueur: 64, maxmem: 96 * 1024 * 1024 };

function deriver(motDePasse: string, sel: Buffer, N: number, r: number, p: number, longueur: number): Promise<Buffer> {
  return new Promise((resoudre, rejeter) => {
    scrypt(motDePasse.normalize('NFKC'), sel, longueur, { N, r, p, maxmem: SCRYPT.maxmem }, (erreur, cle) => (erreur ? rejeter(erreur) : resoudre(cle)));
  });
}

export async function hacherMotDePasse(motDePasse: string): Promise<string> {
  const sel = randomBytes(16);
  const cle = await deriver(motDePasse, sel, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.longueur);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, sel.toString('base64url'), cle.toString('base64url')].join('$');
}

export async function verifierMotDePasse(motDePasse: string, empreinte: string): Promise<boolean> {
  const [algo, n, r, p, sel, attendu] = empreinte.split('$');
  if (algo !== 'scrypt' || !sel || !attendu) return false;
  const N = Number(n);
  // Refuse des paramètres aberrants (empreinte corrompue) plutôt que de bloquer le processus.
  if (!Number.isInteger(N) || N < 1 << 14 || N > 1 << 17) return false;
  const reference = Buffer.from(attendu, 'base64url');
  try {
    const cle = await deriver(motDePasse, Buffer.from(sel, 'base64url'), N, Number(r), Number(p), reference.length);
    return cle.length === reference.length && timingSafeEqual(cle, reference);
  } catch {
    return false;
  }
}

export function validerMotDePasse(motDePasse: string): string | null {
  if (motDePasse.length < 12) return 'Le mot de passe doit contenir au moins 12 caractères.';
  if (motDePasse.length > 200) return 'Le mot de passe est trop long.';
  if (new Set(motDePasse).size < 6) return 'Le mot de passe est trop répétitif.';
  if (/^(motdepasse|password|yallah|azerty|qwerty|123456)/i.test(motDePasse)) return 'Ce mot de passe est trop facile à deviner.';
  return null;
}

export function nouveauJeton(): string {
  return randomBytes(32).toString('base64url');
}

export function hacherJeton(jeton: string): string {
  return createHash('sha256').update(`${cleDerivee('jeton').toString('hex')}:${jeton}`).digest('hex');
}
