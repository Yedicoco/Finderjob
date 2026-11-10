import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyserCsv, analyserFichier } from '@/collecte/connecteurs/fichier';
import { offreDepuisSaisie, titreDepuisTexte } from '@/collecte/connecteurs/manuel';
import { analyserFlux, assainirXml, elementVersOffre } from '@/collecte/connecteurs/rss';
import { analyserSitemap, extraireJobPostings, jobPostingVersOffre, pageVersOffre, titreDepuisAdresse } from '@/collecte/connecteurs/sitemap';
import { analyserRobots, cheminAutorise, delaiCrawlMs, resumerRobots } from '@/collecte/robots';

const fixture = (nom: string) => readFileSync(path.join(__dirname, '..', 'fixtures', nom), 'utf8');
const UA = 'YallahJobRadar/0.1 (+mailto:test@example.org)';

describe('robots.txt (RFC 9309)', () => {
  const robots = analyserRobots(`
# commentaire
User-agent: *
Disallow: /prive/
Disallow: /*?s=
Allow: /prive/public/
Crawl-delay: 10
Content-Signal: search=yes, ai-train=no, ai-input=no

User-agent: MechantBot
Disallow: /

User-agent: yallahjobradar
User-agent: autre
Disallow: /interdit-pour-nous
Disallow: /fichier.pdf$

Sitemap: https://emplois.example/sitemap.xml
`);

  it('applique le groupe le plus spécifique à notre agent', () => {
    expect(cheminAutorise(robots, UA, '/interdit-pour-nous/page')).toBe(false);
    expect(cheminAutorise(robots, UA, '/prive/')).toBe(true);
    expect(cheminAutorise(robots, 'Mozilla/5.0', '/prive/')).toBe(false);
    expect(cheminAutorise(robots, 'MechantBot/2.0', '/offre/1')).toBe(false);
  });

  it('applique la règle la plus longue, Allow l’emportant à égalité', () => {
    expect(cheminAutorise(robots, 'Autre-chose/1.0', '/prive/public/page')).toBe(true);
    expect(cheminAutorise(analyserRobots('User-agent: *\nDisallow: /a\nAllow: /a'), UA, '/a')).toBe(true);
  });

  it('gère les jokers « * » et l’ancre « $ »', () => {
    expect(cheminAutorise(robots, 'Mozilla/5.0', '/recherche?s=menage')).toBe(false);
    expect(cheminAutorise(robots, UA, '/fichier.pdf')).toBe(false);
    expect(cheminAutorise(robots, UA, '/fichier.pdf?v=2')).toBe(true);
  });

  it('autorise tout en l’absence de règle, et toujours /robots.txt', () => {
    expect(cheminAutorise(analyserRobots(''), UA, '/n-importe-quoi')).toBe(true);
    expect(cheminAutorise(analyserRobots('User-agent: *\nDisallow:'), UA, '/page')).toBe(true);
    expect(cheminAutorise(analyserRobots('User-agent: *\nDisallow: /'), UA, '/robots.txt')).toBe(true);
    expect(cheminAutorise(analyserRobots('User-agent: *\nDisallow: /'), UA, '/page')).toBe(false);
  });

  it('lit Crawl-delay, Sitemap et Content-Signal', () => {
    expect(delaiCrawlMs(robots, 'Mozilla/5.0')).toBe(10_000);
    expect(delaiCrawlMs(robots, UA)).toBeNull();
    expect(robots.sitemaps).toEqual(['https://emplois.example/sitemap.xml']);
    expect(robots.signaux).toEqual({ search: true, 'ai-train': false, 'ai-input': false });
    expect(resumerRobots(robots, UA)).toContain('ai-input=no');
  });
});

