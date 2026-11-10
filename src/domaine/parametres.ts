/**
 * Paramètres métier par défaut. Chaque valeur peut être surchargée dans la
 * table app_settings (écran Administration → Paramètres) sans redéployer.
 *
 * Origine des chiffres
 *   - Périmètre : cahier des charges (Maroc uniquement, année cible 2026).
 *   - SMIG : 17,92 DH/h au 1er janvier 2026, soit 3 422,72 DH bruts par mois
 *     pour 191 h (décret n° 2.25.983, Bulletin officiel n° 7469). Chiffre
 *     relevé le 10/11/2026 dans trois sources secondaires concordantes
 *     (dreamjob.ma, weepo.ma, wafir.ma), PAS dans le Bulletin officiel
 *     lui-même : À CONFIRMER sur le texte officiel avant mise en production.
 *   - Plancher « travail domestique » : 60 % du SMIG (loi n° 19-12), calculé.
 *   - Formules Premium (1 000 DH, remplacements 6 mois) et Sérénité (500 DH,
 *     2 mois) : `contenu/fiche-entreprise.md` du dépôt Yedicoco/yallah.services.
 *   - Conservation 12 mois des candidats non retenus : README du même dépôt.
 *   - Les autres seuils (durée de validité, demi-vie, seuils de salaire
 *     « anormal », pondérations) sont des choix de conception à ajuster avec
 *     l'usage ; ils sont justifiés dans docs/09-algorithmes-de-score.md.
 */

export const SMIG_MENSUEL_BRUT_2026 = 3422.72;
export const SMIG_HORAIRE_2026 = 17.92;

export type Parametres = {
  perimetre: {
    pays: 'MA';
    /** Début du périmètre : 1er janvier 2026 à 00 h 00, heure de Casablanca (UTC+1). */
    dateMin: string;
    fuseau: 'Africa/Casablanca';
  };
  offres: {
    /** Sans date d'expiration fournie par la source, une offre expire après ce délai. */
    dureeValiditeJours: number;
    /** Au-delà, une offre active non revue redevient « douteuse ». */
    delaiReverificationJours: number;
    /** Demi-vie du score de fraîcheur. */
    demiVieFraicheurJours: number;
  };
  salaires: {
    smigMensuelBrut: number;
    plancherDomestiqueMensuel: number;
    seuilBasMensuel: number;
    seuilEleveMensuel: number;
    seuilBasJournalier: number;
    seuilEleveJournalier: number;
  };
  risque: { seuilModere: number; seuilEleve: number };
  doublons: { seuilLien: number; seuilProbable: number; fenetreJours: number };
  classification: { confianceMin: number };
  commissions: {
    /**
     * Commission prélevée sur le travailleur. DÉSACTIVÉE par défaut : l'article
     * 480 du Code du travail interdit aux agences de recrutement privées de
     * percevoir des frais des demandeurs d'emploi, et le site Yallah Services
     * promet « Aucun frais, jamais » aux candidats. Voir docs/02-product-brief.md.
     */
    travailleurActive: boolean;
    formules: Record<'premium' | 'serenite', { libelle: string; montant: number; remplacementMois: number }>;
  };
  candidats: { conservationMois: number; versionConsentement: string };
  matching: { scoreMinSuggestion: number; version: string };
};

