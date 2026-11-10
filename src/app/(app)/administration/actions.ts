'use server';

import { after } from 'next/server';
import { accord, compter } from '@/domaine/accord';
import { configIADepuisEnv, creerExtracteurIA } from '@/ia/extracteur';
import { coche, executerAction, nombreOuNul, texte, texteOuNul } from '@/serveur/actions';
import { notifierRelances, traiterAlertes } from '@/serveur/alertes';
import { ErreurAcces, changerMotDePasse, creerUtilisateur, modifierUtilisateur } from '@/serveur/auth';
import { chargerJeuDemo, supprimerJeuDemo } from '@/serveur/demo';
import type { EtatAction } from '@/serveur/etat-action';
import { executerCollecte, reprendreSource } from '@/serveur/ingestion';
import { executerMaintenance } from '@/serveur/maintenance';
import { definirParametre } from '@/serveur/parametres';
import { phraseBilanPerimetre } from '@/serveur/perimetre';
import { ErreurSource, modifierSource, type ModificationSource } from '@/serveur/sources';

// ------------------------------------------------------------------------ sources --

export async function modifierSourceAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('sources.gerer', async ({ acteur }) => {
    const nombres = {
      min_delay_ms: nombreOuNul(donnees, 'delaiSecondes'),
      max_requests_per_run: nombreOuNul(donnees, 'maxRequetes'),
      frequency_minutes: nombreOuNul(donnees, 'frequenceHeures'),
      max_excerpt_chars: nombreOuNul(donnees, 'extraitMax'),
      reliability_score: nombreOuNul(donnees, 'fiabilite'),
    };
    if (Object.values(nombres).some((valeur) => Number.isNaN(valeur))) throw new ErreurSource('Délai, requêtes, fréquence, extrait et fiabilité doivent être des nombres.');
    // Le formulaire parle en secondes et en heures : les bornes sont vérifiées ici dans ces unités, pour un message compréhensible.
    if (nombres.min_delay_ms !== null && (nombres.min_delay_ms < 1 || nombres.min_delay_ms > 120)) throw new ErreurSource('Le délai entre deux requêtes doit être compris entre 1 et 120 secondes.');
    if (nombres.frequency_minutes !== null && (nombres.frequency_minutes < 1 || nombres.frequency_minutes > 168)) throw new ErreurSource('La fréquence doit être comprise entre 1 et 168 heures.');
    const modification: ModificationSource = {
      feed_url: texteOuNul(donnees, 'adresseFlux'),
      collection_mode: texte(donnees, 'mode') || undefined,
      legal_basis: texteOuNul(donnees, 'baseJuridique'),
      permission_status: texte(donnees, 'autorisation') || undefined,
      permission_reference: texteOuNul(donnees, 'referenceAutorisation'),
      terms_url: texteOuNul(donnees, 'adresseConditions'),
      terms_summary: texteOuNul(donnees, 'resumeConditions'),
      conditionsLuesAujourdhui: coche(donnees, 'conditionsLues'),
      allow_ai_processing: coche(donnees, 'autoriserIA'),
      store_contacts: coche(donnees, 'conserverContacts'),
      keep_unclassified: coche(donnees, 'garderNonClassees'),
      notes: texteOuNul(donnees, 'notes'),
      ...(nombres.min_delay_ms !== null ? { min_delay_ms: nombres.min_delay_ms * 1000 } : {}),
      ...(nombres.max_requests_per_run !== null ? { max_requests_per_run: nombres.max_requests_per_run } : {}),
      ...(nombres.frequency_minutes !== null ? { frequency_minutes: nombres.frequency_minutes * 60 } : {}),
      ...(nombres.max_excerpt_chars !== null ? { max_excerpt_chars: nombres.max_excerpt_chars } : {}),
      ...(nombres.reliability_score !== null ? { reliability_score: nombres.reliability_score } : {}),
    };
    await modifierSource(texte(donnees, 'id'), modification, acteur);
    return { message: 'Source mise à jour.' };
  });
}

export async function basculerSourceAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('sources.gerer', async ({ acteur }) => {
    const activer = texte(donnees, 'activer') === '1';
    const source = await modifierSource(texte(donnees, 'id'), { is_active: activer }, acteur);
    return { message: activer ? `« ${source.name} » est activée : le worker la collectera à sa prochaine passe.` : `« ${source.name} » est désactivée : plus aucune requête ne lui sera envoyée.` };
  });
}

export async function reprendreSourceAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('sources.gerer', async ({ acteur }) => {
    await reprendreSource(texte(donnees, 'id'), acteur);
    return { message: 'Pause levée.' };
  });
}

/**
 * Lance une collecte tout de suite. Une collecte polie peut durer plusieurs minutes (délai entre
 * requêtes) : on attend quelques secondes, puis elle se poursuit après la réponse.
 */
