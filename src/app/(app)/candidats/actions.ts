'use server';

import { coche, executerAction, liste, nombreOuNul, texte, texteOuNul } from '@/serveur/actions';
import { ErreurCandidat, ajouterReference, anonymiserCandidat, changerStatutManuel, creerCandidat, modifierCandidat, verifierReference, type SaisieCandidat } from '@/serveur/candidats';
import type { EtatAction } from '@/serveur/etat-action';

function lireSaisie(donnees: FormData): SaisieCandidat {
  const principal = texte(donnees, 'metierPrincipal');
  const metiers = [principal, ...liste(donnees, 'metiers').filter((code) => code !== principal)].filter(Boolean);
  const nombres = { ageDeclare: nombreOuNul(donnees, 'ageDeclare'), experienceAnnees: nombreOuNul(donnees, 'experienceAnnees'), salaireAttendu: nombreOuNul(donnees, 'salaireAttendu'), joursParSemaine: nombreOuNul(donnees, 'joursParSemaine') };
  const libelles: Record<keyof typeof nombres, string> = { ageDeclare: 'L’âge', experienceAnnees: 'Le nombre d’années d’expérience', salaireAttendu: 'Le salaire souhaité', joursParSemaine: 'Le nombre de jours par semaine' };
  for (const [champ, valeur] of Object.entries(nombres) as [keyof typeof nombres, number | null][]) if (Number.isNaN(valeur)) throw new ErreurCandidat(`${libelles[champ]} doit être un nombre.`);
  return {
    nom: texte(donnees, 'nom'),
    telephone: texteOuNul(donnees, 'telephone'),
    email: texteOuNul(donnees, 'email'),
    notes: texteOuNul(donnees, 'notes'),
    ...nombres,
    consentementDonne: coche(donnees, 'consentementDonne'),
    consentementCanal: texte(donnees, 'consentementCanal'),
    consentementDate: texteOuNul(donnees, 'consentementDate'),
    whatsappOptIn: coche(donnees, 'whatsappOptIn'),
    metiers,
    ville: texteOuNul(donnees, 'ville'),
    quartier: texteOuNul(donnees, 'quartier'),
    villesAcceptees: liste(donnees, 'villesAcceptees'),
    langues: liste(donnees, 'langues'),
    periodeSalaire: texte(donnees, 'periodeSalaire') || 'mois',
    logement: texte(donnees, 'logement') || 'indifferent',
    rythmes: liste(donnees, 'rythmes'),
    disponibleLe: texteOuNul(donnees, 'disponibleLe'),
    permis: coche(donnees, 'permis'),
    documents: liste(donnees, 'documents'),
    competences: liste(donnees, 'competences'),
    resume: texteOuNul(donnees, 'resume'),
  };
}

export async function creerCandidatAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('candidats.gerer', async ({ acteur }) => {
    const cree = await creerCandidat(lireSaisie(donnees), acteur);
    return { redirection: `/candidats/${cree.id}` };
  });
}

export async function modifierCandidatAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('candidats.gerer', async ({ acteur }) => {
    const id = texte(donnees, 'id');
    await modifierCandidat(id, lireSaisie(donnees), acteur);
    return { redirection: `/candidats/${id}` };
  });
}

export async function changerStatutCandidatAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('candidats.gerer', async ({ acteur }) => {
    await changerStatutManuel(texte(donnees, 'id'), texte(donnees, 'statut'), acteur);
    return { message: 'Statut mis à jour.' };
  });
}

export async function ajouterReferenceAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('candidats.gerer', async ({ acteur }) => {
    await ajouterReference(texte(donnees, 'id'), { nom: texte(donnees, 'nom'), telephone: texteOuNul(donnees, 'telephone'), relation: texte(donnees, 'relation') }, acteur);
    return { message: 'Référence ajoutée.' };
  });
}

export async function verifierReferenceAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('candidats.gerer', async ({ acteur }) => {
    await verifierReference(texte(donnees, 'reference'), texteOuNul(donnees, 'note'), acteur);
    return { message: 'Vérification notée.' };
  });
}

export async function anonymiserCandidatAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('candidats.gerer', async ({ acteur }) => {
    await anonymiserCandidat(texte(donnees, 'id'), texte(donnees, 'raison') as Parameters<typeof anonymiserCandidat>[1], acteur);
    return { message: 'Fiche anonymisée : les données identifiantes ont été effacées.' };
  });
}
