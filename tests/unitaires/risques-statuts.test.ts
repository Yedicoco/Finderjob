import { describe, expect, it } from 'vitest';
import { extraire } from '@/domaine/extraction';
import { PARAMETRES_DEFAUT, construireParametres } from '@/domaine/parametres';
import { evaluerRisque, evaluerSalaire } from '@/domaine/risques';
import { ageEnJours, statutEffectif, statutInitial } from '@/domaine/statuts';

const MAINTENANT = new Date('2026-11-10T10:00:00Z');
const P = PARAMETRES_DEFAUT;

function risque(titre: string, texte: string, contexte: Partial<{ villeConnue: boolean; employeurConnu: boolean; dateConnue: boolean }> = {}) {
  return evaluerRisque({
    titre,
    texte,
    extraction: extraire(titre, texte, MAINTENANT),
    villeConnue: contexte.villeConnue ?? true,
    employeurConnu: contexte.employeurConnu ?? true,
    dateConnue: contexte.dateConnue ?? true,
    parametres: P,
  });
}
const codes = (titre: string, texte: string) => risque(titre, texte).signaux.map((s) => s.code);

describe('score de risque', () => {
  it('une annonce complète et normale a un risque faible', () => {
    const evaluation = risque('Femme de ménage', 'Famille à Casablanca. CDI, salaire 4 000 DH par mois.');
    expect(evaluation.score).toBe(0);
    expect(evaluation.niveau).toBe('faible');
    expect(evaluation.drapeauSalaire).toBe('normal');
  });

  it('signale une demande d’argent au candidat', () => {
    expect(codes('Hôtesse', 'Frais de dossier de 300 dh à payer avant l’entretien.')).toContain('frais_demandes');
    expect(codes('Agent', 'Merci d’envoyer 200 dh par Wafacash pour réserver votre place.')).toContain('frais_demandes');
    expect(codes('عاملة', 'يجب دفع مبلغ التسجيل قبل المقابلة')).toContain('frais_demandes');
  });

  it('ne signale pas « sans frais » ni « aucun frais de dossier »', () => {
    expect(codes('Nounou', 'Inscription gratuite, sans frais de dossier.')).not.toContain('frais_demandes');
    expect(codes('Nounou', 'Aucun frais d’inscription pour les candidates.')).not.toContain('frais_demandes');
  });

  it('signale une annonce visant une personne mineure', () => {
    expect(codes('Petite bonne', 'pour famille')).toContain('travail_mineur');
    expect(codes('Aide ménagère', 'Fille âgée entre 15 et 20 ans')).toContain('travail_mineur');
    expect(risque('Petite bonne', 'pour famille').niveau).toBe('eleve');
  });

  it('ne confond pas l’âge d’un enfant gardé avec celui de la candidate', () => {
    expect(codes('Nounou', 'Garde d’une fille de 10 ans et d’un garçon âgé de 6 ans.')).not.toContain('travail_mineur');
  });

  it('signale les formulations d’arnaque ou d’activité illicite', () => {
    expect(codes('Travail à domicile', 'Argent facile, gains rapides sans expérience.')).toContain('contenu_suspect');
    expect(codes('Masseuse', 'Massage sensuel, discrétion assurée.')).toContain('contenu_suspect');
    expect(codes('Aide ménagère', 'Le passeport sera conservé par l’employeur.')).toContain('contenu_suspect');
  });

  it('signale un critère discriminatoire sans rendre l’offre douteuse à lui seul', () => {
    const evaluation = risque('Femme de ménage', 'Subsaharienne uniquement, célibataire de préférence. Casablanca.');
    expect(evaluation.signaux.map((s) => s.code)).toContain('criteres_discriminatoires');
    expect(evaluation.niveau).toBe('modere');
  });

  it('signale les salaires anormaux', () => {
    expect(codes('Femme de ménage', 'Temps plein. Salaire 1 500 dh par mois.')).toContain('salaire_sous_minimum');
    expect(codes('Femme de ménage', 'Temps plein. Salaire 2 300 dh par mois.')).toContain('salaire_bas');
    expect(codes('Femme de ménage', 'Salaire 45 000 dh par mois.')).toContain('salaire_eleve');
    expect(codes('Femme de ménage', 'Salaire 100 dh par jour.')).toContain('salaire_bas');
  });

  it('ne juge pas « bas » un temps partiel', () => {
    expect(codes('Femme de ménage', 'Mi-temps, 3 matinées. Salaire 1 800 dh par mois.')).not.toContain('salaire_sous_minimum');
  });

  it('ne juge pas un petit montant dont la période est inconnue', () => {
    const extraction = extraire('Repassage', 'Paiement 80 dh', MAINTENANT);
    expect(evaluerSalaire(extraction.salaire, extraction.tempsTravail, P.salaires)).toBeNull();
  });

  it('additionne les informations manquantes', () => {
    const evaluation = risque('Femme de ménage', 'Travail sérieux.', { villeConnue: false, employeurConnu: false, dateConnue: false });
    expect(evaluation.score).toBe(35);
    expect(evaluation.niveau).toBe('modere');
  });

  it('plafonne à 100', () => {
    expect(risque('Petite bonne', 'Frais de dossier 500 dh. Argent facile.', { villeConnue: false, employeurConnu: false, dateConnue: false }).score).toBe(100);
  });
});

