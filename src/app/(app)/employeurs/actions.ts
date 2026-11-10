'use server';

import { coche, executerAction, liste, nombreOuNul, ouiNonOuNul, texte, texteOuNul } from '@/serveur/actions';
import { ErreurEmployeur, ajouterEchange, changerStatutBesoin, changerStatutEmployeur, creerBesoin, creerEmployeur, modifierBesoin, modifierEmployeur, type SaisieBesoin, type SaisieEmployeur } from '@/serveur/employeurs';
import type { EtatAction } from '@/serveur/etat-action';

function lireEmployeur(donnees: FormData): SaisieEmployeur {
  return {
    type: texte(donnees, 'type'),
    nom: texte(donnees, 'nom'),
    contact: texteOuNul(donnees, 'contact'),
    telephone: texteOuNul(donnees, 'telephone'),
    email: texteOuNul(donnees, 'email'),
    adresse: texteOuNul(donnees, 'adresse'),
    ville: texteOuNul(donnees, 'ville'),
    quartier: texteOuNul(donnees, 'quartier'),
    baseContact: texte(donnees, 'baseContact') || 'non_renseignee',
    nePasContacter: coche(donnees, 'nePasContacter'),
    notes: texteOuNul(donnees, 'notes'),
    prochaineRelance: texteOuNul(donnees, 'prochaineRelance'),
  };
}

function lireBesoin(donnees: FormData): SaisieBesoin {
  const nombres = { postes: nombreOuNul(donnees, 'postes'), salaireMin: nombreOuNul(donnees, 'salaireMin'), salaireMax: nombreOuNul(donnees, 'salaireMax'), experienceMin: nombreOuNul(donnees, 'experienceMin'), montantFrais: nombreOuNul(donnees, 'montantFrais') };
  if (Object.values(nombres).some((valeur) => Number.isNaN(valeur))) throw new ErreurEmployeur('Les champs numériques (postes, salaires, expérience, frais) doivent contenir des nombres.');
  return {
    employeurId: texte(donnees, 'employeur'),
    offreId: texteOuNul(donnees, 'offre'),
    titre: texte(donnees, 'titre'),
    metier: texteOuNul(donnees, 'metier'),
    postes: nombres.postes ?? 1,
    ville: texteOuNul(donnees, 'ville'),
    quartier: texteOuNul(donnees, 'quartier'),
    contrat: texte(donnees, 'contrat') || 'non_precise',
    temps: texte(donnees, 'temps') || 'non_precise',
    logement: texteOuNul(donnees, 'logement'),
    salaireMin: nombres.salaireMin,
    salaireMax: nombres.salaireMax,
    periodeSalaire: texteOuNul(donnees, 'periodeSalaire'),
    langues: liste(donnees, 'langues'),
    permis: ouiNonOuNul(donnees, 'permis'),
    experienceMin: nombres.experienceMin,
    debut: texteOuNul(donnees, 'debut'),
    urgent: coche(donnees, 'urgent'),
    exigences: texteOuNul(donnees, 'exigences'),
    formule: texteOuNul(donnees, 'formule'),
    montantFrais: nombres.montantFrais,
    notes: texteOuNul(donnees, 'notes'),
  };
}

export async function creerEmployeurAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('employeurs.gerer', async ({ acteur }) => {
    const cree = await creerEmployeur({ ...lireEmployeur(donnees), origine: texte(donnees, 'origine') || 'saisie' }, acteur);
    return { redirection: `/employeurs/${cree.id}` };
  });
}

export async function modifierEmployeurAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('employeurs.gerer', async ({ acteur }) => {
    const id = texte(donnees, 'id');
    await modifierEmployeur(id, lireEmployeur(donnees), acteur);
    return { redirection: `/employeurs/${id}` };
  });
}

export async function changerStatutEmployeurAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('employeurs.gerer', async ({ acteur }) => {
    await changerStatutEmployeur(texte(donnees, 'id'), texte(donnees, 'statut'), acteur);
    return { message: 'Statut mis à jour.' };
  });
}

export async function ajouterEchangeAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('employeurs.gerer', async ({ acteur }) => {
    await ajouterEchange(texte(donnees, 'id'), { type: texte(donnees, 'type'), resume: texte(donnees, 'resume'), date: texteOuNul(donnees, 'date'), prochaineAction: texteOuNul(donnees, 'prochaineAction') }, acteur);
    return { message: 'Échange enregistré.' };
  });
}

export async function creerBesoinAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('employeurs.gerer', async ({ acteur }) => {
    const cree = await creerBesoin(lireBesoin(donnees), acteur);
    return { redirection: `/besoins/${cree.id}` };
  });
}

export async function modifierBesoinAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('employeurs.gerer', async ({ acteur }) => {
    const id = texte(donnees, 'id');
    await modifierBesoin(id, lireBesoin(donnees), acteur);
    return { redirection: `/besoins/${id}` };
  });
}

export async function changerStatutBesoinAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('employeurs.gerer', async ({ acteur }) => {
    await changerStatutBesoin(texte(donnees, 'id'), texte(donnees, 'statut'), acteur);
    return { message: 'Statut du besoin mis à jour.' };
  });
}
