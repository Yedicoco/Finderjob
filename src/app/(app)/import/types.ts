/** Données échangées entre le formulaire d'import (client) et ses actions (serveur). */

export type LigneApercu = { terme: string; valeur: string; alerte?: boolean };

export type ApercuVue = {
  source: string;
  noteSource: string;
  rejet: { titre: string; detail: string } | null;
  dejaConnue: { id: string; reference: string } | null;
  offre: {
    titre: string;
    lignes: LigneApercu[];
    statut: string;
    actif: boolean;
    explication: string | null;
    risque: { score: number; niveau: 'faible' | 'modere' | 'eleve'; signaux: string[] };
    pertinence: number;
    doublons: { id: string; reference: string; titre: string; score: number; certain: boolean }[];
  } | null;
};

export type ResultatImportVue = {
  ton: 'succes' | 'attention' | 'erreur';
  titre: string;
  detail: string;
  lien: { href: string; libelle: string } | null;
};

export type EtatImport = { erreur?: string; apercu?: ApercuVue; resultat?: ResultatImportVue } | null;

export type EtatFichier = { erreur?: string; bilan?: { ton: 'succes' | 'attention' | 'erreur'; message: string; lignes: string[] } } | null;