export async function lancerCollecteAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('collecte.lancer', async ({ acteur }) => {
    const configurationIA = configIADepuisEnv();
    const collecte = executerCollecte(texte(donnees, 'id'), { declencheur: 'manuel', acteur, completerIA: configurationIA ? creerExtracteurIA(configurationIA) : undefined }).then(async (bilan) => {
      if (bilan.nouvelles > 0) await traiterAlertes().catch(() => undefined);
      return bilan;
    });
    after(() => collecte.then(() => undefined, () => undefined));
    const bilan = await Promise.race([collecte, new Promise<null>((resoudre) => setTimeout(() => resoudre(null), 8000))]);
    if (!bilan) return { message: 'Collecte en cours : elle se poursuit en arrière-plan. Rechargez cette page dans quelques minutes pour voir le résultat dans « Dernières collectes ».' };
    if (bilan.statut === 'echec') throw new ErreurSource(`La collecte a échoué : ${bilan.message}`);
    if (bilan.statut === 'ignore') throw new ErreurSource(`Collecte non lancée. ${bilan.message}`);
    return { message: `Collecte terminée (${compter(bilan.requetes, 'requête')}) : ${bilan.message}` };
  });
}

// ------------------------------------------------------------------- utilisateurs --

export async function creerUtilisateurAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('utilisateurs.gerer', async ({ acteur }) => {
    const cree = await creerUtilisateur({ email: texte(donnees, 'email'), nom: texte(donnees, 'nom'), role: texte(donnees, 'role'), motDePasse: String(donnees.get('motDePasse') ?? ''), doitChanger: true }, acteur);
    return { message: `Compte créé pour ${cree.full_name}. Transmettez-lui le mot de passe provisoire de vive voix : il devra le changer à la première connexion.` };
  });
}

export async function modifierUtilisateurAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('utilisateurs.gerer', async ({ acteur, utilisateur }) => {
    const id = texte(donnees, 'id');
    const actif = texte(donnees, 'actif');
    if (id === utilisateur.id && actif === '0') throw new ErreurAcces('Vous ne pouvez pas désactiver votre propre compte.', 'invalide');
    await modifierUtilisateur(id, { role: texte(donnees, 'role') || undefined, actif: actif === '' ? undefined : actif === '1' }, acteur);
    return { message: 'Compte mis à jour.' };
  });
}

export async function reinitialiserMotDePasseAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('utilisateurs.gerer', async ({ acteur, utilisateur }) => {
    const id = texte(donnees, 'id');
    if (id === utilisateur.id) throw new ErreurAcces('Pour votre propre mot de passe, utilisez « Mon compte ».', 'invalide');
    await changerMotDePasse(id, String(donnees.get('motDePasse') ?? ''), acteur, { doitChanger: true });
    return { message: 'Mot de passe provisoire enregistré. La personne est déconnectée et devra le changer à sa prochaine connexion.' };
  });
}

// --------------------------------------------------------------------- paramètres --

export async function definirParametreAction(_etat: EtatAction, donnees: FormData): Promise<EtatAction> {
  return executerAction('parametres.gerer', async ({ acteur }) => {
    const cle = texte(donnees, 'cle');
    const valeur = texte(donnees, 'type') === 'booleen' ? coche(donnees, 'valeur') : texte(donnees, 'valeur');
    const { offres } = await definirParametre(cle, valeur, acteur, { justification: texte(donnees, 'justification') });
    // Le début de la recherche s'applique aussitôt aux offres enregistrées : on dit ce que le changement a produit.
    return { message: offres ? `Début de la recherche enregistré : ${phraseBilanPerimetre(offres)}.` : 'Paramètre enregistré.' };
  });
}

export async function executerTachesAction(): Promise<EtatAction> {
  return executerAction('parametres.gerer', async () => {
    const alertes = await traiterAlertes();
    const relances = await notifierRelances();
    const maintenance = await executerMaintenance();
    return {
      message: `Alertes : ${compter(alertes.notifications, 'notification')}, ${compter(alertes.envoyes, 'envoi')}, ${compter(alertes.simules, 'simulé')}, ${compter(alertes.echecs, 'échec')}. Relances : ${compter(relances, 'rappel')}. Maintenance : ${compter(maintenance.statutsFiges, 'statut')} ${accord(maintenance.statutsFiges, 'figé')}, ${compter(maintenance.scores, 'score')} ${accord(maintenance.scores, 'recalculé')}, ${compter(maintenance.candidatsAnonymises, 'fiche')} ${accord(maintenance.candidatsAnonymises, 'anonymisée')}.${maintenance.perimetre.ecartees || maintenance.perimetre.reprises ? ` Début de la recherche : ${phraseBilanPerimetre(maintenance.perimetre)}.` : ''}`,
    };
  });
}

// ------------------------------------------------------------------ démonstration --

export async function chargerDemoAction(): Promise<EtatAction> {
  return executerAction('parametres.gerer', async ({ acteur }) => {
    const etat = await chargerJeuDemo(acteur);
    return { message: `Jeu de démonstration chargé : ${etat.offres} offres, ${etat.candidats} candidats et ${etat.employeurs} employeurs fictifs.` };
  });
}

export async function supprimerDemoAction(): Promise<EtatAction> {
  return executerAction('parametres.gerer', async ({ acteur }) => {
    await supprimerJeuDemo(acteur);
    return { message: 'Jeu de démonstration supprimé : il ne reste aucune donnée fictive.' };
  });
}
