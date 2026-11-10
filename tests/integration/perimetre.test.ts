/**
 * Début de la recherche (paramètre « perimetre.dateMin ») : valeur à
 * l'installation, réglage par l'administrateur, et application aux offres déjà
 * enregistrées — écartées, reprises, relèves entre doublons.
 *
 * Les autres fichiers épinglent ce début au 1er janvier 2026 (tests/parametres.ts) ;
 * ici, c'est lui qu'on fait bouger. Les assertions portent sur l'état ENREGISTRÉ
 * des offres (colonnes status / status_reason), qui ne dépend pas de l'horloge ;
 * la maintenance complète, qui lit l'heure de la base, n'est lancée qu'à la fin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEBUT_RECHERCHE_DEFAUT } from '@/domaine/parametres';
import { executer, requete, uneLigne } from '@/serveur/db';
import { ageDansLaPeriode, chargerJeuDemo } from '@/serveur/demo';
import { apercuSaisie, importerSaisie } from '@/serveur/ingestion';
import { executerMaintenance } from '@/serveur/maintenance';
import { archiverOffre, corrigerOffre, dissocierDoublon, lierDoublon, offreParId, offresAVerifier, sensRattachement, verifierOffre } from '@/serveur/offres';
import { alignerOffresSurDebutRecherche, chargerParametres, definirParametre, listerParametres, oublierParametres, validerParametre } from '@/serveur/parametres';
import { phraseBilanPerimetre } from '@/serveur/perimetre';
import { DEBUT_RECHERCHE_TESTS } from '../parametres';
import { fermerBase, MAINTENANT, preparerBase, type Monde } from './outils';

const CLE = 'perimetre.dateMin';
const LUNDI = '2026-11-09T00:00:00.000Z';

type Etat = { reference: string; status: string; status_reason: string; verification_status: string; requires_human_review: boolean; duplicate_of_id: string | null; published_at: Date | null };
type Enregistree = { id: string; reference: string };

let monde: Monde;
const offres: Record<string, Enregistree> = {};

const etat = async (offre: Enregistree): Promise<Etat> =>
  (await uneLigne<Etat>(`SELECT reference, status, status_reason, verification_status, requires_human_review, duplicate_of_id, published_at FROM job_offers WHERE id = $1`, [offre.id]))!;

const versions = (offre: Enregistree) =>
  requete<{ origin: string; changes: Record<string, [unknown, unknown]>; user_id: string | null }>(`SELECT origin, changes, user_id FROM job_offer_versions WHERE job_offer_id = $1 ORDER BY id`, [offre.id]);

const audits = (action: string) =>
  requete<{ user_id: string | null; summary: string; changes: Record<string, unknown> }>(`SELECT actor_user_id AS user_id, summary, changes FROM audit_logs WHERE action = $1 ORDER BY id`, [action]);

const actives = async (): Promise<string[]> => (await requete<{ reference: string }>(`SELECT reference FROM job_offers WHERE status = 'actif' AND NOT is_demo ORDER BY reference`)).map((ligne) => ligne.reference);

async function importer(nom: string, texte: string, datePublication: string | null, complement: { employeur?: string; url?: string } = {}) {
  const resultat = await importerSaisie({ texte, origine: 'site', ...(datePublication ? { datePublication } : {}), ...complement }, monde.acteurCourtier, MAINTENANT);
  if (resultat.type === 'rejet') throw new Error(`${nom} : offre attendue, annonce refusée (${resultat.motif})`);
  offres[nom] = { id: resultat.id, reference: resultat.reference };
  return resultat;
}

const TEXTE_NOUNOU = 'Nounou à Tanger\nFamille à Tanger cherche une nounou expérimentée, temps plein, logée.';
const TEXTE_GOUVERNANTE = 'Gouvernante d’étage\nHôtel à Agadir recrute une gouvernante d’étage expérimentée.';
const TEXTE_RIAD = 'Réceptionniste H/F\nLe Riad Exemple, médina de Marrakech, recrute un(e) réceptionniste. Français et anglais exigés. CDD saisonnier.';

beforeAll(async () => {
  monde = await preparerBase();
  // Début de la recherche épinglé au 1er janvier 2026 : toutes ces annonces de début novembre entrent dans la période.
  await importer('nounou', TEXTE_NOUNOU, '2026-11-05', { employeur: 'Famille Exemple Tanger', url: 'https://annonces.example/o/201' });
  await importer('gouvernante', TEXTE_GOUVERNANTE, '2026-11-09', { employeur: 'Hôtel Exemple Agadir', url: 'https://annonces.example/o/202' });
  await importer('cuisiniere', 'Cuisinière à domicile\nFamille à Casablanca cherche cuisinière à domicile, cuisine marocaine. Salaire 5000 dh par mois.', '2026-11-08', { employeur: 'Famille Exemple Anfa' });
  await importer('sansDate', 'Baby-sitter à Mohammedia\nFamille à Mohammedia cherche une baby-sitter pour les sorties d’école, du lundi au vendredi.', null, { employeur: 'Famille Exemple Mohammedia' });
  await importer('risquee', 'Femme de ménage à Casablanca\nFrais de dossier 300 dh à payer avant l’entretien. Salaire 4000 dh.', '2026-11-06');
  await importer('jardinier', 'Jardinier pour villa à Bouskoura\nNous cherchons un jardinier sérieux pour notre villa. 3 jours par semaine.', '2026-11-04', { employeur: 'Famille Exemple Bouskoura' });
  await importer('magasinier', 'Magasinier à Casablanca\nSociété de logistique à Casablanca recrute un magasinier.', '2026-11-07', { employeur: 'Logistique Exemple' });
  // La même annonce publiée trois fois : le 6, puis republiée le 9 et le 10 sur d'autres sites.
  await importer('riad6', TEXTE_RIAD, '2026-11-06', { employeur: 'Riad Exemple', url: 'https://annonces.example/o/101' });
  await importer('riad9', TEXTE_RIAD, '2026-11-09', { employeur: 'Riad Exemple', url: 'https://autre-site.example/o/55' });
  await importer('riad10', TEXTE_RIAD, '2026-11-10', { employeur: 'Riad Exemple', url: 'https://troisieme-site.example/o/9' });
  // Décisions humaines antérieures : une offre vérifiée, une offre archivée à la main.
  await verifierOffre(offres.cuisiniere!.id, monde.acteurCourtier, 'Employeur joint par téléphone', MAINTENANT);
  await archiverOffre(offres.jardinier!.id, 'archivage_manuel', monde.acteurCourtier, null, MAINTENANT);
});
afterAll(fermerBase);

describe('situation de départ (recherche depuis le 1er janvier 2026)', () => {
  it('retient les annonces de début novembre et rattache les republications à la première annonce', async () => {
    expect((await chargerParametres()).perimetre.dateMin).toBe(DEBUT_RECHERCHE_TESTS);
    expect(await etat(offres.nounou!)).toMatchObject({ status: 'actif', status_reason: 'aucun' });
    expect(await etat(offres.cuisiniere!)).toMatchObject({ status: 'actif', verification_status: 'verifiee' });
    expect(await etat(offres.sansDate!)).toMatchObject({ status: 'douteux', status_reason: 'date_inconnue' });
    expect(await etat(offres.risquee!)).toMatchObject({ status: 'douteux', status_reason: 'risque_eleve', requires_human_review: true });
    expect(await etat(offres.jardinier!)).toMatchObject({ status: 'archive', status_reason: 'archivage_manuel' });
    expect(await etat(offres.magasinier!)).toMatchObject({ status: 'actif', verification_status: 'a_verifier', requires_human_review: true });
    expect(await etat(offres.riad6!)).toMatchObject({ status: 'actif', duplicate_of_id: null });
    expect(await etat(offres.riad9!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.riad6!.id });
    expect(await etat(offres.riad10!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.riad6!.id });
  });
});

describe('valeur à l’installation : lundi 9 novembre 2026', () => {
  it('s’applique tant qu’aucune date n’a été enregistrée dans les paramètres', async () => {
    // Une installation qui n'a jamais réglé cette date (cas d'une mise à jour de l'outil).
    await executer(`DELETE FROM app_settings WHERE key = $1`, [CLE]);
    oublierParametres();
    const parametres = await chargerParametres();
    expect(parametres.perimetre.dateMin).toBe(DEBUT_RECHERCHE_DEFAUT);
    expect(new Date(parametres.perimetre.dateMin).toISOString()).toBe(LUNDI);
    const ligne = (await listerParametres()).find((l) => l.cle === CLE)!;
    expect(ligne).toMatchObject({ personnalise: false, valeur: DEBUT_RECHERCHE_DEFAUT, regle: { type: 'date', defaut: DEBUT_RECHERCHE_DEFAUT } });
    expect(ligne.description).toMatch(/Début de la recherche/);
  });

  it('écarte les offres enregistrées publiées avant ce lundi, sans rien supprimer', async () => {
    const total = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offers`))!.n;
    const bilan = await alignerOffresSurDebutRecherche({ maintenant: MAINTENANT });
    // Écartées : nounou (5 nov.), cuisinière (8 nov.), annonce à risque (6 nov.), magasinier (7 nov.), première annonce du riad (6 nov.).
    // Reprise : la republication du riad datée du 9, qui prend la place de l'annonce du 6.
    expect(bilan).toEqual({ ecartees: 5, reprises: 1, debut: DEBUT_RECHERCHE_DEFAUT });
    expect(phraseBilanPerimetre(bilan)).toBe('5 offres écartées, 1 offre reprise');
    expect((await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offers`))!.n).toBe(total);

    for (const nom of ['nounou', 'cuisiniere', 'risquee', 'magasinier']) {
      expect(await etat(offres[nom]!), nom).toMatchObject({ status: 'archive', status_reason: 'hors_perimetre_date', requires_human_review: false, duplicate_of_id: null });
    }
    // Ce qu'un courtier avait constaté reste acquis : l'offre vérifiée le reste, les revues en attente aussi.
    expect((await etat(offres.cuisiniere!)).verification_status).toBe('verifiee');
    expect((await etat(offres.risquee!)).verification_status).toBe('a_verifier');
    expect((await etat(offres.magasinier!)).verification_status).toBe('a_verifier');
    // Dans la période, sans date, ou déjà archivée pour une autre raison : rien ne change.
    expect(await etat(offres.gouvernante!)).toMatchObject({ status: 'actif', status_reason: 'aucun' });
    expect(await etat(offres.sansDate!)).toMatchObject({ status: 'douteux', status_reason: 'date_inconnue', requires_human_review: true });
    expect(await etat(offres.jardinier!)).toMatchObject({ status: 'archive', status_reason: 'archivage_manuel' });
    // Seules les offres de la période restent actives ; la file de revue ne montre plus les offres écartées.
    expect(await actives()).toEqual([offres.gouvernante!.reference, offres.riad9!.reference].sort());
    expect((await offresAVerifier()).map((o) => o.reference)).toEqual([offres.sansDate!.reference]);
  });

  it('garde visible l’annonce republiée dans la période : elle devient l’offre principale', async () => {
    expect(await etat(offres.riad9!)).toMatchObject({ status: 'actif', status_reason: 'aucun', verification_status: 'non_requise', requires_human_review: false, duplicate_of_id: null });
    expect(await etat(offres.riad6!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.riad9!.id });
    // Jamais de « doublon d'un doublon » : la troisième publication suit la nouvelle offre principale.
    expect(await etat(offres.riad10!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.riad9!.id });
    expect((await versions(offres.riad9!)).at(-1)).toMatchObject({
      origin: 'fusion_doublon',
      changes: { duplicate_of: [offres.riad6!.reference, null], status: ['archive', 'actif'], status_reason: ['doublon', 'aucun'] },
    });
    const ancienne = await versions(offres.riad6!);
    expect(ancienne.at(-2)).toMatchObject({ origin: 'maintenance', changes: { status: ['actif', 'archive'], status_reason: ['aucun', 'hors_perimetre_date'] } });
    expect(ancienne.at(-1)).toMatchObject({ origin: 'fusion_doublon', changes: { duplicate_of: [null, offres.riad9!.reference], status_reason: ['hors_perimetre_date', 'doublon'] } });
  });

  it('laisse une ligne d’historique par offre et une trace au journal', async () => {
    expect((await versions(offres.nounou!)).at(-1)).toMatchObject({ origin: 'maintenance', user_id: null, changes: { status: ['actif', 'archive'], status_reason: ['aucun', 'hors_perimetre_date'] } });
    expect((await versions(offres.risquee!)).at(-1)).toMatchObject({ origin: 'maintenance', changes: { status: ['douteux', 'archive'], status_reason: ['risque_eleve', 'hors_perimetre_date'] } });
    const traces = await audits('perimetre.application');
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ user_id: null, summary: 'Début de la recherche au 9 novembre 2026 : 5 offres écartées, 1 offre reprise', changes: { debut: LUNDI, ecartees: 5, reprises: 1 } });
  });

  it('est sans effet la deuxième fois', async () => {
    const lignes = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offer_versions`))!.n;
    expect(await alignerOffresSurDebutRecherche({ maintenant: MAINTENANT })).toEqual({ ecartees: 0, reprises: 0, debut: DEBUT_RECHERCHE_DEFAUT });
    expect((await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offer_versions`))!.n).toBe(lignes);
    expect(await audits('perimetre.application')).toHaveLength(1);
  });
});

describe('réglage par l’administrateur', () => {
  it('n’accepte qu’une date comprise entre le 1er janvier 2026 et aujourd’hui', () => {
    expect(validerParametre(CLE, '2026-11-09', MAINTENANT)).toBe(LUNDI);
    // Aujourd'hui est accepté (la recherche commence ce matin à 00 h 00), demain ne l'est pas.
    expect(validerParametre(CLE, '2026-11-10', MAINTENANT)).toBe('2026-11-10T00:00:00.000Z');
    expect(() => validerParametre(CLE, '2026-11-11', MAINTENANT)).toThrow(/ne peut pas commencer dans le futur/);
    expect(() => validerParametre(CLE, '2027-01-01', MAINTENANT)).toThrow(/ne peut pas commencer dans le futur/);
    expect(validerParametre(CLE, '2026-01-01', MAINTENANT)).toBe('2025-12-31T23:00:00.000Z');
    expect(() => validerParametre(CLE, '2025-12-31', MAINTENANT)).toThrow('La recherche ne peut pas commencer avant le 1er janvier 2026.');
    for (const invalide of ['09/11/2026', 'lundi', '', '2026-02-30', null, undefined]) expect(() => validerParametre(CLE, invalide, MAINTENANT)).toThrow('Date invalide.');
  });

  it('refuse une date invalide sans rien modifier', async () => {
    await expect(definirParametre(CLE, '2026-11-11', monde.acteurAdmin, { maintenant: MAINTENANT })).rejects.toThrow(/dans le futur/);
    await expect(definirParametre(CLE, '2025-06-01', monde.acteurAdmin, { maintenant: MAINTENANT })).rejects.toThrow(/avant le 1er janvier 2026/);
    expect((await chargerParametres()).perimetre.dateMin).toBe(DEBUT_RECHERCHE_DEFAUT);
    expect(await audits('parametre.modification')).toHaveLength(0);
    expect(await etat(offres.nounou!)).toMatchObject({ status: 'archive', status_reason: 'hors_perimetre_date' });
  });

  it('reculer la date fait revenir les offres écartées, réévaluées comme à l’enregistrement', async () => {
    const resultat = await definirParametre(CLE, '2026-01-01', monde.acteurAdmin, { maintenant: MAINTENANT });
    // Reprises : nounou, cuisinière, annonce à risque, magasinier. L'ancienne annonce du riad reste le doublon de la republication.
    expect(resultat).toEqual({ offres: { ecartees: 0, reprises: 4 } });
    expect((await chargerParametres()).perimetre.dateMin).toBe('2025-12-31T23:00:00.000Z');

    expect(await etat(offres.nounou!)).toMatchObject({ status: 'actif', status_reason: 'aucun', verification_status: 'non_requise', requires_human_review: false });
    // L'offre vérifiée par un courtier revient vérifiée, sans repasser par la file de revue.
    expect(await etat(offres.cuisiniere!)).toMatchObject({ status: 'actif', status_reason: 'aucun', verification_status: 'verifiee', requires_human_review: false });
    // Les garde-fous d'origine sont rétablis : risque élevé, métier non classé.
    expect(await etat(offres.risquee!)).toMatchObject({ status: 'douteux', status_reason: 'risque_eleve', verification_status: 'a_verifier', requires_human_review: true });
    expect(await etat(offres.magasinier!)).toMatchObject({ status: 'actif', status_reason: 'aucun', verification_status: 'a_verifier', requires_human_review: true });
    expect(await etat(offres.jardinier!)).toMatchObject({ status: 'archive', status_reason: 'archivage_manuel' });
    // Un seul exemplaire actif de l'annonce du riad, quoi qu'il arrive.
    expect(await etat(offres.riad9!)).toMatchObject({ status: 'actif', duplicate_of_id: null });
    expect(await etat(offres.riad6!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.riad9!.id });
    expect(await actives()).toEqual([offres.nounou!, offres.gouvernante!, offres.cuisiniere!, offres.magasinier!, offres.riad9!].map((o) => o.reference).sort());

    expect((await versions(offres.nounou!)).at(-1)).toMatchObject({ origin: 'maintenance', user_id: monde.admin.id, changes: { status: ['archive', 'actif'], status_reason: ['hors_perimetre_date', 'aucun'] } });
    expect((await versions(offres.risquee!)).at(-1)).toMatchObject({ origin: 'maintenance', changes: { status: ['archive', 'douteux'], status_reason: ['hors_perimetre_date', 'risque_eleve'] } });
    // Le réglage et son effet sont tracés au nom de l'administrateur.
    expect((await audits('parametre.modification')).at(-1)).toMatchObject({ user_id: monde.admin.id, changes: { avant: DEBUT_RECHERCHE_DEFAUT, apres: '2025-12-31T23:00:00.000Z' } });
    expect((await audits('perimetre.application')).at(-1)).toMatchObject({ user_id: monde.admin.id, changes: { debut: '2025-12-31T23:00:00.000Z', ecartees: 0, reprises: 4 } });
  });

  it('avancer la date écarte de nouveau les offres plus anciennes, et le réglage reste en place', async () => {
    const resultat = await definirParametre(CLE, '2026-11-09', monde.acteurAdmin, { maintenant: MAINTENANT });
    expect(resultat).toEqual({ offres: { ecartees: 4, reprises: 0 } });
    expect((await chargerParametres()).perimetre.dateMin).toBe(LUNDI);
    expect((await listerParametres()).find((l) => l.cle === CLE)).toMatchObject({ personnalise: true, valeur: LUNDI });
    expect(await actives()).toEqual([offres.gouvernante!.reference, offres.riad9!.reference].sort());
    expect((await etat(offres.cuisiniere!)).verification_status).toBe('verifiee');
    // Enregistrer la même date une seconde fois ne touche à aucune offre.
    expect(await definirParametre(CLE, '2026-11-09', monde.acteurAdmin, { maintenant: MAINTENANT })).toEqual({ offres: { ecartees: 0, reprises: 0 } });
  });

  it('un autre réglage ne touche pas aux offres', async () => {
    expect(await definirParametre('offres.duree_validite_jours', '60', monde.acteurAdmin, { maintenant: MAINTENANT })).toEqual({ offres: null });
    await definirParametre('offres.duree_validite_jours', '45', monde.acteurAdmin, { maintenant: MAINTENANT });
  });
});

describe('nouvelles annonces, recherche depuis le lundi 9 novembre 2026', () => {
  it('archive d’office une annonce publiée la veille et retient celle du lundi', async () => {
    const texte = 'Chauffeur privé à Rabat\nFamille à Rabat, Hay Riad, recrute un chauffeur privé expérimenté, permis B.';
    const apercu = await apercuSaisie({ texte, origine: 'site', employeur: 'Famille Exemple Hay Riad', datePublication: '2026-11-08' }, MAINTENANT);
    expect(apercu.analyse).toMatchObject({ type: 'offre', offre: { status: 'archive', status_reason: 'hors_perimetre_date', requires_human_review: false } });
    const dimanche = await importer('chauffeur', texte, '2026-11-08', { employeur: 'Famille Exemple Hay Riad' });
    expect(dimanche).toMatchObject({ type: 'nouvelle', statut: 'archive', motif: 'hors_perimetre_date' });
    const lundi = await importer('coiffeuse', 'Coiffeuse confirmée à Rabat\nSalon de coiffure à Rabat, quartier Agdal, cherche une coiffeuse confirmée.', '2026-11-09', { employeur: 'Salon Exemple Agdal' });
    expect(lundi).toMatchObject({ type: 'nouvelle', statut: 'actif', motif: 'aucun' });
  });

  it('ne masque pas une annonce de la période derrière la même annonce publiée plus tôt', async () => {
    // La nounou du 5 novembre est écartée ; la même annonce est republiée le 10 sur un autre site.
    const apercu = await apercuSaisie({ texte: TEXTE_NOUNOU, origine: 'site', employeur: 'Famille Exemple Tanger', url: 'https://autre-site.example/o/77', datePublication: '2026-11-10' }, MAINTENANT);
    expect(apercu.doublons[0]).toMatchObject({ id: offres.nounou!.id, decision: 'doublon', horsPeriode: true });
    const resultat = await importer('nounou10', TEXTE_NOUNOU, '2026-11-10', { employeur: 'Famille Exemple Tanger', url: 'https://autre-site.example/o/77' });
    expect(resultat).toMatchObject({ type: 'nouvelle', statut: 'actif', motif: 'aucun', remplace: offres.nounou!, doublonProbable: null });
    expect(await etat(offres.nounou10!)).toMatchObject({ status: 'actif', verification_status: 'non_requise', requires_human_review: false, duplicate_of_id: null });
    // C'est l'ancienne annonce qui est rattachée à la nouvelle, et non l'inverse.
    expect(await etat(offres.nounou!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.nounou10!.id });
    expect((await versions(offres.nounou!)).at(-1)).toMatchObject({
      origin: 'fusion_doublon', user_id: monde.courtier.id, changes: { duplicate_of: [null, offres.nounou10!.reference], status_reason: ['hors_perimetre_date', 'doublon'] },
    });
    // L'aperçu d'une troisième publication ne cite l'offre principale qu'une fois, bien qu'elle et son ancien exemplaire lui ressemblent tous deux.
    const troisieme = await apercuSaisie({ texte: TEXTE_NOUNOU, origine: 'site', employeur: 'Famille Exemple Tanger', url: 'https://troisieme-site.example/o/80', datePublication: '2026-11-10' }, MAINTENANT);
    expect(troisieme.doublons.map((doublon) => doublon.id)).toEqual([offres.nounou10!.id]);
    expect(troisieme.doublons[0]).toMatchObject({ decision: 'doublon', horsPeriode: false });
    // Et l'aperçu de l'annonce déjà enregistrée ne la présente pas comme son propre doublon.
    const connue = await apercuSaisie({ texte: TEXTE_NOUNOU, origine: 'site', employeur: 'Famille Exemple Tanger', url: 'https://autre-site.example/o/77', datePublication: '2026-11-10' }, MAINTENANT);
    expect(connue.dejaConnue).toEqual(offres.nounou10);
    expect(connue.doublons).toEqual([]);
  });

  it('rattache à l’offre de la période une publication plus ancienne de la même annonce', async () => {
    const resultat = await importer('gouvernante7', TEXTE_GOUVERNANTE, '2026-11-07', { employeur: 'Hôtel Exemple Agadir', url: 'https://autre-site.example/o/78' });
    expect(resultat).toMatchObject({ type: 'doublon', statut: 'archive', motif: 'doublon', doublonDe: { id: offres.gouvernante!.id } });
    expect(await etat(offres.gouvernante!)).toMatchObject({ status: 'actif', duplicate_of_id: null });
  });

  it('ne signale pas une simple ressemblance avec une annonce écartée', async () => {
    // Même titre et même ville que l'annonce à risque du 6 novembre (écartée), sans employeur : ressemblance probable, pas certaine.
    const texte = 'Femme de ménage à Casablanca\nFamille cherche une femme de ménage sérieuse, trois matinées par semaine, quartier Maârif.';
    const apercu = await apercuSaisie({ texte, origine: 'site', datePublication: '2026-11-10' }, MAINTENANT);
    expect(apercu.doublons).toEqual([expect.objectContaining({ id: offres.risquee!.id, decision: 'probable', horsPeriode: true })]);
    const resultat = await importer('menage', texte, '2026-11-10');
    expect(resultat).toMatchObject({ type: 'nouvelle', statut: 'actif', doublonProbable: null, remplace: null });
    expect(await etat(offres.menage!)).toMatchObject({ verification_status: 'non_requise', requires_human_review: false });
    expect(await uneLigne(`SELECT 1 FROM job_offers WHERE id = $1 AND score_details ? 'doublonProbable'`, [offres.menage!.id])).toBeNull();
    expect(await etat(offres.risquee!)).toMatchObject({ status: 'archive', status_reason: 'hors_perimetre_date', duplicate_of_id: null });
  });
});

describe('modération, recherche depuis le lundi 9 novembre 2026', () => {
  it('refuse de rouvrir à la main une offre publiée avant le début de la recherche', async () => {
    await expect(verifierOffre(offres.cuisiniere!.id, monde.acteurCourtier, 'Employeur joint de nouveau', MAINTENANT)).rejects.toThrow(
      'Offre publiée avant le début de la recherche (9 novembre 2026) : hors périmètre, elle reste archivée.',
    );
    expect(await etat(offres.cuisiniere!)).toMatchObject({ status: 'archive', status_reason: 'hors_perimetre_date' });
  });

  it('reprend une offre écartée dès que sa date, mal relevée, est rectifiée', async () => {
    expect(await corrigerOffre(offres.chauffeur!.id, { datePublication: '2026-11-09' }, monde.acteurCourtier, MAINTENANT)).toEqual({ statut: 'actif', motif: 'aucun' });
    expect(await etat(offres.chauffeur!)).toMatchObject({ status: 'actif', status_reason: 'aucun' });
    // Et l'inverse : une date rectifiée vers la veille du lundi écarte l'offre.
    expect(await corrigerOffre(offres.coiffeuse!.id, { datePublication: '2026-11-08' }, monde.acteurCourtier, MAINTENANT)).toEqual({ statut: 'archive', motif: 'hors_perimetre_date' });
  });

  it('une offre principale dont la date rectifiée précède la recherche cède la place à sa republication', async () => {
    await importer('gouvernante10', TEXTE_GOUVERNANTE, '2026-11-10', { employeur: 'Hôtel Exemple Agadir', url: 'https://troisieme-site.example/o/79' });
    expect(await etat(offres.gouvernante10!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.gouvernante!.id });
    expect(await corrigerOffre(offres.gouvernante!.id, { datePublication: '2026-11-03' }, monde.acteurCourtier, MAINTENANT)).toEqual({ statut: 'archive', motif: 'hors_perimetre_date' });
    expect(await etat(offres.gouvernante10!)).toMatchObject({ status: 'actif', status_reason: 'aucun', duplicate_of_id: null });
    expect(await etat(offres.gouvernante!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.gouvernante10!.id });
    // La publication du 7 novembre, déjà rattachée, suit la nouvelle offre principale.
    expect(await etat(offres.gouvernante7!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.gouvernante10!.id });
  });

  it('dissocier un doublon publié avant la recherche le laisse archivé, pour ce motif', async () => {
    expect(await dissocierDoublon(offres.riad6!.id, monde.acteurCourtier, MAINTENANT)).toEqual({ statut: 'archive' });
    expect(await etat(offres.riad6!)).toMatchObject({ status: 'archive', status_reason: 'hors_perimetre_date', requires_human_review: false, duplicate_of_id: null });
    // Un doublon publié dans la période redevient « à vérifier », comme avant.
    expect(await dissocierDoublon(offres.riad10!.id, monde.acteurCourtier, MAINTENANT)).toEqual({ statut: 'douteux' });
    expect(await etat(offres.riad10!)).toMatchObject({ status: 'douteux', verification_status: 'a_verifier', requires_human_review: true, duplicate_of_id: null });
  });

  it('rattacher à la main une offre de la période à une annonce écartée inverse le rattachement', async () => {
    // Le courtier confirme que l'annonce du 9 et celle du 6 (écartée) sont la même : c'est celle du 9 qui reste l'offre principale.
    // La fiche l'annonce avant la confirmation, dans les mêmes termes que ce qui sera fait.
    const [du9, du6, du10] = await Promise.all([offreParId(offres.riad9!.id), offreParId(offres.riad6!.id), offreParId(offres.riad10!.id)]);
    expect(await sensRattachement(du9!, offres.riad6!.id, MAINTENANT)).toBe('celle-ci');
    expect(await sensRattachement(du9!, offres.riad10!.id, MAINTENANT)).toBe('autre');
    expect(await sensRattachement(du6!, offres.riad9!.id, MAINTENANT)).toBe('autre');
    expect(await sensRattachement(du10!, 'pas-un-identifiant', MAINTENANT)).toBe('autre');
    expect(await lierDoublon(offres.riad9!.id, offres.riad6!.id, monde.acteurCourtier, MAINTENANT)).toEqual({ principale: 'celle-ci', reference: offres.riad6!.reference });
    expect(await etat(offres.riad9!)).toMatchObject({ status: 'actif', status_reason: 'aucun', duplicate_of_id: null });
    expect(await etat(offres.riad6!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.riad9!.id });
    expect((await audits('offre.doublon_lie')).at(-1)!.summary).toBe(`${offres.riad6!.reference} rattachée à ${offres.riad9!.reference}, publiée dans la période de recherche`);
  });

  it('entre deux offres de la période, le rattachement se fait dans le sens demandé', async () => {
    expect(await lierDoublon(offres.riad9!.id, offres.riad10!.id, monde.acteurCourtier, MAINTENANT)).toEqual({ principale: 'autre', reference: offres.riad10!.reference });
    expect(await etat(offres.riad9!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.riad10!.id });
    // L'annonce du 6, déjà rattachée à celle du 9, suit ; l'offre principale garde son statut.
    expect(await etat(offres.riad6!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.riad10!.id });
    expect(await etat(offres.riad10!)).toMatchObject({ status: 'douteux', duplicate_of_id: null });
  });

  it('l’offre principale d’un groupe le reste quand on lui rattache une annonce écartée, même si l’un de ses doublons est plus ancien', async () => {
    // Groupe : annonce du 10 (principale), du 9 (doublon, dans la période) et du 6. On dissocie celle du 6, puis on déclare à la main que celle du 10 en est la copie.
    await dissocierDoublon(offres.riad6!.id, monde.acteurCourtier, MAINTENANT);
    expect(await sensRattachement((await offreParId(offres.riad10!.id))!, offres.riad6!.id, MAINTENANT)).toBe('celle-ci');
    expect(await lierDoublon(offres.riad10!.id, offres.riad6!.id, monde.acteurCourtier, MAINTENANT)).toEqual({ principale: 'celle-ci', reference: offres.riad6!.reference });
    // Dissociée plus haut, l'annonce du 10 attendait une vérification : elle la garde.
    expect(await etat(offres.riad10!)).toMatchObject({ status: 'actif', status_reason: 'aucun', verification_status: 'a_verifier', requires_human_review: true, duplicate_of_id: null });
    expect(await etat(offres.riad9!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.riad10!.id });
    expect(await etat(offres.riad6!)).toMatchObject({ status: 'archive', status_reason: 'doublon', duplicate_of_id: offres.riad10!.id });
  });
});

describe('maintenance et jeu de démonstration', () => {
  it('la maintenance rattrape une offre restée active avant le début de la recherche', async () => {
    // État qu'aurait laissé une version antérieure de l'outil : une offre du 5 novembre encore active.
    await executer(`UPDATE job_offers SET duplicate_of_id = NULL, duplicate_score = NULL, status = 'actif', status_reason = 'aucun' WHERE id = $1`, [offres.nounou!.id]);
    const bilan = await executerMaintenance(MAINTENANT);
    expect(bilan.perimetre).toEqual({ ecartees: 1, reprises: 0 });
    expect(await etat(offres.nounou!)).toMatchObject({ status: 'archive', status_reason: 'hors_perimetre_date' });
    expect((await executerMaintenance(MAINTENANT)).perimetre).toEqual({ ecartees: 0, reprises: 0 });
  });

  it('répartit les annonces fictives entre le début de la recherche et aujourd’hui, sans changer leur ordre', () => {
    const ages = (maintenant: string) => [1, 2, 5, 10, 14, 20, 60].map((ilYa) => ageDansLaPeriode(ilYa, new Date(LUNDI), new Date(maintenant)));
    // Le lundi même, toutes les annonces courantes sont datées du jour ; le mardi, du jour ou de la veille.
    expect(ages('2026-11-09T08:00:00Z')).toEqual([0, 0, 0, 0, 0, 0, 60]);
    expect(ages('2026-11-10T10:00:00Z')).toEqual([0, 0, 0, 1, 1, 1, 60]);
    // Dix jours plus tard, elles s'étalent sur dix jours ; au bout de vingt jours, elles ont leur âge prévu.
    expect(ages('2026-11-19T10:00:00Z')).toEqual([1, 1, 3, 5, 7, 10, 60]);
    expect(ages('2026-11-29T10:00:00Z')).toEqual([1, 2, 5, 10, 14, 20, 60]);
    expect(ages('2027-03-01T10:00:00Z')).toEqual([1, 2, 5, 10, 14, 20, 60]);
  });

  it('le jeu de démonstration tient dans la période : seule l’annonce volontairement ancienne est écartée', async () => {
    expect(await chargerJeuDemo(monde.acteurAdmin, MAINTENANT)).toEqual({ offres: 18, candidats: 8, employeurs: 2 });
    const statuts = await requete<{ s: string; r: string; n: number }>(`SELECT status AS s, status_reason AS r, count(*)::int AS n FROM job_offers WHERE is_demo GROUP BY 1, 2 ORDER BY 1, 2`);
    expect(statuts).toEqual([
      { s: 'actif', r: 'aucun', n: 14 },
      { s: 'archive', r: 'doublon', n: 1 },
      { s: 'archive', r: 'hors_perimetre_date', n: 1 },
      { s: 'douteux', r: 'date_inconnue', n: 1 },
      { s: 'douteux', r: 'risque_eleve', n: 1 },
    ]);
    // Toutes les annonces datées, sauf celle de 60 jours, ont été publiées entre le lundi 9 et aujourd'hui.
    const bornes = await uneLigne<{ premiere: Date; derniere: Date; n: number }>(
      `SELECT min(published_at) AS premiere, max(published_at) AS derniere, count(*)::int AS n FROM job_offers WHERE is_demo AND published_at IS NOT NULL AND status_reason <> 'hors_perimetre_date'`,
    );
    expect(bornes!.n).toBe(16);
    expect(bornes!.premiere.getTime()).toBeGreaterThanOrEqual(Date.parse(LUNDI));
    expect(bornes!.derniere.toISOString().slice(0, 10)).toBe('2026-11-10');
    // Des dates resserrées ne créent pas de faux rapprochements : une seule reformulation signalée au courtier, comme sur une période longue.
    expect((await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offers WHERE is_demo AND requires_human_review AND score_details ? 'doublonProbable'`))!.n).toBe(1);
    expect((await executerMaintenance(MAINTENANT)).perimetre).toEqual({ ecartees: 0, reprises: 0 });
  });
});