describe('connecteur RSS / Atom', () => {
  it('lit un flux RSS 2.0', () => {
    const elements = analyserFlux(fixture('flux-emplois.xml'));
    expect(elements).toHaveLength(7);
    expect(elements[0]).toMatchObject({ titre: 'Femme de ménage pour villa – Casablanca', identifiant: 'https://emplois.example/?p=1001', auteur: 'Famille test', categories: ['Services à la personne'] });
  });

  it('convertit un élément en annonce brute, sans HTML', () => {
    const [premier] = analyserFlux(fixture('flux-emplois.xml'));
    const offre = elementVersOffre(premier!, 'https://emplois.example/feed/');
    expect(offre?.texte).toContain('femme de ménage sérieuse');
    expect(offre?.texte).not.toContain('<');
    expect(offre?.publieLe?.toISOString()).toBe('2026-11-09T08:30:00.000Z');
    expect(offre?.precisionDate).toBe('exacte');
  });

  it('écarte un élément sans titre', () => {
    const elements = analyserFlux(fixture('flux-emplois.xml'));
    expect(elementVersOffre(elements[6]!, 'https://emplois.example/feed/')).toBeNull();
  });

  it('lit un flux Atom', () => {
    const [entree] = analyserFlux(fixture('flux-atom.xml'));
    expect(entree).toMatchObject({ titre: 'Esthéticienne confirmée – Institut Exemple Agadir', lien: 'https://emplois.example/offre/estheticienne-agadir/', date: '2026-11-05T10:00:00+01:00' });
    expect(elementVersOffre(entree!, 'https://emplois.example/atom')?.texte).toContain('Institut de beauté à Agadir');
  });

  it('ne développe aucune entité déclarée dans un DOCTYPE', () => {
    const piege = '<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY a "aaaa">]><rss><channel><item><title>Test &xxe; &a;</title><link>https://emplois.example/x</link></item></channel></rss>';
    expect(assainirXml(piege)).not.toContain('ENTITY');
    const [element] = analyserFlux(piege);
    expect(element?.titre).not.toContain('root:');
    expect(element?.titre).not.toContain('aaaa');
  });

  it('refuse un lien qui n’est pas http(s)', () => {
    const offre = elementVersOffre({ titre: 'Nounou', lien: 'javascript:alert(1)', identifiant: 'id-1', date: null, contenuHtml: '', categories: [], auteur: null }, 'https://emplois.example/feed/');
    expect(offre?.url).toBeNull();
  });
});

describe('connecteur sitemap', () => {
  it('distingue index et liste d’adresses', () => {
    const index = analyserSitemap(fixture('sitemap-index.xml'));
    expect(index.type).toBe('index');
    expect(index.type === 'index' && index.sitemaps).toHaveLength(3);
    const urls = analyserSitemap(fixture('sitemap-offres.xml'));
    expect(urls.type === 'urls' && urls.urls).toHaveLength(7);
  });

  it('déduit un titre lisible d’une adresse', () => {
    expect(titreDepuisAdresse('https://emplois.example/offre/femme-de-menage-casablanca-12345/')).toBe('Femme de menage casablanca');
    expect(titreDepuisAdresse('https://emplois.example/job/8841/nounou-a-domicile-rabat/')).toBe('Nounou a domicile rabat');
    expect(titreDepuisAdresse('https://emplois.example/12345')).toBe('');
  });

  it('extrait un JobPosting schema.org, y compris dans un @graph', () => {
    const annonces = extraireJobPostings(fixture('page-offre-jsonld.html'));
    expect(annonces).toHaveLength(1);
    const offre = jobPostingVersOffre(annonces[0]!, 'https://emplois.example/offre/x/');
    expect(offre).toMatchObject({
      idExterne: 'JOB-3001',
      titre: "Gouvernante d'étage H/F",
      employeur: 'Hôtel Exemple',
      lieu: 'Marrakech, Marrakech-Safi',
      pays: 'MA',
      precisionDate: 'exacte',
      champs: { tempsTravail: 'temps_plein', salaireMin: 6000, salaireMax: 7500, periodeSalaire: 'mois', devise: 'MAD', nombrePostes: 2 },
    });
    expect(offre?.publieLe?.toISOString().slice(0, 10)).toBe('2026-11-09');
    expect(offre?.expireLe?.toISOString()).toBe('2026-12-09T22:59:00.000Z');
    expect(offre?.texte).toContain('gouvernante d\'étage');
    expect(offre?.texte).not.toContain('<');
  });

  it('ignore un JSON-LD illisible', () => {
    expect(extraireJobPostings('<script type="application/ld+json">{ pas du json</script>')).toEqual([]);
  });

  it('lit une page sans données structurées, sans menus, formulaires ni scripts', () => {
    const offre = pageVersOffre(fixture('page-offre-simple.html'), 'https://emplois.example/offre/nounou/');
    expect(offre?.titre).toBe('Nounou à domicile | Rabat');
    expect(offre?.texte).toContain('Publiée le 8 novembre 2026');
    expect(offre?.texte).not.toContain('Toutes les offres');
    expect(offre?.texte).not.toContain('Postuler');
    expect(offre?.texte).not.toContain('suivi');
    expect(offre?.texte).not.toContain('Mentions légales');
  });
});

