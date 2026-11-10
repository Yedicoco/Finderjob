/**
 * Erreur « métier » : son message est rédigé en français pour l'utilisateur
 * et peut lui être affiché tel quel (règle refusée, saisie incomplète…).
 * Toute autre erreur est technique : elle est journalisée côté serveur et
 * l'écran n'affiche qu'un message générique.
 */
export class ErreurMetier extends Error {}
