/**
 * Worker : collecte planifiée, alertes, relances et maintenance.
 *
 *   npm run worker            boucle (un passage toutes les 5 minutes)
 *   npm run worker:une-fois   un seul passage, puis sortie (cron, CI)
 *
 * La collecte ne concerne que les sources ACTIVES. À l'installation, aucune
 * source externe ne l'est : le worker se limite alors aux alertes et à la
 * maintenance. Il n'ouvre aucun port et peut être arrêté à tout moment : le
 * statut affiché des offres est calculé à la lecture, pas par lui.
 */
import { accord, compter } from '../src/domaine/accord';
import { configIADepuisEnv, creerExtracteurIA } from '../src/ia/extracteur';
import { notifierRelances, traiterAlertes } from '../src/serveur/alertes';
import { fermerPool } from '../src/serveur/db';
import { executerCollecte, sourcesAExecuter } from '../src/serveur/ingestion';
import { executerMaintenance } from '../src/serveur/maintenance';

const INTERVALLE_MS = 5 * 60_000;
const MAINTENANCE_MS = 60 * 60_000;
let arretDemande = false;
let derniereMaintenance = 0;

const horodatage = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const journal = (message: string) => console.log(`[worker ${horodatage()}] ${message}`);

export async function passage(): Promise<void> {
  const configurationIA = configIADepuisEnv();
  const completerIA = configurationIA ? creerExtracteurIA(configurationIA) : undefined;
  const sources = await sourcesAExecuter();
  for (const source of sources) {
    if (arretDemande) return;
    const bilan = await executerCollecte(source.id, { declencheur: 'planifie', completerIA });
    journal(`${source.code} : ${bilan.statut} — ${compter(bilan.nouvelles, 'nouvelle')}, ${compter(bilan.misesAJour, 'mise')} à jour, ${compter(bilan.rejetees, 'écartée')}, ${compter(bilan.requetes, 'requête')}${bilan.message ? ` — ${bilan.message}` : ''}`);
  }
  const alertes = await traiterAlertes();
  if (alertes.notifications) journal(`alertes : ${compter(alertes.notifications, 'notification')}, ${compter(alertes.envoyes, 'envoi')}, ${compter(alertes.simules, 'simulé')}, ${compter(alertes.echecs, 'échec')}`);
  const relances = await notifierRelances();
  if (relances) journal(`relances : ${compter(relances, 'rappel')}`);
  if (Date.now() - derniereMaintenance >= MAINTENANCE_MS) {
    const bilan = await executerMaintenance();
    derniereMaintenance = Date.now();
    journal(`maintenance : ${compter(bilan.statutsFiges, 'statut')} ${accord(bilan.statutsFiges, 'figé')}, ${compter(bilan.scores, 'score')} ${accord(bilan.scores, 'recalculé')}, ${compter(bilan.candidatsAnonymises, 'fiche')} ${accord(bilan.candidatsAnonymises, 'anonymisée')}`);
  }
}

async function principal() {
  const uneFois = process.argv.includes('--une-fois');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { arretDemande = true; });
  journal(uneFois ? 'passage unique' : `démarrage (un passage toutes les ${INTERVALLE_MS / 60_000} minutes)`);
  while (!arretDemande) {
    try {
      await passage();
    } catch (erreur) {
      journal(`ERREUR : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
      if (uneFois) process.exitCode = 1;
    }
    if (uneFois) break;
    const fin = Date.now() + INTERVALLE_MS;
    while (!arretDemande && Date.now() < fin) await new Promise((resoudre) => setTimeout(resoudre, 1000));
  }
  await fermerPool();
  journal('arrêt');
}

if (process.argv[1] && /worker\.[cm]?ts$/.test(process.argv[1])) {
  principal().catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  });
}
