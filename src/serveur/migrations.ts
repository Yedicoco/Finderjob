/**
 * Migrations SQL : fichiers db/migrations/NNNN_nom.sql appliqués dans l'ordre,
 * chacun dans sa transaction. Une migration déjà appliquée ne doit plus être
 * modifiée (empreinte vérifiée) : on ajoute un nouveau fichier.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

export type ResultatMigrations = { appliquees: string[]; dejaPresentes: string[] };

const VERROU_MIGRATIONS = 7_420_260; // identifiant arbitraire du verrou consultatif

export async function appliquerMigrations(
  pool: pg.Pool,
  dossier = path.join(process.cwd(), 'db', 'migrations'),
): Promise<ResultatMigrations> {
  const fichiers = (await readdir(dossier)).filter((nom) => /^\d{4}_.+\.sql$/.test(nom)).sort();
  const client = await pool.connect();
  const resultat: ResultatMigrations = { appliquees: [], dejaPresentes: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [VERROU_MIGRATIONS]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const existantes = new Map<string, string>(
      (await client.query('SELECT version, checksum FROM schema_migrations')).rows.map(
        (ligne: { version: string; checksum: string }) => [ligne.version, ligne.checksum],
      ),
    );
    for (const fichier of fichiers) {
      const sql = await readFile(path.join(dossier, fichier), 'utf8');
      const empreinte = createHash('sha256').update(sql).digest('hex');
      const connue = existantes.get(fichier);
      if (connue) {
        if (connue !== empreinte) {
          throw new Error(
            `La migration ${fichier} a été modifiée après son application. ` +
              'Créez une nouvelle migration au lieu de modifier un fichier déjà appliqué.',
          );
        }
        resultat.dejaPresentes.push(fichier);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [fichier, empreinte]);
        await client.query('COMMIT');
        resultat.appliquees.push(fichier);
      } catch (erreur) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Échec de la migration ${fichier} : ${(erreur as Error).message}`, { cause: erreur });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [VERROU_MIGRATIONS]).catch(() => undefined);
    client.release();
  }
  return resultat;
}
