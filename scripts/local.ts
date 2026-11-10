/**
 * Lancement local « tout-en-un », sans rien installer d'autre que Node.js :
 *
 *   npm run local        PostgreSQL embarqué + migrations + référentiels +
 *                        application (production) + worker
 *   npm run local:dev    idem avec le serveur de développement Next.js
 *
 * Options : --sans-worker (pas de collecte ni d'alertes en arrière-plan),
 *           --sans-construction (réutilise la dernière construction).
 *
 * Les données restent dans .data/ (ignoré par Git) :
 *   .data/pg/            base PostgreSQL
 *   .data/secret.key     clé de chiffrement locale, créée au premier lancement
 *   .data/admin-local.txt  identifiants du compte administrateur local
 *
 * Si DATABASE_URL est défini, la base embarquée n'est pas démarrée.
 * En production : voir docs/04-architecture-technique.md.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const racine = path.resolve(__dirname, '..');
const dossierDonnees = path.resolve(process.env.YS_DONNEES_DOSSIER ?? path.join(racine, '.data'));
const dev = process.argv.includes('--dev');
const sansWorker = process.argv.includes('--sans-worker');
const sansConstruction = process.argv.includes('--sans-construction');
const port = process.env.PORT ?? '3000';

function secretLocal(): string {
  if (process.env.YS_CLE_SECRETE?.trim()) return process.env.YS_CLE_SECRETE.trim();
  const fichier = path.join(dossierDonnees, 'secret.key');
  if (existsSync(fichier)) return readFileSync(fichier, 'utf8').trim();
  const cle = randomBytes(32).toString('base64');
  writeFileSync(fichier, `${cle}\n`, { mode: 0o600 });
  console.log(`Clé de chiffrement locale créée : ${path.relative(racine, fichier)} (ne la perdez pas : sans elle, les données chiffrées sont illisibles).`);
  return cle;
}

async function principal() {
  mkdirSync(dossierDonnees, { recursive: true });
  process.env.YS_CLE_SECRETE = secretLocal();
  process.env.NEXT_TELEMETRY_DISABLED ??= '1';

  let arreterBase: (() => Promise<void>) | null = null;
  if (!process.env.DATABASE_URL) {
    const { demarrerPgEmbarque } = await import('./lib/pg-embarque');
    const base = await demarrerPgEmbarque({ dossier: process.env.YS_PG_DOSSIER ?? path.join(dossierDonnees, 'pg') });
    process.env.DATABASE_URL = base.url;
    arreterBase = base.arreter;
    console.log(`PostgreSQL embarqué démarré (port ${base.port}).`);
  }

  // Compte administrateur local : créé une seule fois, identifiants écrits dans .data/.
  const fichierAdmin = path.join(dossierDonnees, 'admin-local.txt');
  process.env.YS_ADMIN_EMAIL ??= 'admin@yallah.local';
  const { initialiser } = await import('./initialiser');
  const resultat = await initialiser((ligne) => console.log(ligne));
  if (resultat.motDePasseProvisoire) {
    writeFileSync(fichierAdmin, `Compte administrateur local\nAdresse : ${resultat.email}\nMot de passe provisoire : ${resultat.motDePasseProvisoire}\n(à changer à la première connexion)\n`, { mode: 0o600 });
    console.log(`\nCompte administrateur : ${resultat.email}\nMot de passe provisoire : ${resultat.motDePasseProvisoire}\n(également noté dans ${path.relative(racine, fichierAdmin)})\n`);
  }
  const { fermerPool } = await import('../src/serveur/db');
  await fermerPool();

  const enfants: ChildProcess[] = [];
  const lancer = (commande: string, args: string[]) => {
    const enfant = spawn(commande, args, { cwd: racine, stdio: 'inherit', env: process.env });
    enfants.push(enfant);
    return enfant;
  };
  const next = path.join(racine, 'node_modules', '.bin', 'next');
  const tsx = path.join(racine, 'node_modules', '.bin', 'tsx');

  // Reconstruire à chaque lancement garantit que l'application servie correspond au code présent
  // (après une mise à jour, par exemple). --sans-construction réutilise la construction existante.
  if (!dev && (!sansConstruction || !existsSync(path.join(racine, '.next', 'BUILD_ID')))) {
    console.log('Construction de l’application…');
    await new Promise<void>((resoudre, rejeter) => lancer(next, ['build']).on('exit', (code) => (code === 0 ? resoudre() : rejeter(new Error(`next build a échoué (code ${code})`)))));
  }
  const application = lancer(next, [dev ? 'dev' : 'start', '-H', '0.0.0.0', '-p', port]);
  if (!sansWorker) lancer(tsx, [path.join('scripts', 'worker.ts')]);

  let arret = false;
  const arreter = async (code = 0) => {
    if (arret) return;
    arret = true;
    for (const enfant of enfants) enfant.kill('SIGTERM');
    await new Promise((resoudre) => setTimeout(resoudre, 800));
    if (arreterBase) await arreterBase().catch(() => undefined);
    process.exit(code);
  };
  process.on('SIGINT', () => void arreter(0));
  process.on('SIGTERM', () => void arreter(0));
  application.on('exit', (code) => void arreter(code ?? 0));
}

principal().catch((erreur) => {
  console.error(erreur instanceof Error ? erreur.message : erreur);
  process.exit(1);
});
