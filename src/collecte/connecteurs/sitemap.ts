/**
 * Connecteur « sitemap » : découvre les annonces par le plan du site, puis —
 * seulement si le mode de collecte l'autorise — lit la page publique de chaque
 * annonce nouvelle et en extrait les données structurées schema.org/JobPosting.
 *
 *   mode index_liens   aucune page d'annonce n'est visitée : titre déduit de
 *                      l'adresse, date = lastmod du sitemap (approximative)
 *   mode extrait       la page est lue ; seuls un extrait court et le lien
 *                      sont conservés
 *   mode texte_complet réservé aux sources ayant donné une autorisation écrite
 *
 * Aucune pagination de résultats de recherche, aucun formulaire, aucun compte.
 */
import { lireDate } from '@/domaine/extraction';
import { decoderEntites, htmlVersTexte, sha256 } from '@/domaine/texte';
import { ErreurCollecte, type ClientPoli } from '../http';
import type { ChampsStructures, OffreBrute, ResultatConnecteur, Source } from '../types';
import { assainirXml, creerAnalyseurXml } from './rss';

export type EntreeSitemap = { loc: string; lastmod: string | null };
export type Sitemap = { type: 'index'; sitemaps: EntreeSitemap[] } | { type: 'urls'; urls: EntreeSitemap[] };

function liste(noeud: unknown): unknown[] {
  if (noeud === null || noeud === undefined) return [];
  return Array.isArray(noeud) ? noeud : [noeud];
}

function chaine(noeud: unknown): string {
  if (typeof noeud === 'string') return noeud.trim();
  if (typeof noeud === 'number') return String(noeud);
  if (typeof noeud === 'object' && noeud !== null && '#text' in noeud) return chaine((noeud as Record<string, unknown>)['#text']);
  return '';
}