export const PARAMETRES_DEFAUT: Parametres = {
  perimetre: { pays: 'MA', dateMin: '2026-01-01T00:00:00+01:00', fuseau: 'Africa/Casablanca' },
  offres: { dureeValiditeJours: 45, delaiReverificationJours: 21, demiVieFraicheurJours: 10 },
  salaires: {
    smigMensuelBrut: SMIG_MENSUEL_BRUT_2026,
    plancherDomestiqueMensuel: Math.round(SMIG_MENSUEL_BRUT_2026 * 0.6),
    seuilBasMensuel: 2500,
    seuilEleveMensuel: 30000,
    seuilBasJournalier: 140,
    seuilEleveJournalier: 1500,
  },
  risque: { seuilModere: 25, seuilEleve: 50 },
  doublons: { seuilLien: 0.82, seuilProbable: 0.65, fenetreJours: 30 },
  classification: { confianceMin: 35 },
  commissions: {
    travailleurActive: false,
    formules: {
      premium: { libelle: 'Premium', montant: 1000, remplacementMois: 6 },
      serenite: { libelle: 'Sérénité', montant: 500, remplacementMois: 2 },
    },
  },
  candidats: { conservationMois: 12, versionConsentement: '2026-11' },
  matching: { scoreMinSuggestion: 50, version: 'appariement-v1' },
};

/** Clés stockées dans app_settings (notation pointée) et leur description. */
export const DESCRIPTIONS_PARAMETRES: Record<string, string> = {
  'perimetre.dateMin': 'Date à partir de laquelle une offre est dans le périmètre (2026).',
  'offres.duree_validite_jours': 'Durée de validité d’une offre sans date d’expiration (jours).',
  'offres.delai_reverification_jours': 'Délai au-delà duquel une offre active non revue devient douteuse (jours).',
  'offres.demi_vie_fraicheur_jours': 'Demi-vie du score de fraîcheur (jours).',
  'salaires.seuil_bas_mensuel': 'Salaire mensuel en dessous duquel une offre est signalée (DH).',
  'salaires.seuil_eleve_mensuel': 'Salaire mensuel au-dessus duquel une offre est signalée (DH).',
  'salaires.plancher_domestique_mensuel': 'Plancher légal du travail domestique : 60 % du SMIG (DH).',
  'commissions.travailleur_active': 'Autorise la saisie d’une commission côté travailleur (désactivé par défaut).',
  'candidats.conservation_mois': 'Durée de conservation d’un candidat non placé (mois).',
};

type Surcharges = Record<string, unknown>;

function nombre(valeur: unknown, defaut: number, min: number, max: number): number {
  return typeof valeur === 'number' && Number.isFinite(valeur) && valeur >= min && valeur <= max ? valeur : defaut;
}

/** Fusionne les valeurs de app_settings avec les valeurs par défaut (en les bornant). */
export function construireParametres(surcharges: Surcharges = {}): Parametres {
  const d = PARAMETRES_DEFAUT;
  const dateMin = surcharges['perimetre.dateMin'];
  return {
    ...d,
    perimetre: {
      ...d.perimetre,
      dateMin: typeof dateMin === 'string' && !Number.isNaN(Date.parse(dateMin)) ? dateMin : d.perimetre.dateMin,
    },
    offres: {
      dureeValiditeJours: nombre(surcharges['offres.duree_validite_jours'], d.offres.dureeValiditeJours, 7, 180),
      delaiReverificationJours: nombre(surcharges['offres.delai_reverification_jours'], d.offres.delaiReverificationJours, 3, 90),
      demiVieFraicheurJours: nombre(surcharges['offres.demi_vie_fraicheur_jours'], d.offres.demiVieFraicheurJours, 2, 60),
    },
    salaires: {
      ...d.salaires,
      seuilBasMensuel: nombre(surcharges['salaires.seuil_bas_mensuel'], d.salaires.seuilBasMensuel, 500, 10000),
      seuilEleveMensuel: nombre(surcharges['salaires.seuil_eleve_mensuel'], d.salaires.seuilEleveMensuel, 5000, 200000),
      plancherDomestiqueMensuel: nombre(surcharges['salaires.plancher_domestique_mensuel'], d.salaires.plancherDomestiqueMensuel, 500, 10000),
    },
    commissions: {
      ...d.commissions,
      travailleurActive: surcharges['commissions.travailleur_active'] === true,
    },
    candidats: {
      ...d.candidats,
      conservationMois: nombre(surcharges['candidats.conservation_mois'], d.candidats.conservationMois, 1, 60),
    },
  };
}
