import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { statutEffectif } from '@/domaine/statuts';
import { requete, uneLigne, executer } from '@/serveur/db';
import { executerCollecte, importerFichier, importerSaisie, apercuSaisie } from '@/serveur/ingestion';
import { archiverOffre, corrigerOffre, dissocierDoublon, offreParId, rechercherOffres, verifierOffre } from '@/serveur/offres';
import { modifierSource, sourceParCode, sourceParId } from '@/serveur/sources';
import { creerSourceTest, fauxSite, fermerBase, fixture, MAINTENANT, preparerBase, type Monde } from './outils';

let monde: Monde;
let sourceId: string;
const attendre = async () => undefined;
const FLUX = 'https://emplois.example/feed/';
const site = (corps: string, entetes: Record<string, string> = {}) => fauxSite({ [FLUX]: { corps, type: 'application/rss+xml; charset=UTF-8', entetes } });

beforeAll(async () => {
  monde = await preparerBase();
  sourceId = await creerSourceTest();
});
afterAll(fermerBase);

describe('collecte RSS de bout en bout', () => {
  it('crée les offres du Maroc dans la taxonomie et écarte les autres', async () => {
    const { fetchImpl, appels } = site(fixture('flux-emplois.xml'));
    const bilan = await executerCollecte(sourceId, { declencheur: 'manuel', acteur: monde.acteurAdmin, maintenant: MAINTENANT, fetch: fetchImpl, attendre, autoriserAdressesLocales: true });
    expect(bilan).toMatchObject({ statut: 'succes', lues: 6, nouvelles: 4, rejetees: 3, erreurs: 0, requetes: 2 });
    expect(appels).toEqual(['https://emplois.example/robots.txt', FLUX]);

    const offres = await requete<{ title: string; status: string; status_reason: string; city_code: string | null; reference: string }>(`SELECT title, status, status_reason, city_code, reference FROM job_offers ORDER BY reference`);
    expect(offres.map((o) => [o.status, o.status_reason, o.city_code])).toEqual([
      ['actif', 'aucun', 'casablanca'],
      ['actif', 'aucun', 'marrakech'],
      ['actif', 'aucun', 'rabat'],
      ['archive', 'hors_perimetre_date', 'rabat'],
    ]);
    expect(offres[0]!.reference).toBe('YS-OF-2026-0001');
    const rejets = await requete<{ reason: string }>(`SELECT reason FROM ingestion_rejections ORDER BY reason`);
    expect(rejets.map((r) => r.reason)).toEqual(['contenu_vide', 'hors_maroc', 'hors_taxonomie']);
  });

  it('ne stocke aucune coordonnée quand la source ne l’autorise pas', async () => {
    const lignes = await requete<{ t: string }>(`SELECT row_to_json(o)::text AS t FROM job_offers o`);
    for (const ligne of lignes) expect(ligne.t).not.toMatch(/06 ?00 ?00 ?00 ?01|600000001/);
    expect(await uneLigne(`SELECT 1 FROM job_offers WHERE has_contact_in_source AND contact_phone_enc IS NULL`)).not.toBeNull();
  });

  it('une seconde lecture identique ne crée rien et n’écrit aucun nouveau rejet', async () => {
    const { fetchImpl } = site(fixture('flux-emplois.xml'));
    const bilan = await executerCollecte(sourceId, { declencheur: 'planifie', maintenant: new Date(MAINTENANT.getTime() + 3_600_000), fetch: fetchImpl, attendre, autoriserAdressesLocales: true });
    expect(bilan).toMatchObject({ statut: 'succes', nouvelles: 0, inchangees: 4, misesAJour: 0, rejetees: 3 });
    expect((await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM ingestion_rejections`))!.n).toBe(3);
    expect((await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offers`))!.n).toBe(4);
  });

  it('historise un changement de salaire', async () => {
    const { fetchImpl } = site(fixture('flux-emplois.xml').replace('4&nbsp;000 DH', '4&nbsp;500 DH'));
    const bilan = await executerCollecte(sourceId, { declencheur: 'planifie', maintenant: new Date(MAINTENANT.getTime() + 7_200_000), fetch: fetchImpl, attendre, autoriserAdressesLocales: true });
    expect(bilan).toMatchObject({ misesAJour: 1, inchangees: 3, nouvelles: 0 });
    const version = await uneLigne<{ changed_fields: string[]; changes: Record<string, [number, number]> }>(`SELECT changed_fields, changes FROM job_offer_versions ORDER BY id DESC LIMIT 1`);
    expect(version!.changed_fields).toContain('salary_min');
    expect(version!.changes.salary_min).toEqual([4000, 4500]);
  });

  it('s’arrête et met la source en pause quand le site refuse l’accès', async () => {
    const { fetchImpl, appels } = fauxSite({ [FLUX]: { statut: 403 } });
    const quand = new Date(MAINTENANT.getTime() + 10_800_000);
    const bilan = await executerCollecte(sourceId, { declencheur: 'planifie', maintenant: quand, fetch: fetchImpl, attendre, autoriserAdressesLocales: true });
    expect(bilan.statut).toBe('echec');
    expect(appels.filter((u) => u === FLUX)).toHaveLength(1);
    const source = await sourceParId(sourceId);
    expect(new Date(source!.paused_until!).getTime()).toBeGreaterThanOrEqual(quand.getTime() + 86_400_000);
    const ensuite = fauxSite({});
    const ignore = await executerCollecte(sourceId, { declencheur: 'planifie', maintenant: new Date(quand.getTime() + 3_600_000), fetch: ensuite.fetchImpl, attendre });
    expect(ignore.statut).toBe('ignore');
    expect(ensuite.appels).toHaveLength(0);
  });
});

