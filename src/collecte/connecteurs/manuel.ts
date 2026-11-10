/**
 * Import manuel assisté : un courtier colle le texte d'une annonce qu'il a
 * lue lui-même (site d'emploi, WhatsApp, message d'un employeur). Aucune
 * requête n'est envoyée au site d'origine : l'adresse est conservée comme lien.
 */
import { classer } from '@/domaine/classification';
import { lireDate } from '@/domaine/extraction';
import { urlCanonique } from '@/domaine/doublons';
import { sha256 } from '@/domaine/texte';
import type { ChampsStructures, OffreBrute } from '../types';

export type SaisieManuelle = {
  titre?: string | null;
  texte: string;
  url?: string | null;
  employeur?: string | null;
  typeEmployeur?: string | null;
  ville?: string | null;
  quartier?: string | null;
  /** Date de publication écrite dans l'annonce (AAAA-MM-JJ). Jamais la date du jour par défaut. */
  datePublication?: string | null;
  dateExpiration?: string | null;
  contrat?: string | null;
  salaireMin?: number | null;
  salaireMax?: number | null;
  periodeSalaire?: 'mois' | 'semaine' | 'jour' | 'heure' | null;
  urgent?: boolean;
};

const SALUTATION = /^(?:bonjour|bonsoir|salut|salam(?:\s+ale[iy]k[ou]u?m)?|hello|hi|السلام عليكم|سلام|مرحبا)(?=[\s,!.:;–—-]|$)[\s,!.:;–—-]*/i;
const FIN_DE_PHRASE = /(?<=[.!?؟])\s+/;

const raccourcir = (phrase: string): string => (phrase.length > 120 ? `${phrase.slice(0, 117).trimEnd()}…` : phrase);

/**
 * Titre à défaut de titre saisi. Un message d'employeur commence souvent par
 * une salutation ou une présentation (« Bonjour, nous sommes le riad X ») : on
 * retient la première phrase qui NOMME un métier de la taxonomie ; à défaut,
 * la première ligne utile.
 */
export function titreDepuisTexte(texte: string): string {
  const phrases = texte
    .split(/\r?\n/)
    .flatMap((ligne) => ligne.split(FIN_DE_PHRASE))
    .map((phrase) => phrase.replace(/^[\s•*\-–—#>]+/, '').replace(SALUTATION, '').trim())
    .filter((phrase) => phrase.length >= 3)
    .slice(0, 8);
  const premiere = phrases[0];
  if (!premiere) return '';
  const avecMetier = phrases.find((phrase) => classer(phrase).principal !== null);
  return raccourcir(avecMetier ?? premiere);
}

export function offreDepuisSaisie(saisie: SaisieManuelle): OffreBrute {
  const texte = saisie.texte.trim();
  const titre = (saisie.titre?.trim() || titreDepuisTexte(texte)).slice(0, 300);
  const canonique = urlCanonique(saisie.url);
  const publieLe = lireDate(saisie.datePublication);
  const champs: ChampsStructures = {};
  if (saisie.contrat) champs.contrat = saisie.contrat;
  if (saisie.typeEmployeur) champs.typeEmployeur = saisie.typeEmployeur;
  if (saisie.ville) champs.ville = saisie.ville;
  if (saisie.quartier) champs.quartier = saisie.quartier;
  if (saisie.salaireMin) {
    champs.salaireMin = saisie.salaireMin;
    champs.salaireMax = saisie.salaireMax ?? null;
    champs.periodeSalaire = saisie.periodeSalaire ?? null;
    champs.devise = 'MAD';
  }
  if (saisie.urgent) champs.urgent = true;
  return {
    // Même adresse ou même texte recollé = même offre (mise à jour, pas de doublon).
    idExterne: canonique ?? `saisie:${sha256(`${titre}\n${texte}`).slice(0, 32)}`,
    url: canonique ? (saisie.url ?? null) : null,
    titre,
    texte,
    employeur: saisie.employeur?.trim() || null,
    // La ville choisie dans le formulaire situe l'offre au Maroc (le référentiel ne contient que des villes marocaines).
    lieu: null,
    publieLe,
    precisionDate: publieLe ? 'exacte' : 'inconnue',
    expireLe: lireDate(saisie.dateExpiration),
    champs,
  };
}
