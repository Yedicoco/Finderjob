/**
 * Client HTTP « poli » pour la collecte automatisée.
 *
 * Garanties
 *   - User-Agent identifiable, avec une adresse de contact ;
 *   - robots.txt lu et respecté avant toute requête vers un hôte ;
 *   - une seule requête à la fois, espacée d'au moins `delaiMinMs`
 *     (ou du Crawl-delay du site s'il est plus long) ;
 *   - nombre maximal de requêtes par exécution ;
 *   - GET uniquement ; aucun cookie, aucune session, aucun formulaire, aucun
 *     JavaScript exécuté, aucun contournement de CAPTCHA ou de blocage ;
 *   - 401 / 403 / 429 / 503 : on s'arrête et on met la source en pause ;
 *   - requêtes conditionnelles (ETag, Last-Modified) pour ne pas retélécharger ;
 *   - taille de réponse plafonnée, délai d'attente court ;
 *   - refus des adresses privées (protection SSRF), sauf en test.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { analyserRobots, cheminAutorise, delaiCrawlMs, ROBOTS_TOUT_AUTORISE, ROBOTS_TOUT_INTERDIT, type Robots } from './robots';

/**
 * User-Agent par défaut : un nom de produit stable (c'est lui que les sites
 * peuvent cibler dans robots.txt) et une adresse de contact. À personnaliser
 * avec YS_COLLECTE_USER_AGENT ou par source (job_sources.user_agent).
 */
export const USER_AGENT_DEFAUT = process.env.YS_COLLECTE_USER_AGENT?.trim() || 'YallahJobRadar/0.1 (+mailto:servicesyallah@gmail.com)';

export class ErreurCollecte extends Error {
  constructor(
    message: string,
    readonly code: 'robots_interdit' | 'quota_atteint' | 'blocage_site' | 'http' | 'reseau' | 'adresse_interdite' | 'trop_volumineux' | 'type_inattendu',
    readonly details: { statut?: number; reessayerApresSecondes?: number; url?: string } = {},
  ) {
    super(message);
  }
}

export type CacheHttp = Record<string, { etag?: string; lastModified?: string }>;

export type ReponsePolie =
  | { statut: 'ok'; url: string; corps: string; typeContenu: string }
  | { statut: 'non_modifie'; url: string };

export type OptionsClient = {
  userAgent?: string | null;
  delaiMinMs: number;
  maxRequetes: number;
  delaiAttenteMs?: number;
  tailleMaxOctets?: number;
  cache?: CacheHttp;
  /** Injection pour les tests. */
  fetch?: typeof fetch;
  attendre?: (ms: number) => Promise<void>;
  /** Autorise 127.0.0.1 et les réseaux privés (tests uniquement). */
  autoriserAdressesLocales?: boolean;
  /** false : robots.txt n'est pas consulté (jamais utilisé en production). */
  respecterRobots?: boolean;
};

function estAdressePrivee(adresse: string): boolean {
  if (net.isIPv4(adresse)) {
    const [a, b] = adresse.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(adresse)) {
    const minuscule = adresse.toLowerCase();
    if (minuscule.startsWith('::ffff:')) return estAdressePrivee(minuscule.slice(7));
    return minuscule === '::1' || minuscule === '::' || minuscule.startsWith('fc') || minuscule.startsWith('fd') || minuscule.startsWith('fe80');
  }
  return true;
}

export class ClientPoli {
  readonly userAgent: string;
  readonly cache: CacheHttp;
  requetes = 0;
  robotsBloques = 0;
  /** Signaux Content-Signal rencontrés (ex. { 'ai-input': false }). */
  signaux: Record<string, boolean> = {};

  private readonly robotsParOrigine = new Map<string, Robots>();
  private dernierAppel = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly attendre: (ms: number) => Promise<void>;

  constructor(private readonly options: OptionsClient) {
    this.userAgent = options.userAgent?.trim() || USER_AGENT_DEFAUT;
    this.cache = { ...(options.cache ?? {}) };
    this.fetchImpl = options.fetch ?? fetch;
    this.attendre = options.attendre ?? ((ms) => new Promise((resoudre) => setTimeout(resoudre, ms)));
  }

  get quotaRestant(): number {
    return Math.max(0, this.options.maxRequetes - this.requetes);
  }

