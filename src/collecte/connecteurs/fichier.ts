/**
 * Import d'un fichier CSV ou JSON fourni par un partenaire (export d'un site
 * qui a donné son accord, liste d'un employeur, tableau tenu par l'équipe).
 * Aucun réseau : le fichier est lu tel quel.
 *
 * Colonnes reconnues (insensibles à la casse et aux accents) :
 *   titre* · description · employeur · ville · quartier · pays · url ·
 *   date_publication · date_expiration · contrat · salaire_min · salaire_max ·
 *   periode_salaire · postes
 */
import { lireDate } from '@/domaine/extraction';
import { urlCanonique } from '@/domaine/doublons';
import { normaliserTexte, sha256 } from '@/domaine/texte';
import type { ChampsStructures, OffreBrute } from '../types';

const ALIAS: Record<string, string[]> = {
  titre: ['titre', 'title', 'poste', 'intitule', 'job title'],
  description: ['description', 'texte', 'annonce', 'details', 'detail'],
  employeur: ['employeur', 'entreprise', 'societe', 'company', 'recruteur'],
  ville: ['ville', 'city', 'lieu', 'localisation', 'location'],
  quartier: ['quartier', 'district', 'zone'],
  pays: ['pays', 'country'],
  url: ['url', 'lien', 'link', 'adresse'],
  date_publication: ['date publication', 'date de publication', 'date', 'publie le', 'published', 'date posted'],
  date_expiration: ['date expiration', 'date d expiration', 'expire le', 'expiration', 'valid through'],
  contrat: ['contrat', 'type de contrat', 'contract'],
  salaire_min: ['salaire min', 'salaire', 'salary', 'salaire minimum'],
  salaire_max: ['salaire max', 'salaire maximum'],
  periode_salaire: ['periode salaire', 'periode', 'period'],
  postes: ['postes', 'nombre de postes', 'headcount'],
};

function champCanonique(entete: string): string | null {
  const normalise = normaliserTexte(entete.replace(/_/g, ' '));
  for (const [champ, alias] of Object.entries(ALIAS)) if (alias.includes(normalise)) return champ;
  return null;
}

/** Analyse CSV conforme à la RFC 4180 (guillemets, séparateur « ; » ou « , », BOM). */
export function analyserCsv(contenu: string): string[][] {
  const texte = contenu.replace(/^\uFEFF/, '');
  const premiereLigne = texte.split(/\r?\n/, 1)[0] ?? '';
  const separateur = (premiereLigne.match(/;/g)?.length ?? 0) >= (premiereLigne.match(/,/g)?.length ?? 0) ? ';' : ',';
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let entreGuillemets = false;
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte[i]!;
    if (entreGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') {
          champ += '"';
          i += 1;
        } else entreGuillemets = false;
      } else champ += c;
    } else if (c === '"' && champ === '') entreGuillemets = true;
    else if (c === separateur) {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i += 1;
      ligne.push(champ);
      champ = '';
      if (ligne.some((valeur) => valeur.trim() !== '')) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some((valeur) => valeur.trim() !== '')) lignes.push(ligne);
  return lignes;
}

function nombre(valeur: string | undefined): number | null {
  if (!valeur) return null;
  const n = Number.parseFloat(valeur.replace(/[^\d.,]/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function ligneVersOffre(donnees: Record<string, string>, numero: number): OffreBrute | { erreur: string } {
  const titre = (donnees.titre ?? '').trim();
  if (titre.length < 3) return { erreur: `ligne ${numero} : titre absent` };
  const texte = (donnees.description ?? '').trim();
  const canonique = urlCanonique(donnees.url);
  const publieLe = lireDate(donnees.date_publication);
  const champs: ChampsStructures = {};
  if (donnees.contrat) champs.contrat = normaliserTexte(donnees.contrat).replace(/ /g, '_');
  const salaireMin = nombre(donnees.salaire_min);
  if (salaireMin) {
    champs.salaireMin = salaireMin;
    champs.salaireMax = nombre(donnees.salaire_max);
    const periode = normaliserTexte(donnees.periode_salaire ?? '');
    champs.periodeSalaire = periode === 'mois' || periode === 'semaine' || periode === 'jour' || periode === 'heure' ? periode : null;
    champs.devise = 'MAD';
  }
  const postes = nombre(donnees.postes);
  if (postes) champs.nombrePostes = Math.round(postes);
  if (donnees.quartier) champs.quartier = donnees.quartier.trim();
  return {
    idExterne: canonique ?? `fichier:${sha256(`${titre}\n${donnees.employeur ?? ''}\n${donnees.ville ?? ''}\n${texte}`).slice(0, 32)}`,
    url: canonique ? (donnees.url ?? null) : null,
    titre: titre.slice(0, 300),
    texte,
    employeur: donnees.employeur?.trim() || null,
    lieu: donnees.ville?.trim() || null,
    pays: donnees.pays?.trim() || null,
    publieLe,
    precisionDate: publieLe ? 'exacte' : 'inconnue',
    expireLe: lireDate(donnees.date_expiration),
    champs,
  };
}

export type ResultatFichier = { offres: OffreBrute[]; erreurs: string[] };

export function analyserFichier(contenu: string, nomFichier: string): ResultatFichier {
  const resultat: ResultatFichier = { offres: [], erreurs: [] };
  const estJson = /\.json$/i.test(nomFichier) || /^\s*[[{]/.test(contenu);
  let enregistrements: Record<string, string>[] = [];

  if (estJson) {
    let donnees: unknown;
    try {
      donnees = JSON.parse(contenu);
    } catch {
      return { offres: [], erreurs: ['Le fichier JSON est illisible.'] };
    }
    const tableau = Array.isArray(donnees) ? donnees : Array.isArray((donnees as { offres?: unknown })?.offres) ? (donnees as { offres: unknown[] }).offres : null;
    if (!tableau) return { offres: [], erreurs: ['Le JSON doit être un tableau d’offres (ou un objet { "offres": [...] }).'] };
    enregistrements = tableau.map((element) => {
      const sortie: Record<string, string> = {};
      if (typeof element === 'object' && element !== null) {
        for (const [cleBrute, valeur] of Object.entries(element)) {
          const champ = champCanonique(cleBrute);
          if (champ && (typeof valeur === 'string' || typeof valeur === 'number')) sortie[champ] = String(valeur);
        }
      }
      return sortie;
    });
  } else {
    const lignes = analyserCsv(contenu);
    const entetes = (lignes[0] ?? []).map(champCanonique);
    if (!entetes.includes('titre')) return { offres: [], erreurs: ['Colonne « titre » introuvable dans la première ligne du fichier.'] };
    enregistrements = lignes.slice(1).map((ligne) => {
      const sortie: Record<string, string> = {};
      ligne.forEach((valeur, index) => {
        const champ = entetes[index];
        if (champ && valeur.trim() !== '') sortie[champ] = valeur.trim();
      });
      return sortie;
    });
  }

  if (enregistrements.length > 2000) {
    resultat.erreurs.push(`Fichier limité à 2 000 lignes (${enregistrements.length} reçues) : seules les 2 000 premières sont lues.`);
    enregistrements = enregistrements.slice(0, 2000);
  }
  enregistrements.forEach((donnees, index) => {
    const offre = ligneVersOffre(donnees, index + 2);
    if ('erreur' in offre) resultat.erreurs.push(offre.erreur);
    else resultat.offres.push(offre);
  });
  return resultat;
}
