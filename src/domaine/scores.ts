/**
 * Scores d'une offre (0 à 100), tous explicables :
 *   fraîcheur   ancienneté de la publication
 *   qualité     complétude de l'annonce + fiabilité de la source
 *   pertinence  intérêt pour l'activité de Yallah Services
 *   placement   indice de priorité commerciale — une ESTIMATION, pas une garantie
 * Le score de risque est dans risques.ts.
 */
import { accord, compter } from './accord';
import type { Contrat, PrecisionDate, TypeEmployeur } from './extraction';
import { villeParCode } from './geographie';
import { metierParCode } from './taxonomie';

const JOUR_MS = 86_400_000;

export type LigneScore = { critere: string; points: number; max: number; explication: string };
export type ScoreDetaille = { score: number; lignes: LigneScore[] };

const borner = (valeur: number) => Math.max(0, Math.min(100, Math.round(valeur)));

/** 100 le jour de la publication, divisé par deux tous les `demiVieJours`. 0 si expirée ou non datée. */
export function scoreFraicheur(publieLe: Date | null, maintenant: Date, demiVieJours: number, expiree = false): number {
  if (!publieLe || expiree) return 0;
  const age = Math.max(0, (maintenant.getTime() - publieLe.getTime()) / JOUR_MS);
  return borner(100 * 0.5 ** (age / demiVieJours));
}

export type EntreeQualite = {
  longueurDescription: number;
  ville: boolean;
  quartier: boolean;
  employeur: boolean;
  salaire: boolean;
  contrat: boolean;
  precisionDate: PrecisionDate;
  experience: boolean;
  rythme: boolean;
  /** Lien vers l'annonce d'origine ou moyen de contact connu. */
  joignable: boolean;
  fiabiliteSource: number;
};

export function scoreQualite(entree: EntreeQualite): ScoreDetaille {
  const lignes: LigneScore[] = [];
  const ligne = (critere: string, obtenu: boolean | number, max: number, oui: string, non: string) => {
    const points = typeof obtenu === 'number' ? obtenu : obtenu ? max : 0;
    lignes.push({ critere, points, max, explication: points > 0 ? oui : non });
  };
  const description = entree.longueurDescription >= 400 ? 15 : entree.longueurDescription >= 150 ? 10 : entree.longueurDescription >= 40 ? 5 : 0;
  ligne('Description', description, 15, 'Description présente', 'Description absente ou très courte');
  ligne('Ville', entree.ville, 15, 'Ville identifiée', 'Ville non précisée');
  ligne('Quartier', entree.quartier, 5, 'Quartier identifié', 'Quartier non précisé');
  ligne('Employeur', entree.employeur, 10, 'Employeur nommé', 'Employeur non identifié');
  ligne('Salaire', entree.salaire, 15, 'Salaire affiché', 'Salaire non affiché');
  ligne('Contrat', entree.contrat, 10, 'Type de contrat précisé', 'Contrat non précisé');
  ligne('Date', entree.precisionDate === 'exacte' ? 10 : entree.precisionDate === 'approximative' ? 5 : 0, 10, entree.precisionDate === 'exacte' ? 'Date de publication exacte' : 'Date de publication approximative', 'Date de publication inconnue');
  ligne('Expérience', entree.experience, 5, 'Expérience demandée précisée', 'Expérience non précisée');
  ligne('Rythme', entree.rythme, 5, 'Rythme de travail précisé', 'Rythme non précisé');
  ligne('Accès', entree.joignable, 10, 'Lien ou contact disponible', 'Aucun lien ni contact');
  const completude = lignes.reduce((total, l) => total + l.points, 0);
  const fiabilite = Math.max(0, Math.min(100, entree.fiabiliteSource));
  lignes.push({ critere: 'Source', points: Math.round(fiabilite * 0.2), max: 20, explication: `Fiabilité de la source : ${fiabilite}/100` });
  return { score: borner(completude * 0.8 + fiabilite * 0.2), lignes };
}

const POINTS_CONTRAT: Record<Contrat, number> = {
  cdi: 5, cdd: 4, saisonnier: 3, interim: 3, journalier: 3, anapec: 3, non_precise: 2, freelance: 1, stage: 0,
};
const POINTS_EMPLOYEUR: Record<TypeEmployeur, number> = {
  famille: 10, particulier: 10, riad: 10, residence: 9, hotel: 8, spa: 8, salon: 8, entreprise: 5, autre: 4,
};

export type EntreePertinence = {
  metier: string | null;
  confianceMetier: number;
  ville: string | null;
  typeEmployeur: TypeEmployeur | null;
  contrat: Contrat;
  urgent: boolean;
  massif: boolean;
  salaireAffiche: boolean;
  salaireAnormal: boolean;
  scoreRisque: number;
  seuilRisqueEleve: number;
};

/**
 * Pertinence pour Yallah Services (100 points) :
 *   métier 45 · zone 25 · type d'employeur 10 · contrat 5 · urgence/volume 10 · salaire 5
 * puis division par deux si le risque est élevé.
 */
