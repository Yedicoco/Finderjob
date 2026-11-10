import { describe, expect, it } from 'vitest';
import { CONTRATS, LANGUES, ROLES, STATUTS_OFFRE } from '@/domaine/referentiels';

describe('référentiels', () => {
  it('reconnaît ses codes et refuse le reste', () => {
    expect(LANGUES.est('fr')).toBe(true);
    expect(LANGUES.est('francais')).toBe(false);
    expect(LANGUES.est(null)).toBe(false);
    expect(LANGUES.est(42)).toBe(false);
  });

  it('ne prend pas une propriété héritée de Object pour un code', () => {
    for (const piege of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(LANGUES.est(piege)).toBe(false);
      expect(ROLES.est(piege)).toBe(false);
      expect(typeof CONTRATS.libelle(piege)).toBe('string');
    }
  });

  it('donne un libellé français, le code brut s’il est inconnu, un tiret s’il est vide', () => {
    expect(STATUTS_OFFRE.libelle('actif')).toMatch(/acti/i);
    expect(CONTRATS.libelle('inconnu')).toBe('inconnu');
    expect(CONTRATS.libelle(null)).toBe('—');
    expect(CONTRATS.options.map((o) => o.valeur)).toEqual([...CONTRATS.codes]);
  });
});
