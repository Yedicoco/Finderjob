/**
 * Formulaire de correction d'une offre : valeurs affichées et lecture de la
 * saisie. Seuls les champs réellement modifiés sont transmis au service, car
 * tout champ corrigé est ensuite « verrouillé » contre les collectes.
 */
import { dateIso } from '@/composants/format';
import type { CorrectionOffre, Offre } from '@/serveur/offres';

export type ValeursCorrection = Record<'datePublication' | 'dateExpiration' | 'ville' | 'quartier' | 'metier' | 'employeur' | 'typeEmployeur' | 'contrat' | 'salaireMin' | 'salaireMax' | 'periodeSalaire', string>;

export function valeursCorrection(offre: Offre): ValeursCorrection {
  return {
    datePublication: dateIso(offre.published_at),
    dateExpiration: dateIso(offre.expires_at),
    ville: offre.city_code ?? '',
    quartier: offre.district ?? '',
    metier: offre.metier ?? '',
    employeur: offre.employer_name ?? '',
    typeEmployeur: offre.employer_type_guess ?? '',
    contrat: offre.contract_type,
    salaireMin: offre.salary_min === null ? '' : String(offre.salary_min),
    salaireMax: offre.salary_max === null ? '' : String(offre.salary_max),
    periodeSalaire: offre.salary_period ?? '',
  };
}

const nombre = (texte: string): number | null => {
  const propre = texte.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!propre) return null;
  return /^\d+(\.\d+)?$/.test(propre) ? Number(propre) : Number.NaN;
};

/** Compare la saisie aux valeurs affichées et ne garde que les différences. */
export function correctionDepuisSaisie(avant: ValeursCorrection, lire: (nom: keyof ValeursCorrection) => string): CorrectionOffre {
  const c: CorrectionOffre = {};
  const change = (nom: keyof ValeursCorrection) => lire(nom) !== avant[nom];
  if (change('datePublication')) c.datePublication = lire('datePublication') || null;
  if (change('dateExpiration')) c.dateExpiration = lire('dateExpiration') || null;
  if (change('ville')) c.ville = lire('ville') || null;
  if (change('quartier')) c.quartier = lire('quartier') || null;
  if (change('metier')) c.metier = lire('metier') || null;
  if (change('employeur')) c.employeur = lire('employeur') || null;
  if (change('typeEmployeur')) c.typeEmployeur = lire('typeEmployeur') || null;
  if (change('contrat')) c.contrat = lire('contrat');
  if (change('salaireMin') || change('salaireMax') || change('periodeSalaire')) {
    c.salaireMin = nombre(lire('salaireMin'));
    c.salaireMax = nombre(lire('salaireMax'));
    c.periodeSalaire = lire('periodeSalaire') || null;
  }
  return c;
}
