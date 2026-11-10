/**
 * PostgreSQL embarqué pour le développement local et les tests.
 *
 * C'est un vrai serveur PostgreSQL 17 (paquet npm `embedded-postgres`, binaires
 * officiels) : mêmes extensions (pg_trgm, unaccent) et même recherche plein
 * texte qu'en production. Il n'est jamais chargé quand DATABASE_URL est défini.
 */
import { mkdir, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export type PgEmbarque = { url: string; port: number; arreter: () => Promise<void> };

type Options = {
  /** Dossier des données. Par défaut .data/pg (ignoré par Git). */
  dossier?: string;
  port?: number;
  /** false : le dossier est supprimé à l'arrêt (tests). */
  persistant?: boolean;
  base?: string;
  journal?: (ligne: string) => void;
};

async function portLibre(souhaite?: number): Promise<number> {
  const essayer = (port: number) =>
    new Promise<number>((resoudre, rejeter) => {
      const serveur = net.createServer();
      serveur.unref();
      serveur.once('error', rejeter);
      serveur.listen(port, '127.0.0.1', () => {
        const adresse = serveur.address();
        const obtenu = typeof adresse === 'object' && adresse ? adresse.port : port;
        serveur.close(() => resoudre(obtenu));
      });
    });
  if (souhaite) {
    try {
      return await essayer(souhaite);
    } catch {
      // port occupé : on en prend un autre
    }
  }
  return essayer(0);
}

export async function demarrerPgEmbarque(options: Options = {}): Promise<PgEmbarque> {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dossier = path.resolve(options.dossier ?? process.env.YS_PG_DOSSIER ?? path.join('.data', 'pg'));
  const persistant = options.persistant ?? true;
  const base = options.base ?? 'yallah_job_radar';
  const utilisateur = 'yallah';
  // Mot de passe local sans valeur de sécurité : le serveur n'écoute que sur 127.0.0.1.
  const motDePasse = 'local';
  const port = await portLibre(options.port ?? Number.parseInt(process.env.YS_PG_PORT ?? '54329', 10));
  await mkdir(path.dirname(dossier), { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dossier,
    user: utilisateur,
    password: motDePasse,
    port,
    persistent: persistant,
    // UTF-8 + locale intégrée à PostgreSQL 17 : identique sur Linux, macOS et
    // Windows, et l'arabe est correctement découpé par la recherche plein texte.
    initdbFlags: ['--encoding=UTF8', '--locale-provider=builtin', '--builtin-locale=C.UTF-8', '--locale=C'],
    onLog: (message: unknown) => options.journal?.(String(message)),
    onError: (message: unknown) => options.journal?.(`ERREUR ${String(message)}`),
  });

  const dejaInitialise = await import('node:fs').then((fs) => fs.existsSync(path.join(dossier, 'PG_VERSION')));
  if (!dejaInitialise) await pg.initialise();
  await pg.start();
  if (!dejaInitialise) await pg.createDatabase(base);

  const url = `postgres://${utilisateur}:${motDePasse}@127.0.0.1:${port}/${base}`;
  let arrete = false;
  return {
    url,
    port,
    arreter: async () => {
      if (arrete) return;
      arrete = true;
      await pg.stop();
      if (!persistant) await rm(dossier, { recursive: true, force: true });
    },
  };
}