  private async verifierAdresse(url: URL): Promise<void> {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new ErreurCollecte(`Protocole refusé : ${url.protocol}`, 'adresse_interdite', { url: url.href });
    }
    if (url.username || url.password) throw new ErreurCollecte('Adresse avec identifiants refusée', 'adresse_interdite', { url: url.href });
    if (this.options.autoriserAdressesLocales) return;
    const hote = url.hostname.replace(/^\[|\]$/g, '');
    let adresses: string[];
    if (net.isIP(hote)) adresses = [hote];
    else {
      try {
        adresses = (await lookup(hote, { all: true })).map((resultat) => resultat.address);
      } catch {
        throw new ErreurCollecte(`Hôte introuvable : ${hote}`, 'reseau', { url: url.href });
      }
    }
    if (adresses.length === 0 || adresses.some(estAdressePrivee)) {
      throw new ErreurCollecte(`Adresse privée ou locale refusée : ${hote}`, 'adresse_interdite', { url: url.href });
    }
  }

  private async espacer(delaiMs: number): Promise<void> {
    const ecoule = Date.now() - this.dernierAppel;
    if (this.dernierAppel > 0 && ecoule < delaiMs) await this.attendre(delaiMs - ecoule);
    this.dernierAppel = Date.now();
  }

  private async requeteBrute(url: URL, entetes: Record<string, string>): Promise<Response> {
    if (this.requetes >= this.options.maxRequetes) {
      throw new ErreurCollecte('Nombre maximal de requêtes atteint pour cette exécution', 'quota_atteint', { url: url.href });
    }
    this.requetes += 1;
    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        // Les redirections sont suivies à la main pour revérifier robots.txt et l'adresse à chaque saut.
        redirect: 'manual',
        headers: { 'User-Agent': this.userAgent, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, application/json;q=0.7', 'Accept-Language': 'fr, ar;q=0.8, en;q=0.6', ...entetes },
        signal: AbortSignal.timeout(this.options.delaiAttenteMs ?? 15_000),
        credentials: 'omit',
      });
    } catch (erreur) {
      throw new ErreurCollecte(`Échec réseau : ${erreur instanceof Error ? erreur.message : String(erreur)}`, 'reseau', { url: url.href });
    }
  }

  private async robotsPour(url: URL): Promise<Robots> {
    if (this.options.respecterRobots === false) return ROBOTS_TOUT_AUTORISE;
    const existant = this.robotsParOrigine.get(url.origin);
    if (existant) return existant;
    let robots: Robots;
    try {
      const adresse = new URL('/robots.txt', url.origin);
      await this.verifierAdresse(adresse);
      await this.espacer(this.options.delaiMinMs);
      const reponse = await this.requeteBrute(adresse, {});
      if (reponse.ok) robots = analyserRobots((await reponse.text()).slice(0, 500_000));
      // RFC 9309 § 2.3.1 : 4xx = pas de restriction ; 5xx ou réseau = tout est interdit.
      else if (reponse.status >= 400 && reponse.status < 500 && reponse.status !== 429) robots = ROBOTS_TOUT_AUTORISE;
      else robots = ROBOTS_TOUT_INTERDIT;
    } catch (erreur) {
      if (erreur instanceof ErreurCollecte && (erreur.code === 'quota_atteint' || erreur.code === 'adresse_interdite')) throw erreur;
      robots = ROBOTS_TOUT_INTERDIT;
    }
    this.robotsParOrigine.set(url.origin, robots);
    Object.assign(this.signaux, robots.signaux);
    return robots;
  }

  /** robots.txt de l'origine (pour l'écran d'administration et les sitemaps déclarés). */
  async lireRobots(adresse: string): Promise<Robots> {
    return this.robotsPour(new URL(adresse));
  }

  async obtenir(adresse: string, options: { typesAcceptes?: RegExp } = {}): Promise<ReponsePolie> {
    let url = new URL(adresse);
    for (let saut = 0; saut < 4; saut += 1) {
      await this.verifierAdresse(url);
      const robots = await this.robotsPour(url);
      if (!cheminAutorise(robots, this.userAgent, `${url.pathname}${url.search}`)) {
        this.robotsBloques += 1;
        throw new ErreurCollecte(`robots.txt interdit ${url.pathname}`, 'robots_interdit', { url: url.href });
      }
      await this.espacer(Math.max(this.options.delaiMinMs, delaiCrawlMs(robots, this.userAgent) ?? 0));

      const memo = this.cache[url.href];
      const entetes: Record<string, string> = {};
      if (memo?.etag) entetes['If-None-Match'] = memo.etag;
      if (memo?.lastModified) entetes['If-Modified-Since'] = memo.lastModified;
      const reponse = await this.requeteBrute(url, entetes);

      if (reponse.status === 304) return { statut: 'non_modifie', url: url.href };
      if (reponse.status >= 300 && reponse.status < 400) {
        const suite = reponse.headers.get('location');
        if (!suite) throw new ErreurCollecte('Redirection sans destination', 'http', { statut: reponse.status, url: url.href });
        url = new URL(suite, url);
        continue;
      }
      if ([401, 403, 407, 429, 451, 503].includes(reponse.status)) {
        const attente = Number.parseInt(reponse.headers.get('retry-after') ?? '', 10);
        throw new ErreurCollecte(`Le site refuse ou limite l’accès (HTTP ${reponse.status}) : arrêt de la collecte`, 'blocage_site', {
          statut: reponse.status,
          url: url.href,
          ...(Number.isFinite(attente) && attente > 0 ? { reessayerApresSecondes: Math.min(attente, 86_400) } : {}),
        });
      }
      if (!reponse.ok) throw new ErreurCollecte(`HTTP ${reponse.status}`, 'http', { statut: reponse.status, url: url.href });

      const typeContenu = (reponse.headers.get('content-type') ?? '').toLowerCase();
      if (options.typesAcceptes && !options.typesAcceptes.test(typeContenu)) {
        throw new ErreurCollecte(`Type de contenu inattendu : ${typeContenu || 'inconnu'}`, 'type_inattendu', { url: url.href });
      }
      const tailleMax = this.options.tailleMaxOctets ?? 3_000_000;
      const annoncee = Number.parseInt(reponse.headers.get('content-length') ?? '', 10);
      if (Number.isFinite(annoncee) && annoncee > tailleMax) throw new ErreurCollecte('Réponse trop volumineuse', 'trop_volumineux', { url: url.href });
      const tampon = await reponse.arrayBuffer();
      if (tampon.byteLength > tailleMax) throw new ErreurCollecte('Réponse trop volumineuse', 'trop_volumineux', { url: url.href });

      const etag = reponse.headers.get('etag') ?? undefined;
      const lastModified = reponse.headers.get('last-modified') ?? undefined;
      if (etag || lastModified) this.cache[url.href] = { ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) };
      return { statut: 'ok', url: url.href, corps: new TextDecoder('utf-8').decode(tampon), typeContenu };
    }
    throw new ErreurCollecte('Trop de redirections', 'http', { url: adresse });
  }
}
