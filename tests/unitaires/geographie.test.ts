import { describe, expect, it } from 'vitest';
import { VILLES, detecterLieu, estZoneYallah, evaluerPays, quartiersDeVille } from '@/domaine/geographie';

describe('référentiel des villes', () => {
  it('reprend les 14 villes de la couverture Yallah et leurs phases', () => {
    const yallah = VILLES.filter((v) => v.statut === 'confirmee' || v.statut === 'pole' || v.statut === 'candidate');
    expect(yallah).toHaveLength(14);
    expect(VILLES.filter((v) => v.phase === 1).map((v) => v.code)).toEqual(['casablanca', 'bouskoura', 'dar-bouazza', 'rabat', 'marrakech']);
    expect(VILLES.filter((v) => v.statut === 'retiree').map((v) => v.code).sort()).toEqual(['meknes', 'oujda', 'tetouan']);
  });

  it('a des codes uniques', () => {
    expect(new Set(VILLES.map((v) => v.code)).size).toBe(VILLES.length);
  });

  it('connaît les zones de ciblage', () => {
    expect(estZoneYallah('casablanca')).toBe(true);
    expect(estZoneYallah('el-jadida')).toBe(false);
    expect(estZoneYallah('oujda')).toBe(false);
    expect(quartiersDeVille('casablanca').length).toBeGreaterThan(3);
  });
});

describe('détection du lieu', () => {
  it.each([
    ['Femme de ménage à Casablanca', 'casablanca'],
    ['Nounou - Casa', 'casablanca'],
    ['Réceptionniste | Marrakech', 'marrakech'],
    ['Chauffeur à Tanger', 'tanger'],
    ['مطلوب عاملة نظافة بالدار البيضاء', 'casablanca'],
    ['طباخة في الرباط', 'rabat'],
    ['Cuisinière à Kénitra', 'kenitra'],
    ['Housekeeper in Agadir', 'agadir'],
  ])('%s → %s', (titre, attendu) => {
    expect(detecterLieu(titre).ville?.code).toBe(attendu);
  });

  it('préfère la commune précise à la métropole', () => {
    expect(detecterLieu('Gardien de villa – Bouskoura, Casablanca').ville?.code).toBe('bouskoura');
    expect(detecterLieu('Nounou à Dar Bouazza (Casablanca)').ville?.code).toBe('dar-bouazza');
  });

  it('ne prend pas « sale » (adjectif) pour la ville de Salé', () => {
    expect(detecterLieu('Nettoyage de linge sale et repassage').ville).toBeNull();
    expect(detecterLieu('Femme de ménage à Salé').ville?.code).toBe('sale');
  });

  it('ne confond pas la région avec la ville', () => {
    const lieu = detecterLieu('Agent d’accueil', 'Région : Rabat-Salé-Kénitra');
    expect(lieu.ville).toBeNull();
    expect(lieu.region).toBe('Rabat-Salé-Kénitra');
    expect(lieu.marocMentionne).toBe(true);
  });

  it('utilise d’abord le lieu structuré de la source', () => {
    expect(detecterLieu('Femme de chambre', 'Hôtel du groupe basé à Casablanca', 'Agadir').ville?.code).toBe('agadir');
  });

  it('repère le quartier', () => {
    const lieu = detecterLieu('Femme de ménage', 'Villa à Californie, Casablanca');
    expect(lieu.ville?.code).toBe('casablanca');
    expect(lieu.quartier).toBe('Californie');
  });
});

describe('filtre pays : Maroc uniquement', () => {
  it('accepte une offre dans une ville marocaine', () => {
    expect(evaluerPays({ titre: 'Femme de ménage à Rabat' }).pays).toBe('MA');
  });

  it('rejette un pays structuré étranger et accepte le Maroc', () => {
    expect(evaluerPays({ titre: 'Nanny', paysStructure: 'AE' }).pays).toBe('etranger');
    expect(evaluerPays({ titre: 'Nanny', paysStructure: 'MA' }).pays).toBe('MA');
    expect(evaluerPays({ titre: 'Nanny', paysStructure: 'Maroc' }).pays).toBe('MA');
  });

  it.each([
    ['Nounou à Dubaï', 'Famille cherche nounou. Entretiens à Casablanca.'],
    ['Femme de ménage', 'Agence à Casablanca recrute pour le Qatar. Visa pris en charge.'],
    ['Serveur - Qatar', ''],
    ['عاملة منزلية للعمل في السعودية', 'المقابلات في الدار البيضاء'],
    ['Aide-soignante', 'Poste basé en France, contrat de 2 ans.'],
    ['Cuisinier', 'Travail à l’étranger, billet d’avion offert'],
  ])('rejette un poste à l’étranger : %s', (titre, texte) => {
    expect(evaluerPays({ titre, texte }).pays).toBe('etranger');
  });

  it('ne rejette pas un établissement marocain au nom étranger', () => {
    const evaluation = evaluerPays({ titre: 'Serveur Café de Paris', texte: 'Restaurant situé à Marrakech, quartier Guéliz.' });
    expect(evaluation.pays).toBe('MA');
    expect(evaluation.aVerifier).toBe(true);
  });

  it('ne rejette pas « cuisine française » ni une expérience à l’étranger', () => {
    expect(evaluerPays({ titre: 'Chef de partie à Casablanca', texte: 'Cuisine française et italienne. Une expérience en France est un plus.' }).pays).toBe('MA');
  });

  it('classe « inconnu » une offre sans aucun lieu (elle partira en vérification)', () => {
    expect(evaluerPays({ titre: 'Femme de ménage', texte: 'Travail sérieux, bon salaire.' }).pays).toBe('inconnu');
  });

  it('rejette un lieu structuré étranger', () => {
    expect(evaluerPays({ titre: 'Housekeeper', lieuStructure: 'Dubai, UAE' }).pays).toBe('etranger');
  });
});
