/** Listes de choix tirées des référentiels (métiers par secteur, villes). */
import type { ComponentProps } from 'react';
import { VILLES } from '@/domaine/geographie';
import { METIERS, SECTEURS } from '@/domaine/taxonomie';
import { cx, type Option } from './ui';

export const OPTIONS_SECTEURS: Option[] = SECTEURS.map((secteur) => ({ valeur: secteur.code, libelle: secteur.libelle.fr }));
export const OPTIONS_METIERS: Option[] = METIERS.map((metier) => ({ valeur: metier.code, libelle: metier.libelle.fr }));
export const OPTIONS_VILLES: Option[] = [...VILLES].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((ville) => ({ valeur: ville.code, libelle: ville.nom }));

/** Liste des métiers regroupés par secteur. */
export function SelectionMetier({ vide, className, ...reste }: ComponentProps<'select'> & { vide?: string }) {
  return (
    <select {...reste} className={cx('champ', className)}>
      {vide !== undefined ? <option value="">{vide}</option> : null}
      {SECTEURS.map((secteur) => (
        <optgroup key={secteur.code} label={secteur.libelle.fr}>
          {METIERS.filter((metier) => metier.secteur === secteur.code)
            .sort((a, b) => a.libelle.fr.localeCompare(b.libelle.fr, 'fr'))
            .map((metier) => (
              <option key={metier.code} value={metier.code}>
                {metier.libelle.fr}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