describe('statut initial d’une offre', () => {
  const base = {
    publieLe: new Date('2026-11-08T09:00:00Z'),
    precisionDate: 'exacte' as const,
    expireLe: null,
    pays: 'MA' as const,
    villeConnue: true,
    scoreRisque: 0,
    estDoublonDe: false,
    maintenant: MAINTENANT,
    parametres: P,
  };

  it('offre récente, datée, localisée → active', () => {
    expect(statutInitial(base)).toEqual({ statut: 'actif', motif: 'aucun', verification: 'non_requise', revueHumaine: false });
  });

  it('sans date → douteuse, jamais active', () => {
    expect(statutInitial({ ...base, publieLe: null, precisionDate: 'inconnue' })).toMatchObject({ statut: 'douteux', motif: 'date_inconnue', verification: 'a_verifier' });
  });

  it('date dans le futur → douteuse', () => {
    expect(statutInitial({ ...base, publieLe: new Date('2026-12-25T00:00:00Z') })).toMatchObject({ statut: 'douteux', motif: 'date_incoherente' });
  });

  it('publiée avant le 1er janvier 2026 (heure de Casablanca) → archivée hors périmètre', () => {
    expect(statutInitial({ ...base, publieLe: new Date('2025-12-31T22:59:59Z') })).toMatchObject({ statut: 'archive', motif: 'hors_perimetre_date' });
    // 1er janvier 2026 00:00 à Casablanca = 31 décembre 2025 23:00 UTC : dans le périmètre (mais expirée par ancienneté).
    expect(statutInitial({ ...base, publieLe: new Date('2025-12-31T23:00:00Z') })).toMatchObject({ statut: 'expire', motif: 'expiree_anciennete' });
  });

  it('expirée selon la source ou par ancienneté', () => {
    expect(statutInitial({ ...base, expireLe: new Date('2026-11-09T00:00:00Z') })).toMatchObject({ statut: 'expire', motif: 'expiree_source' });
    expect(statutInitial({ ...base, publieLe: new Date('2026-09-01T00:00:00Z') })).toMatchObject({ statut: 'expire', motif: 'expiree_anciennete' });
    // Une date d'expiration explicite encore valable l'emporte sur l'ancienneté.
    expect(statutInitial({ ...base, publieLe: new Date('2026-09-01T00:00:00Z'), expireLe: new Date('2026-12-01T00:00:00Z') })).toMatchObject({ statut: 'actif' });
  });

  it('lieu inconnu ou risque élevé → douteuse avec revue humaine', () => {
    expect(statutInitial({ ...base, pays: 'inconnu', villeConnue: false })).toMatchObject({ statut: 'douteux', motif: 'localisation_inconnue', revueHumaine: true });
    expect(statutInitial({ ...base, scoreRisque: 60 })).toMatchObject({ statut: 'douteux', motif: 'risque_eleve', revueHumaine: true });
  });

  it('doublon → archivé', () => {
    expect(statutInitial({ ...base, estDoublonDe: true })).toMatchObject({ statut: 'archive', motif: 'doublon' });
  });

  it('active mais à vérifier si la ville manque ou si une revue est demandée', () => {
    expect(statutInitial({ ...base, villeConnue: false })).toEqual({ statut: 'actif', motif: 'aucun', verification: 'a_verifier', revueHumaine: true });
    expect(statutInitial({ ...base, revueDemandee: true })).toMatchObject({ statut: 'actif', verification: 'a_verifier' });
  });
});

