/**
 * Prépare une base : migrations, référentiels (villes, métiers, compétences,
 * catalogue des sources — toutes les sources externes restent DÉSACTIVÉES),
 * début de la recherche appliqué aux offres déjà enregistrées, et premier
 * compte administrateur.
 *
 *   YS_ADMIN_EMAIL          obligatoire s'il n'existe encore aucun administrateur
 *   YS_ADMIN_NOM            facultatif
 *   YS_ADMIN_MOT_DE_PASSE   facultatif : sinon un mot de passe provisoire est
 *                           généré, affiché UNE fois, et devra être changé.
 *
 * Aucune offre, aucun candidat, aucun employeur n'est créé.
 */
import { randomBytes } from 'node:crypto';
import { compter } from '../src/domaine/accord';
import { jourEcritMaroc } from '../src/domaine/fuseau';
import { ACTEUR_SYSTEME } from '../src/serveur/audit';
import { creerUtilisateur } from '../src/serveur/auth';
import { fermerPool, obtenirPool, uneLigne } from '../src/serveur/db';
import { appliquerMigrations } from '../src/serveur/migrations';
import { alignerOffresSurDebutRecherche } from '../src/serveur/parametres';
import { phraseBilanPerimetre } from '../src/serveur/perimetre';
import { synchroniserReferentiels } from '../src/serveur/referentiel';

export async function initialiser(journal: (ligne: string) => void = console.log): Promise<{ motDePasseProvisoire: string | null; email: string | null }> {
  const migrations = await appliquerMigrations(obtenirPool());
  journal(migrations.appliquees.length ? `Migrations appliquées : ${migrations.appliquees.join(', ')}` : 'Schéma à jour.');
  const referentiels = await synchroniserReferentiels();
  journal(`Référentiels : ${referentiels.villes} villes, ${referentiels.categories} catégories, ${referentiels.competences} compétences, ${referentiels.sources} sources au catalogue${referentiels.sourcesAjoutees ? ` (${compter(referentiels.sourcesAjoutees, 'ajoutée')} à l’instant, sites externes désactivés)` : ' (aucune ajoutée ; réglages existants conservés)'}.`);
  // Après une mise à jour, le début de la recherche peut avoir changé : les offres enregistrées s'alignent ici, sans attendre le worker.
  const perimetre = await alignerOffresSurDebutRecherche();
  journal(`Début de la recherche : ${jourEcritMaroc(new Date(perimetre.debut))}${perimetre.ecartees || perimetre.reprises ? ` (${phraseBilanPerimetre(perimetre)})` : ''}.`);

  if (await uneLigne(`SELECT 1 FROM users WHERE role_code = 'administrateur' AND is_active`)) {
    journal('Un administrateur existe déjà : aucun compte créé.');
    return { motDePasseProvisoire: null, email: null };
  }
  const email = process.env.YS_ADMIN_EMAIL?.trim();
  if (!email) throw new Error('Aucun administrateur : définissez YS_ADMIN_EMAIL (et, si vous le souhaitez, YS_ADMIN_MOT_DE_PASSE).');
  const fourni = process.env.YS_ADMIN_MOT_DE_PASSE;
  const motDePasse = fourni ?? `${randomBytes(12).toString('base64url')}-Ys1`;
  await creerUtilisateur({ email, nom: process.env.YS_ADMIN_NOM?.trim() || 'Administrateur', role: 'administrateur', motDePasse, doitChanger: !fourni }, ACTEUR_SYSTEME);
  journal(`Compte administrateur créé : ${email}`);
  return { motDePasseProvisoire: fourni ? null : motDePasse, email };
}

async function principal() {
  const resultat = await initialiser();
  if (resultat.motDePasseProvisoire) {
    console.log(`\nMot de passe provisoire (affiché une seule fois, à changer à la première connexion) :\n  ${resultat.motDePasseProvisoire}\n`);
  }
  await fermerPool();
}

if (process.argv[1] && /initialiser\.[cm]?ts$/.test(process.argv[1])) {
  principal().catch((erreur) => {
    console.error(erreur instanceof Error ? erreur.message : erreur);
    process.exit(1);
  });
}
