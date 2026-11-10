import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collecterRss, analyserFlux, elementVersOffre } from '@/collecte/connecteurs/rss';
import { collecterSitemap } from '@/collecte/connecteurs/sitemap';
import { offreDepuisSaisie } from '@/collecte/connecteurs/manuel';
import { ClientPoli, ErreurCollecte } from '@/collecte/http';
import { analyserOffre, type PolitiqueSource } from '@/collecte/pipeline';
import type { Source } from '@/collecte/types';
import { PARAMETRES_DEFAUT } from '@/domaine/parametres';

const fixture = (nom: string) => readFileSync(path.join(__dirname, '..', 'fixtures', nom), 'utf8');
const MAINTENANT = new Date('2026-11-10T10:00:00Z');

type Route = { statut?: number; corps?: string; type?: string; entetes?: Record<string, string> };

/** Faux site : aucune requête réelle ne sort du test. */
function fauxSite(routes: Record<string, Route | ((requete: Request) => Route)>) {
  const appels: { url: string; entetes: Headers }[] = [];
  const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = entree instanceof URL ? entree.href : typeof entree === 'string' ? entree : entree.url;
    const requete = new Request(url, init);
    appels.push({ url, entetes: requete.headers });
    const definition = routes[url];
    const route = typeof definition === 'function' ? definition(requete) : definition;
    if (!route) return new Response('introuvable', { status: 404 });
    return new Response(route.statut === 304 ? null : (route.corps ?? ''), { status: route.statut ?? 200, headers: { 'content-type': route.type ?? 'text/html; charset=utf-8', ...(route.entetes ?? {}) } });
  }) as typeof fetch;
  return { fetchImpl, appels };
}

function client(fetchImpl: typeof fetch, surcharge: Partial<ConstructorParameters<typeof ClientPoli>[0]> = {}) {
  const attentes: number[] = [];
  const c = new ClientPoli({ delaiMinMs: 3000, maxRequetes: 20, fetch: fetchImpl, autoriserAdressesLocales: true, attendre: async (ms) => void attentes.push(ms), ...surcharge });
  return { c, attentes };
}

const source = (surcharge: Partial<Source> = {}): Source => ({
  id: '00000000-0000-4000-8000-000000000001',
  code: 'test',
  name: 'Source de test',
  kind: 'rss',
  base_url: 'https://emplois.example/',
  feed_url: 'https://emplois.example/feed/',
  collection_mode: 'extrait',
  is_active: true,
  legal_basis: 'Jeu d’essai',
  permission_status: 'accordee',
  user_agent: null,
  min_delay_ms: 3000,
  max_requests_per_run: 20,
  frequency_minutes: 360,
  max_excerpt_chars: 300,
  allow_ai_processing: false,
  store_contacts: false,
  keep_unclassified: false,
  country_default: null,
  reliability_score: 60,
  config: {},
  http_cache: {},
  last_run_at: null,
  consecutive_failures: 0,
  paused_until: null,
  ...surcharge,
});

