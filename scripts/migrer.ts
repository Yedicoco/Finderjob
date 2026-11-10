/** Applique les migrations SQL sur la base désignée par DATABASE_URL. */
import { accord, compter } from '../src/domaine/accord';
import { appliquerMigrations } from '../src/serveur/migrations';
import { fermerPool, obtenirPool } from '../src/serveur/db';

async function principal() {
  const resultat = await appliquerMigrations(obtenirPool());
  console.log(
    resultat.appliquees.length
      ? `Migrations appliquées : ${resultat.appliquees.join(', ')}`
      : `Base à jour (${compter(resultat.dejaPresentes.length, 'migration')} déjà ${accord(resultat.dejaPresentes.length, 'appliquée')}).`,
  );
  await fermerPool();
}

principal().catch((erreur) => {
  console.error(erreur instanceof Error ? erreur.message : erreur);
  process.exit(1);
});