describe('statut effectif (recalculé à la lecture)', () => {
  const delais = { dureeValiditeJours: 45, delaiReverificationJours: 21 };
  const offre = {
    statut: 'actif' as const,
    motif: 'aucun' as const,
    publieLe: new Date('2026-11-01T09:00:00Z'),
    precisionDate: 'exacte' as const,
    expireLe: null,
    verifieLe: new Date('2026-11-09T09:00:00Z'),
  };

  it('reste active tant que rien n’a changé', () => {
    expect(statutEffectif(offre, MAINTENANT, delais)).toEqual({ statut: 'actif', motif: 'aucun' });
  });

  it('devient expirée d’elle-même avec le temps', () => {
    expect(statutEffectif(offre, new Date('2027-01-05T00:00:00Z'), delais)).toEqual({ statut: 'expire', motif: 'expiree_anciennete' });
    expect(statutEffectif({ ...offre, expireLe: new Date('2026-11-10T09:59:59Z') }, MAINTENANT, delais)).toEqual({ statut: 'expire', motif: 'expiree_source' });
  });

  it('devient douteuse si elle n’a pas été revérifiée', () => {
    expect(statutEffectif({ ...offre, verifieLe: new Date('2026-10-01T00:00:00Z') }, MAINTENANT, delais)).toEqual({ statut: 'douteux', motif: 'non_reverifiee' });
  });

  it('ne « réactive » jamais une offre archivée, expirée ou douteuse', () => {
    expect(statutEffectif({ ...offre, statut: 'archive', motif: 'doublon' }, MAINTENANT, delais)).toEqual({ statut: 'archive', motif: 'doublon' });
    expect(statutEffectif({ ...offre, statut: 'douteux', motif: 'risque_eleve' }, MAINTENANT, delais)).toEqual({ statut: 'douteux', motif: 'risque_eleve' });
  });

  it('calcule l’âge en jours', () => {
    expect(ageEnJours(new Date('2026-11-07T10:00:00Z'), MAINTENANT)).toBe(3);
    expect(ageEnJours(null, MAINTENANT)).toBeNull();
  });
});

describe('paramètres', () => {
  it('a des valeurs par défaut conformes au cahier des charges', () => {
    expect(P.perimetre.pays).toBe('MA');
    expect(new Date(P.perimetre.dateMin).toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(P.commissions.travailleurActive).toBe(false);
    expect(P.candidats.conservationMois).toBe(12);
    expect(P.commissions.formules.premium).toMatchObject({ montant: 1000, remplacementMois: 6 });
    expect(P.commissions.formules.serenite).toMatchObject({ montant: 500, remplacementMois: 2 });
  });

  it('borne les surcharges et ignore les valeurs invalides', () => {
    const p = construireParametres({ 'offres.duree_validite_jours': 30, 'offres.delai_reverification_jours': 9999, 'commissions.travailleur_active': 'oui' });
    expect(p.offres.dureeValiditeJours).toBe(30);
    expect(p.offres.delaiReverificationJours).toBe(21);
    expect(p.commissions.travailleurActive).toBe(false);
    expect(construireParametres({ 'commissions.travailleur_active': true }).commissions.travailleurActive).toBe(true);
  });
});
