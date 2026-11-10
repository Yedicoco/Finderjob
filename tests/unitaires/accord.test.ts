import { describe, expect, it } from 'vitest';
import { accord, compter } from '@/domaine/accord';
import { pluriel } from '@/composants/format';

describe('accord en nombre', () => {
  it('garde le singulier pour 0 et 1, passe au pluriel à partir de 2', () => {
    expect(accord(0, 'offre')).toBe('offre');
    expect(accord(1, 'offre')).toBe('offre');
    expect(accord(2, 'offre')).toBe('offres');
    expect(accord(1.5, 'an')).toBe('an');
  });

  it('accepte un pluriel irrégulier ou un groupe de mots', () => {
    expect(accord(3, 'travail', 'travaux')).toBe('travaux');
    expect(accord(1, 'Langue manquante', 'Langues manquantes')).toBe('Langue manquante');
    expect(accord(2, 'Langue manquante', 'Langues manquantes')).toBe('Langues manquantes');
  });

  it('écrit le nombre suivi du mot accordé', () => {
    expect(compter(1, 'an')).toBe('1 an');
    expect(compter(3, 'an')).toBe('3 ans');
    expect(compter(1.5, 'an')).toBe('1,5 an');
    expect(compter(0, 'doublon')).toBe('0 doublon');
  });

  it('met le nombre au format français dans les écrans', () => {
    expect(pluriel(1, 'offre')).toBe('1 offre');
    expect(pluriel(1200, 'offre').replace(/\s/g, ' ')).toBe('1 200 offres');
  });
});
