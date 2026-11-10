/**
 * Accord en nombre des libellés affichés ou journalisés.
 *
 * En français le pluriel commence à 2 : « 0 offre », « 1 offre », « 2 offres ».
 * Module pur et sans dépendance : utilisable par le domaine, le serveur et
 * les composants (y compris côté navigateur).
 */

/** Le mot accordé, sans le nombre : `accord(3, 'repérée')` → « repérées ». */
export const accord = (n: number, singulier: string, pluriel = `${singulier}s`): string => (Math.abs(n) >= 2 ? pluriel : singulier);

/** Le nombre suivi du mot accordé : « 1 an », « 3 ans », « 1,5 an ». */
export const compter = (n: number, singulier: string, pluriel?: string): string => `${String(n).replace('.', ',')} ${accord(n, singulier, pluriel)}`;
