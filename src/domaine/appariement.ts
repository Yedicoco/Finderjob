/**
 * Appariement candidat ↔ offre (ou besoin employeur) : score de 0 à 100,
 * expliqué critère par critère.
 *
 *   métier 35 · lieu 20 · disponibilité 10 · expérience 10 · langues 8 ·
 *   salaire 7 · logement et rythme 5 · permis et compétences 5
 *
 * Principes
 *   - Le score AIDE à choisir ; il ne décide de rien. Aucune proposition n'est
 *     envoyée automatiquement à un employeur.
 *   - Seul le profil professionnel est lu. L'origine, l'âge, le nom, la
 *     situation familiale ne sont jamais des critères (ils ne sont même pas
 *     transmis à cette fonction).
 *   - Des « bloquants » empêchent toute proposition : candidat indisponible ou
 *     déjà placé, consentement absent, offre inactive.
 */
import { accord, compter } from './accord';
import { mensualiser, type PeriodeSalaire } from './extraction';
import { villeParCode } from './geographie';
import { libelleMetier, metierParCode, metiersProches } from './taxonomie';

export const VERSION_APPARIEMENT = 'appariement-v1';

export type ProfilCandidat = {
  statut: 'nouveau' | 'contacte' | 'entretien' | 'propose' | 'place' | 'refuse' | 'indisponible';
  consentementValide: boolean;
  /** Codes métiers ; le premier est le métier principal. */
  metiers: string[];
  ville: string | null;
  villesAcceptees: string[];
  experienceAnnees: number | null;
  langues: string[];
  salaireAttendu: number | null;
  periodeSalaire: PeriodeSalaire;
  logement: 'loge' | 'non_loge' | 'indifferent';
  rythmes: string[];
  /** Date de disponibilité « AAAA-MM-JJ » ; null = disponible. */
  disponibleLe: string | null;
  permis: boolean;
  competences: string[];
};

export type PosteAPourvoir = {
  /** false : offre expirée, douteuse non vérifiée, archivée, ou besoin clos. */
  ouvert: boolean;
  metiers: string[];
  ville: string | null;
  experienceMinAnnees: number | null;
  langues: string[];
  salaireMin: number | null;
  salaireMax: number | null;
  periodeSalaire: PeriodeSalaire | null;
  logement: 'loge' | 'non_loge' | 'indifferent' | null;
  tempsTravail: string;
  permis: boolean | null;
  urgent: boolean;
  competences: string[];
};

export type CritereAppariement = { code: string; libelle: string; points: number; max: number; explication: string };

export type ResultatAppariement = {
  score: number;
  criteres: CritereAppariement[];
  /** Raisons qui interdisent de proposer ce candidat (le score reste indicatif). */
  bloquants: string[];
  pointsForts: string[];
  pointsFaibles: string[];
};

const JOUR_MS = 86_400_000;

function metierScore(candidat: ProfilCandidat, poste: PosteAPourvoir): CritereAppariement {
  const base = { code: 'metier', libelle: 'Métier', max: 35 };
  const cible = poste.metiers[0];
  if (!cible) return { ...base, points: 0, explication: 'Métier du poste non classé' };
  if (candidat.metiers.length === 0) return { ...base, points: 0, explication: 'Aucun métier renseigné pour le candidat' };
  if (candidat.metiers[0] !== undefined && poste.metiers.includes(candidat.metiers[0])) {
    return { ...base, points: 35, explication: `Métier principal identique : ${libelleMetier(candidat.metiers[0])}` };
  }
  const secondaire = candidat.metiers.find((code) => poste.metiers.includes(code));
  if (secondaire) return { ...base, points: 30, explication: `Métier pratiqué par le candidat : ${libelleMetier(secondaire)}` };
  const proche = candidat.metiers.find((code) => poste.metiers.some((cibleCode) => metiersProches(code, cibleCode)));
  if (proche) return { ...base, points: 20, explication: `Métier proche : ${libelleMetier(proche)} pour un poste de ${libelleMetier(cible)}` };
  const secteurCible = metierParCode(cible)?.secteur;
  if (secteurCible && candidat.metiers.some((code) => metierParCode(code)?.secteur === secteurCible)) {
    return { ...base, points: 10, explication: 'Même secteur, métier différent' };
  }
  return { ...base, points: 0, explication: 'Métier sans rapport' };
}

function lieuScore(candidat: ProfilCandidat, poste: PosteAPourvoir): CritereAppariement {
  const base = { code: 'lieu', libelle: 'Lieu', max: 20 };
  if (!poste.ville) return { ...base, points: 5, explication: 'Ville du poste non précisée' };
  const nom = villeParCode(poste.ville)?.nom ?? poste.ville;
  if (candidat.ville === poste.ville) return { ...base, points: 20, explication: `Habite ${nom}` };
  if (candidat.villesAcceptees.includes(poste.ville)) return { ...base, points: 16, explication: `Accepte de travailler à ${nom}` };
  if (poste.logement === 'loge' && candidat.logement !== 'non_loge') {
    return { ...base, points: 12, explication: `Poste logé à ${nom} : mobilité possible` };
  }
  const regionCandidat = villeParCode(candidat.ville)?.region;
  if (regionCandidat && regionCandidat === villeParCode(poste.ville)?.region) {
    return { ...base, points: 8, explication: `Même région que ${nom}` };
  }
  return { ...base, points: 0, explication: `${nom} hors des villes acceptées` };
}

