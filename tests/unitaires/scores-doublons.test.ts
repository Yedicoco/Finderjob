import { describe, expect, it } from 'vitest';
import { deciderDoublon, empreinte, motsSignificatifs, normaliserEmployeur, similarite, urlCanonique, type OffreComparable } from '@/domaine/doublons';
import { indicePlacement, scoreFraicheur, scorePertinence, scoreQualite } from '@/domaine/scores';

const MAINTENANT = new Date('2026-11-10T10:00:00Z');
const SEUILS = { seuilLien: 0.82, seuilProbable: 0.65 };

describe('score de fraîcheur', () => {
  it('vaut 100 le jour même et se divise par deux tous les 10 jours', () => {
    expect(scoreFraicheur(MAINTENANT, MAINTENANT, 10)).toBe(100);
    expect(scoreFraicheur(new Date('2026-10-31T10:00:00Z'), MAINTENANT, 10)).toBe(50);
    expect(scoreFraicheur(new Date('2026-10-21T10:00:00Z'), MAINTENANT, 10)).toBe(25);
  });

  it('vaut 0 sans date ou si l’offre est expirée', () => {
    expect(scoreFraicheur(null, MAINTENANT, 10)).toBe(0);
    expect(scoreFraicheur(MAINTENANT, MAINTENANT, 10, true)).toBe(0);
  });
});

describe('score de qualité', () => {
  const complet = { longueurDescription: 600, ville: true, quartier: true, employeur: true, salaire: true, contrat: true, precisionDate: 'exacte' as const, experience: true, rythme: true, joignable: true, fiabiliteSource: 100 };

  it('vaut 100 pour une annonce complète issue d’une source fiable', () => {
    expect(scoreQualite(complet).score).toBe(100);
  });

  it('baisse quand des informations manquent, et l’explique', () => {
    const resultat = scoreQualite({ ...complet, salaire: false, employeur: false, fiabiliteSource: 50 });
    expect(resultat.score).toBe(70);
    expect(resultat.lignes.find((l) => l.critere === 'Salaire')?.explication).toBe('Salaire non affiché');
  });
});

describe('score de pertinence Yallah', () => {
  const base = { metier: 'femme_menage', confianceMetier: 100, ville: 'casablanca', typeEmployeur: 'famille' as const, contrat: 'cdi' as const, urgent: true, massif: true, salaireAffiche: true, salaireAnormal: false, scoreRisque: 0, seuilRisqueEleve: 50 };

  it('vaut 100 pour l’offre idéale', () => {
    expect(scorePertinence(base).score).toBe(100);
  });

  it('dépend de la zone Yallah', () => {
    const points = (ville: string | null) => scorePertinence({ ...base, ville }).lignes.find((l) => l.critere === 'Zone')?.points;
    expect(points('casablanca')).toBe(25);
    expect(points('tanger')).toBe(20);
    expect(points('fes')).toBe(15);
    expect(points('el-jadida')).toBe(10);
    expect(points('oujda')).toBe(5);
    expect(points(null)).toBe(0);
  });

  it('vaut peu hors taxonomie', () => {
    expect(scorePertinence({ ...base, metier: null, confianceMetier: 0 }).score).toBe(55);
  });

  it('est divisé par deux si le risque est élevé', () => {
    expect(scorePertinence({ ...base, scoreRisque: 60 }).score).toBe(50);
  });
});

describe('indice de placement', () => {
  it('combine les scores et reste entre 0 et 100', () => {
    expect(indicePlacement({ pertinence: 100, fraicheur: 100, qualite: 100, candidatsDisponibles: 3, joignabilite: 100 }).score).toBe(100);
    expect(indicePlacement({ pertinence: 0, fraicheur: 0, qualite: 0, candidatsDisponibles: 0, joignabilite: 0 }).score).toBe(0);
    expect(indicePlacement({ pertinence: 80, fraicheur: 50, qualite: 60, candidatsDisponibles: 1, joignabilite: 50 }).score).toBe(24 + 13 + 9 + 10 + 5);
  });
});

