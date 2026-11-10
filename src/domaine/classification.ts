/**
 * Classification d'une annonce dans la taxonomie Yallah (3 secteurs, 42 métiers).
 *
 * Méthode : dictionnaire pondéré, explicable ligne à ligne (aucune boîte noire).
 *   - expression forte dans le titre  : 10 points × (1 + 0,25 par mot supplémentaire)
 *   - expression forte dans le corps  :  3 points × (même bonus de longueur)
 *   - expression faible               :  4 points (titre) ou 1 point (corps, 2 au plus),
 *                                        seulement en l'absence d'expression forte au même endroit
 *   - contexte favorable              : +6 points (ex. « ménage » + « villa »)
 *   - métier cité seulement dans le corps : × 0,4 si le titre nomme autre chose,
 *     × 2 si le titre est générique (« Hôtel X recrute plusieurs profils »)
 *   - contexte défavorable            : × 0,4     (ex. « gouvernante » + « hôtel »)
 *   - expression d'exclusion          : × 0,2 dans le titre, × 0,7 dans le corps
 *   - expression contenue dans celle d'un autre métier (« réceptionniste » dans
 *     « réceptionniste spa »)         : × 0,5
 * Confiance = 100 × (1 − e^(−points / 12)). Seuil de classement : 35.
 */
import { cle, cleArabeAllegee, tokeniser } from './texte';
import { METIERS_PREPARES, type CodeSecteur, type MetierPrepare } from './taxonomie';

export type Classement = {
  code: string;
  secteur: CodeSecteur;
  confiance: number;
  points: number;
  /** Expressions de l'annonce qui expliquent le classement. */
  indices: string[];
};

export type ResultatClassification = {
  principal: Classement | null;
  /** Métiers retenus (confiance ≥ seuil), du plus au moins probable, 3 au plus. */
  categories: Classement[];
  secteur: CodeSecteur | null;
};

export const SEUIL_CONFIANCE_DEFAUT = 35;

type Zone = { cle: string; allegee: string };

function zone(texte: string): Zone {
  const c = cle(texte);
  return { cle: c, allegee: cleArabeAllegee(c) };
}

function present(z: Zone, expression: string): boolean {
  return expression.trim().length > 0 && (z.cle.includes(expression) || z.allegee.includes(expression));
}

type Evaluation = { metier: MetierPrepare; points: number; indices: string[]; meilleureCle: string | null; dansTitre: boolean };

const MARQUEURS_FORTS = new Set(tokeniser('plusieurs divers diverses profils postes vacants عدة مناصب وظائف jobs vacancies positions'));
const MARQUEURS_FAIBLES = new Set(tokeniser('recrute recrutement recrutons recherche recherchons offre emploi annonce urgent urgente job hiring مطلوب توظيف'));
const MOTS_NEUTRES = new Set(tokeniser('de du des la le les un une et ou a au aux en pour sur d l h f hf chez hotel riad spa salon societe groupe famille restaurant residence في من عن'));

/** Titre qui ne nomme aucun métier précis : « Recrutement », « Hôtel X recrute plusieurs profils ». */
export function estTitreGenerique(titre: string): boolean {
  const mots = tokeniser(titre);
  if (mots.length === 0) return true;
  if (mots.some((mot) => MARQUEURS_FORTS.has(mot))) return true;
  if (!mots.some((mot) => MARQUEURS_FAIBLES.has(mot))) return false;
  const restants = mots.filter((mot) => !MARQUEURS_FAIBLES.has(mot) && !MOTS_NEUTRES.has(mot) && mot.length > 1);
  return restants.length <= 1;
}

