/**
 * Référentiels en base : villes, quartiers, catégories de métiers, compétences.
 * Le code (src/domaine) est la source ; la base en reçoit une copie à chaque
 * initialisation, pour les clés étrangères et les jointures.
 */
import { QUARTIERS, VILLES } from '@/domaine/geographie';
import { COMPETENCES, DOCUMENTS_CANDIDAT } from '@/domaine/referentiels';
import { METIERS, SECTEURS } from '@/domaine/taxonomie';
import { executer, requete, uneLigne, type Executeur } from './db';
import { SOURCES_INITIALES } from './sources-initiales';

type Caches = { categories: Map<string, string> | null; competences: Map<string, string> | null };
const caches: Caches = ((globalThis as { __ysRef?: Caches }).__ysRef ??= { categories: null, competences: null });

export function oublierCachesReferentiels(): void {
  caches.categories = null;
  caches.competences = null;
}

export async function idsCategories(tx?: Executeur): Promise<Map<string, string>> {
  if (caches.categories && !tx) return caches.categories;
  const lignes = await requete<{ code: string; id: string }>(`SELECT code, id FROM job_categories`, [], tx);
  const carte = new Map(lignes.map((ligne) => [ligne.code, ligne.id]));
  if (!tx) caches.categories = carte;
  return carte;
}

export async function idsCompetences(tx?: Executeur): Promise<Map<string, string>> {
  if (caches.competences && !tx) return caches.competences;
  const lignes = await requete<{ code: string; id: string }>(`SELECT code, id FROM skills`, [], tx);
  const carte = new Map(lignes.map((ligne) => [ligne.code, ligne.id]));
  if (!tx) caches.competences = carte;
  return carte;
}

export async function synchroniserReferentiels(tx?: Executeur): Promise<{ villes: number; quartiers: number; categories: number; competences: number; sources: number; sourcesAjoutees: number }> {
  for (const [ordre, ville] of VILLES.entries()) {
    await executer(
      `INSERT INTO cities (code, name_fr, name_ar, region, yallah_status, yallah_phase, aliases, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (code) DO UPDATE SET name_fr = EXCLUDED.name_fr, name_ar = EXCLUDED.name_ar, region = EXCLUDED.region,
         yallah_status = EXCLUDED.yallah_status, yallah_phase = EXCLUDED.yallah_phase, aliases = EXCLUDED.aliases, sort_order = EXCLUDED.sort_order`,
      [ville.code, ville.nom, ville.nomAr, ville.region, ville.statut, ville.phase ?? null, ville.alias ?? [], ordre],
      tx,
    );
  }
  for (const quartier of QUARTIERS) {
    await executer(
      `INSERT INTO districts (city_code, name, is_target_zone, aliases) VALUES ($1, $2, $3, $4)
       ON CONFLICT (city_code, name) DO UPDATE SET is_target_zone = EXCLUDED.is_target_zone, aliases = EXCLUDED.aliases`,
      [quartier.ville, quartier.nom, quartier.cible, quartier.alias ?? []],
      tx,
    );
  }
  for (const secteur of SECTEURS) {
    await executer(
      `INSERT INTO job_categories (code, level, label_fr, label_ar, label_en, yallah_priority, sort_order)
       VALUES ($1, 'secteur', $2, $3, $4, 100, $5)
       ON CONFLICT (code) DO UPDATE SET label_fr = EXCLUDED.label_fr, label_ar = EXCLUDED.label_ar, label_en = EXCLUDED.label_en, sort_order = EXCLUDED.sort_order`,
      [secteur.code, secteur.libelle.fr, secteur.libelle.ar, secteur.libelle.en, secteur.ordre],
      tx,
    );
  }
  for (const [ordre, metier] of METIERS.entries()) {
    await executer(
      `INSERT INTO job_categories (code, parent_id, level, label_fr, label_ar, label_en, keywords, yallah_priority, sort_order)
       VALUES ($1, (SELECT id FROM job_categories WHERE code = $2), 'metier', $3, $4, $5, $6::jsonb, $7, $8)
       ON CONFLICT (code) DO UPDATE SET parent_id = EXCLUDED.parent_id, label_fr = EXCLUDED.label_fr, label_ar = EXCLUDED.label_ar,
         label_en = EXCLUDED.label_en, keywords = EXCLUDED.keywords, yallah_priority = EXCLUDED.yallah_priority, sort_order = EXCLUDED.sort_order`,
      [metier.code, metier.secteur, metier.libelle.fr, metier.libelle.ar, metier.libelle.en, JSON.stringify({ forts: metier.forts, faibles: metier.faibles ?? [] }), metier.priorite, ordre],
      tx,
    );
  }
  for (const competence of COMPETENCES) {
    await executer(
      `INSERT INTO skills (code, label_fr, label_ar, label_en, kind) VALUES ($1, $2, $3, $4, 'competence')
       ON CONFLICT (code) DO UPDATE SET label_fr = EXCLUDED.label_fr, label_ar = EXCLUDED.label_ar, label_en = EXCLUDED.label_en`,
      [competence.code, competence.fr, competence.ar, competence.en],
      tx,
    );
  }
  for (const document of DOCUMENTS_CANDIDAT.options) {
    await executer(`INSERT INTO skills (code, label_fr, kind) VALUES ($1, $2, 'document') ON CONFLICT (code) DO UPDATE SET label_fr = EXCLUDED.label_fr`, [`doc_${document.valeur}`, document.libelle], tx);
  }
  // Sources : créées une seule fois. Une source déjà présente n'est JAMAIS écrasée
  // (l'administrateur a pu y consigner une autorisation ou la désactiver).
  let sourcesAjoutees = 0;
  for (const source of SOURCES_INITIALES) {
    sourcesAjoutees += await executer(
      `INSERT INTO job_sources (code, name, kind, base_url, feed_url, collection_mode, is_active, legal_basis, permission_status, terms_url,
                                terms_summary, robots_summary, store_contacts, country_default, reliability_score, max_excerpt_chars, config, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18)
       ON CONFLICT (code) DO NOTHING`,
      [
        source.code, source.name, source.kind, source.base_url, source.feed_url, source.collection_mode, source.is_active, source.legal_basis,
        source.permission_status, source.terms_url, source.terms_summary, source.robots_summary, source.store_contacts, source.country_default,
        source.reliability_score, source.max_excerpt_chars, JSON.stringify(source.config), source.notes,
      ],
      tx,
    );
  }
  oublierCachesReferentiels();
  const compte = async (table: string) => (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`, [], tx))?.n ?? 0;
  return { villes: await compte('cities'), quartiers: await compte('districts'), categories: await compte('job_categories'), competences: await compte('skills'), sources: await compte('job_sources'), sourcesAjoutees };
}