function disponibiliteScore(candidat: ProfilCandidat, poste: PosteAPourvoir, maintenant: Date): CritereAppariement {
  const base = { code: 'disponibilite', libelle: 'Disponibilité', max: 10 };
  if (!candidat.disponibleLe) return { ...base, points: 10, explication: 'Disponible immédiatement' };
  const jours = Math.ceil((new Date(`${candidat.disponibleLe}T11:00:00Z`).getTime() - maintenant.getTime()) / JOUR_MS);
  if (jours <= 0) return { ...base, points: 10, explication: 'Disponible immédiatement' };
  if (jours <= 15) return { ...base, points: poste.urgent ? 3 : 7, explication: `Disponible dans ${compter(jours, 'jour')}${poste.urgent ? ' — le poste est urgent' : ''}` };
  if (jours <= 30) return { ...base, points: poste.urgent ? 0 : 4, explication: `Disponible dans ${jours} jours` };
  return { ...base, points: 0, explication: `Disponible dans ${jours} jours seulement` };
}

function experienceScore(candidat: ProfilCandidat, poste: PosteAPourvoir): CritereAppariement {
  const base = { code: 'experience', libelle: 'Expérience', max: 10 };
  const requise = poste.experienceMinAnnees;
  const acquise = candidat.experienceAnnees;
  if (requise === null || requise === 0) {
    if (acquise === null) return { ...base, points: 5, explication: 'Expérience non exigée ; non renseignée pour le candidat' };
    return { ...base, points: acquise >= 1 ? 10 : 7, explication: `Expérience non exigée ; le candidat a ${compter(acquise, 'an')}` };
  }
  if (acquise === null) return { ...base, points: 3, explication: `${compter(requise, 'an')} ${accord(requise, 'demandé')} ; expérience du candidat non renseignée` };
  if (acquise >= requise) return { ...base, points: 10, explication: `${compter(acquise, 'an')} pour ${compter(requise, 'demandé')}` };
  if (acquise >= requise - 1) return { ...base, points: 6, explication: `${compter(acquise, 'an')} pour ${compter(requise, 'demandé')} : légèrement en dessous` };
  return { ...base, points: 1, explication: `${compter(acquise, 'an')} pour ${compter(requise, 'demandé')}` };
}

// Au Maroc, une annonce qui demande « arabe » est satisfaite par la darija, et inversement.
const EQUIVALENTS: Record<string, string[]> = { ar: ['ar', 'darija'], darija: ['darija', 'ar'] };

function languesScore(candidat: ProfilCandidat, poste: PosteAPourvoir): CritereAppariement {
  const base = { code: 'langues', libelle: 'Langues', max: 8 };
  if (poste.langues.length === 0) return { ...base, points: 6, explication: 'Aucune langue exigée' };
  const couvertes = poste.langues.filter((langue) => (EQUIVALENTS[langue] ?? [langue]).some((equivalent) => candidat.langues.includes(equivalent)));
  const manquantes = poste.langues.filter((langue) => !couvertes.includes(langue));
  const points = Math.round((couvertes.length / poste.langues.length) * 8);
  return {
    ...base,
    points,
    explication: manquantes.length === 0 ? `Langues demandées parlées (${poste.langues.join(', ')})` : `${accord(manquantes.length, 'Langue manquante', 'Langues manquantes')} : ${manquantes.join(', ')}`,
  };
}

function salaireScore(candidat: ProfilCandidat, poste: PosteAPourvoir): CritereAppariement {
  const base = { code: 'salaire', libelle: 'Salaire', max: 7 };
  const offert = poste.salaireMax ?? poste.salaireMin;
  if (offert === null || poste.periodeSalaire === null) return { ...base, points: 4, explication: 'Salaire du poste non affiché' };
  if (candidat.salaireAttendu === null) return { ...base, points: 4, explication: 'Prétentions du candidat non renseignées' };
  const offertMensuel = mensualiser(offert, poste.periodeSalaire);
  const attenduMensuel = mensualiser(candidat.salaireAttendu, candidat.periodeSalaire);
  const ratio = offertMensuel / attenduMensuel;
  const dh = (montant: number) => `${Math.round(montant).toLocaleString('fr-FR')} DH/mois`;
  const detail = `${dh(offertMensuel)} proposés pour ${dh(attenduMensuel)} souhaités`;
  if (ratio >= 1) return { ...base, points: 7, explication: detail };
  if (ratio >= 0.9) return { ...base, points: 5, explication: `${detail} (écart inférieur à 10 %)` };
  if (ratio >= 0.75) return { ...base, points: 2, explication: `${detail} (écart important)` };
  return { ...base, points: 0, explication: `${detail} (très en dessous)` };
}

