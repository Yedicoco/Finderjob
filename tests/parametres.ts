/**
 * Paramètres utilisés par les tests.
 *
 * Les annonces d'essai (jeux d'essai, saisies des tests) sont datées de début
 * novembre 2026. Le début de la recherche est un réglage appelé à bouger (par
 * défaut : lundi 9 novembre 2026) ; les tests l'épinglent donc au plancher du
 * cahier des charges, le 1er janvier 2026, pour ne dépendre que des règles et
 * pas de la valeur du moment.
 *
 * La valeur par défaut a ses propres tests (unitaires/risques-statuts), comme
 * son application aux offres déjà enregistrées (integration/securite).
 */
import { construireParametres, DEBUT_RECHERCHE_PLANCHER } from '@/domaine/parametres';

/** 1er janvier 2026, 00 h 00 à Casablanca. */
export const DEBUT_RECHERCHE_TESTS = new Date(DEBUT_RECHERCHE_PLANCHER).toISOString();

export const PARAMETRES_TESTS = construireParametres({ 'perimetre.dateMin': DEBUT_RECHERCHE_TESTS });
