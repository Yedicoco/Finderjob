/**
 * Catalogue initial des sources.
 *
 * TOUTES les sources automatisées sont créées DÉSACTIVÉES. La base refuse
 * d'en activer une tant que l'administrateur n'a pas consigné : une base
 * juridique, la date de sa propre lecture des conditions d'utilisation, et
 * une autorisation (« non requise » ou « accordée »).
 *
 * Les constats ci-dessous ont été relevés le 10 novembre 2026. Ils décrivent
 * ce qui a été LU ce jour-là ; ils ne remplacent ni la relecture des
 * conditions par Yallah Services, ni un avis juridique. Détail et sources :
 * docs/08-plan-de-collecte.md.
 */
export type SourceInitiale = {
  code: string;
  name: string;
  kind: 'rss' | 'sitemap' | 'api' | 'manuel' | 'fichier';
  base_url: string | null;
  feed_url: string | null;
  collection_mode: 'desactive' | 'manuel' | 'index_liens' | 'extrait' | 'texte_complet';
  is_active: boolean;
  legal_basis: string | null;
  permission_status: 'non_requise' | 'non_demandee' | 'demandee' | 'accordee' | 'refusee';
  terms_url: string | null;
  terms_summary: string | null;
  robots_summary: string | null;
  store_contacts: boolean;
  country_default: 'MA' | null;
  reliability_score: number;
  max_excerpt_chars: number;
  config: Record<string, unknown>;
  notes: string;
};

const RELEVE = 'Relevé du 10/11/2026.';

