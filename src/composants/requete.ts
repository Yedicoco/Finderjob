/** Lecture des paramètres d'adresse (?q=…&page=…) des pages de liste. */
export type ParametresAdresse = Record<string, string | string[] | undefined>;

export const un = (valeur: string | string[] | undefined): string => (Array.isArray(valeur) ? (valeur[0] ?? '') : (valeur ?? '')).trim();

/** Adresse `base` avec les filtres en cours, modifiés par `changements` (null = retirer). La page repart à 1. */
export function adresseAvec(base: string, parametres: ParametresAdresse, changements: Record<string, string | null> = {}): string {
  const requete = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) {
    const texte = un(valeur);
    if (texte && cle !== 'page') requete.set(cle, texte);
  }
  for (const [cle, valeur] of Object.entries(changements)) {
    if (valeur === null) requete.delete(cle);
    else requete.set(cle, valeur);
  }
  const chaine = requete.toString();
  return chaine ? `${base}?${chaine}` : base;
}

export const pageDemandee = (parametres: ParametresAdresse): number => {
  const page = Number.parseInt(un(parametres.page), 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
};
