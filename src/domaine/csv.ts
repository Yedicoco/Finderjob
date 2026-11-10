/**
 * Écriture de fichiers CSV destinés à un tableur.
 *
 * Deux précautions :
 *  - une cellule qui commence par = + - @ (ou une tabulation, un retour chariot)
 *    serait interprétée comme une FORMULE par Excel ou LibreOffice ; comme les
 *    titres d'annonces viennent de l'extérieur, ces cellules sont préfixées
 *    d'une apostrophe, qui les force en texte ;
 *  - le séparateur est le point-virgule et le fichier commence par un BOM
 *    UTF-8 : c'est ce qu'attend un Excel réglé en français (accents, arabe).
 */
export type CelluleCsv = string | number | boolean | Date | null | undefined;

const DEBUT_FORMULE = /^[=+\-@\t\r]/;

export function celluleCsv(valeur: CelluleCsv, separateur = ';'): string {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? String(valeur).replace('.', ',') : '';
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? '' : valeur.toISOString().slice(0, 10);
  let texte = valeur.replace(/\r\n?/g, '\n');
  if (DEBUT_FORMULE.test(texte)) texte = `'${texte}`;
  return texte.includes('"') || texte.includes('\n') || texte.includes(separateur) ? `"${texte.replaceAll('"', '""')}"` : texte;
}

export function versCsv(entetes: string[], lignes: CelluleCsv[][], separateur = ';'): string {
  const corps = [entetes, ...lignes].map((ligne) => ligne.map((cellule) => celluleCsv(cellule, separateur)).join(separateur));
  return `\uFEFF${corps.join('\r\n')}\r\n`;
}