describe('client HTTP poli', () => {
  it('lit robots.txt avant la première requête et s’identifie', async () => {
    const { fetchImpl, appels } = fauxSite({ 'https://emplois.example/robots.txt': { corps: 'User-agent: *\nDisallow: /prive/', type: 'text/plain' }, 'https://emplois.example/page': { corps: 'bonjour' } });
    const { c } = client(fetchImpl);
    const reponse = await c.obtenir('https://emplois.example/page');
    expect(reponse).toMatchObject({ statut: 'ok', corps: 'bonjour' });
    expect(appels.map((a) => a.url)).toEqual(['https://emplois.example/robots.txt', 'https://emplois.example/page']);
    expect(appels[1]!.entetes.get('user-agent')).toMatch(/^YallahJobRadar\//);
    expect(appels[1]!.entetes.get('cookie')).toBeNull();
  });

  it('refuse une page interdite par robots.txt sans la demander', async () => {
    const { fetchImpl, appels } = fauxSite({ 'https://emplois.example/robots.txt': { corps: 'User-agent: *\nDisallow: /prive/', type: 'text/plain' } });
    const { c } = client(fetchImpl);
    await expect(c.obtenir('https://emplois.example/prive/x')).rejects.toMatchObject({ code: 'robots_interdit' });
    expect(appels).toHaveLength(1);
    expect(c.robotsBloques).toBe(1);
  });

  it('considère tout interdit si robots.txt est en erreur serveur, tout permis s’il est absent', async () => {
    const enPanne = fauxSite({ 'https://emplois.example/robots.txt': { statut: 500 }, 'https://emplois.example/page': { corps: 'x' } });
    await expect(client(enPanne.fetchImpl).c.obtenir('https://emplois.example/page')).rejects.toMatchObject({ code: 'robots_interdit' });
    const absent = fauxSite({ 'https://emplois.example/page': { corps: 'x' } });
    await expect(client(absent.fetchImpl).c.obtenir('https://emplois.example/page')).resolves.toMatchObject({ statut: 'ok' });
  });

  it('espace les requêtes et respecte un Crawl-delay plus long', async () => {
    const { fetchImpl } = fauxSite({ 'https://emplois.example/robots.txt': { corps: 'User-agent: *\nCrawl-delay: 10', type: 'text/plain' }, 'https://emplois.example/a': { corps: 'a' }, 'https://emplois.example/b': { corps: 'b' } });
    const { c, attentes } = client(fetchImpl);
    await c.obtenir('https://emplois.example/a');
    await c.obtenir('https://emplois.example/b');
    expect(attentes.length).toBe(2);
    expect(Math.max(...attentes)).toBeGreaterThan(9000);
    expect(Math.max(...attentes)).toBeLessThanOrEqual(10_000);
  });

  it('s’arrête au quota de requêtes', async () => {
    const { fetchImpl } = fauxSite({ 'https://emplois.example/a': { corps: 'a' }, 'https://emplois.example/b': { corps: 'b' } });
    const { c } = client(fetchImpl, { maxRequetes: 2 });
    await c.obtenir('https://emplois.example/a');
    await expect(c.obtenir('https://emplois.example/b')).rejects.toMatchObject({ code: 'quota_atteint' });
    expect(c.quotaRestant).toBe(0);
  });

  it('s’arrête net sur 403, 429 ou 503, sans réessayer ni contourner', async () => {
    for (const statut of [403, 429, 503]) {
      const { fetchImpl, appels } = fauxSite({ 'https://emplois.example/a': { statut, entetes: { 'retry-after': '120' } } });
      const erreur = await client(fetchImpl).c.obtenir('https://emplois.example/a').catch((e: unknown) => e);
      expect(erreur).toBeInstanceOf(ErreurCollecte);
      expect(erreur).toMatchObject({ code: 'blocage_site', details: { statut, reessayerApresSecondes: 120 } });
      expect(appels.filter((a) => a.url.endsWith('/a'))).toHaveLength(1);
    }
  });

  it('envoie des requêtes conditionnelles et reconnaît un 304', async () => {
    const { fetchImpl, appels } = fauxSite({
      'https://emplois.example/feed/': (requete) => (requete.headers.get('if-none-match') === '"v1"' ? { statut: 304 } : { corps: '<rss/>', type: 'application/rss+xml', entetes: { etag: '"v1"' } }),
    });
    const premier = client(fetchImpl);
    await premier.c.obtenir('https://emplois.example/feed/');
    expect(premier.c.cache['https://emplois.example/feed/']).toEqual({ etag: '"v1"' });
    const second = client(fetchImpl, { cache: premier.c.cache });
    await expect(second.c.obtenir('https://emplois.example/feed/')).resolves.toEqual({ statut: 'non_modifie', url: 'https://emplois.example/feed/' });
    expect(appels.at(-1)!.entetes.get('if-none-match')).toBe('"v1"');
  });

  it('revérifie robots.txt après une redirection', async () => {
    const { fetchImpl } = fauxSite({
      'https://emplois.example/robots.txt': { corps: 'User-agent: *\nDisallow: /prive/', type: 'text/plain' },
      'https://emplois.example/a': { statut: 302, entetes: { location: '/prive/b' } },
      'https://emplois.example/prive/b': { corps: 'secret' },
    });
    await expect(client(fetchImpl).c.obtenir('https://emplois.example/a')).rejects.toMatchObject({ code: 'robots_interdit' });
  });

  it('refuse les adresses locales ou privées et les protocoles exotiques', async () => {
    const { fetchImpl, appels } = fauxSite({});
    const strict = new ClientPoli({ delaiMinMs: 0, maxRequetes: 5, fetch: fetchImpl, attendre: async () => undefined });
    for (const adresse of ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://[::1]/', 'ftp://emplois.example/x', 'https://utilisateur:secret@emplois.example/']) {
      await expect(strict.obtenir(adresse)).rejects.toMatchObject({ code: 'adresse_interdite' });
    }
    expect(appels).toHaveLength(0);
  });

  it('refuse une réponse trop volumineuse ou d’un type inattendu', async () => {
    const { fetchImpl } = fauxSite({ 'https://emplois.example/gros': { corps: 'x'.repeat(5000) }, 'https://emplois.example/image': { corps: 'x', type: 'image/png' } });
    await expect(client(fetchImpl, { tailleMaxOctets: 1000 }).c.obtenir('https://emplois.example/gros')).rejects.toMatchObject({ code: 'trop_volumineux' });
    await expect(client(fetchImpl).c.obtenir('https://emplois.example/image', { typesAcceptes: /html/ })).rejects.toMatchObject({ code: 'type_inattendu' });
  });
});

describe('collecte RSS de bout en bout (faux site)', () => {
  it('rend les annonces du flux et signale « inchangé » sur 304', async () => {
    const { fetchImpl } = fauxSite({ 'https://emplois.example/feed/': { corps: fixture('flux-emplois.xml'), type: 'application/rss+xml; charset=UTF-8', entetes: { etag: '"abc"' } } });
    const { c } = client(fetchImpl);
    const resultat = await collecterRss(source(), c);
    expect(resultat.offres).toHaveLength(6);
    expect(resultat.ecartees).toHaveLength(1);
    expect(c.requetes).toBe(2);

    const inchange = fauxSite({ 'https://emplois.example/feed/': { statut: 304 } });
    const suite = await collecterRss(source(), client(inchange.fetchImpl, { cache: c.cache }).c);
    expect(suite).toMatchObject({ inchange: true, offres: [] });
  });
});

describe('collecte par sitemap de bout en bout (faux site)', () => {
  const routes = {
    'https://emplois.example/robots.txt': { corps: 'User-agent: *\nDisallow: /prive/\nSitemap: https://emplois.example/sitemap.xml', type: 'text/plain' },
    'https://emplois.example/sitemap.xml': { corps: fixture('sitemap-index.xml'), type: 'application/xml' },
    'https://emplois.example/job-sitemap1.xml': { corps: fixture('sitemap-offres.xml'), type: 'application/xml' },
    'https://emplois.example/offre/gouvernante-d-etage-hotel-exemple-marrakech/': { corps: fixture('page-offre-jsonld.html') },
    'https://emplois.example/offre/nounou-a-domicile-rabat/': { corps: fixture('page-offre-simple.html') },
    'https://emplois.example/offre/comptable-senior-casablanca/': { corps: '<html><head><title>Comptable senior</title></head><body><main><h1>Comptable senior</h1><p>Cabinet à Casablanca.</p></main></body></html>' },
  };
  const sourceSitemap = (surcharge: Partial<Source> = {}) => source({ kind: 'sitemap', feed_url: 'https://emplois.example/sitemap.xml', config: { motifUrl: '/offre/' }, ...surcharge });
  const aucuneConnue = async () => new Set<string>();

  it('en mode « index de liens », ne visite aucune page d’annonce', async () => {
    const { fetchImpl, appels } = fauxSite(routes);
    const resultat = await collecterSitemap(sourceSitemap({ collection_mode: 'index_liens' }), client(fetchImpl).c, { maintenant: MAINTENANT, dejaConnues: aucuneConnue });
    expect(appels.map((a) => a.url)).toEqual(['https://emplois.example/robots.txt', 'https://emplois.example/sitemap.xml', 'https://emplois.example/job-sitemap1.xml']);
    expect(resultat.offres.map((o) => o.titre)).toEqual(['Gouvernante d etage hotel exemple marrakech', 'Secrete', 'Nounou a domicile rabat', 'Comptable senior casablanca']);
    expect(resultat.offres[0]).toMatchObject({ texte: '', precisionDate: 'approximative' });
  });

  it('en mode « extrait », lit les pages nouvelles, respecte robots.txt et ignore les autres sites', async () => {
    const { fetchImpl, appels } = fauxSite(routes);
    const resultat = await collecterSitemap(sourceSitemap(), client(fetchImpl).c, { maintenant: MAINTENANT, dejaConnues: aucuneConnue });
    const visitees = appels.map((a) => a.url);
    expect(visitees).not.toContain('https://emplois.example/prive/offre/secrete/');
    expect(visitees).not.toContain('https://ailleurs.example/offre/hors-site/');
    expect(visitees).not.toContain('https://autre-site.example/job-sitemap.xml');
    expect(visitees).not.toContain('https://emplois.example/page-sitemap.xml');
    expect(visitees).not.toContain('https://emplois.example/offre/jardinier-villa-bouskoura/');
    expect(resultat.ecartees).toEqual([{ url: 'https://emplois.example/prive/offre/secrete/', motif: 'robots_interdit' }]);
    expect(resultat.offres).toHaveLength(3);
    expect(resultat.offres[0]).toMatchObject({ idExterne: 'https://emplois.example/offre/gouvernante-d-etage-hotel-exemple-marrakech/', employeur: 'Hôtel Exemple', pays: 'MA' });
  });

  it('ne revisite pas les pages déjà connues', async () => {
    const { fetchImpl, appels } = fauxSite(routes);
    const connues = async (urls: string[]) => new Set(urls.filter((u) => u.includes('gouvernante') || u.includes('nounou')));
    const resultat = await collecterSitemap(sourceSitemap(), client(fetchImpl).c, { maintenant: MAINTENANT, dejaConnues: connues });
    expect(appels.map((a) => a.url)).not.toContain('https://emplois.example/offre/nounou-a-domicile-rabat/');
    expect(resultat.offres.map((o) => o.titre)).toEqual(['Comptable senior']);
  });

  it('s’arrête proprement quand le quota est atteint (exécution partielle)', async () => {
    const { fetchImpl } = fauxSite(routes);
    const resultat = await collecterSitemap(sourceSitemap(), client(fetchImpl, { maxRequetes: 4 }).c, { maintenant: MAINTENANT, dejaConnues: aucuneConnue });
    expect(resultat.partiel).toBe(true);
    expect(resultat.offres).toHaveLength(1);
  });
});

describe('pipeline d’analyse', () => {
  const politique = (surcharge: Partial<PolitiqueSource> = {}): PolitiqueSource => ({ kind: 'rss', collection_mode: 'extrait', max_excerpt_chars: 300, store_contacts: false, keep_unclassified: false, country_default: null, reliability_score: 60, ...surcharge });
  const contexte = { maintenant: MAINTENANT, parametres: PARAMETRES_DEFAUT };
  const duFlux = () => analyserFlux(fixture('flux-emplois.xml')).map((e) => elementVersOffre(e, 'https://emplois.example/feed/')).filter((o) => o !== null);

  it('qualifie une annonce française complète', () => {
    const resultat = analyserOffre(duFlux()[0]!, politique(), contexte);
    expect(resultat.type).toBe('offre');
    if (resultat.type !== 'offre') return;
    expect(resultat.offre).toMatchObject({
      title: 'Femme de ménage pour villa – Casablanca',
      city_code: 'casablanca',
      district: 'Californie',
      sector_code: 'maison',
      contract_type: 'cdi',
      work_time: 'temps_plein',
      salary_min: 4000,
      salary_period: 'mois',
      salary_flag: 'normal',
      experience_min_years: 2,
      status: 'actif',
      status_reason: 'aucun',
      date_precision: 'exacte',
      canonical_url: 'https://emplois.example/offre/femme-de-menage-villa-casablanca',
      has_contact_in_source: true,
      contact_phone: null,
      description_full: null,
      content_language: 'fr',
    });
    expect(resultat.offre.categories[0]).toMatchObject({ code: 'femme_menage', principal: true });
    expect(resultat.offre.relevance_score).toBeGreaterThan(70);
    expect(resultat.offre.risk_score).toBeLessThan(25);
  });

  it('ne conserve jamais un numéro de téléphone si la source ne l’autorise pas', () => {
    const resultat = analyserOffre(duFlux()[0]!, politique(), contexte);
    if (resultat.type !== 'offre') throw new Error('offre attendue');
    expect(JSON.stringify(resultat.offre)).not.toMatch(/06 ?00 ?00 ?00 ?01|600000001/);
    const autorisee = analyserOffre(duFlux()[0]!, politique({ store_contacts: true, collection_mode: 'texte_complet' }), contexte);
    if (autorisee.type !== 'offre') throw new Error('offre attendue');
    expect(autorisee.offre.contact_phone).toBe('+212 600 000 001');
    expect(autorisee.offre.description_full).toContain('06 00 00 00 01');
  });

  it('qualifie une annonce en arabe', () => {
    const resultat = analyserOffre(duFlux()[2]!, politique(), contexte);
    if (resultat.type !== 'offre') throw new Error('offre attendue');
    expect(resultat.offre).toMatchObject({ city_code: 'rabat', content_language: 'ar', housing: 'loge', salary_min: 3500, salary_period: 'mois', status: 'actif' });
    expect(resultat.offre.categories.map((c) => c.code)).toContain('femme_menage');
  });

  it('rejette une offre à l’étranger et une offre hors taxonomie', () => {
    expect(analyserOffre(duFlux()[3]!, politique(), contexte)).toMatchObject({ type: 'rejet', motif: 'hors_maroc' });
    expect(analyserOffre(duFlux()[4]!, politique(), contexte)).toMatchObject({ type: 'rejet', motif: 'hors_taxonomie' });
  });

  it('archive une offre publiée avant le 1er janvier 2026', () => {
    const resultat = analyserOffre(duFlux()[5]!, politique(), contexte);
    if (resultat.type !== 'offre') throw new Error('offre attendue');
    expect(resultat.offre).toMatchObject({ status: 'archive', status_reason: 'hors_perimetre_date' });
  });

  it('ne rend jamais active une offre sans date vérifiable', () => {
    const brute = offreDepuisSaisie({ texte: 'Nounou à Rabat\nFamille à Rabat cherche une nounou expérimentée, temps plein.' });
    const resultat = analyserOffre(brute, politique({ kind: 'manuel', collection_mode: 'manuel' }), contexte);
    if (resultat.type !== 'offre') throw new Error('offre attendue');
    expect(resultat.offre).toMatchObject({ status: 'douteux', status_reason: 'date_inconnue', verification_status: 'a_verifier', requires_human_review: true, published_at: null, freshness_score: 0 });
  });

  it('en mode « index de liens », ne conserve aucun texte', () => {
    const resultat = analyserOffre(duFlux()[0]!, politique({ collection_mode: 'index_liens' }), contexte);
    if (resultat.type !== 'offre') throw new Error('offre attendue');
    expect(resultat.offre.description_excerpt).toBeNull();
    expect(resultat.offre.description_full).toBeNull();
    expect(resultat.offre.salary_min).toBe(4000);
  });

  it('tronque l’extrait à la longueur autorisée par la source', () => {
    const brute = { ...duFlux()[1]!, texte: `Le Riad Exemple à Marrakech recrute un réceptionniste. ${'Détail du poste. '.repeat(80)}` };
    const resultat = analyserOffre(brute, politique({ max_excerpt_chars: 120 }), contexte);
    if (resultat.type !== 'offre') throw new Error('offre attendue');
    expect(resultat.offre.description_excerpt!.length).toBeLessThanOrEqual(121);
  });

  it('garde une offre hors taxonomie saisie à la main, mais la soumet à une revue', () => {
    const brute = offreDepuisSaisie({ texte: 'Magasinier à Casablanca\nSociété de logistique à Casablanca recrute un magasinier.', datePublication: '2026-11-08' });
    const resultat = analyserOffre(brute, politique({ kind: 'manuel', collection_mode: 'manuel' }), contexte);
    if (resultat.type !== 'offre') throw new Error('offre attendue');
    expect(resultat.offre).toMatchObject({ status: 'actif', verification_status: 'a_verifier', requires_human_review: true, sector_code: null });
    expect(resultat.offre.categories).toEqual([]);
  });

  it('marque douteuse une annonce qui réclame de l’argent', () => {
    const brute = offreDepuisSaisie({ texte: 'Femme de ménage à Casablanca\nFrais de dossier 300 dh à payer avant l’entretien. Salaire 4000 dh.', datePublication: '2026-11-09' });
    const resultat = analyserOffre(brute, politique({ kind: 'manuel', collection_mode: 'manuel' }), contexte);
    if (resultat.type !== 'offre') throw new Error('offre attendue');
    expect(resultat.offre).toMatchObject({ status: 'douteux', status_reason: 'risque_eleve', requires_human_review: true });
    expect(resultat.offre.risk_flags).toContain('frais_demandes');
  });

  it('utilise les données structurées de la source en priorité', () => {
    const resultat = analyserOffre(
      { idExterne: 'x', url: 'https://emplois.example/o/9', titre: 'Gouvernante d’étage', texte: 'Hôtel 5 étoiles recrute.', employeur: 'Hôtel Exemple', lieu: 'Marrakech, Marrakech-Safi', pays: 'MA', publieLe: new Date('2026-11-09T10:00:00Z'), precisionDate: 'exacte', expireLe: new Date('2026-12-09T22:59:00Z'), champs: { tempsTravail: 'temps_plein', salaireMin: 6000, salaireMax: 7500, periodeSalaire: 'mois', devise: 'MAD', nombrePostes: 2 } },
      politique({ kind: 'sitemap' }),
      contexte,
    );
    if (resultat.type !== 'offre') throw new Error('offre attendue');
    expect(resultat.offre).toMatchObject({ employer_name: 'Hôtel Exemple', employer_normalized: 'exemple', city_code: 'marrakech', salary_min: 6000, salary_max: 7500, salary_monthly_estimate: 6750, headcount: 2, work_time: 'temps_plein', status: 'actif' });
    expect(resultat.offre.expires_at?.toISOString()).toBe('2026-12-09T22:59:00.000Z');
  });

  it('produit la même empreinte de contenu pour la même annonce, une autre si elle change', () => {
    const a = analyserOffre(duFlux()[0]!, politique(), contexte);
    const b = analyserOffre(duFlux()[0]!, politique(), contexte);
    const c = analyserOffre({ ...duFlux()[0]!, texte: duFlux()[0]!.texte.replace('4 000', '4 500') }, politique(), contexte);
    if (a.type !== 'offre' || b.type !== 'offre' || c.type !== 'offre') throw new Error('offres attendues');
    expect(a.offre.content_hash).toBe(b.offre.content_hash);
    expect(a.offre.content_hash).not.toBe(c.offre.content_hash);
    expect(a.offre.fingerprint).toBe(c.offre.fingerprint);
  });
});
