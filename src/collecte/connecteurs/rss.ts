/**
 * Connecteur RSS / Atom.
 *
 * Un flux RSS est le moyen de syndication prévu par l'éditeur : c'est la forme
 * de collecte la plus légère (une seule requête, pas de page visitée). Il ne
 * dispense pas de vérifier les conditions d'utilisation du site : la source
 * reste désactivée tant qu'une base juridique n'est pas consignée.
 */
import { XMLParser } from 'fast-xml-parser';
import { lireDate } from '@/domaine/extraction';
import { decoderEntites, htmlVersTexte } from '@/domaine/texte';
import type { ClientPoli } from '../http';
import type { OffreBrute, ResultatConnecteur, Source } from '../types';

export type ElementFlux = {
  titre: string;
  lien: string | null;
  identifiant: string | null;
  date: string | null;
  contenuHtml: string;
  categories: string[];
  auteur: string | null;
};

const TAILLE_MAX_XML = 5_000_000;

export function creerAnalyseurXml(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    // Les entités déclarées dans un DOCTYPE ne sont jamais développées.
    processEntities: true,
    htmlEntities: false,
  });
}

/** Retire toute déclaration DOCTYPE (aucune entité externe ou récursive n'est interprétée). */
export function assainirXml(xml: string): string {
  if (xml.length > TAILLE_MAX_XML) throw new Error('Document XML trop volumineux');
  return xml.replace(/<!DOCTYPE[\s\S]*?(?:\[[\s\S]*?\]\s*)?>/gi, '');
}

function texte(noeud: unknown): string {
  if (noeud === null || noeud === undefined) return '';
  if (typeof noeud === 'string') return noeud;
  if (typeof noeud === 'number' || typeof noeud === 'boolean') return String(noeud);
  if (Array.isArray(noeud)) return texte(noeud[0]);
  if (typeof noeud === 'object') return texte((noeud as Record<string, unknown>)['#text']);
  return '';
}

function liste(noeud: unknown): unknown[] {
  if (noeud === null || noeud === undefined) return [];
  return Array.isArray(noeud) ? noeud : [noeud];
}

function lienAtom(noeud: unknown): string | null {
  const liens = liste(noeud);
  const choisi = liens.find((lien) => typeof lien === 'object' && lien !== null && ((lien as Record<string, unknown>)['@_rel'] ?? 'alternate') === 'alternate') ?? liens[0];
  if (typeof choisi === 'string') return choisi;
  if (typeof choisi === 'object' && choisi !== null) return texte((choisi as Record<string, unknown>)['@_href']) || texte(choisi) || null;
  return null;
}

export function analyserFlux(xml: string): ElementFlux[] {
  const document = creerAnalyseurXml().parse(assainirXml(xml)) as Record<string, unknown>;
  const rss = document.rss as Record<string, unknown> | undefined;
  const atom = document.feed as Record<string, unknown> | undefined;
  const rdf = (document['rdf:RDF'] ?? document.RDF) as Record<string, unknown> | undefined;

  if (atom) {
    return liste(atom.entry).map((entree) => {
      const e = entree as Record<string, unknown>;
      return {
        titre: decoderEntites(texte(e.title)).trim(),
        lien: lienAtom(e.link),
        identifiant: texte(e.id) || null,
        date: texte(e.published) || texte(e.updated) || null,
        contenuHtml: texte(e.content) || texte(e.summary),
        categories: liste(e.category).map((c) => (typeof c === 'object' && c !== null ? texte((c as Record<string, unknown>)['@_term']) : texte(c))).filter(Boolean),
        auteur: texte((liste(e.author)[0] as Record<string, unknown> | undefined)?.name) || null,
      };
    });
  }
  const canal = (rss?.channel ?? rdf) as Record<string, unknown> | undefined;
  const elements = liste(canal?.item ?? rdf?.item);
  return elements.map((element) => {
    const e = element as Record<string, unknown>;
    const guid = e.guid;
    return {
      titre: decoderEntites(texte(e.title)).trim(),
      lien: texte(e.link) || null,
      identifiant: texte(guid) || null,
      date: texte(e.pubDate) || texte(e['dc:date']) || null,
      contenuHtml: texte(e['content:encoded']) || texte(e.description),
      categories: liste(e.category).map(texte).filter(Boolean),
      auteur: texte(e['dc:creator']) || texte(e.author) || null,
    };
  });
}

function urlHttp(valeur: string | null, base: string): string | null {
  if (!valeur) return null;
  try {
    const url = new URL(valeur.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function elementVersOffre(element: ElementFlux, adresseFlux: string): OffreBrute | null {
  // Un GUID ne sert d'adresse que s'il est lui-même une adresse absolue (sinon « id-1 » deviendrait un lien inventé).
  const guidEstUneAdresse = /^https?:\/\//i.test(element.identifiant?.trim() ?? '');
  const url = urlHttp(element.lien, adresseFlux) ?? (guidEstUneAdresse ? urlHttp(element.identifiant, adresseFlux) : null);
  const idExterne = (element.identifiant || url || '').trim();
  if (!element.titre || !idExterne) return null;
  const publieLe = lireDate(element.date);
  const corps = htmlVersTexte(element.contenuHtml);
  return {
    idExterne: idExterne.slice(0, 500),
    url,
    titre: element.titre.slice(0, 300),
    // Les catégories du flux aident le classement (« Hôtellerie », « Services à la personne »).
    texte: [corps, element.categories.length > 0 ? `Catégories : ${element.categories.join(', ')}` : ''].filter(Boolean).join('\n'),
    publieLe,
    precisionDate: publieLe ? 'exacte' : 'inconnue',
  };
}

export async function collecterRss(source: Source, client: ClientPoli): Promise<ResultatConnecteur> {
  const resultat: ResultatConnecteur = { offres: [], ecartees: [], inchange: false, partiel: false, avertissements: [] };
  if (!source.feed_url) throw new Error('Adresse du flux (feed_url) absente');
  const reponse = await client.obtenir(source.feed_url, { typesAcceptes: /xml|rss|atom|text\/plain/ });
  if (reponse.statut === 'non_modifie') {
    resultat.inchange = true;
    return resultat;
  }
  const limite = Math.min(200, Number(source.config.maxElements ?? 100));
  for (const element of analyserFlux(reponse.corps).slice(0, limite)) {
    const offre = elementVersOffre(element, reponse.url);
    if (offre) resultat.offres.push(offre);
    else resultat.ecartees.push({ url: element.lien ?? reponse.url, motif: 'contenu_vide', detail: 'élément sans titre ou sans identifiant' });
  }
  return resultat;
}
