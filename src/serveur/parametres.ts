/**
 * Paramètres modifiables (table app_settings).
 *
 * La base lit elle-même deux de ces valeurs (durée de validité, délai de
 * revérification) pour calculer le statut effectif : toute écriture est donc
 * validée et bornée ICI, afin que la base et le code voient la même valeur.
 */
import { construireParametres, DESCRIPTIONS_PARAMETRES, PARAMETRES_DEFAUT, type Parametres } from '@/domaine/parametres';
import { journaliser, type Acteur } from './audit';
import { executer, requete, type Executeur } from './db';
import { ErreurMetier } from '@/domaine/erreurs';
import { dateSaisieMaroc } from '@/domaine/fuseau';

type Regle = { type: 'entier'; min: number; max: number; defaut: number } | { type: 'booleen'; defaut: boolean } | { type: 'date'; defaut: string };

const D = PARAMETRES_DEFAUT;

export const REGLES_PARAMETRES: Record<string, Regle> = {
  'perimetre.dateMin': { type: 'date', defaut: D.perimetre.dateMin },
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

export function validerParametre(cle: string, brut: unknown): unknown {
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
  // Le périmètre du cahier des charges est « à partir du 1er janvier 2026 » : on peut le resserrer, pas l'élargir.
  if (date.getTime() < Date.parse(D.perimetre.dateMin)) throw new ErreurParametre('Le périmètre ne peut pas commencer avant le 1er janvier 2026.');
  return date.toISOString();
}

export async function definirParametre(cle: string, brut: unknown, acteur: Acteur, options: { justification?: string } = {}): Promise<void> {
  const valeur = validerParametre(cle, brut);
  if (cle === 'commissions.travailleur_active' && valeur === true && (options.justification ?? '').trim().length < 20) {
    throw new ErreurParametre('Activer la commission côté travailleur exige une justification écrite (20 caractères au moins) : avis juridique, référence, date.');
  }
  const avant = (await lireSurcharges())[cle] ?? REGLES_PARAMETRES[cle]!.defaut;
  await executer(
    `INSERT INTO app_settings (key, value, description, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, $4, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [cle, JSON.stringify(valeur), DESCRIPTIONS_PARAMETRES[cle] ?? '', acteur.id],
  );
  oublierParametres();
  await journaliser({
    acteur,
    action: 'parametre.modification',
    entite: 'parametre',
    id: cle,
    resume: `Paramètre « ${cle} » modifié`,
    changements: { avant, apres: valeur, ...(options.justification ? { justification: options.justification.trim().slice(0, 500) } : {}) },
  });
}