export function scorePertinence(entree: EntreePertinence): ScoreDetaille {
  const lignes: LigneScore[] = [];
  const metier = metierParCode(entree.metier);
  const pointsMetier = metier ? 45 * (metier.priorite / 100) * (entree.confianceMetier / 100) : 0;
  lignes.push({
    critere: 'Métier',
    points: Math.round(pointsMetier),
    max: 45,
    explication: metier ? `${metier.libelle.fr} — priorité Yallah ${metier.priorite}/100, confiance ${entree.confianceMetier} %` : 'Métier hors de la taxonomie Yallah',
  });

  const ville = villeParCode(entree.ville);
  let pointsZone = 0;
  let explicationZone = 'Ville non précisée';
  if (ville) {
    if (ville.statut === 'confirmee' || ville.statut === 'pole') {
      pointsZone = ville.phase === 1 ? 25 : ville.phase === 2 ? 20 : 15;
      explicationZone = `${ville.nom} — zone Yallah, phase ${ville.phase}`;
    } else if (ville.statut === 'candidate') {
      pointsZone = 10;
      explicationZone = `${ville.nom} — ville candidate`;
    } else {
      pointsZone = 5;
      explicationZone = `${ville.nom} — hors zone Yallah actuelle`;
    }
  }
  lignes.push({ critere: 'Zone', points: pointsZone, max: 25, explication: explicationZone });

  const pointsEmployeur = entree.typeEmployeur ? POINTS_EMPLOYEUR[entree.typeEmployeur] : 3;
  lignes.push({ critere: 'Employeur', points: pointsEmployeur, max: 10, explication: entree.typeEmployeur ? `Type d’employeur : ${entree.typeEmployeur}` : 'Type d’employeur inconnu' });

  lignes.push({ critere: 'Contrat', points: POINTS_CONTRAT[entree.contrat], max: 5, explication: entree.contrat === 'non_precise' ? 'Contrat non précisé' : `Contrat : ${entree.contrat}` });

  const pointsVolume = (entree.urgent ? 5 : 0) + (entree.massif ? 5 : 0);
  lignes.push({
    critere: 'Urgence et volume',
    points: pointsVolume,
    max: 10,
    explication: [entree.urgent ? 'recrutement urgent' : null, entree.massif ? 'plusieurs postes' : null].filter(Boolean).join(', ') || 'Ni urgence ni recrutement en nombre',
  });

  const pointsSalaire = entree.salaireAffiche ? (entree.salaireAnormal ? 2 : 5) : 0;
  lignes.push({ critere: 'Salaire', points: pointsSalaire, max: 5, explication: entree.salaireAffiche ? (entree.salaireAnormal ? 'Salaire affiché mais anormal' : 'Salaire affiché') : 'Salaire non affiché' });

  let total = lignes.reduce((somme, l) => somme + l.points, 0);
  if (entree.scoreRisque >= entree.seuilRisqueEleve) {
    lignes.push({ critere: 'Risque', points: -Math.round(total / 2), max: 0, explication: 'Risque élevé : pertinence divisée par deux' });
    total /= 2;
  }
  return { score: borner(total), lignes };
}

export type EntreePlacement = {
  pertinence: number;
  fraicheur: number;
  qualite: number;
  /** Candidats disponibles correspondant au métier et à la ville (null = non calculé). */
  candidatsDisponibles: number | null;
  /** 100 = contact direct connu ; 50 = lien vers l'annonce ; 0 = rien. */
  joignabilite: number;
};

/**
 * Indice de placement : estimation de la priorité commerciale d'une offre.
 * Pertinence 30 % · fraîcheur 25 % · qualité 15 % · vivier de candidats 20 % · joignabilité 10 %.
 * Ce n'est PAS une probabilité mesurée : aucun historique de placements ne l'a encore calibré.
 */
export function indicePlacement(entree: EntreePlacement): ScoreDetaille {
  const vivier = entree.candidatsDisponibles === null ? 40 : entree.candidatsDisponibles >= 3 ? 100 : entree.candidatsDisponibles === 2 ? 75 : entree.candidatsDisponibles === 1 ? 50 : 0;
  const lignes: LigneScore[] = [
    { critere: 'Pertinence', points: Math.round(entree.pertinence * 0.3), max: 30, explication: `Pertinence Yallah : ${entree.pertinence}/100` },
    { critere: 'Fraîcheur', points: Math.round(entree.fraicheur * 0.25), max: 25, explication: `Fraîcheur : ${entree.fraicheur}/100` },
    { critere: 'Qualité', points: Math.round(entree.qualite * 0.15), max: 15, explication: `Qualité de l’annonce : ${entree.qualite}/100` },
    {
      critere: 'Vivier',
      points: Math.round(vivier * 0.2),
      max: 20,
      explication: entree.candidatsDisponibles === null ? 'Vivier de candidats non calculé' : `${compter(entree.candidatsDisponibles, 'candidat')} ${accord(entree.candidatsDisponibles, 'disponible')} sur ce métier et cette ville`,
    },
    { critere: 'Joignabilité', points: Math.round(entree.joignabilite * 0.1), max: 10, explication: entree.joignabilite >= 100 ? 'Contact employeur connu' : entree.joignabilite >= 50 ? 'Lien vers l’annonce disponible' : 'Aucun moyen de contact' },
  ];
  return { score: borner(lignes.reduce((somme, l) => somme + l.points, 0)), lignes };
}
