/**
 * Paramètres modifiables (table app_settings).
 *
 * La base lit elle-même deux de ces valeurs (durée de validité, délai de
 * revérification) pour calculer le statut effectif : toute écriture est donc
 * validée et bornée ICI, afin que la base et le code voient la même valeur.
 */
import { construireParametres, DEBUT_RECHERCHE_PLANCHER, DESCRIPTIONS_PARAMETRES, PARAMETRES_DEFAUT, type Parametres } from '@/domaine/parametres';
import { journaliser, type Acteur } from './audit';
import { executer, requete, transaction, type Executeur } from './db';
import { appliquerDebutRecherche, type BilanPerimetre } from './perimetre';
import { ErreurMetier } from '@/domaine/erreurs';
import { dateSaisieMaroc, jourEcritMaroc } from '@/domaine/fuseau';

/** Une date se règle entre `min` (plancher) et aujourd'hui. */
type Regle = { type: 'entier'; min: number; max: number; defaut: number } | { type: 'booleen'; defaut: boolean } | { type: 'date'; min: string; defaut: string };

const D = PARAMETRES_DEFAUT;

export const CLE_DEBUT_RECHERCHE = 'perimetre.dateMin';

export const REGLES_PARAMETRES: Record<string, Regle> = {
  [CLE_DEBUT_RECHERCHE]: { type: 'date', min: DEBUT_RECHERCHE_PLANCHER, defaut: D.perimetre.dateMin },
  'offres.duree_validite_jours': { type: 'entier', min: 7, max: 180, defaut: D.offres.dureeValiditeJours },
  'offres.delai_reverification_jours': { type: 'entier', min: 3, max: 90, defaut: D.offres.delaiReverificationJours },
  'offres.demi_vie_fraicheur_jours': { type: 'entier', min: 2, max: 60, defaut: D.offres.demiVieFraicheurJours },
  'salaires.seuil_bas_mensuel': { type: 'entier', min: 500, max: 10_000, defaut: D.salaires.seuilBasMensuel },
  'salaires.seuil_eleve_mensuel': { type: 'entier', min: 5000, max: 200_000, defaut: D.salaires.seuilEleveMensuel },
  'salaires.plancher_domestique_mensuel': { type: 'entier', min: 500, max: 10_000, defaut: D.salaires.plancherDomestiqueMensuel },
  'commissions.travailleur_active': { type: 'booleen', defaut: D.commissions.travailleurActive },
  'candidats.conservation_mois': { type: 'entier', min: 1, max: 60, defaut: D.candidats.conservationMois },
};

export class ErreurParametre extends ErreurMetier {}

type Memo = { valeur: Parametres; lueA: number } | null;
const etat: { memo: Memo } = ((globalThis as { __ysParam?: { memo: Memo } }).__ysParam ??= { memo: null });

export function oublierParametres(): void {
  etat.memo = null;
}

export async function lireSurcharges(tx?: Executeur): Promise<Record<string, unknown>> {
  const lignes = await requete<{ key: string; value: unknown }>(`SELECT key, value FROM app_settings`, [], tx);
  return Object.fromEntries(lignes.map((ligne) => [ligne.key, ligne.value]));
}

/** Paramètres effectifs. Mémorisés 15 secondes par processus. */
export async function chargerParametres(tx?: Executeur): Promise<Parametres> {
  if (!tx && etat.memo && Date.now() - etat.memo.lueA < 15_000) return etat.memo.valeur;
  const valeur = construireParametres(await lireSurcharges(tx));
  if (!tx) etat.memo = { valeur, lueA: Date.now() };
  return valeur;
}

export type LigneParametre = { cle: string; description: string; regle: Regle; valeur: unknown; personnalise: boolean };

export async function listerParametres(): Promise<LigneParametre[]> {
  const surcharges = await lireSurcharges();
  return Object.entries(REGLES_PARAMETRES).map(([cle, regle]) => ({
    cle,
    description: DESCRIPTIONS_PARAMETRES[cle] ?? cle,
    regle,
    valeur: cle in surcharges ? surcharges[cle] : regle.defaut,
    personnalise: cle in surcharges,
  }));
}

