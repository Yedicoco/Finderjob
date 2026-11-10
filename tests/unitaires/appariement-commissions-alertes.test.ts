import { describe, expect, it } from 'vitest';
import { normaliserCriteres, offreCorrespond, resumerCriteres, type OffrePourAlerte } from '@/domaine/alertes';
import { apparier, estSuggerable, type PosteAPourvoir, type ProfilCandidat } from '@/domaine/appariement';
import { ErreurCommission, calculerMontant, finRemplacement, totaliser, transitionAutorisee, verifierPayeur } from '@/domaine/commissions';

const MAINTENANT = new Date('2026-11-10T10:00:00Z');

const candidat = (surcharge: Partial<ProfilCandidat> = {}): ProfilCandidat => ({
  statut: 'nouveau',
  consentementValide: true,
  metiers: ['femme_menage'],
  ville: 'casablanca',
  villesAcceptees: ['bouskoura'],
  experienceAnnees: 4,
  langues: ['darija', 'fr'],
  salaireAttendu: 4000,
  periodeSalaire: 'mois',
  logement: 'indifferent',
  rythmes: [],
  disponibleLe: null,
  permis: false,
  competences: ['menage', 'repassage'],
  ...surcharge,
});

const poste = (surcharge: Partial<PosteAPourvoir> = {}): PosteAPourvoir => ({
  ouvert: true,
  metiers: ['femme_menage'],
  ville: 'casablanca',
  experienceMinAnnees: 2,
  langues: ['fr'],
  salaireMin: 4000,
  salaireMax: null,
  periodeSalaire: 'mois',
  logement: null,
  tempsTravail: 'temps_plein',
  permis: null,
  urgent: false,
  competences: [],
  ...surcharge,
});

