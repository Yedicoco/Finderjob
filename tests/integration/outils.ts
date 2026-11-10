/**
 * Outils partagés par les tests d'intégration : base vidée, référentiels
 * chargés, trois comptes (un par rôle), faux site HTTP en mémoire.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { inject } from 'vitest';
import type { Acteur } from '@/serveur/audit';
import { acteurDe, creerUtilisateur, type Utilisateur } from '@/serveur/auth';
import { reinitialiserCles } from '@/serveur/config';
import { definirPool, executer, fermerPool } from '@/serveur/db';
import { oublierParametres } from '@/serveur/parametres';
import { synchroniserReferentiels } from '@/serveur/referentiel';

export const MAINTENANT = new Date('2026-11-10T10:00:00Z');
export const MOT_DE_PASSE = 'Essai-Solide-2026!';

export const fixture = (nom: string) => readFileSync(path.join(__dirname, '..', 'fixtures', nom), 'utf8');

const TABLES = [
  'notifications', 'alerts', 'search_queries', 'commissions', 'placements', 'matches', 'candidate_references', 'candidate_skills',
  'candidate_profile_categories', 'candidate_profiles', 'candidates', 'employer_needs', 'job_offer_versions', 'job_offer_skills', 'job_offer_categories',
  'job_offers', 'employer_interactions', 'employers', 'ingestion_rejections', 'scraping_runs', 'job_sources', 'skills', 'job_categories', 'districts',
  'cities', 'counters', 'app_settings', 'rate_limits', 'sessions', 'audit_logs', 'users',
];

export type Monde = { admin: Utilisateur; courtier: Utilisateur; lecteur: Utilisateur; acteurAdmin: Acteur; acteurCourtier: Acteur };

export async function preparerBase(): Promise<Monde> {
  process.env.YS_CLE_SECRETE = Buffer.alloc(32, 7).toString('base64');
  reinitialiserCles();
  oublierParametres();
  await fermerPool();
  definirPool(new pg.Pool({ connectionString: inject('urlBase'), max: 4 }));
  await executer(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  await synchroniserReferentiels();
  const systeme: Acteur = { id: null, libelle: 'tests', role: null };
  const admin = await creerUtilisateur({ email: 'admin@yallah.example', nom: 'Administratrice Test', role: 'administrateur', motDePasse: MOT_DE_PASSE, doitChanger: false }, systeme);
  const courtier = await creerUtilisateur({ email: 'courtier@yallah.example', nom: 'Courtier Test', role: 'courtier', motDePasse: MOT_DE_PASSE, doitChanger: false }, systeme);
  const lecteur = await creerUtilisateur({ email: 'lecteur@yallah.example', nom: 'Lecteur Test', role: 'lecteur', motDePasse: MOT_DE_PASSE, doitChanger: false }, systeme);
  return { admin, courtier, lecteur, acteurAdmin: acteurDe(admin), acteurCourtier: acteurDe(courtier) };
}

export async function fermerBase(): Promise<void> {
  await fermerPool();
}

type Route = { statut?: number; corps?: string; type?: string; entetes?: Record<string, string> };

/** Faux site : aucune requête réelle ne sort des tests. */
export function fauxSite(routes: Record<string, Route | ((requete: Request) => Route)>) {
  const appels: string[] = [];
  const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = entree instanceof URL ? entree.href : typeof entree === 'string' ? entree : entree.url;
    const requete = new Request(url, init);
    appels.push(url);
    const definition = routes[url];
    const route = typeof definition === 'function' ? definition(requete) : definition;
    if (!route) return new Response('introuvable', { status: 404 });
    return new Response(route.statut === 304 ? null : (route.corps ?? ''), { status: route.statut ?? 200, headers: { 'content-type': route.type ?? 'text/html; charset=utf-8', ...(route.entetes ?? {}) } });
  }) as typeof fetch;
  return { fetchImpl, appels };
}

/** Source RSS de test, conforme et active (site fictif « emplois.example »). */
export async function creerSourceTest(surcharge: Record<string, unknown> = {}): Promise<string> {
  const valeurs: Record<string, unknown> = {
    code: 'test-rss', name: 'Emplois fictifs (test)', kind: 'rss', base_url: 'https://emplois.example/', feed_url: 'https://emplois.example/feed/',
    collection_mode: 'extrait', is_active: true, legal_basis: 'Jeu d’essai : site fictif, aucune requête réelle.', permission_status: 'accordee',
    permission_reference: 'Test', terms_checked_at: MAINTENANT, min_delay_ms: 1000, max_requests_per_run: 30, reliability_score: 60, ...surcharge,
  };
  const colonnes = Object.keys(valeurs);
  const { requete } = await import('@/serveur/db');
  const lignes = await requete<{ id: string }>(`INSERT INTO job_sources (${colonnes.join(', ')}) VALUES (${colonnes.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(valeurs));
  return lignes[0]!.id;
}
