/**
 * Contrôle de conformité de l'installation (lecture seule).
 *
 *   npm run verifier        code de sortie 1 si un point bloquant est relevé
 *
 * Vérifie ce que le logiciel ne peut pas garantir seul : configuration des
 * secrets, sources actives, dérogations, conservation des données.
 */
import { accord, compter } from '../src/domaine/accord';
import { jourEcritMaroc } from '../src/domaine/fuseau';
import { apercuIntegre, estProduction } from '../src/serveur/config';
import { fermerPool, requete, uneLigne } from '../src/serveur/db';
import { chargerParametres } from '../src/serveur/parametres';

type Constat = { niveau: 'ok' | 'attention' | 'bloquant'; texte: string };

export async function verifier(): Promise<Constat[]> {
  const constats: Constat[] = [];
  const noter = (niveau: Constat['niveau'], texte: string) => constats.push({ niveau, texte });

  const cle = process.env.YS_CLE_SECRETE?.trim() ?? '';
  if (!cle) noter('bloquant', 'YS_CLE_SECRETE est absent : chiffrement et sessions impossibles.');
  else noter('ok', 'YS_CLE_SECRETE est défini (sa valeur n’est jamais affichée).');
  if (estProduction() && apercuIntegre()) noter('bloquant', 'YS_APERCU_INTEGRE=1 en production : la protection contre l’intégration en iframe est levée.');

  const sources = await requete<{ code: string; name: string; kind: string; is_active: boolean; legal_basis: string | null; permission_status: string; terms_checked_at: Date | null; collection_mode: string; store_contacts: boolean; allow_ai_processing: boolean }>(
    `SELECT code, name, kind, is_active, legal_basis, permission_status, terms_checked_at, collection_mode, store_contacts, allow_ai_processing FROM job_sources ORDER BY code`,
  );
  const externes = sources.filter((s) => !['manuel', 'fichier'].includes(s.kind));
  const actives = externes.filter((s) => s.is_active);
  if (actives.length === 0) noter('ok', `Aucune collecte automatique active (${compter(externes.length, 'site')} au catalogue, tous désactivés).`);
  for (const source of actives) {
    const age = source.terms_checked_at ? (Date.now() - new Date(source.terms_checked_at).getTime()) / 86_400_000 : Infinity;
    if (!source.legal_basis || !['accordee', 'non_requise'].includes(source.permission_status)) noter('bloquant', `${source.name} est active sans base juridique ou autorisation consignée.`);
    else if (age > 180) noter('attention', `${source.name} : conditions d’utilisation relues il y a ${Math.round(age)} jours — à relire (tous les 6 mois).`);
    else noter('ok', `${source.name} : active, autorisation « ${source.permission_status} », conditions relues il y a ${compter(Math.round(age), 'jour')}.`);
    if (source.store_contacts) noter('attention', `${source.name} : conservation des coordonnées activée — vérifier qu’elle est couverte par l’autorisation.`);
    if (source.allow_ai_processing) noter('attention', `${source.name} : traitement par modèle de langage autorisé — vérifier l’accord de l’éditeur.`);
  }

  const parametres = await chargerParametres();
  if (parametres.commissions.travailleurActive) {
    noter('attention', 'La commission à la charge du TRAVAILLEUR est activée. Article 480 du Code du travail et promesse « Aucun frais, jamais » : validation juridique écrite indispensable.');
  } else noter('ok', 'Commission à la charge du travailleur : désactivée.');
  const travailleur = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM commissions WHERE payer = 'travailleur' AND status <> 'annule'`))!.n;
  if (travailleur > 0) noter('attention', `${compter(travailleur, 'commission')} à la charge d’un travailleur ${accord(travailleur, 'enregistrée')} : à faire valider.`);

  const retard = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM candidates WHERE anonymized_at IS NULL AND status <> 'place' AND retention_until < current_date`))!.n;
  if (retard > 0) noter('attention', `${compter(retard, 'fiche')} candidat au-delà de la durée de conservation : lancez le worker (anonymisation automatique).`);
  else noter('ok', 'Aucune fiche candidat au-delà de sa durée de conservation.');

  // Le début de la recherche est un réglage : c'est la valeur en vigueur qui est contrôlée, pas la valeur d'origine.
  const debutRecherche = new Date(parametres.perimetre.dateMin);
  const incoherentes = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM v_job_offers WHERE effective_status = 'actif' AND (published_at IS NULL OR published_at < $1 OR country_code <> 'MA')`, [debutRecherche]))!.n;
  if (incoherentes > 0) noter('bloquant', `${compter(incoherentes, 'offre')} ${accord(incoherentes, 'active')} hors périmètre (date ou pays) : anomalie à signaler.`);
  else noter('ok', `Toutes les offres actives sont au Maroc, datées et publiées depuis le ${jourEcritMaroc(debutRecherche)} (début de la recherche).`);

  const demo = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offers WHERE is_demo`))!.n;
  if (demo > 0) noter(estProduction() ? 'attention' : 'ok', `Jeu de démonstration chargé (${demo} offres fictives)${estProduction() ? ' : à supprimer en production' : ''}.`);

  const administrateurs = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE role_code = 'administrateur' AND is_active`))!.n;
  if (administrateurs === 0) noter('bloquant', 'Aucun administrateur actif.');
  const provisoires = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE must_change_password AND is_active`))!.n;
  if (provisoires > 0) noter('attention', `${compter(provisoires, 'compte')} avec un mot de passe provisoire non encore changé.`);
  return constats;
}

async function principal() {
  const constats = await verifier();
  const symbole = { ok: '✓', attention: '!', bloquant: '✗' } as const;
  for (const constat of constats) console.log(` ${symbole[constat.niveau]} ${constat.texte}`);
  const bloquants = constats.filter((c) => c.niveau === 'bloquant').length;
  const attentions = constats.filter((c) => c.niveau === 'attention').length;
  console.log(`\n${compter(bloquants, 'point')} ${accord(bloquants, 'bloquant')}, ${compter(attentions, 'point')} d’attention.`);
  await fermerPool();
  if (bloquants > 0) process.exit(1);
}

if (process.argv[1] && /verifier-conformite\.[cm]?ts$/.test(process.argv[1])) {
  principal().catch((erreur) => {
    console.error(erreur instanceof Error ? erreur.message : erreur);
    process.exit(1);
  });
}
