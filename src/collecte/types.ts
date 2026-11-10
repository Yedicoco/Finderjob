/**
 * Types partagés par les connecteurs et le pipeline de collecte.
 */
import type { PrecisionDate } from '@/domaine/extraction';

export type TypeSource = 'rss' | 'sitemap' | 'api' | 'manuel' | 'fichier';
export type ModeCollecte = 'desactive' | 'manuel' | 'index_liens' | 'extrait' | 'texte_complet';

/** Ligne de la table job_sources (colonnes utiles à la collecte). */
export type Source = {
  id: string;
  code: string;
  name: string;
  kind: TypeSource;
  base_url: string | null;
  feed_url: string | null;
  collection_mode: ModeCollecte;
  is_active: boolean;
  legal_basis: string | null;
  permission_status: string;
  user_agent: string | null;
  min_delay_ms: number;
  max_requests_per_run: number;
  frequency_minutes: number;
  max_excerpt_chars: number;
  allow_ai_processing: boolean;
  store_contacts: boolean;
  keep_unclassified: boolean;
  country_default: string | null;
  reliability_score: number;
  config: Record<string, unknown>;
  http_cache: Record<string, { etag?: string; lastModified?: string }>;
  last_run_at: Date | null;
  consecutive_failures: number;
  paused_until: Date | null;
};

/** Champs déjà structurés par la source (JSON-LD JobPosting, colonnes d'un fichier, formulaire). */
export type ChampsStructures = {
  contrat?: string | null;
  tempsTravail?: string | null;
  salaireMin?: number | null;
  salaireMax?: number | null;
  periodeSalaire?: 'mois' | 'semaine' | 'jour' | 'heure' | null;
  devise?: string | null;
  nombrePostes?: number | null;
  typeEmployeur?: string | null;
  ville?: string | null;
  quartier?: string | null;
  logement?: 'loge' | 'non_loge' | null;
  urgent?: boolean;
};

/** Une annonce telle que le connecteur la rend, avant toute analyse. */
export type OffreBrute = {
  /** Identifiant stable dans la source (GUID RSS, URL, identifiant JSON-LD…). */
  idExterne: string;
  url: string | null;
  titre: string;
  /** Texte brut (jamais de HTML). Peut être vide en mode « index de liens ». */
  texte: string;
  employeur?: string | null;
  /** Lieu structuré fourni par la source (ville, région). */
  lieu?: string | null;
  /** Pays structuré fourni par la source (code ISO ou nom). */
  pays?: string | null;
  publieLe?: Date | null;
  precisionDate?: PrecisionDate;
  expireLe?: Date | null;
  majLe?: Date | null;
  champs?: ChampsStructures;
};

export type MotifRejet = 'hors_maroc' | 'hors_taxonomie' | 'contenu_vide' | 'robots_interdit' | 'erreur_extraction' | 'doublon_exact';

export type ResultatConnecteur = {
  offres: OffreBrute[];
  /** Pages écartées avant analyse (robots.txt, page illisible…). */
  ecartees: { url: string; motif: MotifRejet; detail?: string }[];
  /** true : la source n'a rien de nouveau (réponse 304). */
  inchange: boolean;
  /** Le quota de requêtes a été atteint avant la fin : exécution partielle. */
  partiel: boolean;
  avertissements: string[];
};
