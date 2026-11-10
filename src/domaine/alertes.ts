/**
 * Alertes : critères enregistrés par un utilisateur, comparés à chaque
 * nouvelle offre. Fonctions pures ; l'envoi est dans src/serveur/alertes.ts.
 */
import { nomVille } from './geographie';
import { CONTRATS } from './referentiels';
import { libelleMetier, libelleSecteur } from './taxonomie';
import { cle, contient } from './texte';

export type CriteresAlerte = {
  texte?: string;
  categories?: string[];
  secteurs?: string[];
  villes?: string[];
  contrats?: string[];
  salaireMin?: number;
  urgentSeulement?: boolean;
  massifSeulement?: boolean;
  pertinenceMin?: number;
};

export type OffrePourAlerte = {
  titre: string;
  motsCles: string;
  employeur: string | null;
  metiers: string[];
  secteur: string | null;
  ville: string | null;
  contrat: string;
  salaireMensuel: number | null;
  urgent: boolean;
  massif: boolean;
  pertinence: number;
  statutEffectif: string;
};

/** Nettoie des critères reçus d'un formulaire ou de la base (rien n'est cru sur parole). */
export function normaliserCriteres(brut: unknown): CriteresAlerte {
  const source = (typeof brut === 'object' && brut !== null ? brut : {}) as Record<string, unknown>;
  const liste = (valeur: unknown) => (Array.isArray(valeur) ? [...new Set(valeur.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))].slice(0, 50) : []);
  const nombre = (valeur: unknown, min: number, max: number) => (typeof valeur === 'number' && Number.isFinite(valeur) && valeur >= min && valeur <= max ? valeur : undefined);
  const criteres: CriteresAlerte = {};
  if (typeof source.texte === 'string' && source.texte.trim()) criteres.texte = source.texte.trim().slice(0, 120);
  for (const champ of ['categories', 'secteurs', 'villes', 'contrats'] as const) {
    const valeurs = liste(source[champ]);
    if (valeurs.length > 0) criteres[champ] = valeurs;
  }
  const salaireMin = nombre(source.salaireMin, 1, 1_000_000);
  if (salaireMin !== undefined) criteres.salaireMin = salaireMin;
  const pertinenceMin = nombre(source.pertinenceMin, 1, 100);
  if (pertinenceMin !== undefined) criteres.pertinenceMin = pertinenceMin;
  if (source.urgentSeulement === true) criteres.urgentSeulement = true;
  if (source.massifSeulement === true) criteres.massifSeulement = true;
  return criteres;
}

/** Une alerte ne signale que des offres actives ; tous les critères renseignés doivent être satisfaits. */
export function offreCorrespond(criteres: CriteresAlerte, offre: OffrePourAlerte): boolean {
  if (offre.statutEffectif !== 'actif') return false;
  if (criteres.texte) {
    const botte = cle(`${offre.titre} ${offre.motsCles} ${offre.employeur ?? ''}`);
    const mots = cle(criteres.texte).trim().split(' ').filter(Boolean);
    if (!mots.every((mot) => contient(botte, ` ${mot} `))) return false;
  }
  if (criteres.categories?.length && !criteres.categories.some((code) => offre.metiers.includes(code))) return false;
  if (criteres.secteurs?.length && (!offre.secteur || !criteres.secteurs.includes(offre.secteur))) return false;
  if (criteres.villes?.length && (!offre.ville || !criteres.villes.includes(offre.ville))) return false;
  if (criteres.contrats?.length && !criteres.contrats.includes(offre.contrat)) return false;
  if (criteres.salaireMin !== undefined && (offre.salaireMensuel === null || offre.salaireMensuel < criteres.salaireMin)) return false;
  if (criteres.urgentSeulement && !offre.urgent) return false;
  if (criteres.massifSeulement && !offre.massif) return false;
  if (criteres.pertinenceMin !== undefined && offre.pertinence < criteres.pertinenceMin) return false;
  return true;
}

/** Phrase lisible décrivant une alerte (« Femme de ménage · Casablanca, Rabat · urgentes »). */
export function resumerCriteres(criteres: CriteresAlerte): string {
  const morceaux: string[] = [];
  if (criteres.texte) morceaux.push(`« ${criteres.texte} »`);
  if (criteres.categories?.length) morceaux.push(criteres.categories.map(libelleMetier).join(', '));
  if (criteres.secteurs?.length) morceaux.push(criteres.secteurs.map(libelleSecteur).join(', '));
  if (criteres.villes?.length) morceaux.push(criteres.villes.map(nomVille).join(', '));
  if (criteres.contrats?.length) morceaux.push(criteres.contrats.map((code) => CONTRATS.libelle(code)).join(', '));
  if (criteres.salaireMin !== undefined) morceaux.push(`à partir de ${criteres.salaireMin.toLocaleString('fr-FR')} DH/mois`);
  if (criteres.urgentSeulement) morceaux.push('urgentes');
  if (criteres.massifSeulement) morceaux.push('recrutements en nombre');
  if (criteres.pertinenceMin !== undefined) morceaux.push(`pertinence d’au moins ${criteres.pertinenceMin}`);
  return morceaux.join(' · ') || 'Toutes les offres actives';
}