export function analyserSitemap(xml: string): Sitemap {
  const document = creerAnalyseurXml().parse(assainirXml(xml)) as Record<string, unknown>;
  const entrees = (noeuds: unknown): EntreeSitemap[] =>
    liste(noeuds)
      .map((noeud) => {
        const n = noeud as Record<string, unknown>;
        return { loc: chaine(n.loc), lastmod: chaine(n.lastmod) || null };
      })
      .filter((entree) => /^https?:\/\//i.test(entree.loc));
  const index = document.sitemapindex as Record<string, unknown> | undefined;
  if (index) return { type: 'index', sitemaps: entrees(index.sitemap) };
  const urlset = document.urlset as Record<string, unknown> | undefined;
  return { type: 'urls', urls: entrees(urlset?.url) };
}

// --------------------------------------------------------------- JSON-LD ----

type Json = Record<string, unknown>;

function estJobPosting(noeud: unknown): noeud is Json {
  if (typeof noeud !== 'object' || noeud === null) return false;
  const type = (noeud as Json)['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

/** Tous les objets JobPosting des blocs <script type="application/ld+json"> d'une page. */
export function extraireJobPostings(html: string): Json[] {
  const trouves: Json[] = [];
  const motif = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const bloc of html.matchAll(motif)) {
    let donnees: unknown;
    try {
      donnees = JSON.parse((bloc[1] ?? '').trim());
    } catch {
      continue;
    }
    const file = liste(donnees);
    while (file.length > 0 && trouves.length < 20) {
      const noeud = file.shift();
      if (estJobPosting(noeud)) trouves.push(noeud);
      else if (typeof noeud === 'object' && noeud !== null && Array.isArray((noeud as Json)['@graph'])) file.push(...((noeud as Json)['@graph'] as unknown[]));
    }
  }
  return trouves;
}

const TYPES_EMPLOI: Record<string, { contrat?: string; tempsTravail?: string }> = {
  FULL_TIME: { tempsTravail: 'temps_plein' },
  PART_TIME: { tempsTravail: 'temps_partiel' },
  TEMPORARY: { contrat: 'cdd' },
  CONTRACTOR: { contrat: 'freelance' },
  INTERN: { contrat: 'stage' },
  PER_DIEM: { contrat: 'journalier' },
};

const UNITES: Record<string, 'mois' | 'semaine' | 'jour' | 'heure'> = { MONTH: 'mois', WEEK: 'semaine', DAY: 'jour', HOUR: 'heure' };

function nombre(valeur: unknown): number | null {
  const n = typeof valeur === 'number' ? valeur : typeof valeur === 'string' ? Number.parseFloat(valeur.replace(/\s/g, '').replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function premier(noeud: unknown): Json | null {
  const element = liste(noeud)[0];
  return typeof element === 'object' && element !== null ? (element as Json) : null;
}

export function jobPostingVersOffre(annonce: Json, url: string): OffreBrute | null {
  const titre = decoderEntites(chaine(annonce.title) || chaine(annonce.name));
  if (!titre) return null;
  const organisation = premier(annonce.hiringOrganization);
  const lieu = premier(annonce.jobLocation);
  const adresse = lieu ? (premier(lieu.address) ?? (typeof lieu.address === 'string' ? ({ addressLocality: lieu.address } as Json) : null)) : null;
  const paysBrut = adresse?.addressCountry;
  const pays = typeof paysBrut === 'object' && paysBrut !== null ? chaine((paysBrut as Json).name) : chaine(paysBrut);

  const champs: ChampsStructures = {};
  for (const type of liste(annonce.employmentType).map((t) => chaine(t).toUpperCase())) Object.assign(champs, TYPES_EMPLOI[type] ?? {});
  const salaire = premier(annonce.baseSalary);
  if (salaire) {
    const valeur = premier(salaire.value) ?? salaire;
    const min = nombre(valeur.minValue) ?? nombre(valeur.value);
    const max = nombre(valeur.maxValue);
    if (min !== null) {
      champs.salaireMin = min;
      champs.salaireMax = max !== null && max > min ? max : null;
      champs.periodeSalaire = UNITES[chaine(valeur.unitText).toUpperCase()] ?? null;
      champs.devise = chaine(salaire.currency) || chaine(valeur.currency) || null;
    }
  }
  const postes = nombre(annonce.totalJobOpenings);
  if (postes !== null) champs.nombrePostes = Math.round(postes);

  const publieLe = lireDate(chaine(annonce.datePosted));
  const identifiant = premier(annonce.identifier);
  return {
    idExterne: (chaine(identifiant?.value) || chaine(annonce.identifier) || url).slice(0, 500),
    url,
    titre: titre.slice(0, 300),
    texte: htmlVersTexte(decoderEntites(chaine(annonce.description))),
    employeur: organisation ? decoderEntites(chaine(organisation.name)) || null : decoderEntites(chaine(annonce.hiringOrganization)) || null,
    lieu: [chaine(adresse?.addressLocality), chaine(adresse?.addressRegion)].filter(Boolean).join(', ') || null,
    pays: pays || null,
    publieLe,
    precisionDate: publieLe ? 'exacte' : 'inconnue',
    expireLe: lireDate(chaine(annonce.validThrough)),
    champs,
  };
}

// ------------------------------------------------- page sans JSON-LD -------

function meta(html: string, nom: string): string | null {
  const motif = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${nom}["'][^>]*>`, 'i');
  const balise = motif.exec(html)?.[0];
  const contenu = balise ? /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(balise) : null;
  const valeur = contenu ? decoderEntites(contenu[1] ?? contenu[2] ?? '').trim() : '';
  return valeur || null;
}

/** Page publique sans données structurées : titre + texte principal, sans menus ni pied de page. */
export function pageVersOffre(html: string, url: string): OffreBrute | null {
  const titre =
    meta(html, 'og:title') ??
    (/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ? htmlVersTexte(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)![1]!) : null) ??
    (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ? htmlVersTexte(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)![1]!) : null);
  if (!titre) return null;
  const principal = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  const sansHabillage = principal.replace(/<(nav|header|footer|aside|form|select|button)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const publication = meta(html, 'article:published_time');
  const publieLe = lireDate(publication);
  return {
    idExterne: url,
    url,
    titre: titre.replace(/\s+/g, ' ').slice(0, 300),
    texte: htmlVersTexte(sansHabillage).slice(0, 20_000),
    ...(publieLe ? { publieLe, precisionDate: 'exacte' as const } : {}),
  };
}

/** « /offre/femme-de-menage-casablanca-1234/ » → « Femme de menage casablanca ». */
export function titreDepuisAdresse(adresse: string): string {
  try {
    const segments = new URL(adresse).pathname.split('/').filter(Boolean);
    const slug = decodeURIComponent([...segments].reverse().find((segment) => /[a-z\u0600-\u06FF]{3}/i.test(segment)) ?? '');
    const mots = slug.replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_+]+/g, ' ').replace(/\b\d{3,}\b/g, ' ').replace(/\s+/g, ' ').trim();
    return mots ? mots.charAt(0).toUpperCase() + mots.slice(1) : '';
  } catch {
    return '';
  }
}

// ------------------------------------------------------------ collecte -----

type ConfigSitemap = {
  /** Expression régulière : seules les adresses d'annonces qui la vérifient sont retenues. */
  motifUrl?: string;
  /** Expression régulière appliquée au CHEMIN des sous-sitemaps d'un index (défaut : job|offre|emploi|annonce). */
  motifSitemap?: string;
  maxSitemaps?: number;
  maxPages?: number;
  ancienneteMaxJours?: number;
};

function cheminDe(adresse: string): string {
  try {
    return new URL(adresse).pathname;
  } catch {
    return '';
  }
}

function expression(motif: string | undefined, nom: string): RegExp | null {
  if (!motif) return null;
  if (motif.length > 200) throw new Error(`${nom} : expression trop longue`);
  try {
    return new RegExp(motif, 'i');
  } catch {
    throw new Error(`${nom} invalide : ${motif}`);
  }
}

export async function collecterSitemap(source: Source, client: ClientPoli, contexte: { maintenant: Date; dejaConnues: (urls: string[]) => Promise<Set<string>> }): Promise<ResultatConnecteur> {
  const resultat: ResultatConnecteur = { offres: [], ecartees: [], inchange: false, partiel: false, avertissements: [] };
  if (!source.feed_url) throw new Error('Adresse du sitemap (feed_url) absente');
  const config = source.config as ConfigSitemap;
  const filtre = expression(config.motifUrl, 'Motif d’adresse');
  // Le motif porte sur le chemin seulement : « emplois.example » ne doit pas faire retenir « /page-sitemap.xml ».
  const filtreSitemap = expression(config.motifSitemap, 'Motif de sitemap') ?? /job|offre|emploi|annonce/i;
  const ancienneteMax = (config.ancienneteMaxJours ?? 45) * 86_400_000;
  const origine = new URL(source.feed_url).origin;

  // 1. Lire le sitemap (et, s'il s'agit d'un index, ses sous-sitemaps pertinents).
  const aLire = [source.feed_url];
  const entrees: EntreeSitemap[] = [];
  let lus = 0;
  let toutInchange = true;
  while (aLire.length > 0 && lus < (config.maxSitemaps ?? 3) + 1) {
    const adresse = aLire.shift()!;
    const estRacine = lus === 0;
    lus += 1;
    let reponse;
    try {
      reponse = await client.obtenir(adresse, { typesAcceptes: /xml|text\/plain/ });
    } catch (erreur) {
      // Le sitemap racine est indispensable ; un sous-sitemap illisible n'arrête pas la collecte,
      // sauf si le site nous bloque ou si le quota est atteint.
      if (estRacine || !(erreur instanceof ErreurCollecte) || erreur.code === 'blocage_site') throw erreur;
      if (erreur.code === 'quota_atteint') {
        resultat.partiel = true;
        break;
      }
      resultat.avertissements.push(`Sous-sitemap ignoré (${erreur.message}) : ${adresse}`);
      continue;
    }
    if (reponse.statut === 'non_modifie') continue;
    toutInchange = false;
    const sitemap = analyserSitemap(reponse.corps);
    if (sitemap.type === 'index') {
      // Un seul niveau d'index : un index trouvé dans un sous-sitemap n'est pas suivi.
      if (!estRacine) continue;
      const pertinents = sitemap.sitemaps
        .filter((entree) => new URL(entree.loc).origin === origine)
        .filter((entree) => filtreSitemap.test(cheminDe(entree.loc)))
        .sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? ''));
      aLire.push(...pertinents.slice(0, config.maxSitemaps ?? 3).map((entree) => entree.loc));
    } else {
      entrees.push(...sitemap.urls);
    }
  }
  if (toutInchange) {
    resultat.inchange = true;
    return resultat;
  }

  // 2. Garder les adresses d'annonces récentes, du même site, non encore connues.
  const candidates = entrees
    .filter((entree) => {
      try {
        return new URL(entree.loc).origin === origine;
      } catch {
        return false;
      }
    })
    .filter((entree) => !filtre || filtre.test(entree.loc))
    .map((entree) => ({ ...entree, date: lireDate(entree.lastmod) }))
    .filter((entree) => !entree.date || contexte.maintenant.getTime() - entree.date.getTime() <= ancienneteMax)
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  const connues = await contexte.dejaConnues(candidates.map((entree) => entree.loc));
  const nouvelles = candidates.filter((entree) => !connues.has(entree.loc));

  // 3a. Index de liens : aucune page visitée.
  if (source.collection_mode === 'index_liens') {
    for (const entree of nouvelles.slice(0, 200)) {
      const titre = titreDepuisAdresse(entree.loc);
      if (!titre) {
        resultat.ecartees.push({ url: entree.loc, motif: 'contenu_vide', detail: 'adresse sans titre lisible' });
        continue;
      }
      // lastmod est une date de modification, pas de publication : précision « approximative ».
      resultat.offres.push({ idExterne: entree.loc, url: entree.loc, titre, texte: '', publieLe: entree.date, precisionDate: entree.date ? 'approximative' : 'inconnue', majLe: entree.date });
    }
    return resultat;
  }

  // 3b. Lecture des pages publiques, dans la limite du quota de requêtes.
  const maxPages = Math.min(config.maxPages ?? 20, 100);
  for (const entree of nouvelles.slice(0, maxPages)) {
    if (client.quotaRestant <= 0) {
      resultat.partiel = true;
      break;
    }
    try {
      const reponse = await client.obtenir(entree.loc, { typesAcceptes: /html/ });
      if (reponse.statut === 'non_modifie') continue;
      const structuree = extraireJobPostings(reponse.corps).map((annonce) => jobPostingVersOffre(annonce, reponse.url)).find(Boolean);
      const offre = structuree ?? pageVersOffre(reponse.corps, reponse.url);
      if (!offre) {
        resultat.ecartees.push({ url: entree.loc, motif: 'erreur_extraction', detail: 'page sans titre exploitable' });
        continue;
      }
      // L'identifiant reste l'adresse du sitemap : c'est elle qui sert à ne pas revisiter la page.
      resultat.offres.push({ ...offre, idExterne: entree.loc, url: entree.loc, majLe: entree.date });
    } catch (erreur) {
      if (erreur instanceof ErreurCollecte && erreur.code === 'robots_interdit') {
        resultat.ecartees.push({ url: entree.loc, motif: 'robots_interdit' });
        continue;
      }
      if (erreur instanceof ErreurCollecte && erreur.code === 'quota_atteint') {
        resultat.partiel = true;
        break;
      }
      if (erreur instanceof ErreurCollecte && erreur.code === 'blocage_site') throw erreur;
      resultat.ecartees.push({ url: entree.loc, motif: 'erreur_extraction', detail: erreur instanceof Error ? erreur.message.slice(0, 200) : 'erreur' });
    }
  }
  if (nouvelles.length > maxPages) resultat.partiel = true;
  return resultat;
}

/** Empreinte d'adresse utilisée pour mémoriser les pages écartées sans stocker leur contenu. */
export function empreinteAdresse(url: string): string {
  return sha256(url.trim());
}
