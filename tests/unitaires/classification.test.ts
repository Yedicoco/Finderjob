import { describe, expect, it } from 'vitest';
import { classer } from '@/domaine/classification';
import { METIERS, SECTEURS, metiersDuSecteur, motsClesRecherche } from '@/domaine/taxonomie';

const principal = (titre: string, texte = '') => classer(titre, texte).principal?.code ?? null;

describe('taxonomie', () => {
  it('contient les 3 secteurs et les 42 métiers du cahier des charges', () => {
    expect(SECTEURS.map((s) => s.code)).toEqual(['maison', 'beaute', 'hospitalite']);
    expect(METIERS).toHaveLength(42);
    expect(metiersDuSecteur('maison')).toHaveLength(15);
    expect(metiersDuSecteur('beaute')).toHaveLength(13);
    expect(metiersDuSecteur('hospitalite')).toHaveLength(14);
  });

  it('a des codes uniques et des libellés dans les trois langues', () => {
    expect(new Set(METIERS.map((m) => m.code)).size).toBe(METIERS.length);
    for (const metier of METIERS) {
      expect(metier.libelle.fr.length).toBeGreaterThan(2);
      expect(metier.libelle.ar.length).toBeGreaterThan(2);
      expect(metier.libelle.en.length).toBeGreaterThan(2);
      expect(metier.forts.length).toBeGreaterThan(0);
    }
  });

  it('ne référence que des métiers existants dans « proches »', () => {
    const codes = new Set(METIERS.map((m) => m.code));
    for (const metier of METIERS) for (const proche of metier.proches ?? []) expect(codes.has(proche), `${metier.code} → ${proche}`).toBe(true);
  });

  it('produit des mots-clés de recherche multilingues', () => {
    const mots = motsClesRecherche(['femme_menage']);
    expect(mots).toContain('Femme de ménage');
    expect(mots).toContain('عاملة نظافة');
    expect(mots).toContain('housekeeper');
  });
});

describe('classification des annonces', () => {
  it.each([
    ['Femme de ménage', 'Famille à Casablanca cherche une femme de ménage pour villa', 'femme_menage'],
    ['Nounou à domicile', 'Garde de deux enfants', 'nounou'],
    ['Chauffeur privé', 'Famille à Rabat', 'chauffeur_prive'],
    ['Cuisinière marocaine pour famille', '', 'cuisinier_domicile'],
    ['Gardien de villa', '', 'gardien'],
    ['Esthéticienne confirmée', 'Institut de beauté à Marrakech', 'estheticienne'],
    ['Réceptionniste spa', '', 'receptionniste_spa'],
    ['Réceptionniste', 'Hôtel à Agadir', 'receptionniste'],
    ['Responsable de riad', 'Médina de Marrakech', 'responsable_riad'],
    ['Housekeeping supervisor', 'Luxury hotel in Marrakech', 'housekeeping'],
  ])('%s → %s', (titre, texte, attendu) => {
    expect(principal(titre, texte)).toBe(attendu);
  });

  it('classe une annonce rédigée en arabe', () => {
    expect(principal('مطلوب عاملة نظافة بالدار البيضاء', 'عائلة تبحث عن عاملة منزلية')).toBe('femme_menage');
  });

  it('distingue la gouvernante de maison de la gouvernante d’hôtel', () => {
    expect(principal('Gouvernante', 'Famille à Rabat recherche une gouvernante de maison')).toBe('gouvernante');
    expect(principal('Gouvernante d’étage H/F', 'Hôtel 5 étoiles à Marrakech')).toBe('housekeeping');
  });

  it('ne confond pas « aide cuisinier » et « cuisinier »', () => {
    expect(principal('Aide cuisinier', 'Restaurant à Tanger')).toBe('aide_cuisinier');
  });

  it.each([['Développeur web', 'React, Node.js'], ['Commercial terrain', 'Vente de cuisines équipées'], ['Chauffeur poids lourd', 'Transport de marchandises'], ['Serveur', 'Restaurant']])(
    'laisse hors taxonomie : %s',
    (titre, texte) => {
      expect(principal(titre, texte)).toBeNull();
    },
  );

  it('explique son classement et donne une confiance entre 0 et 100', () => {
    const resultat = classer('Femme de ménage', 'pour une villa à Bouskoura');
    expect(resultat.principal?.confiance).toBeGreaterThanOrEqual(35);
    expect(resultat.principal?.confiance).toBeLessThanOrEqual(100);
    expect(resultat.principal?.indices.join(' ')).toContain('femme de ménage');
    expect(resultat.secteur).toBe('maison');
  });

  it('une simple mention dans le corps ne suffit pas à classer', () => {
    expect(principal('Responsable des achats', 'Vous encadrez aussi la femme de ménage du site.')).toBeNull();
    expect(principal('Responsable des achats', 'Vous encadrez aussi la femme de ménage de la villa.')).toBeNull();
  });

  it('lit le corps quand le titre est générique', () => {
    expect(principal('Hôtel Atlas recrute plusieurs profils', 'Postes : femme de chambre, plongeur.')).toBe('femme_chambre');
    expect(principal('Offre d’emploi urgente', 'Nous cherchons une nounou pour deux enfants à Rabat.')).toBe('nounou');
  });
});