export const SOURCES_INITIALES: SourceInitiale[] = [
  // ------------------------------------------------ sources internes (actives) --
  {
    code: 'saisie-manuelle',
    name: 'Annonce lue par un courtier (import manuel)',
    kind: 'manuel',
    base_url: null,
    feed_url: null,
    collection_mode: 'manuel',
    is_active: true,
    legal_basis: 'Consultation humaine d’une annonce publique ; seuls un extrait court et le lien sont conservés, pour un usage interne.',
    permission_status: 'non_requise',
    terms_url: null,
    terms_summary: null,
    robots_summary: null,
    store_contacts: false,
    country_default: null,
    reliability_score: 55,
    max_excerpt_chars: 300,
    config: {},
    notes: 'Aucune requête automatique : le courtier colle le texte qu’il a lu. Les coordonnées présentes dans l’annonce ne sont pas conservées.',
  },
  {
    code: 'annonce-confiee',
    name: 'Annonce confiée par l’employeur',
    kind: 'manuel',
    base_url: null,
    feed_url: null,
    collection_mode: 'texte_complet',
    is_active: true,
    legal_basis: 'Annonce transmise directement à Yallah Services par l’employeur (demande entrante).',
    permission_status: 'non_requise',
    terms_url: null,
    terms_summary: null,
    robots_summary: null,
    store_contacts: true,
    country_default: 'MA',
    reliability_score: 85,
    max_excerpt_chars: 600,
    config: {},
    notes: 'Message WhatsApp, appel, e-mail ou formulaire du site : l’employeur a lui-même communiqué l’annonce et ses coordonnées.',
  },
  {
    code: 'fichier-partenaire',
    name: 'Fichier CSV / JSON fourni par un partenaire',
    kind: 'fichier',
    base_url: null,
    feed_url: null,
    collection_mode: 'manuel',
    is_active: true,
    legal_basis: 'Fichier remis volontairement par un partenaire ou un employeur.',
    permission_status: 'non_requise',
    terms_url: null,
    terms_summary: null,
    robots_summary: null,
    store_contacts: false,
    country_default: null,
    reliability_score: 70,
    max_excerpt_chars: 400,
    config: {},
    notes: 'Aucun réseau. Vérifier avec le partenaire ce qu’il autorise à conserver avant de passer en « texte complet ».',
  },

  // ------------------------------ sites d'emploi examinés (collecte désactivée) --
  {
    code: 'rekrute',
    name: 'ReKrute',
    kind: 'sitemap',
    base_url: 'https://www.rekrute.com/',
    feed_url: null,
    collection_mode: 'manuel',
    is_active: false,
    legal_basis: null,
    permission_status: 'non_demandee',
    terms_url: 'https://www.rekrute.com/mentions-legales.html',
    terms_summary:
      `${RELEVE} Les mentions légales interdisent « d’utiliser ou d’extraire en tout ou en partie les bases de données » du site et les liens profonds hors page d’accueil ; les conditions générales de vente interdisent l’extraction substantielle ou répétée des offres et leur exploitation commerciale. Collecte automatisée INTERDITE sans accord écrit.`,
    robots_summary:
      `${RELEVE} Pas de groupe « User-agent: * » ; les agrégateurs d’offres (Jooblebot, JobBot) et de nombreux robots sont bloqués nommément ; /offres.html interdit aux robots autorisés.`,
    store_contacts: false,
    country_default: null,
    reliability_score: 75,
    max_excerpt_chars: 200,
    config: {},
    notes: 'Import manuel uniquement. Les liens profonds étant contestés par les mentions légales, le lien est gardé pour l’usage interne et n’est jamais publié. Toute automatisation suppose un partenariat écrit.',
  },
  {
    code: 'indeed-ma',
    name: 'Indeed Maroc',
    kind: 'api',
    base_url: 'https://ma.indeed.com/',
    feed_url: null,
    collection_mode: 'manuel',
    is_active: false,
    legal_basis: null,
    permission_status: 'non_demandee',
    terms_url: 'https://www.indeed.com/legal',
    terms_summary:
      `${RELEVE} D’après deux sources secondaires concordantes, les conditions d’Indeed interdisent tout accès par robot, spider ou scraper sans autorisation écrite expresse ; le site est en outre protégé contre l’accès automatisé. Collecte automatisée INTERDITE. À relire sur le texte officiel.`,
    robots_summary: `${RELEVE} Non relu pour ce relevé. Une source secondaire indique que robots.txt ferme les pages d’offres et de recherche : à vérifier directement.`,
    store_contacts: false,
    country_default: null,
    reliability_score: 70,
    max_excerpt_chars: 200,
    config: {},
    notes: 'Import manuel uniquement. Seule voie d’automatisation : un accord ou un programme partenaire officiel d’Indeed.',
  },
  {
    code: 'emploi-ma',
    name: 'Emploi.ma',
    kind: 'sitemap',
    base_url: 'https://www.emploi.ma/',
    feed_url: null,
    collection_mode: 'manuel',
    is_active: false,
    legal_basis: null,
    permission_status: 'non_demandee',
    terms_url: null,
    terms_summary: `${RELEVE} Conditions générales non relues : À LIRE avant toute activation.`,
    robots_summary:
      `${RELEVE} « User-agent: * » : Allow: / avec Content-Signal: search=yes, ai-train=no, use=reference. L’indexation avec lien et court extrait est admise par ce signal ; l’entraînement de modèles d’IA est refusé ; aucun signal « ai-input » n’est donné (ni accordé, ni refusé). Robots d’entraînement d’IA bloqués nommément.`,
    store_contacts: false,
    country_default: null,
    reliability_score: 70,
    max_excerpt_chars: 200,
    config: {},
    notes: 'Le signal search=yes rend plausible un mode « index de liens » (titre, lien, date), mais robots.txt ne vaut pas autorisation contractuelle : lire les conditions générales et demander un accord écrit. Traitement par IA à laisser désactivé.',
  },
  {
    code: 'marocemploi',
    name: 'MarocEmploi.net',
    kind: 'sitemap',
    base_url: 'https://marocemploi.net/',
    feed_url: 'https://marocemploi.net/sitemap.xml',
    collection_mode: 'manuel',
    is_active: false,
    legal_basis: null,
    permission_status: 'non_demandee',
    terms_url: null,
    terms_summary: `${RELEVE} Conditions d’utilisation non relues : À LIRE avant toute activation.`,
    robots_summary:
      `${RELEVE} « User-agent: * » : interdit /wp-admin/, /wp-login.php, /embed/, /pr/, /ma/ et la pagination (?page=). Sitemaps déclarés : /sitemap.xml et /sitemaps.xml. GPTBot, ClaudeBot, PerplexityBot et Google-Extended explicitement autorisés.`,
    store_contacts: false,
    country_default: null,
    reliability_score: 55,
    max_excerpt_chars: 200,
    config: { motifSitemap: 'job' },
    notes: 'Le flux /feed/ est éditorial (articles), pas un flux d’offres : la découverte passerait par le sitemap des offres. Site d’annonces généraliste : fiabilité à confirmer à l’usage.',
  },
  {
    code: 'dreamjob',
    name: 'Dreamjob.ma',
    kind: 'rss',
    base_url: 'https://www.dreamjob.ma/',
    feed_url: 'https://www.dreamjob.ma/emploi/feed/',
    collection_mode: 'manuel',
    is_active: false,
    legal_basis: null,
    permission_status: 'non_demandee',
    terms_url: null,
    terms_summary: `${RELEVE} Conditions d’utilisation non relues : À LIRE avant toute activation.`,
    robots_summary: `${RELEVE} « User-agent: * » : interdit /wp-admin/, la recherche (/?s=) et /wp-json/wp/v2/. Sitemaps déclarés : /sitemap_index.xml et /news-sitemap.xml.`,
    store_contacts: false,
    country_default: null,
    reliability_score: 60,
    max_excerpt_chars: 200,
    config: {},
    notes: 'Un flux RSS des offres existe (/emploi/feed/) : c’est le canal de syndication prévu par l’éditeur, donc le candidat le plus simple à un mode « extrait + lien » — après lecture des conditions et, de préférence, accord écrit.',
  },
  {
    code: 'jobsquare',
    name: 'Jobsquare.ma',
    kind: 'sitemap',
    base_url: 'https://www.jobsquare.ma/',
    feed_url: 'https://www.jobsquare.ma/sitemap_index.xml',
    collection_mode: 'manuel',
    is_active: false,
    legal_basis: null,
    permission_status: 'non_demandee',
    terms_url: 'https://www.jobsquare.ma/terms-of-use/',
    terms_summary: `${RELEVE} Page de conditions repérée mais non relue pour ce relevé : À LIRE avant toute activation.`,
    robots_summary:
      `${RELEVE} « User-agent: * » : Allow: / ; interdit /admin/, /system/, /temp/, /resume/ (CV), les paramètres de recherche (searchID, keyword, backPage), l’espace personnel et /go-link. Les fiches /job/ restent ouvertes. Sitemap déclaré : /sitemap_index.xml.`,
    store_contacts: false,
    country_default: null,
    reliability_score: 60,
    max_excerpt_chars: 200,
    config: { motifUrl: '/job/', motifSitemap: 'job' },
    notes: 'Le site présente une page « API et intégrations » destinée aux recruteurs : la voie à privilégier est de demander un accès officiel plutôt que de lire les pages.',
  },
];
