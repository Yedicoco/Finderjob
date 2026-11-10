/**
 * Lecture de robots.txt selon la RFC 9309 (Robots Exclusion Protocol).
 *
 *   - le groupe retenu est celui dont le User-agent correspond le mieux à notre
 *     jeton produit ; à défaut, le groupe « * » ;
 *   - la règle la plus longue l'emporte ; à longueur égale, Allow l'emporte ;
 *   - « * » remplace n'importe quelle suite de caractères, « $ » ancre la fin ;
 *   - Crawl-delay (hors RFC mais répandu) est respecté s'il est plus strict que
 *     le délai configuré pour la source ;
 *   - Content-Signal (proposition « contentsignals.org », vue sur emploi.ma) :
 *     « ai-input=no » interdit de transmettre le contenu à un modèle d'IA.
 *
 * Respecter robots.txt est nécessaire mais PAS suffisant : les conditions
 * d'utilisation du site priment (voir docs/08-plan-de-collecte.md).
 */

export type RegleRobots = { type: 'allow' | 'disallow'; motif: string };
export type GroupeRobots = { agents: string[]; regles: RegleRobots[]; delaiCrawlSecondes: number | null };
export type Robots = {
  groupes: GroupeRobots[];
  sitemaps: string[];
  signaux: Record<string, boolean>;
};

export const ROBOTS_TOUT_AUTORISE: Robots = { groupes: [], sitemaps: [], signaux: {} };
export const ROBOTS_TOUT_INTERDIT: Robots = { groupes: [{ agents: ['*'], regles: [{ type: 'disallow', motif: '/' }], delaiCrawlSecondes: null }], sitemaps: [], signaux: {} };

export function analyserRobots(contenu: string): Robots {
  const robots: Robots = { groupes: [], sitemaps: [], signaux: {} };
  let courant: GroupeRobots | null = null;
  let dernierChampEstAgent = false;

  for (const ligneBrute of contenu.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).slice(0, 5000)) {
    const ligne = ligneBrute.replace(/#.*$/, '').trim();
    if (!ligne) continue;
    const separateur = ligne.indexOf(':');
    if (separateur < 1) continue;
    const champ = ligne.slice(0, separateur).trim().toLowerCase();
    const valeur = ligne.slice(separateur + 1).trim();

    if (champ === 'user-agent') {
      if (!courant || !dernierChampEstAgent) {
        courant = { agents: [], regles: [], delaiCrawlSecondes: null };
        robots.groupes.push(courant);
      }
      courant.agents.push(valeur.toLowerCase());
      dernierChampEstAgent = true;
      continue;
    }
    dernierChampEstAgent = false;

    if (champ === 'sitemap') {
      if (/^https?:\/\//i.test(valeur)) robots.sitemaps.push(valeur);
    } else if (champ === 'content-signal') {
      for (const morceau of valeur.split(',')) {
        const [cle, etat] = morceau.split('=').map((partie) => partie.trim().toLowerCase());
        if (cle && (etat === 'yes' || etat === 'no')) robots.signaux[cle] = etat === 'yes';
      }
    } else if (courant) {
      if (champ === 'allow' || champ === 'disallow') {
        // « Disallow: » vide = tout est autorisé : aucune règle à enregistrer.
        if (valeur !== '') courant.regles.push({ type: champ, motif: valeur });
      } else if (champ === 'crawl-delay') {
        const secondes = Number.parseFloat(valeur);
        if (Number.isFinite(secondes) && secondes >= 0) courant.delaiCrawlSecondes = Math.min(secondes, 3600);
      }
    }
  }
  return robots;
}

/** Jeton produit d'un User-Agent : « YallahJobRadar/0.1 (+https://…) » → « yallahjobradar ». */
export function jetonProduit(userAgent: string): string {
  return (userAgent.match(/^[A-Za-z_-]+/)?.[0] ?? userAgent).toLowerCase();
}

function groupePour(robots: Robots, userAgent: string): GroupeRobots | null {
  const jeton = jetonProduit(userAgent);
  const specifiques = robots.groupes.filter((groupe) => groupe.agents.some((agent) => agent !== '*' && (jeton === agent || jeton.includes(agent))));
  if (specifiques.length > 0) {
    // Plusieurs groupes pour le même agent : leurs règles se cumulent (RFC 9309, § 2.2.1).
    return {
      agents: [jeton],
      regles: specifiques.flatMap((groupe) => groupe.regles),
      delaiCrawlSecondes: specifiques.map((groupe) => groupe.delaiCrawlSecondes).find((delai) => delai !== null) ?? null,
    };
  }
  const generiques = robots.groupes.filter((groupe) => groupe.agents.includes('*'));
  if (generiques.length === 0) return null;
  return {
    agents: ['*'],
    regles: generiques.flatMap((groupe) => groupe.regles),
    delaiCrawlSecondes: generiques.map((groupe) => groupe.delaiCrawlSecondes).find((delai) => delai !== null) ?? null,
  };
}

function motifVersRegExp(motif: string): RegExp {
  const ancre = motif.endsWith('$');
  const corps = (ancre ? motif.slice(0, -1) : motif)
    .split('*')
    .map((morceau) => morceau.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${corps}${ancre ? '$' : ''}`);
}

function normaliserChemin(chemin: string): string {
  try {
    // Les octets encodés sont comparés sous forme décodée quand c'est possible.
    return decodeURI(chemin);
  } catch {
    return chemin;
  }
}

/** Le chemin (avec sa chaîne de requête) est-il autorisé pour ce User-Agent ? */
export function cheminAutorise(robots: Robots, userAgent: string, cheminEtRequete: string): boolean {
  if (cheminEtRequete === '/robots.txt') return true;
  const groupe = groupePour(robots, userAgent);
  if (!groupe) return true;
  const chemin = normaliserChemin(cheminEtRequete || '/');
  let meilleure: { type: 'allow' | 'disallow'; longueur: number } | null = null;
  for (const regle of groupe.regles) {
    if (!motifVersRegExp(normaliserChemin(regle.motif)).test(chemin)) continue;
    const longueur = regle.motif.length;
    if (!meilleure || longueur > meilleure.longueur || (longueur === meilleure.longueur && regle.type === 'allow')) {
      meilleure = { type: regle.type, longueur };
    }
  }
  return !meilleure || meilleure.type === 'allow';
}

export function delaiCrawlMs(robots: Robots, userAgent: string): number | null {
  const delai = groupePour(robots, userAgent)?.delaiCrawlSecondes;
  return delai === null || delai === undefined ? null : Math.round(delai * 1000);
}

/** Phrase courte décrivant ce que robots.txt permet à notre agent (affichée dans l'administration). */
export function resumerRobots(robots: Robots, userAgent: string): string {
  const groupe = groupePour(robots, userAgent);
  const morceaux: string[] = [];
  if (!groupe) morceaux.push('aucune règle pour notre agent (tout est autorisé)');
  else {
    const interdits = groupe.regles.filter((regle) => regle.type === 'disallow').map((regle) => regle.motif);
    morceaux.push(interdits.length === 0 ? 'aucune interdiction' : `interdit : ${interdits.slice(0, 8).join(', ')}${interdits.length > 8 ? '…' : ''}`);
    if (groupe.delaiCrawlSecondes !== null) morceaux.push(`délai demandé : ${groupe.delaiCrawlSecondes} s`);
  }
  const signaux = Object.entries(robots.signaux).map(([cle, etat]) => `${cle}=${etat ? 'yes' : 'no'}`);
  if (signaux.length > 0) morceaux.push(`Content-Signal : ${signaux.join(', ')}`);
  return morceaux.join(' ; ');
}