describe('appariement candidat ↔ offre', () => {
  it('donne 100 au profil idéal et l’explique', () => {
    const resultat = apparier(candidat(), poste(), MAINTENANT);
    expect(resultat.score).toBe(100);
    expect(resultat.bloquants).toEqual([]);
    expect(resultat.criteres.reduce((total, c) => total + c.max, 0)).toBe(100);
    expect(resultat.pointsForts.length).toBeGreaterThan(2);
  });

  it('valorise un métier proche moins qu’un métier identique', () => {
    const identique = apparier(candidat(), poste(), MAINTENANT).criteres[0]!;
    const proche = apparier(candidat({ metiers: ['femme_chambre'] }), poste(), MAINTENANT).criteres[0]!;
    const autre = apparier(candidat({ metiers: ['chauffeur_prive'] }), poste(), MAINTENANT).criteres[0]!;
    const horsSecteur = apparier(candidat({ metiers: ['coiffeuse'] }), poste(), MAINTENANT).criteres[0]!;
    expect([identique.points, proche.points, autre.points, horsSecteur.points]).toEqual([35, 20, 10, 0]);
  });

  it('tient compte du lieu : même ville, ville acceptée, poste logé, autre ville', () => {
    const lieu = (c: Partial<ProfilCandidat>, p: Partial<PosteAPourvoir>) => apparier(candidat(c), poste(p), MAINTENANT).criteres[1]!.points;
    expect(lieu({}, {})).toBe(20);
    expect(lieu({}, { ville: 'bouskoura' })).toBe(16);
    expect(lieu({}, { ville: 'marrakech', logement: 'loge' })).toBe(12);
    expect(lieu({}, { ville: 'mohammedia' })).toBe(8);
    expect(lieu({}, { ville: 'tanger' })).toBe(0);
  });

  it('pénalise un salaire proposé très inférieur aux prétentions', () => {
    const salaire = (offert: number) => apparier(candidat(), poste({ salaireMin: offert }), MAINTENANT).criteres[5]!.points;
    expect(salaire(4500)).toBe(7);
    expect(salaire(3700)).toBe(5);
    expect(salaire(3100)).toBe(2);
    expect(salaire(2500)).toBe(0);
  });

  it('accepte la darija pour une annonce qui demande l’arabe', () => {
    expect(apparier(candidat({ langues: ['darija'] }), poste({ langues: ['ar'] }), MAINTENANT).criteres[4]!.points).toBe(8);
  });

  it('bloque un candidat placé, indisponible ou sans consentement, et une offre inactive', () => {
    expect(apparier(candidat({ statut: 'place' }), poste(), MAINTENANT).bloquants).toEqual(['Candidat déjà placé']);
    expect(apparier(candidat({ consentementValide: false }), poste(), MAINTENANT).bloquants).toContain('Consentement du candidat absent ou retiré');
    expect(apparier(candidat(), poste({ ouvert: false }), MAINTENANT).bloquants).toEqual(['Offre inactive ou non vérifiée']);
  });

  it('signale un permis demandé non détenu', () => {
    const resultat = apparier(candidat(), poste({ permis: true }), MAINTENANT);
    expect(resultat.score).toBe(97);
    expect(resultat.criteres[7]!.explication).toContain('permis demandé, non détenu');
  });

  it('ne compte le permis qu’une fois, qu’il vienne de la case ou de la compétence repérée dans l’annonce', () => {
    // L'annonce cite « permis de conduire » : l'extraction renseigne à la fois le permis et la compétence.
    const annonce = poste({ permis: true, competences: ['permis_conduire'] });
    const avecCase = apparier(candidat({ permis: true, competences: [] }), annonce, MAINTENANT);
    expect(avecCase.criteres[7]!.points).toBe(5);
    expect(avecCase.criteres[7]!.explication).toBe('permis de conduire');
    const sansPermis = apparier(candidat({ permis: false, competences: [] }), annonce, MAINTENANT);
    expect(sansPermis.criteres[7]!.points).toBe(2);
    expect(sansPermis.criteres[7]!.explication).toBe('permis demandé, non détenu');
    // Une ancienne fiche où seule la compétence est cochée vaut un permis détenu.
    const ancienneFiche = apparier(candidat({ permis: false, competences: ['permis_conduire'] }), poste({ permis: true }), MAINTENANT);
    expect(ancienneFiche.criteres[7]!.points).toBe(5);
    // Les autres compétences demandées restent comptées à part.
    const mixte = apparier(candidat({ permis: true, competences: ['menage'] }), poste({ permis: true, competences: ['permis_conduire', 'menage', 'repassage'] }), MAINTENANT);
    expect(mixte.criteres[7]!.explication).toBe('permis de conduire ; 1/2 compétences demandées');
  });

  it('ne suggère jamais un candidat d’un autre métier ou hors de portée, même si tout le reste convient', () => {
    const chauffeurTanger = apparier(candidat({ metiers: ['chauffeur_prive'], ville: 'tanger', villesAcceptees: [] }), poste(), MAINTENANT);
    // Les critères secondaires suffisent à dépasser 50 points…
    expect(chauffeurTanger.score).toBeGreaterThanOrEqual(50);
    // …mais ce n'est pas une suggestion valable.
    expect(estSuggerable(chauffeurTanger, 50)).toBe(false);
    expect(estSuggerable(apparier(candidat({ metiers: ['chauffeur_prive'] }), poste(), MAINTENANT), 50)).toBe(false);
    expect(estSuggerable(apparier(candidat({ ville: 'tanger', villesAcceptees: [] }), poste(), MAINTENANT), 50)).toBe(false);
  });

  it('suggère le même métier ou un métier proche, sur place ou dans une ville acceptée', () => {
    expect(estSuggerable(apparier(candidat(), poste(), MAINTENANT), 50)).toBe(true);
    expect(estSuggerable(apparier(candidat({ ville: 'bouskoura', villesAcceptees: ['casablanca'] }), poste(), MAINTENANT), 50)).toBe(true);
    expect(estSuggerable(apparier(candidat({ metiers: ['femme_chambre'] }), poste(), MAINTENANT), 50)).toBe(true);
    expect(estSuggerable(apparier(candidat(), poste({ ville: null }), MAINTENANT), 50)).toBe(true);
    expect(estSuggerable(apparier(candidat({ statut: 'place' }), poste(), MAINTENANT), 50)).toBe(false);
    expect(estSuggerable(apparier(candidat(), poste(), MAINTENANT), 101)).toBe(false);
  });

  it('ne lit aucun critère personnel (origine, âge, nom) : ils n’existent pas dans le profil', () => {
    const cles = Object.keys(candidat());
    for (const interdit of ['origine', 'age', 'nom', 'nationalite', 'religion', 'situationFamiliale']) expect(cles).not.toContain(interdit);
  });
});

