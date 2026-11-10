import { describe, expect, it } from 'vitest';
import { cle, cleArabeAllegee, contient, detecterLangue, htmlVersTexte, jaccard, normaliserTexte, preparer, tronquer } from '@/domaine/texte';

describe('normalisation de texte', () => {
  it('retire les accents et unifie la casse', () => {
    expect(normaliserTexte('Hôtel  Ménagère — Épilation')).toBe('hotel menagere epilation');
  });

  it('unifie les variantes arabes (hamza, ta marbuta, voyelles brèves)', () => {
    expect(normaliserTexte('عاملةُ نظافةٍ')).toBe(normaliserTexte('عامله نظافه'));
    expect(normaliserTexte('أكادير')).toBe(normaliserTexte('اكادير'));
  });

  it('convertit les chiffres arabes-indiens', () => {
    expect(preparer('٤٠٠٠ درهم')).toBe('4000 درهم');
  });

  it('respecte les limites de mots : « salon » ne se trouve pas dans « salonique »', () => {
    expect(contient(cle('poste à Salonique'), cle('salon'))).toBe(false);
    expect(contient(cle('Salons de coiffure'), cle('salon de coiffure'))).toBe(true);
  });

  it('retire la préposition collée aux mots arabes', () => {
    expect(cleArabeAllegee(cle('بالرباط'))).toContain(cle('الرباط').trim());
  });

  it('détecte la langue dominante', () => {
    expect(detecterLangue('مطلوب عاملة نظافة بالدار البيضاء')).toBe('ar');
    expect(detecterLangue('Nous recherchons une femme de ménage pour une villa')).toBe('fr');
    expect(detecterLangue('We are looking for a housekeeper with experience, full time job')).toBe('en');
    expect(detecterLangue('Femme de ménage مطلوب عاملة نظافة')).toBe('mixte');
  });

  it('convertit le HTML en texte sans exécuter ni conserver de balise', () => {
    const texte = htmlVersTexte('<p>Poste &agrave; Rabat</p><script>alert(1)</script><ul><li>CDI</li><li>4&nbsp;000 DH</li></ul>');
    expect(texte).toContain('Poste à Rabat');
    expect(texte).toContain('- CDI');
    expect(texte).not.toContain('alert');
    expect(texte).not.toContain('<');
  });

  it('tronque sur une limite de mot', () => {
    expect(tronquer('Femme de ménage expérimentée pour villa', 20)).toBe('Femme de ménage…');
    expect(tronquer('court', 20)).toBe('court');
  });

  it('calcule la similarité de Jaccard', () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    expect(jaccard([], [])).toBe(0);
  });
});
