import { describe, expect, it } from 'vitest';
import { extraire } from '@/domaine/extraction';
import { dateSaisieMaroc } from '@/domaine/fuseau';
import { DEBUT_RECHERCHE_DEFAUT, DEBUT_RECHERCHE_PLANCHER, PARAMETRES_DEFAUT, construireParametres } from '@/domaine/parametres';
import { evaluerRisque, evaluerSalaire } from '@/domaine/risques';
import { MOTIFS_HORS_PERIODE, ageEnJours, statutEffectif, statutInitial } from '@/domaine/statuts';
import { PARAMETRES_TESTS } from '../parametres';

const MAINTENANT = new Date('2026-11-10T10:00:00Z');
// Début de la recherche épinglé au 1er janvier 2026 : voir tests/parametres.ts.
const P = PARAMETRES_TESTS;

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

  it('début de la recherche par défaut (lundi 9 novembre 2026) : la veille au soir est écartée, minuit est retenu', () => {
    const defaut = { ...base, parametres: PARAMETRES_DEFAUT };
    expect(statutInitial({ ...defaut, publieLe: new Date('2026-11-08T23:59:59Z') })).toEqual({ statut: 'archive', motif: 'hors_perimetre_date', verification: 'non_requise', revueHumaine: false });
    expect(statutInitial({ ...defaut, publieLe: new Date('2026-11-09T00:00:00Z') })).toEqual({ statut: 'actif', motif: 'aucun', verification: 'non_requise', revueHumaine: false });
    // La même annonce du dimanche 8 novembre reste active tant que la recherche commence plus tôt.
    expect(statutInitial({ ...base, publieLe: new Date('2026-11-08T23:59:59Z') })).toMatchObject({ statut: 'actif' });
  });

  it('une annonce écartée par le début de la recherche l’est quels que soient ses autres défauts, sauf l’absence de date', () => {
    const ancienne = { ...base, parametres: PARAMETRES_DEFAUT, publieLe: new Date('2026-11-06T09:00:00Z') };
    expect(statutInitial({ ...ancienne, scoreRisque: 90 })).toMatchObject({ statut: 'archive', motif: 'hors_perimetre_date' });
    expect(statutInitial({ ...ancienne, estDoublonDe: true })).toMatchObject({ statut: 'archive', motif: 'hors_perimetre_date' });
    expect(statutInitial({ ...ancienne, pays: 'inconnu', villeConnue: false })).toMatchObject({ statut: 'archive', motif: 'hors_perimetre_date' });
    // Sans date fiable, impossible de dire si l'annonce précède la recherche : elle reste à vérifier.
    expect(statutInitial({ ...ancienne, publieLe: null, precisionDate: 'inconnue' })).toMatchObject({ statut: 'douteux', motif: 'date_inconnue' });
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

  it('dit par son motif si l’annonce a une date fiable dans la période de recherche', () => {
    const horsPeriode = (entree: Parameters<typeof statutInitial>[0]) => MOTIFS_HORS_PERIODE.includes(statutInitial(entree).motif);
    const defaut = { ...base, parametres: PARAMETRES_DEFAUT };
    // Hors période : sans date, date dans le futur, publiée avant le début de la recherche.
    expect(horsPeriode({ ...defaut, publieLe: null, precisionDate: 'inconnue' })).toBe(true);
    expect(horsPeriode({ ...defaut, publieLe: new Date('2026-12-25T00:00:00Z') })).toBe(true);
    expect(horsPeriode({ ...defaut, publieLe: new Date('2026-11-08T23:59:59Z') })).toBe(true);
    // Dans la période, quel que soit le statut : active, douteuse, expirée, doublon.
    const lundi = { ...defaut, publieLe: new Date('2026-11-09T00:00:00Z') };
    expect(horsPeriode(lundi)).toBe(false);
    expect(horsPeriode({ ...lundi, scoreRisque: 90 })).toBe(false);
    expect(horsPeriode({ ...lundi, pays: 'inconnu', villeConnue: false })).toBe(false);
    expect(horsPeriode({ ...lundi, expireLe: new Date('2026-11-09T12:00:00Z') })).toBe(false);
    expect(horsPeriode({ ...lundi, estDoublonDe: true })).toBe(false);
    // Une date à peine en avance (horloge de la source) reste dans la période.
    expect(horsPeriode({ ...defaut, publieLe: new Date('2026-11-11T09:00:00Z') })).toBe(false);
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
    const D = PARAMETRES_DEFAUT;
    expect(D.perimetre.pays).toBe('MA');
    expect(D.commissions.travailleurActive).toBe(false);
    expect(D.candidats.conservationMois).toBe(12);
    expect(D.commissions.formules.premium).toMatchObject({ montant: 1000, remplacementMois: 6 });
    expect(D.commissions.formules.serenite).toMatchObject({ montant: 500, remplacementMois: 2 });
  });

  it('fait commencer la recherche le lundi 9 novembre 2026 à 00 h 00, heure de Casablanca', () => {
    const debut = new Date(PARAMETRES_DEFAUT.perimetre.dateMin);
    expect(PARAMETRES_DEFAUT.perimetre.dateMin).toBe(DEBUT_RECHERCHE_DEFAUT);
    expect(debut.toISOString()).toBe('2026-11-09T00:00:00.000Z');
    // Même instant que la date saisie dans les paramètres : le formulaire et la valeur d'origine ne peuvent pas diverger.
    expect(dateSaisieMaroc('2026-11-09', 'debut')?.getTime()).toBe(debut.getTime());
    expect(debut.getUTCDay()).toBe(1);
    expect(construireParametres().perimetre.dateMin).toBe(DEBUT_RECHERCHE_DEFAUT);
  });

  it('ne remonte jamais avant le 1er janvier 2026, plancher du cahier des charges', () => {
    const plancher = new Date(DEBUT_RECHERCHE_PLANCHER);
    expect(plancher.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(dateSaisieMaroc('2026-01-01', 'debut')?.getTime()).toBe(plancher.getTime());
    expect(plancher.getTime()).toBeLessThan(Date.parse(DEBUT_RECHERCHE_DEFAUT));
    // Le plancher lui-même et toute date postérieure sont retenus…
    expect(construireParametres({ 'perimetre.dateMin': '2025-12-31T23:00:00.000Z' }).perimetre.dateMin).toBe('2025-12-31T23:00:00.000Z');
    expect(construireParametres({ 'perimetre.dateMin': '2026-06-01T00:00:00+01:00' }).perimetre.dateMin).toBe('2026-06-01T00:00:00+01:00');
    // … une date antérieure, illisible ou d'un autre type est ignorée : la valeur d'origine s'applique.
    for (const invalide of ['2025-12-31T22:59:59.000Z', '2025-06-01T00:00:00Z', 'bientôt', '', 20261109, null, undefined]) {
      expect(construireParametres({ 'perimetre.dateMin': invalide }).perimetre.dateMin).toBe(DEBUT_RECHERCHE_DEFAUT);
    }
  });

  it('borne les surcharges et ignore les valeurs invalides', () => {
    const p = construireParametres({ 'offres.duree_validite_jours': 30, 'offres.delai_reverification_jours': 9999, 'commissions.travailleur_active': 'oui' });
    expect(p.offres.dureeValiditeJours).toBe(30);
    expect(p.offres.delaiReverificationJours).toBe(21);
    expect(p.commissions.travailleurActive).toBe(false);
    expect(construireParametres({ 'commissions.travailleur_active': true }).commissions.travailleurActive).toBe(true);
  });
});
