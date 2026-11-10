'use server';

import { dateCourte, salaire } from '@/composants/format';
import type { MotifRejet } from '@/collecte/types';
import { nomVille } from '@/domaine/geographie';
import { CONTRATS, MOTIFS_STATUT, STATUTS_OFFRE, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { libelleMetier } from '@/domaine/taxonomie';
import { coche, executerActionAvecResultat, nombreOuNul, texte, texteOuNul } from '@/serveur/actions';
import { ErreurImport, apercuSaisie, importerFichier, importerSaisie, type ApercuSaisie, type SaisieImport } from '@/serveur/ingestion';
import { chargerParametres } from '@/serveur/parametres';
import type { ApercuVue, EtatFichier, EtatImport, LigneApercu, ResultatImportVue } from './types';

const REJETS: Record<MotifRejet, string> = {
  hors_maroc: 'Le poste n’est pas au Maroc',
  hors_taxonomie: 'Le métier n’entre pas dans les secteurs suivis',
  contenu_vide: 'L’annonce est vide ou sans titre',
  robots_interdit: 'La page n’est pas autorisée à la collecte',
  erreur_extraction: 'L’annonce n’a pas pu être lue',
  doublon_exact: 'Annonce déjà enregistrée',
};

const EXPLICATIONS: Record<string, string> = {
  date_inconnue: 'Aucune date de publication n’a été trouvée. L’offre sera enregistrée comme « douteuse » : renseignez la date écrite sur l’annonce pour qu’elle puisse être active.',
  date_incoherente: 'La date de publication est dans le futur : vérifiez-la.',
  hors_perimetre_date: 'L’annonce date d’avant le 1er janvier 2026 : elle sera archivée d’office.',
  localisation_inconnue: 'Aucune ville marocaine n’a été reconnue. Choisissez la ville si l’annonce la précise.',
  risque_eleve: 'Plusieurs signaux de risque : l’offre sera enregistrée comme « douteuse » et ne sera proposée à personne avant vérification.',
  expiree_source: 'La date limite de l’annonce est déjà dépassée.',
  expiree_anciennete: 'L’annonce est trop ancienne pour être encore considérée comme valable.',
};

function lireSaisie(donnees: FormData): SaisieImport {
  const periode = texte(donnees, 'periodeSalaire');
  return {
    origine: texte(donnees, 'origine') === 'employeur' ? 'employeur' : 'site',
    texte: String(donnees.get('texte') ?? ''),
    titre: texteOuNul(donnees, 'titre'),
    url: texteOuNul(donnees, 'url'),
    employeur: texteOuNul(donnees, 'employeur'),
    typeEmployeur: texteOuNul(donnees, 'typeEmployeur'),
    ville: texteOuNul(donnees, 'ville'),
    datePublication: texteOuNul(donnees, 'datePublication'),
    dateExpiration: texteOuNul(donnees, 'dateExpiration'),
    salaireMin: nombreOuNul(donnees, 'salaireMin'),
    salaireMax: nombreOuNul(donnees, 'salaireMax'),
    periodeSalaire: periode === 'mois' || periode === 'semaine' || periode === 'jour' || periode === 'heure' ? periode : null,
    urgent: coche(donnees, 'urgent'),
  };
}

function controlerSaisie(saisie: SaisieImport): void {
  if (Number.isNaN(saisie.salaireMin) || Number.isNaN(saisie.salaireMax)) throw new ErreurImport('Le salaire doit être un nombre (par exemple 3500).');
  if (saisie.typeEmployeur && !TYPES_EMPLOYEUR.est(saisie.typeEmployeur)) throw new ErreurImport('Type d’employeur inconnu.');
}

function vueApercu(apercu: ApercuSaisie, seuils: { modere: number; eleve: number }): ApercuVue {
  const texteComplet = apercu.source.collection_mode === 'texte_complet';
  const base = {
    source: apercu.source.name,
    noteSource: texteComplet
      ? 'Le texte complet et les coordonnées de l’employeur seront conservés (coordonnées chiffrées, affichage journalisé).'
      : 'Seul un court extrait et le lien seront conservés. Les coordonnées présentes dans le texte ne sont pas recopiées.',
    dejaConnue: apercu.dejaConnue,
  };
  if (apercu.analyse.type === 'rejet') return { ...base, rejet: { titre: REJETS[apercu.analyse.motif], detail: apercu.analyse.detail }, offre: null };
  const o = apercu.analyse.offre;
  const metier = o.categories.find((categorie) => categorie.principal)?.code ?? null;
  const remuneration = salaire(o.salary_min, o.salary_max, o.salary_period);
  const lignes: LigneApercu[] = [
    { terme: 'Métier', valeur: metier ? `${libelleMetier(metier)}${o.classification_confidence !== null ? ` (confiance ${o.classification_confidence} %)` : ''}` : 'Non reconnu : à confirmer sur la fiche', alerte: !metier },
    { terme: 'Ville', valeur: o.city_code ? `${nomVille(o.city_code)}${o.district ? ` · ${o.district}` : ''}` : (o.city_label ?? 'Non reconnue'), alerte: !o.city_code },
    { terme: 'Publication', valeur: o.published_at ? `${dateCourte(o.published_at)}${o.date_precision === 'approximative' ? ' (approximative)' : ''}` : 'Date introuvable', alerte: !o.published_at },
    { terme: 'Salaire', valeur: remuneration ? `${remuneration}${o.salary_flag === 'sous_minimum_legal' ? ' — inférieur au minimum légal de référence' : o.salary_flag === 'bas' ? ' — anormalement bas' : o.salary_flag === 'eleve' ? ' — anormalement élevé' : ''}` : 'Non indiqué', alerte: Boolean(o.salary_flag && o.salary_flag !== 'normal') },
    { terme: 'Contrat', valeur: CONTRATS.libelle(o.contract_type) },
    { terme: 'Employeur', valeur: `${o.employer_name ?? 'Non identifié'}${o.employer_type_guess ? ` (${TYPES_EMPLOYEUR.libelle(o.employer_type_guess).toLowerCase()})` : ''}` },
  ];
  if (o.headcount) lignes.push({ terme: 'Postes', valeur: String(o.headcount) });
  if (o.has_contact_in_source) lignes.push({ terme: 'Coordonnées', valeur: texteComplet ? 'Repérées : elles seront conservées chiffrées' : 'Repérées dans le texte : non conservées' });
  return {
    ...base,
    rejet: null,
    offre: {
      titre: o.title,
      lignes,
      statut: `${STATUTS_OFFRE.libelle(o.status)}${o.status_reason !== 'aucun' ? ` — ${MOTIFS_STATUT.libelle(o.status_reason).toLowerCase()}` : ''}`,
      actif: o.status === 'actif',
      explication: EXPLICATIONS[o.status_reason] ?? null,
      risque: { score: o.risk_score, niveau: o.risk_score >= seuils.eleve ? 'eleve' : o.risk_score >= seuils.modere ? 'modere' : 'faible', signaux: o.score_details.risque.map((signal) => signal.libelle) },
      pertinence: o.relevance_score,
      doublons: apercu.doublons.slice(0, 3).map((doublon) => ({ id: doublon.id, reference: doublon.reference, titre: doublon.titre, score: doublon.score, certain: doublon.decision === 'doublon' })),
    },
  };
}

export async function analyserOuImporter(_etat: EtatImport, donnees: FormData): Promise<EtatImport> {
  const enregistrer = texte(donnees, 'intention') === 'enregistrer';
  const reponse = await executerActionAvecResultat(
    'offres.importer',
    async ({ acteur }): Promise<EtatImport> => {
      const saisie = lireSaisie(donnees);
      controlerSaisie(saisie);
      if (!enregistrer) {
        const parametres = await chargerParametres();
        return { apercu: vueApercu(await apercuSaisie(saisie), { modere: parametres.risque.seuilModere, eleve: parametres.risque.seuilEleve }) };
      }
      const resultat = await importerSaisie(saisie, acteur);
      let vue: ResultatImportVue;
      if (resultat.type === 'rejet') {
        vue = { ton: 'erreur', titre: `Annonce non enregistrée : ${REJETS[resultat.motif].toLowerCase()}`, detail: `${resultat.detail}. L’outil ne suit que les postes situés au Maroc.`, lien: null };
      } else {
        const lien = { href: `/offres/${resultat.id}`, libelle: `Ouvrir la fiche ${resultat.reference}` };
        const statut = `${STATUTS_OFFRE.libelle(resultat.statut).toLowerCase()}${resultat.motif !== 'aucun' ? ` (${MOTIFS_STATUT.libelle(resultat.motif).toLowerCase()})` : ''}`;
        if (resultat.type === 'doublon')
          vue = {
            ton: 'attention',
            titre: `Doublon : cette annonce existe déjà${resultat.doublonDe ? ` (${resultat.doublonDe.reference})` : ''}`,
            detail: `Elle a été enregistrée sous ${resultat.reference} puis archivée comme doublon, pour ne pas créer une seconde offre active.`,
            lien: resultat.doublonDe ? { href: `/offres/${resultat.doublonDe.id}`, libelle: `Ouvrir l’offre principale ${resultat.doublonDe.reference}` } : lien,
          };
        else if (resultat.type === 'inchangee') vue = { ton: 'attention', titre: `Annonce déjà enregistrée (${resultat.reference})`, detail: 'Rien n’a changé depuis le dernier enregistrement.', lien };
        else if (resultat.type === 'mise_a_jour') vue = { ton: 'succes', titre: `${resultat.reference} mise à jour`, detail: `L’annonce était déjà connue ; ses informations ont été actualisées. Statut : ${statut}.`, lien };
        else
          vue = {
            ton: resultat.statut === 'actif' ? 'succes' : 'attention',
            titre: `${resultat.reference} enregistrée — ${statut}`,
            detail: resultat.doublonProbable ? `Attention : elle ressemble à ${resultat.doublonProbable.reference} (${resultat.doublonProbable.score} %). Comparez les deux fiches.` : resultat.statut === 'actif' ? 'Elle apparaît dans la liste des offres actives.' : 'Elle n’apparaît pas parmi les offres actives tant qu’elle n’est pas complétée ou vérifiée.',
            lien,
          };
      }
      return { resultat: vue };
    },
    { ecrit: enregistrer },
  );
  return 'erreur' in reponse ? { erreur: reponse.erreur } : reponse.resultat;
}

/** Les exports de tableur français sont souvent en Windows-1252 : on tente UTF-8, puis on se rabat. */
function decoder(octets: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder('windows-1252').decode(octets);
  }
}

export async function importerFichierAction(_etat: EtatFichier, donnees: FormData): Promise<EtatFichier> {
  const reponse = await executerActionAvecResultat('offres.importer', async ({ acteur }): Promise<EtatFichier> => {
    const fichier = donnees.get('fichier');
    if (!(fichier instanceof File) || fichier.size === 0) throw new ErreurImport('Choisissez un fichier CSV ou JSON.');
    if (fichier.size > 2_000_000) throw new ErreurImport('Fichier trop volumineux (2 Mo au plus). Découpez-le en plusieurs fichiers.');
    if (!/\.(csv|json|txt)$/i.test(fichier.name)) throw new ErreurImport('Format non reconnu : le fichier doit être un .csv ou un .json.');
    const bilan = await importerFichier(decoder(await fichier.arrayBuffer()), fichier.name, acteur);
    return { bilan: { ton: bilan.statut === 'succes' ? 'succes' : bilan.statut === 'partiel' ? 'attention' : 'erreur', message: bilan.message, lignes: bilan.erreursFichier.slice(0, 8) } };
  });
  return 'erreur' in reponse ? { erreur: reponse.erreur } : reponse.resultat;
}
