/**
 * Sources d'offres : lecture, modification encadrée, garde-fous de conformité.
 * La base porte la règle (contrainte job_sources_activation_conforme) ; ce
 * module la répète pour donner un message clair avant l'écriture.
 */
import type { Source } from '@/collecte/types';
import { MODES_COLLECTE, STATUTS_AUTORISATION } from '@/domaine/referentiels';
import { journaliser, type Acteur } from './audit';
import { executer, requete, uneLigne, type Executeur } from './db';
import { ErreurMetier } from '@/domaine/erreurs';

export type SourceComplete = Source & {
  permission_reference: string | null;
  terms_url: string | null;
  terms_summary: string | null;
  terms_checked_at: Date | null;
  robots_summary: string | null;
  robots_checked_at: Date | null;
  last_success_at: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

export class ErreurSource extends ErreurMetier {}

export async function listerSources(tx?: Executeur): Promise<(SourceComplete & { nb_offres: number })[]> {
  return requete(
    `SELECT s.*, (SELECT count(*)::int FROM job_offers o WHERE o.source_id = s.id) AS nb_offres
       FROM job_sources s ORDER BY (s.kind IN ('manuel', 'fichier')) DESC, s.name`,
    [],
    tx,
  );
}

export async function sourceParId(id: string, tx?: Executeur): Promise<SourceComplete | null> {
  return uneLigne<SourceComplete>(`SELECT * FROM job_sources WHERE id = $1`, [id], tx);
}

export async function sourceParCode(code: string, tx?: Executeur): Promise<SourceComplete | null> {
  return uneLigne<SourceComplete>(`SELECT * FROM job_sources WHERE code = $1`, [code], tx);
}

const estAutomatisee = (kind: string) => kind === 'rss' || kind === 'sitemap' || kind === 'api';

/** Raisons pour lesquelles une source ne peut pas être activée (liste vide = conforme). */
export function obstaclesActivation(source: Pick<SourceComplete, 'kind' | 'legal_basis' | 'terms_checked_at' | 'permission_status' | 'collection_mode' | 'feed_url'>): string[] {
  if (!estAutomatisee(source.kind)) return source.collection_mode === 'desactive' ? ['Le mode de collecte est « désactivée ».'] : [];
  const obstacles: string[] = [];
  if (source.kind === 'api') obstacles.push('Aucun connecteur d’API n’est livré : une API officielle demande un accord et un développement dédié.');
  if (!source.feed_url) obstacles.push('L’adresse du flux ou du sitemap est absente.');
  if (!source.legal_basis || source.legal_basis.trim().length < 10) obstacles.push('La base juridique n’est pas consignée (10 caractères au moins).');
  if (!source.terms_checked_at) obstacles.push('La date de lecture des conditions d’utilisation n’est pas consignée.');
  if (source.permission_status !== 'non_requise' && source.permission_status !== 'accordee') obstacles.push('L’autorisation doit être « non requise » ou « accordée ».');
  if (!['index_liens', 'extrait', 'texte_complet'].includes(source.collection_mode)) obstacles.push('Le mode de collecte doit être « index de liens », « extrait » ou « texte complet ».');
  if (source.collection_mode === 'texte_complet' && source.permission_status !== 'accordee') obstacles.push('Le texte complet exige une autorisation écrite accordée.');
  return obstacles;
}

export type ModificationSource = Partial<{
  name: string;
  feed_url: string | null;
  collection_mode: string;
  is_active: boolean;
  legal_basis: string | null;
  permission_status: string;
  permission_reference: string | null;
  terms_url: string | null;
  terms_summary: string | null;
  conditionsLuesAujourdhui: boolean;
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
  notes: string | null;
}>;

function urlHttps(valeur: string | null | undefined, nom: string): string | null {
  if (!valeur || !valeur.trim()) return null;
  let url: URL;
  try {
    url = new URL(valeur.trim());
  } catch {
    throw new ErreurSource(`${nom} : adresse invalide.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ErreurSource(`${nom} : l’adresse doit commencer par https:// ou http://.`);
  if (url.username || url.password) throw new ErreurSource(`${nom} : une adresse ne doit pas contenir d’identifiants.`);
  return url.href;
}

function borne(valeur: number | undefined, actuel: number, min: number, max: number, nom: string): number {
  if (valeur === undefined) return actuel;
  if (!Number.isFinite(valeur) || valeur < min || valeur > max) throw new ErreurSource(`${nom} : valeur attendue entre ${min} et ${max}.`);
  return Math.round(valeur);
}

export async function modifierSource(id: string, m: ModificationSource, acteur: Acteur, maintenant = new Date()): Promise<SourceComplete> {
  const actuelle = await sourceParId(id);
  if (!actuelle) throw new ErreurSource('Source introuvable.');
  const mode = m.collection_mode ?? actuelle.collection_mode;
  if (!MODES_COLLECTE.est(mode)) throw new ErreurSource('Mode de collecte inconnu.');
  const autorisation = m.permission_status ?? actuelle.permission_status;
  if (!STATUTS_AUTORISATION.est(autorisation)) throw new ErreurSource('Statut d’autorisation inconnu.');
  if (autorisation === 'accordee' && !(m.permission_reference ?? actuelle.permission_reference)?.trim()) {
    throw new ErreurSource('Une autorisation « accordée » doit citer sa référence (date, interlocuteur, e-mail ou contrat).');
  }
  const suivante = {
    ...actuelle,
    name: m.name?.trim() || actuelle.name,
    feed_url: m.feed_url === undefined ? actuelle.feed_url : urlHttps(m.feed_url, 'Adresse du flux'),
    collection_mode: mode,
    is_active: m.is_active ?? actuelle.is_active,
    legal_basis: m.legal_basis === undefined ? actuelle.legal_basis : m.legal_basis?.trim() || null,
    permission_status: autorisation,
    permission_reference: m.permission_reference === undefined ? actuelle.permission_reference : m.permission_reference?.trim() || null,
    terms_url: m.terms_url === undefined ? actuelle.terms_url : urlHttps(m.terms_url, 'Adresse des conditions'),
    terms_summary: m.terms_summary === undefined ? actuelle.terms_summary : m.terms_summary?.trim() || null,
    terms_checked_at: m.conditionsLuesAujourdhui ? maintenant : actuelle.terms_checked_at,
    min_delay_ms: borne(m.min_delay_ms, actuelle.min_delay_ms, 1000, 120_000, 'Délai entre requêtes (ms)'),
    max_requests_per_run: borne(m.max_requests_per_run, actuelle.max_requests_per_run, 1, 500, 'Requêtes par exécution'),
    frequency_minutes: borne(m.frequency_minutes, actuelle.frequency_minutes, 60, 10_080, 'Fréquence (minutes)'),
    max_excerpt_chars: borne(m.max_excerpt_chars, actuelle.max_excerpt_chars, 0, 5000, 'Longueur de l’extrait'),
    allow_ai_processing: m.allow_ai_processing ?? actuelle.allow_ai_processing,
    store_contacts: m.store_contacts ?? actuelle.store_contacts,
    keep_unclassified: m.keep_unclassified ?? actuelle.keep_unclassified,
    country_default: m.country_default === undefined ? actuelle.country_default : m.country_default === 'MA' ? 'MA' : null,
    reliability_score: borne(m.reliability_score, actuelle.reliability_score, 0, 100, 'Fiabilité'),
    config: m.config ?? actuelle.config,
    notes: m.notes === undefined ? actuelle.notes : m.notes?.trim() || null,
  };
  if (suivante.is_active) {
    const obstacles = obstaclesActivation(suivante);
    if (obstacles.length > 0) throw new ErreurSource(`Activation impossible : ${obstacles.join(' ')}`);
  }
  if (estAutomatisee(suivante.kind) && suivante.store_contacts && suivante.permission_status !== 'accordee') {
    throw new ErreurSource('Conserver les coordonnées d’annonces collectées automatiquement exige une autorisation écrite accordée.');
  }
  if (estAutomatisee(suivante.kind) && suivante.collection_mode === 'texte_complet' && suivante.permission_status !== 'accordee') {
    throw new ErreurSource('Le texte complet exige une autorisation écrite accordée.');
  }
  await executer(
    `UPDATE job_sources SET name = $2, feed_url = $3, collection_mode = $4, is_active = $5, legal_basis = $6, permission_status = $7,
            permission_reference = $8, terms_url = $9, terms_summary = $10, terms_checked_at = $11, min_delay_ms = $12,
            max_requests_per_run = $13, frequency_minutes = $14, max_excerpt_chars = $15, allow_ai_processing = $16, store_contacts = $17,
            keep_unclassified = $18, country_default = $19, reliability_score = $20, config = $21::jsonb, notes = $22,
            paused_until = CASE WHEN $5 THEN paused_until ELSE NULL END
      WHERE id = $1`,
    [
      id, suivante.name, suivante.feed_url, suivante.collection_mode, suivante.is_active, suivante.legal_basis, suivante.permission_status,
      suivante.permission_reference, suivante.terms_url, suivante.terms_summary, suivante.terms_checked_at, suivante.min_delay_ms,
      suivante.max_requests_per_run, suivante.frequency_minutes, suivante.max_excerpt_chars, suivante.allow_ai_processing, suivante.store_contacts,
      suivante.keep_unclassified, suivante.country_default, suivante.reliability_score, JSON.stringify(suivante.config), suivante.notes,
    ],
  );
  const champs = (Object.keys(m) as (keyof ModificationSource)[]).filter((cle) => m[cle] !== undefined);
  await journaliser({
    acteur,
    action: suivante.is_active !== actuelle.is_active ? (suivante.is_active ? 'source.activation' : 'source.desactivation') : 'source.modification',
    entite: 'source',
    id,
    resume: `Source « ${actuelle.name} » ${suivante.is_active !== actuelle.is_active ? (suivante.is_active ? 'activée' : 'désactivée') : 'modifiée'}`,
    changements: { champs, mode: [actuelle.collection_mode, suivante.collection_mode], autorisation: [actuelle.permission_status, suivante.permission_status] },
  });
  return (await sourceParId(id))!;
}

export type Execution = {
  id: string;
  source_id: string;
  source_name: string;
  trigger_kind: string;
  status: string;
  started_at: Date;
  finished_at: Date | null;
  http_requests: number;
  robots_blocked_count: number;
  fetched_count: number;
  new_count: number;
  updated_count: number;
  unchanged_count: number;
  duplicate_count: number;
  rejected_count: number;
  error_count: number;
  message: string | null;
};

export async function listerExecutions(limite = 30, sourceId?: string): Promise<Execution[]> {
  return requete<Execution>(
    `SELECT r.*, s.name AS source_name FROM scraping_runs r JOIN job_sources s ON s.id = r.source_id
      ${sourceId ? 'WHERE r.source_id = $2' : ''} ORDER BY r.started_at DESC LIMIT $1`,
    sourceId ? [limite, sourceId] : [limite],
  );
}

export async function rejetsRecents(limite = 50): Promise<{ id: number; source_name: string; title: string | null; source_url: string | null; reason: string; detail: string | null; created_at: Date }[]> {
  return requete(
    `SELECT j.id, s.name AS source_name, j.title, j.source_url, j.reason, j.detail, j.created_at
       FROM ingestion_rejections j JOIN job_sources s ON s.id = j.source_id ORDER BY j.created_at DESC LIMIT $1`,
    [limite],
  );
}