describe('doublons', () => {
  const offre = (surcharge: Partial<OffreComparable>): OffreComparable => ({
    titre: 'Femme de ménage',
    employeur: null,
    ville: 'casablanca',
    metier: 'femme_menage',
    publieLe: new Date('2026-11-08T09:00:00Z'),
    langue: 'fr',
    ...surcharge,
  });

  it('ignore les mots vides et l’ordre des mots', () => {
    expect(motsSignificatifs('URGENT : recrute Femme de ménage H/F')).toEqual(['femme', 'menage']);
    expect(empreinte({ titre: 'Femme de ménage H/F', employeur: 'Hôtel Atlas SARL', ville: 'rabat' })).toBe(
      empreinte({ titre: 'Urgent - femme de ménage', employeur: 'hotel atlas', ville: 'rabat' }),
    );
  });

  it('normalise les noms d’employeur', () => {
    expect(normaliserEmployeur('Hôtel Atlas SARL')).toBe('atlas');
    expect(normaliserEmployeur(null)).toBe('');
  });

  it('canonise les adresses', () => {
    expect(urlCanonique('https://www.exemple.ma/offre/123/?utm_source=x&id=4#haut')).toBe('https://exemple.ma/offre/123?id=4');
    expect(urlCanonique('javascript:alert(1)')).toBeNull();
    expect(urlCanonique('pas une url')).toBeNull();
  });

  it('rattache la même offre publiée par le même employeur sur deux sites', () => {
    const a = offre({ employeur: 'Riad Exemple', titre: 'Femme de chambre H/F', metier: 'femme_chambre' });
    const b = offre({ employeur: 'RIAD EXEMPLE', titre: 'Femme de chambre', metier: 'femme_chambre', publieLe: new Date('2026-11-09T09:00:00Z') });
    expect(deciderDoublon(similarite(a, b).score, SEUILS)).toBe('doublon');
  });

  it('ne rattache pas automatiquement deux annonces génériques sans employeur', () => {
    const resultat = similarite(offre({}), offre({}));
    expect(deciderDoublon(resultat.score, SEUILS)).toBe('probable');
  });

  it('rattache deux annonces sans employeur si leurs textes sont quasi identiques', () => {
    const texte = 'Famille cherche femme de ménage sérieuse pour villa quartier Californie, logée, nourrie, salaire 4000 dh, expérience exigée, références demandées.';
    expect(deciderDoublon(similarite(offre({ description: texte }), offre({ description: `${texte} Merci.` })).score, SEUILS)).toBe('doublon');
  });

  it('ne confond pas deux villes ou deux employeurs', () => {
    expect(similarite(offre({}), offre({ ville: 'rabat' })).score).toBe(0);
    expect(similarite(offre({ employeur: 'Hôtel A' }), offre({ employeur: 'Hôtel B' })).score).toBe(0);
  });

  it('reconnaît la même annonce en français et en arabe', () => {
    const fr = offre({ employeur: 'Riad Exemple', titre: 'Femme de chambre', metier: 'femme_chambre' });
    const ar = offre({ employeur: 'Riad Exemple', titre: 'عاملة غرف', metier: 'femme_chambre', langue: 'ar' });
    expect(deciderDoublon(similarite(fr, ar).score, SEUILS)).toBe('doublon');
  });

  it('considère identiques deux annonces à la même adresse', () => {
    expect(similarite(offre({ urlCanonique: 'https://exemple.ma/o/1' }), offre({ titre: 'Autre', urlCanonique: 'https://exemple.ma/o/1' })).score).toBe(1);
  });

  it('laisse distinctes deux offres de métiers différents chez le même employeur', () => {
    const a = offre({ employeur: 'Hôtel Exemple', titre: 'Réceptionniste de nuit', metier: 'receptionniste' });
    const b = offre({ employeur: 'Hôtel Exemple', titre: 'Femme de chambre', metier: 'femme_chambre' });
    expect(deciderDoublon(similarite(a, b).score, SEUILS)).toBe('distinct');
  });
});