describe('import manuel et fichier', () => {
  it('prend la première ligne utile comme titre', () => {
    expect(titreDepuisTexte('\n  • URGENT Femme de ménage à Rabat\nDétails…')).toBe('URGENT Femme de ménage à Rabat');
    expect(titreDepuisTexte('')).toBe('');
    // Message d'employeur : la salutation et la présentation ne font pas un titre.
    expect(titreDepuisTexte('Bonjour, nous sommes le Riad Essai à Marrakech. Nous cherchons une réceptionniste parlant français et anglais. Merci.')).toBe(
      'Nous cherchons une réceptionniste parlant français et anglais.',
    );
    expect(titreDepuisTexte('Salam, je cherche une nounou à Rabat pour deux enfants')).toBe('je cherche une nounou à Rabat pour deux enfants');
    expect(titreDepuisTexte('السلام عليكم\nمطلوب عاملة نظافة بالدار البيضاء')).toBe('مطلوب عاملة نظافة بالدار البيضاء');
    // Aucun métier reconnu : première ligne utile, sans la salutation.
    expect(titreDepuisTexte('Bonjour,\nNous recrutons pour notre établissement à Agadir.\nMerci de nous contacter.')).toBe('Nous recrutons pour notre établissement à Agadir.');
    // Un mot qui commence comme une salutation n'est pas rogné.
    expect(titreDepuisTexte('Hiver 2026 : femme de chambre pour riad à Fès')).toBe('Hiver 2026 : femme de chambre pour riad à Fès');
    expect(titreDepuisTexte(`${'Très '.repeat(40)}longue première ligne`).length).toBeLessThanOrEqual(120);
  });

  it('donne le même identifiant au même texte recollé, et utilise l’adresse si elle existe', () => {
    const a = offreDepuisSaisie({ texte: 'Nounou à Rabat\nFamille cherche nounou.' });
    const b = offreDepuisSaisie({ texte: 'Nounou à Rabat\nFamille cherche nounou.' });
    expect(a.idExterne).toBe(b.idExterne);
    expect(a.idExterne.startsWith('saisie:')).toBe(true);
    expect(offreDepuisSaisie({ texte: 'x y z', url: 'https://www.emplois.example/o/1?utm_source=a' }).idExterne).toBe('https://emplois.example/o/1');
  });

  it('ne met jamais la date du jour par défaut', () => {
    const offre = offreDepuisSaisie({ texte: 'Nounou à Rabat' });
    expect(offre.publieLe).toBeNull();
    expect(offre.precisionDate).toBe('inconnue');
    expect(offreDepuisSaisie({ texte: 'Nounou', datePublication: '2026-11-08' }).precisionDate).toBe('exacte');
  });

  it('refuse une adresse qui n’est pas http(s)', () => {
    expect(offreDepuisSaisie({ texte: 'Nounou à Rabat', url: 'javascript:alert(1)' }).url).toBeNull();
  });

  it('analyse un CSV avec guillemets, point-virgule et BOM', () => {
    expect(analyserCsv('\uFEFFa;b\n"x;1";"dit ""oui"""\n')).toEqual([['a', 'b'], ['x;1', 'dit "oui"']]);
    expect(analyserCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('importe un fichier CSV et signale les lignes invalides', () => {
    const resultat = analyserFichier(fixture('offres.csv'), 'offres.csv');
    expect(resultat.offres).toHaveLength(2);
    expect(resultat.erreurs).toEqual(['ligne 4 : titre absent']);
    expect(resultat.offres[0]).toMatchObject({ titre: 'Femme de chambre', employeur: 'Riad Exemple', lieu: 'Marrakech', idExterne: 'https://partenaire.example/offres/12', champs: { salaireMin: 3800, contrat: 'cdd' } });
    expect(resultat.offres[0]?.texte).toContain('"sérieuse"');
    expect(resultat.offres[0]?.publieLe?.toISOString().slice(0, 10)).toBe('2026-11-05');
  });

  it('importe un fichier JSON', () => {
    const resultat = analyserFichier(JSON.stringify([{ title: 'Nounou', city: 'Rabat', date: '2026-11-01', salaire: 3500 }, { description: 'sans titre' }]), 'offres.json');
    expect(resultat.offres).toHaveLength(1);
    expect(resultat.erreurs).toHaveLength(1);
    expect(analyserFichier('{ cassé', 'x.json').erreurs).toEqual(['Le fichier JSON est illisible.']);
  });
});
