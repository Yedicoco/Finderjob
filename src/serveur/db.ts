/**
 * Accès PostgreSQL — un seul pool par processus.
 *
 * Pas d'ORM : le modèle de données est livré en SQL (db/migrations) et les
 * requêtes de recherche (plein texte, trigrammes) s'écrivent mieux en SQL.
 * Toutes les requêtes sont paramétrées ($1, $2…) ; aucune valeur utilisateur
 * n'est concaténée dans le texte SQL.
 */
import pg from 'pg';

const { Pool, types } = pg;

// numeric → number (montants en dirhams, bien en deçà de 2^53)
types.setTypeParser(1700, (valeur) => Number.parseFloat(valeur));
// bigint → number (identifiants bigserial)
types.setTypeParser(20, (valeur) => Number.parseInt(valeur, 10));
// date → chaîne « AAAA-MM-JJ » : pas de conversion en Date, donc pas de décalage horaire
types.setTypeParser(1082, (valeur) => valeur);

export type Executeur = {
  query: (texte: string, valeurs?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
};

type Etat = { pool: pg.Pool | null };

// Survit au rechargement à chaud de Next.js en développement.
const etat: Etat = ((globalThis as { __ysDb?: Etat }).__ysDb ??= { pool: null });

export class ErreurConfiguration extends Error {}

export function urlBaseDeDonnees(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new ErreurConfiguration(
      'DATABASE_URL est absent. Lancez « npm run local » (PostgreSQL embarqué) ou renseignez .env.',
    );
  }
  return url;
}

export function obtenirPool(): pg.Pool {
  if (!etat.pool) {
    etat.pool = new Pool({
      connectionString: urlBaseDeDonnees(),
      max: Number.parseInt(process.env.YS_DB_POOL_MAX ?? '8', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    etat.pool.on('error', (erreur) => {
      console.error('[db] erreur sur une connexion inactive :', erreur.message);
    });
  }
  return etat.pool;
}

/** Utilisé par les tests et les scripts pour brancher un pool déjà construit. */
export function definirPool(pool: pg.Pool | null): void {
  etat.pool = pool;
}

export async function fermerPool(): Promise<void> {
  const pool = etat.pool;
  etat.pool = null;
  if (pool) await pool.end();
}

export async function requete<T = Record<string, unknown>>(
  texte: string,
  valeurs: unknown[] = [],
  executeur?: Executeur,
): Promise<T[]> {
  const resultat = await (executeur ?? obtenirPool()).query(texte, valeurs);
  return resultat.rows as T[];
}

export async function uneLigne<T = Record<string, unknown>>(
  texte: string,
  valeurs: unknown[] = [],
  executeur?: Executeur,
): Promise<T | null> {
  const lignes = await requete<T>(texte, valeurs, executeur);
  return lignes[0] ?? null;
}

export async function executer(texte: string, valeurs: unknown[] = [], executeur?: Executeur): Promise<number> {
  const resultat = await (executeur ?? obtenirPool()).query(texte, valeurs);
  return resultat.rowCount ?? 0;
}

/** Exécute `travail` dans une transaction ; annule tout en cas d'erreur. */
export async function transaction<T>(travail: (tx: Executeur) => Promise<T>): Promise<T> {
  const client = await obtenirPool().connect();
  try {
    await client.query('BEGIN');
    const resultat = await travail(client);
    await client.query('COMMIT');
    return resultat;
  } catch (erreur) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }
}

/** Séries de références : offre, candidat, employeur, besoin, placement, commission, reçu. */
export type SerieReference = 'OF' | 'CA' | 'EM' | 'BE' | 'PL' | 'CO' | 'RE';

/**
 * Fragment SQL qui attribue la prochaine référence d'une série.
 *
 * Les fiches du jeu de démonstration ont leurs propres séries (« YS-DEMO-… ») :
 * charger puis retirer la démonstration ne consomme aucun numéro réel, et ne
 * laisse donc aucun trou dans la numérotation des reçus ni des dossiers.
 * Le code vient d'une liste fermée : aucune donnée saisie n'entre dans ce SQL.
 */
export function prochaineReference(serie: SerieReference, fictif = false): string {
  return `ys_next_reference('${fictif ? 'DEMO-' : ''}${serie}')`;
}