function conditionsScore(candidat: ProfilCandidat, poste: PosteAPourvoir): CritereAppariement {
  const base = { code: 'conditions', libelle: 'Logement et rythme', max: 5 };
  const notes: string[] = [];
  let points = 0;
  if (!poste.logement || poste.logement === 'indifferent' || candidat.logement === 'indifferent' || candidat.logement === poste.logement) {
    points += 3;
    if (poste.logement && poste.logement !== 'indifferent') notes.push(poste.logement === 'loge' ? 'poste logé accepté' : 'poste non logé accepté');
  } else {
    notes.push(poste.logement === 'loge' ? 'poste logé, le candidat préfère rentrer chez lui' : 'poste non logé, le candidat souhaite être logé');
  }
  if (poste.tempsTravail === 'non_precise' || candidat.rythmes.length === 0 || candidat.rythmes.includes(poste.tempsTravail)) {
    points += 2;
  } else {
    notes.push('rythme de travail différent de celui souhaité');
  }
  return { ...base, points, explication: notes.join(' ; ') || 'Conditions compatibles' };
}

/** Code de la compétence « Permis de conduire » du référentiel (voir `COMPETENCES`). */
export const COMPETENCE_PERMIS = 'permis_conduire';

function atoutsScore(candidat: ProfilCandidat, poste: PosteAPourvoir): CritereAppariement {
  const base = { code: 'atouts', libelle: 'Permis et compétences', max: 5 };
  const notes: string[] = [];
  let points = 0;
  // Le permis n'est noté qu'une fois : la case « Permis de conduire » de la fiche et la
  // compétence du même nom repérée dans une annonce désignent la même chose.
  const permisDemande = poste.permis === true || poste.competences.includes(COMPETENCE_PERMIS);
  const permisDetenu = candidat.permis || candidat.competences.includes(COMPETENCE_PERMIS);
  if (permisDemande) {
    if (permisDetenu) {
      points += 3;
      notes.push('permis de conduire');
    } else {
      notes.push('permis demandé, non détenu');
    }
  } else {
    points += 3;
  }
  const demandees = poste.competences.filter((competence) => competence !== COMPETENCE_PERMIS);
  if (demandees.length === 0) {
    points += 2;
  } else {
    const couvertes = demandees.filter((competence) => candidat.competences.includes(competence));
    points += Math.round((couvertes.length / demandees.length) * 2);
    notes.push(`${couvertes.length}/${demandees.length} ${accord(demandees.length, 'compétence demandée', 'compétences demandées')}`);
  }
  return { ...base, points, explication: notes.join(' ; ') || 'Aucune exigence particulière' };
}

/**
 * Un candidat n'est SUGGÉRÉ que s'il fait le métier (identique, pratiqué ou
 * proche) et peut travailler sur place. Sans cette règle, les critères
 * secondaires (disponibilité, langues, salaire…) suffiraient à faire remonter
 * un chauffeur de Tanger pour un poste de femme de ménage à Casablanca.
 */
export const POINTS_METIER_MIN_SUGGESTION = 20;

export function estSuggerable(resultat: ResultatAppariement, scoreMin: number): boolean {
  if (resultat.bloquants.length > 0 || resultat.score < scoreMin) return false;
  const points = (code: string) => resultat.criteres.find((critere) => critere.code === code)?.points ?? 0;
  return points('metier') >= POINTS_METIER_MIN_SUGGESTION && points('lieu') > 0;
}

export function apparier(candidat: ProfilCandidat, poste: PosteAPourvoir, maintenant: Date): ResultatAppariement {
  const criteres = [
    metierScore(candidat, poste),
    lieuScore(candidat, poste),
    disponibiliteScore(candidat, poste, maintenant),
    experienceScore(candidat, poste),
    languesScore(candidat, poste),
    salaireScore(candidat, poste),
    conditionsScore(candidat, poste),
    atoutsScore(candidat, poste),
  ];
  const bloquants: string[] = [];
  if (!candidat.consentementValide) bloquants.push('Consentement du candidat absent ou retiré');
  if (candidat.statut === 'place') bloquants.push('Candidat déjà placé');
  if (candidat.statut === 'indisponible') bloquants.push('Candidat indisponible');
  if (candidat.statut === 'refuse') bloquants.push('Candidature écartée');
  if (!poste.ouvert) bloquants.push('Offre inactive ou non vérifiée');

  const score = Math.max(0, Math.min(100, criteres.reduce((total, critere) => total + critere.points, 0)));
  return {
    score,
    criteres,
    bloquants,
    pointsForts: criteres.filter((c) => c.points >= c.max * 0.8 && c.max >= 7).map((c) => c.explication),
    pointsFaibles: criteres.filter((c) => c.points <= c.max * 0.3).map((c) => c.explication),
  };
}
