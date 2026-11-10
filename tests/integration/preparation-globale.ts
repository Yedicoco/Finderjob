/**
 * Démarre un PostgreSQL embarqué jetable pour les tests d'intégration, applique
 * les migrations et transmet l'URL aux tests (`inject('urlBase')`).
 *
 * Pour tester contre un autre serveur : YS_TEST_DATABASE_URL=postgres://…
 * (base VIDE dédiée aux tests : les tables y sont vidées entre les fichiers).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { demarrerPgEmbarque } from '../../scripts/lib/pg-embarque';
import { appliquerMigrations } from '../../src/serveur/migrations';

export default async function preparation(projet: TestProject) {
  let url = process.env.YS_TEST_DATABASE_URL;
  let arreter: (() => Promise<void>) | undefined;

  if (!url) {
    const dossier = mkdtempSync(path.join(tmpdir(), 'ys-tests-pg-'));
    const instance = await demarrerPgEmbarque({
      dossier: path.join(dossier, 'pg'),
      port: 54400 + Math.floor(Math.random() * 400),
      persistant: false,
      base: 'ys_tests',
    });
    url = instance.url;
    arreter = async () => {
      await instance.arreter();
      rmSync(dossier, { recursive: true, force: true });
    };
  }

  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await appliquerMigrations(pool);
  } finally {
    await pool.end();
  }
  projet.provide('urlBase', url);
  return arreter;
}

declare module 'vitest' {
  export interface ProvidedContext {
    urlBase: string;
  }
}