describe('commissions', () => {
  it('calcule un forfait et un pourcentage', () => {
    expect(calculerMontant({ mode: 'forfait', montantForfait: 1000 })).toBe(1000);
    expect(calculerMontant({ mode: 'pourcentage', base: 4500, taux: 10 })).toBe(450);
    expect(calculerMontant({ mode: 'pourcentage', base: 3333.33, taux: 12.5 })).toBe(416.67);
  });

  it('refuse un calcul incomplet', () => {
    expect(() => calculerMontant({ mode: 'pourcentage', taux: 10 })).toThrow(ErreurCommission);
    expect(() => calculerMontant({ mode: 'pourcentage', base: 4000, taux: 150 })).toThrow(ErreurCommission);
    expect(() => calculerMontant({ mode: 'forfait' })).toThrow(ErreurCommission);
  });

  it('autorise toujours la commission employeur', () => {
    expect(verifierPayeur({ payeur: 'employeur', commissionTravailleurActive: false, accuseLecture: false, justification: null })).toEqual([]);
  });

  it('refuse la commission travailleur tant qu’elle n’est pas activée, lue et justifiée', () => {
    expect(verifierPayeur({ payeur: 'travailleur', commissionTravailleurActive: false, accuseLecture: false, justification: '' })).toHaveLength(3);
    expect(verifierPayeur({ payeur: 'travailleur', commissionTravailleurActive: true, accuseLecture: true, justification: 'trop court' })).toHaveLength(1);
    expect(verifierPayeur({ payeur: 'travailleur', commissionTravailleurActive: true, accuseLecture: true, justification: 'Validation écrite du conseil juridique du 3 mars.' })).toEqual([]);
  });

  it('encadre les changements de statut', () => {
    expect(transitionAutorisee('du', 'facture')).toBe(true);
    expect(transitionAutorisee('facture', 'encaisse')).toBe(true);
    expect(transitionAutorisee('encaisse', 'du')).toBe(false);
    expect(transitionAutorisee('annule', 'du')).toBe(false);
  });

  it('calcule la fin de la période de remplacement', () => {
    expect(finRemplacement('2026-11-10', 6)).toBe('2027-05-10');
    expect(finRemplacement('2026-08-31', 6)).toBe('2027-02-28');
    expect(finRemplacement('2026-12-15', 2)).toBe('2027-02-15');
  });

  it('totalise par statut et par payeur, hors commissions annulées', () => {
    const totaux = totaliser([
      { status: 'du', amount: 1000, payer: 'employeur' },
      { status: 'encaisse', amount: 500, payer: 'employeur' },
      { status: 'annule', amount: 300, payer: 'employeur' },
    ]);
    expect(totaux).toMatchObject({ du: 1000, encaisse: 500, annule: 300, facture: 0, parPayeur: { employeur: 1500, travailleur: 0 } });
  });
});

describe('alertes', () => {
  const offre: OffrePourAlerte = {
    titre: 'Femme de ménage pour villa',
    motsCles: 'Femme de ménage / aide ménagère · عاملة نظافة · housekeeper',
    employeur: null,
    metiers: ['femme_menage'],
    secteur: 'maison',
    ville: 'casablanca',
    contrat: 'cdi',
    salaireMensuel: 4000,
    urgent: true,
    massif: false,
    pertinence: 80,
    statutEffectif: 'actif',
  };

  it('compare tous les critères renseignés', () => {
    expect(offreCorrespond({}, offre)).toBe(true);
    expect(offreCorrespond({ villes: ['casablanca', 'rabat'], categories: ['femme_menage'], urgentSeulement: true }, offre)).toBe(true);
    expect(offreCorrespond({ villes: ['rabat'] }, offre)).toBe(false);
    expect(offreCorrespond({ salaireMin: 5000 }, offre)).toBe(false);
    expect(offreCorrespond({ massifSeulement: true }, offre)).toBe(false);
    expect(offreCorrespond({ pertinenceMin: 90 }, offre)).toBe(false);
    expect(offreCorrespond({ secteurs: ['beaute'] }, offre)).toBe(false);
  });

  it('cherche le texte dans le titre et les mots-clés multilingues', () => {
    expect(offreCorrespond({ texte: 'housekeeper' }, offre)).toBe(true);
    expect(offreCorrespond({ texte: 'ménage villa' }, offre)).toBe(true);
    expect(offreCorrespond({ texte: 'chauffeur' }, offre)).toBe(false);
  });

  it('ne signale jamais une offre expirée, douteuse ou archivée', () => {
    for (const statutEffectif of ['expire', 'douteux', 'archive']) expect(offreCorrespond({}, { ...offre, statutEffectif })).toBe(false);
  });

  it('nettoie les critères reçus', () => {
    expect(normaliserCriteres({ texte: '  nounou ', villes: ['rabat', 'rabat', 3], salaireMin: -5, urgentSeulement: 'oui', inconnu: 1 })).toEqual({ texte: 'nounou', villes: ['rabat'] });
    expect(normaliserCriteres(null)).toEqual({});
  });

  it('résume une alerte en une phrase', () => {
    expect(resumerCriteres({ categories: ['femme_menage'], villes: ['casablanca'], urgentSeulement: true })).toBe('Femme de ménage / aide ménagère · Casablanca · urgentes');
    expect(resumerCriteres({})).toBe('Toutes les offres actives');
  });
});