function evaluer(metier: MetierPrepare, titre: Zone, corps: Zone, titreGenerique: boolean): Evaluation | null {
  const indices: string[] = [];
  let points = 0;
  let meilleureCle: string | null = null;

  const forteTitre = metier.clesFortes.find((expression) => present(titre, expression.cle));
  const forteCorps = metier.clesFortes.find((expression) => present(corps, expression.cle));
  if (forteTitre) {
    points += 10 * (1 + 0.25 * (forteTitre.mots - 1));
    indices.push(`titre : « ${forteTitre.brut} »`);
    meilleureCle = forteTitre.cle;
  }
  if (forteCorps) {
    points += 3 * (1 + 0.25 * (forteCorps.mots - 1));
    if (forteCorps.cle !== forteTitre?.cle) indices.push(`texte : « ${forteCorps.brut} »`);
    meilleureCle ??= forteCorps.cle;
  }

  // Une expression faible (« ménage ») ne compte pas si une expression forte
  // (« femme de ménage ») a déjà été trouvée au même endroit : elle en fait partie.
  const faibleTitre = forteTitre ? undefined : metier.clesFaibles.find((expression) => present(titre, expression.cle));
  if (faibleTitre) {
    points += 4;
    indices.push(`titre : « ${faibleTitre.brut} » (indice)`);
  }
  const faiblesCorps = forteCorps ? [] : metier.clesFaibles.filter((expression) => present(corps, expression.cle)).slice(0, 2);
  if (faiblesCorps.length > 0) {
    points += faiblesCorps.length;
    if (!forteTitre) indices.push(`texte : « ${faiblesCorps[0]!.brut} » (indice)`);
  }

  if (points === 0) return null;

  const contexte = metier.clesContextePlus.find((c) => present(titre, c) || present(corps, c));
  if (contexte) {
    points += 6;
    indices.push(`contexte : « ${contexte.trim()} »`);
  }
  if (!forteTitre && !faibleTitre) {
    points *= titreGenerique ? 2 : 0.4;
    if (!titreGenerique) indices.push('métier cité dans le texte seulement, pas dans le titre');
  }
  const contreContexte = metier.clesContexteMoins.find((c) => present(titre, c) || present(corps, c));
  if (contreContexte) {
    points *= 0.4;
    indices.push(`contexte défavorable : « ${contreContexte.trim()} »`);
  }
  const exclusionTitre = metier.clesExclusions.find((c) => present(titre, c));
  const exclusionCorps = exclusionTitre ? undefined : metier.clesExclusions.find((c) => present(corps, c));
  if (exclusionTitre) {
    points *= 0.2;
    indices.push(`exclusion : « ${exclusionTitre.trim()} »`);
  } else if (exclusionCorps) {
    points *= 0.7;
  }

  return { metier, points, indices, meilleureCle, dansTitre: Boolean(forteTitre) };
}

export function confianceDepuisPoints(points: number): number {
  return Math.round(100 * (1 - Math.exp(-points / 12)));
}

export function classer(titre: string, texte = '', options: { confianceMin?: number } = {}): ResultatClassification {
  const seuil = options.confianceMin ?? SEUIL_CONFIANCE_DEFAUT;
  const zoneTitre = zone(titre);
  const zoneCorps = zone(texte);

  const titreGenerique = estTitreGenerique(titre);
  const evaluations = METIERS_PREPARES.map((metier) => evaluer(metier, zoneTitre, zoneCorps, titreGenerique)).filter(
    (evaluation): evaluation is Evaluation => evaluation !== null,
  );

  // « réceptionniste » est contenu dans « réceptionniste spa » : le métier le
  // plus précis l'emporte.
  const reductions = evaluations.map((evaluation) => {
    const propre = evaluation.meilleureCle;
    if (!propre) return 1;
    const contenue = evaluations.some(
      (autre) =>
        autre !== evaluation &&
        autre.meilleureCle !== null &&
        autre.meilleureCle !== propre &&
        autre.dansTitre === evaluation.dansTitre &&
        autre.meilleureCle.includes(propre),
    );
    return contenue ? 0.5 : 1;
  });
  evaluations.forEach((evaluation, index) => {
    evaluation.points *= reductions[index] ?? 1;
  });

  const categories = evaluations
    .map((evaluation) => ({
      code: evaluation.metier.code,
      secteur: evaluation.metier.secteur,
      confiance: confianceDepuisPoints(evaluation.points),
      points: Math.round(evaluation.points * 10) / 10,
      indices: evaluation.indices,
      priorite: evaluation.metier.priorite,
    }))
    .filter((classement) => classement.confiance >= seuil)
    .sort((a, b) => b.points - a.points || b.priorite - a.priorite)
    .slice(0, 3)
    .map(({ priorite: _priorite, ...classement }) => {
      void _priorite;
      return classement;
    });

  const principal = categories[0] ?? null;
  return { principal, categories, secteur: principal?.secteur ?? null };
}