export function validerParametre(cle: string, brut: unknown, maintenant: Date = new Date()): unknown {
  const regle = Object.hasOwn(REGLES_PARAMETRES, cle) ? REGLES_PARAMETRES[cle] : undefined;
  if (!regle) throw new ErreurParametre(`Paramètre inconnu : ${cle.slice(0, 60)}`);
  if (regle.type === 'entier') {
    // « 10 000 » (avec espace) est accepté ; « 12abc » ou « 2,5 » ne le sont pas.
    const saisi = typeof brut === 'number' ? String(brut) : String(brut ?? '').replace(/[\s\u00a0\u202f]/g, '');
    const n = /^\d{1,9}$/.test(saisi) ? Number(saisi) : Number.NaN;
    if (!Number.isInteger(n) || n < regle.min || n > regle.max) {
      throw new ErreurParametre(`Valeur attendue : un nombre entier entre ${regle.min.toLocaleString('fr-FR')} et ${regle.max.toLocaleString('fr-FR')}.`);
    }
    return n;
  }
  if (regle.type === 'booleen') {
    if (brut === true || brut === 'true' || brut === 'on' || brut === '1') return true;
    if (brut === false || brut === 'false' || brut === '' || brut === '0' || brut === null || brut === undefined) return false;
    throw new ErreurParametre('Valeur attendue : oui ou non.');
  }
  // Un jour saisi (« 2026-03-01 ») commence à 00 h 00, heure de Casablanca.
  const date = dateSaisieMaroc(String(brut ?? ''), 'debut');
  if (!date) throw new ErreurParametre('Date invalide.');
  // Le cahier des charges fixe un plancher (1er janvier 2026) : la recherche peut commencer plus tard, jamais plus tôt.
  if (date.getTime() < Date.parse(regle.min)) throw new ErreurParametre(`La recherche ne peut pas commencer avant le ${jourEcritMaroc(new Date(regle.min))}.`);
  // Un début dans le futur écarterait toutes les offres, y compris celles d'aujourd'hui : c'est toujours une erreur de saisie.
  if (date.getTime() > maintenant.getTime()) throw new ErreurParametre('La recherche ne peut pas commencer dans le futur : choisissez aujourd’hui ou une date passée.');
  return date.toISOString();
}

export type ResultatParametre = {
  /** Renseigné quand le début de la recherche a changé : offres écartées et reprises aussitôt. */
  offres: BilanPerimetre | null;
};

export async function definirParametre(cle: string, brut: unknown, acteur: Acteur, options: { justification?: string; maintenant?: Date } = {}): Promise<ResultatParametre> {
  const maintenant = options.maintenant ?? new Date();
  const valeur = validerParametre(cle, brut, maintenant);
  if (cle === 'commissions.travailleur_active' && valeur === true && (options.justification ?? '').trim().length < 20) {
    throw new ErreurParametre('Activer la commission côté travailleur exige une justification écrite (20 caractères au moins) : avis juridique, référence, date.');
  }
  // Une seule transaction : le réglage, son effet sur les offres enregistrées et la trace au journal sont écrits ensemble ou pas du tout.
  const resultat = await transaction(async (tx) => {
    const avant = (await lireSurcharges(tx))[cle] ?? REGLES_PARAMETRES[cle]!.defaut;
    await executer(
      `INSERT INTO app_settings (key, value, description, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, $4, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [cle, JSON.stringify(valeur), DESCRIPTIONS_PARAMETRES[cle] ?? '', acteur.id],
      tx,
    );
    await journaliser(
      {
        acteur,
        action: 'parametre.modification',
        entite: 'parametre',
        id: cle,
        resume: `Paramètre « ${cle} » modifié`,
        changements: { avant, apres: valeur, ...(options.justification ? { justification: options.justification.trim().slice(0, 500) } : {}) },
      },
      tx,
    );
    // Le début de la recherche s'applique aussitôt aux offres déjà enregistrées.
    const offres = cle === CLE_DEBUT_RECHERCHE ? await appliquerDebutRecherche(await chargerParametres(tx), { maintenant, acteur, tx }) : null;
    return { offres };
  });
  oublierParametres();
  return resultat;
}

/**
 * Aligne les offres enregistrées sur le début de la recherche en vigueur
 * (relu en base à l'instant, sans passer par la copie mémorisée). Sans effet
 * si tout est déjà aligné. Appelé au démarrage et à chaque maintenance : c'est
 * ce qui applique une nouvelle valeur par défaut après une mise à jour.
 */
export async function alignerOffresSurDebutRecherche(options: { maintenant?: Date; acteur?: Acteur } = {}): Promise<BilanPerimetre & { debut: string }> {
  return transaction(async (tx) => {
    const parametres = await chargerParametres(tx);
    return { ...(await appliquerDebutRecherche(parametres, { ...options, tx })), debut: parametres.perimetre.dateMin };
  });
}