describe('garde-fous de conformité des sources', () => {
  it('les sites d’emploi du catalogue sont désactivés par défaut', async () => {
    const actives = await requete<{ code: string }>(`SELECT code FROM job_sources WHERE is_active AND kind IN ('rss', 'sitemap', 'api') AND code <> 'test-rss'`);
    expect(actives).toEqual([]);
    const catalogue = await requete<{ code: string }>(`SELECT code FROM job_sources WHERE kind IN ('rss', 'sitemap', 'api') AND code <> 'test-rss' ORDER BY code`);
    expect(catalogue.map((s) => s.code)).toEqual(['dreamjob', 'emploi-ma', 'indeed-ma', 'jobsquare', 'marocemploi', 'rekrute']);
  });

  it('une source désactivée ne déclenche aucune requête', async () => {
    const dreamjob = await sourceParCode('dreamjob');
    const { fetchImpl, appels } = fauxSite({});
    const bilan = await executerCollecte(dreamjob!.id, { declencheur: 'manuel', acteur: monde.acteurAdmin, fetch: fetchImpl, attendre });
    expect(bilan.statut).toBe('ignore');
    expect(appels).toHaveLength(0);
  });

  it('refuse d’activer une source sans base juridique, lecture des conditions et autorisation', async () => {
    const dreamjob = await sourceParCode('dreamjob');
    await expect(modifierSource(dreamjob!.id, { is_active: true }, monde.acteurAdmin)).rejects.toThrow(/Activation impossible/);
    // La base elle-même refuse, même en contournant l'application.
    await expect(executer(`UPDATE job_sources SET is_active = true, collection_mode = 'extrait' WHERE id = $1`, [dreamjob!.id])).rejects.toMatchObject({ code: '23514' });
    await expect(executer(`UPDATE job_sources SET collection_mode = 'texte_complet' WHERE id = $1`, [dreamjob!.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('accepte l’activation une fois la conformité consignée, et la journalise', async () => {
    const dreamjob = await sourceParCode('dreamjob');
    const activee = await modifierSource(dreamjob!.id, {
      is_active: true, collection_mode: 'extrait', legal_basis: 'Accord écrit de l’éditeur (test).', permission_status: 'accordee', permission_reference: 'E-mail du 01/11/2026 (test)', conditionsLuesAujourdhui: true,
    }, monde.acteurAdmin, MAINTENANT);
    expect(activee.is_active).toBe(true);
    expect(await uneLigne(`SELECT 1 FROM audit_logs WHERE action = 'source.activation' AND entity_id = $1`, [dreamjob!.id])).not.toBeNull();
    await modifierSource(dreamjob!.id, { is_active: false }, monde.acteurAdmin);
  });
});

describe('recherche', () => {
  it('trouve une annonce arabe en cherchant en français ou en anglais', async () => {
    const fr = await rechercherOffres({ q: 'femme de ménage' });
    expect(fr.offres.map((o) => o.city_code).sort()).toEqual(['casablanca', 'rabat']);
    const en = await rechercherOffres({ q: 'housekeeper' });
    expect(en.total).toBe(2);
    const ar = await rechercherOffres({ q: 'عاملة نظافة' });
    expect(ar.offres.map((o) => o.city_code)).toContain('rabat');
  });

  it('ignore les accents et la casse', async () => {
    expect((await rechercherOffres({ q: 'RECEPTIONNISTE' })).total).toBe(1);
    expect((await rechercherOffres({ q: 'menage' })).total).toBe(2);
  });

  it('filtre par ville, secteur, métier, salaire et statut', async () => {
    expect((await rechercherOffres({ ville: 'rabat' })).total).toBe(1);
    expect((await rechercherOffres({ ville: 'rabat', statut: 'tous' })).total).toBe(2);
    expect((await rechercherOffres({ secteur: 'hospitalite' })).total).toBe(1);
    expect((await rechercherOffres({ metier: 'femme_menage' })).total).toBe(2);
    expect((await rechercherOffres({ salaireMin: 4200 })).total).toBe(1);
    const tout = await rechercherOffres({});
    expect(tout.parStatut).toMatchObject({ actif: 3, archive: 1 });
    expect(tout.offres.every((o) => o.effective_status === 'actif')).toBe(true);
  });

  it('résiste à une saisie hostile', async () => {
    await expect(rechercherOffres({ q: `'; DROP TABLE job_offers; --` })).resolves.toMatchObject({ total: 0 });
    await expect(rechercherOffres({ q: '%%% ((( &&& !!!' })).resolves.toBeDefined();
    expect((await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offers`))!.n).toBe(4);
  });
});

describe('statut effectif : la base et le code donnent toujours le même résultat', () => {
  it('sur une grille de cas', async () => {
    const jour = 86_400_000;
    const t = MAINTENANT.getTime();
    const cas = [];
    for (const statut of ['actif', 'expire', 'douteux', 'archive'] as const)
      for (const publie of [null, t - 2 * jour, t - 44.9 * jour, t - 45 * jour - 1000, t - 60 * jour])
        for (const precision of ['exacte', 'approximative', 'inconnue'] as const)
          for (const expire of [null, t - 1000, t, t + jour])
            for (const verifie of [t - jour, t - 21 * jour + 1000, t - 21 * jour - 1000, t - 40 * jour])
              cas.push({ statut, publie, precision, expire, verifie });
    for (const c of cas) {
      const attendu = statutEffectif(
        { statut: c.statut, motif: c.statut === 'actif' ? 'aucun' : 'risque_eleve', publieLe: c.publie ? new Date(c.publie) : null, precisionDate: c.precision, expireLe: c.expire ? new Date(c.expire) : null, verifieLe: new Date(c.verifie) },
        MAINTENANT,
        { dureeValiditeJours: 45, delaiReverificationJours: 21 },
      );
      const sql = await uneLigne<{ s: string; r: string }>(
        `SELECT ys_effective_status($1, $2, $3, $4, $5, 45, 21, $6) AS s, ys_effective_reason($1, $7, $2, $3, $4, $5, 45, 21, $6) AS r`,
        [c.statut, c.publie ? new Date(c.publie) : null, c.precision, c.expire ? new Date(c.expire) : null, new Date(c.verifie), MAINTENANT, c.statut === 'actif' ? 'aucun' : 'risque_eleve'],
      );
      expect({ statut: sql!.s, motif: sql!.r }, JSON.stringify(c)).toEqual(attendu);
    }
    expect(cas.length).toBe(960);
  });

  it('une offre active devient expirée à la lecture sans intervention du worker', async () => {
    const offre = await uneLigne<{ id: string }>(`SELECT id FROM job_offers WHERE city_code = 'marrakech'`);
    await executer(`UPDATE job_offers SET published_at = now() - interval '50 days', last_checked_at = now() WHERE id = $1`, [offre!.id]);
    const lue = await offreParId(offre!.id);
    expect(lue).toMatchObject({ status: 'actif', effective_status: 'expire', effective_reason: 'expiree_anciennete', freshness_score: 0 });
    expect((await rechercherOffres({ ville: 'marrakech' })).total).toBe(0);
    await executer(`UPDATE job_offers SET published_at = $2 WHERE id = $1`, [offre!.id, new Date('2026-11-08T10:00:00Z')]);
  });

  it('la base refuse une offre active sans date ou rattachée comme doublon', async () => {
    const offre = await uneLigne<{ id: string }>(`SELECT id FROM job_offers WHERE city_code = 'casablanca'`);
    await expect(executer(`UPDATE job_offers SET published_at = NULL WHERE id = $1`, [offre!.id])).rejects.toMatchObject({ code: '23514' });
    await expect(executer(`UPDATE job_offers SET date_precision = 'inconnue' WHERE id = $1`, [offre!.id])).rejects.toMatchObject({ code: '23514' });
    await expect(executer(`UPDATE job_offers SET country_code = 'FR' WHERE id = $1`, [offre!.id])).rejects.toMatchObject({ code: '23514' });
  });
});

describe('import manuel, doublons et modération', () => {
  const annonce = 'Réceptionniste H/F\nLe Riad Exemple, médina de Marrakech, recrute un(e) réceptionniste. Français et anglais exigés. CDD saisonnier. Tél : 06 00 00 00 02';

  it('montre un aperçu sans rien écrire', async () => {
    const avant = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offers`))!.n;
    const apercu = await apercuSaisie({ texte: annonce, origine: 'site', employeur: 'Riad Exemple', datePublication: '2026-11-09' }, MAINTENANT);
    expect(apercu.analyse.type).toBe('offre');
    expect(apercu.doublons[0]).toMatchObject({ decision: 'doublon' });
    expect(apercu.source.name).toMatch(/import manuel/);
    expect((await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offers`))!.n).toBe(avant);
  });

  it('rattache la même annonce lue ailleurs comme doublon, sans la supprimer', async () => {
    const resultat = await importerSaisie({ texte: annonce, origine: 'site', employeur: 'Riad Exemple', datePublication: '2026-11-09' }, monde.acteurCourtier, MAINTENANT);
    expect(resultat).toMatchObject({ type: 'doublon', statut: 'archive', motif: 'doublon' });
    if (resultat.type !== 'doublon') return;
    const principale = await offreParId(resultat.doublonDe!.id);
    expect(principale!.doublons.map((d) => d.reference)).toContain(resultat.reference);
    // Import manuel depuis un site : les coordonnées ne sont pas conservées.
    expect(await uneLigne(`SELECT 1 FROM job_offers WHERE id = $1 AND contact_phone_enc IS NULL AND has_contact_in_source`, [resultat.id])).not.toBeNull();
  });

  it('le même texte recollé met à jour la même offre', async () => {
    const resultat = await importerSaisie({ texte: annonce, origine: 'site', employeur: 'Riad Exemple', datePublication: '2026-11-09' }, monde.acteurCourtier, MAINTENANT);
    expect(resultat.type).toBe('inchangee');
  });

  it('une offre dissociée redevient « à vérifier », puis active après vérification', async () => {
    const doublon = await uneLigne<{ id: string }>(`SELECT id FROM job_offers WHERE status_reason = 'doublon'`);
    await dissocierDoublon(doublon!.id, monde.acteurCourtier, MAINTENANT);
    expect(await offreParId(doublon!.id)).toMatchObject({ status: 'douteux', verification_status: 'a_verifier', duplicate_of_id: null });
    expect(await verifierOffre(doublon!.id, monde.acteurCourtier, 'Employeur joint par téléphone', MAINTENANT)).toEqual({ statut: 'actif', motif: 'aucun' });
    await archiverOffre(doublon!.id, 'archivage_manuel', monde.acteurCourtier, null, MAINTENANT);
  });

  it('une annonce sans date reste douteuse tant qu’un courtier n’a pas saisi la date', async () => {
    const resultat = await importerSaisie({ texte: 'Nounou à Tanger\nFamille à Tanger cherche une nounou expérimentée, temps plein, logée.', origine: 'site' }, monde.acteurCourtier, MAINTENANT);
    expect(resultat).toMatchObject({ type: 'nouvelle', statut: 'douteux', motif: 'date_inconnue' });
    if (resultat.type === 'rejet') return;
    await expect(verifierOffre(resultat.id, monde.acteurCourtier, null, MAINTENANT)).rejects.toThrow(/date de publication/);
    const corrigee = await corrigerOffre(resultat.id, { datePublication: '2026-11-07' }, monde.acteurCourtier, MAINTENANT);
    expect(corrigee).toEqual({ statut: 'actif', motif: 'aucun' });
    const lue = await offreParId(resultat.id);
    expect(lue).toMatchObject({ effective_status: 'actif', date_precision: 'exacte' });
    expect(lue!.versions[0]!.changed_fields).toContain('published_at');
    expect(lue!.freshness_score).toBeGreaterThan(70);
  });

  it('une correction humaine n’est pas écrasée par un nouvel import', async () => {
    const texte = 'Cuisinière à domicile\nFamille à Casablanca cherche cuisinière à domicile, cuisine marocaine. Salaire 5000 dh par mois.';
    const premiere = await importerSaisie({ texte, origine: 'site', url: 'https://annonces.example/o/77', datePublication: '2026-11-08' }, monde.acteurCourtier, MAINTENANT);
    if (premiere.type === 'rejet') throw new Error('offre attendue');
    await corrigerOffre(premiere.id, { ville: 'rabat' }, monde.acteurCourtier, MAINTENANT);
    const seconde = await importerSaisie({ texte: texte.replace('5000', '5500'), origine: 'site', url: 'https://annonces.example/o/77', datePublication: '2026-11-08' }, monde.acteurCourtier, MAINTENANT);
    expect(seconde.type).toBe('mise_a_jour');
    expect(await offreParId(premiere.id)).toMatchObject({ city_code: 'rabat', salary_min: 5500 });
  });

  it('refuse d’enregistrer une offre hors Maroc et en garde la trace', async () => {
    const resultat = await importerSaisie({ texte: 'Femme de ménage à Dubaï\nFamille aux Émirats cherche femme de ménage, visa pris en charge.', origine: 'site', datePublication: '2026-11-08' }, monde.acteurCourtier, MAINTENANT);
    expect(resultat).toMatchObject({ type: 'rejet', motif: 'hors_maroc' });
    expect(await uneLigne(`SELECT 1 FROM job_offers WHERE title ILIKE '%Dubaï%'`)).toBeNull();
  });

  it('rattache un import manuel au site reconnu par son adresse, sans requête vers ce site', async () => {
    const apercu = await apercuSaisie({ texte: 'Gouvernante d’étage\nHôtel à Agadir recrute une gouvernante d’étage expérimentée.', origine: 'site', url: 'https://www.rekrute.com/offre-emploi-gouvernante-123.html', datePublication: '2026-11-08' }, MAINTENANT);
    expect(apercu.source.name).toBe('ReKrute');
    expect(apercu.source.collection_mode).toBe('manuel');
  });

  it('conserve le texte et le contact d’une annonce confiée par l’employeur, chiffrés', async () => {
    const resultat = await importerSaisie({ texte: 'Jardinier pour villa à Bouskoura\nNous cherchons un jardinier sérieux pour notre villa. 3 jours par semaine. Appelez le 06 00 00 00 03.', origine: 'employeur', datePublication: '2026-11-09' }, monde.acteurCourtier, MAINTENANT);
    if (resultat.type === 'rejet') throw new Error('offre attendue');
    const ligne = await uneLigne<{ contact_phone_enc: string; description_full: string }>(`SELECT contact_phone_enc, description_full FROM job_offers WHERE id = $1`, [resultat.id]);
    expect(ligne!.contact_phone_enc).toMatch(/^v1\./);
    expect(ligne!.contact_phone_enc).not.toContain('600000003');
    expect(ligne!.description_full).toContain('jardinier sérieux');
  });

  it('importe un fichier CSV', async () => {
    const bilan = await importerFichier(fixture('offres.csv'), 'offres.csv', monde.acteurCourtier, MAINTENANT);
    expect(bilan).toMatchObject({ statut: 'partiel', nouvelles: 2, erreursFichier: ['ligne 4 : titre absent'] });
    expect(await uneLigne(`SELECT 1 FROM job_offers o JOIN job_sources s ON s.id = o.source_id WHERE s.code = 'fichier-partenaire' AND o.city_code = 'tanger' AND o.salary_min = 5000`)).not.toBeNull();
  });
});
