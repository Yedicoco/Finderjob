import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { notFound } from 'next/navigation';
import { ListeCorrespondances } from '@/composants/correspondances';
import { BoutonAction, BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { dateCourte, dateHeure, dateIso, dateLongue, dirhams, estArabe, ilYA, pluriel, salaire } from '@/composants/format';
import { EtiquettesOffre, lieuOffre } from '@/composants/offres';
import { OPTIONS_VILLES, SelectionMetier } from '@/composants/options';
import { Badge, Carte, Champ, Definition, Definitions, EnTetePage, Encart, Jauge, LienBouton, LienExterne, Selection, TexteLibre } from '@/composants/ui';
import { DEBUT_RECHERCHE_PLANCHER } from '@/domaine/parametres';
import {
  AVERTISSEMENT_ENGAGEMENT,
  CONTRATS,
  LANGUES,
  LOGEMENT,
  MENTION_INTERMEDIAIRE,
  MODES_COLLECTE,
  MODES_TRAVAIL,
  MOTIFS_STATUT,
  NIVEAUX_EXPERIENCE,
  PERIODES_SALAIRE,
  STATUTS_OFFRE,
  STATUTS_VERIFICATION,
  TEMPS_TRAVAIL,
  TYPES_EMPLOYEUR,
} from '@/domaine/referentiels';
import { COMPETENCES } from '@/domaine/referentiels';
import type { Signal } from '@/domaine/risques';
import type { LigneScore } from '@/domaine/scores';
import { libelleMetier, libelleSecteur } from '@/domaine/taxonomie';
import { listerCorrespondances } from '@/serveur/appariements';
import { offreParId, sensRattachement, type OffreDetaillee } from '@/serveur/offres';
import { chargerParametres } from '@/serveur/parametres';
import { exigerPermission } from '@/serveur/session-next';
import { chercherCandidatsPourOffre } from '../../appariements/actions';
import { archiverOffreAction, corrigerOffreAction, creerEmployeurDepuisOffre, dissocierDoublonAction, ecarterDoublonAction, lierDoublonAction, revelerContact, verifierOffreAction } from '../actions';
import { valeursCorrection } from '../correction';

export const metadata: Metadata = { title: 'Fiche offre' };

const LIBELLES_CHAMPS: Record<string, string> = {
  title: 'Titre', published_at: 'Date de publication', date_precision: 'Précision de la date', expires_at: 'Date limite', city_code: 'Ville', district: 'Quartier',
  employer_name: 'Employeur', employer_type_guess: 'Type d’employeur', contract_type: 'Contrat', salary_min: 'Salaire minimum', salary_max: 'Salaire maximum',
  salary_period: 'Période du salaire', primary_category: 'Métier', status: 'Statut', status_reason: 'Motif du statut', verification_status: 'Vérification',
  duplicate_of: 'Rattachement', description_excerpt: 'Extrait', description_full: 'Texte', work_time: 'Temps de travail', housing: 'Logement', is_urgent: 'Urgence',
  headcount: 'Nombre de postes', languages: 'Langues', experience_min_years: 'Expérience', contenu: 'Contenu de l’annonce',
};
const ORIGINES: Record<string, string> = { collecte: 'Collecte', saisie: 'Saisie', moderation: 'Courtier', maintenance: 'Contrôle automatique', fusion_doublon: 'Doublon', creation: 'Création' };

function explicationStatut(offre: OffreDetaillee, validite: number, reverification: number, debutRecherche: string): { texte: string; quoiFaire?: string } | null {
  switch (offre.effective_reason) {
    case 'date_inconnue':
      return { texte: 'L’annonce n’indique aucune date de publication fiable : rien ne prouve qu’elle est assez récente.', quoiFaire: 'Retrouvez la date sur l’annonce d’origine, puis renseignez-la dans « Corriger ».' };
    case 'date_incoherente':
      return { texte: 'La date de publication relevée est dans le futur.', quoiFaire: 'Corrigez la date de publication.' };
    case 'hors_perimetre_date':
      return {
        texte: `Publiée avant le début de la recherche (${dateLongue(debutRecherche)}) : hors du périmètre de l’outil.`,
        quoiFaire: 'Si la date relevée est fausse, rectifiez-la dans « Corriger ». Sinon, rien à faire : le début de la recherche se règle dans Administration › Paramètres (administrateur) et, s’il est reculé, cette offre est réévaluée d’elle-même.',
      };
    case 'localisation_inconnue':
      return { texte: 'Le lieu de travail n’a pas pu être confirmé au Maroc.', quoiFaire: 'Si l’annonce précise une ville marocaine, renseignez-la dans « Corriger ».' };
    case 'expiree_source':
      return { texte: `La date limite indiquée par l’annonce (${dateCourte(offre.expires_at)}) est dépassée.` };
    case 'expiree_anciennete':
      return { texte: `Publiée il y a plus de ${validite} jours, sans date limite connue : elle est considérée comme expirée.` };
    case 'non_reverifiee':
      return { texte: `Personne n’a revu cette offre depuis plus de ${reverification} jours : elle n’est plus présentée comme active.`, quoiFaire: 'Vérifiez sur l’annonce d’origine qu’elle est toujours en ligne, puis cliquez sur « J’ai vérifié cette offre ».' };
    case 'risque_eleve':
      return { texte: 'Plusieurs signaux de risque ont été relevés (voir ci-dessous).', quoiFaire: 'Ne la proposez à aucun candidat avant de l’avoir contrôlée. Écartez-la si le doute persiste.' };
    case 'doublon':
      return { texte: 'Même annonce qu’une autre offre déjà enregistrée.' };
    case 'rejetee_moderation':
      return { texte: 'Écartée par un courtier après vérification.' };
    case 'pourvue':
      return { texte: 'Le poste a été pourvu.' };
    case 'archivage_manuel':
      return { texte: 'Archivée manuellement.' };
    default:
      return null;
  }
}

function LignesScore({ titre, lignes }: { titre: string; lignes: LigneScore[] | undefined }) {
  if (!lignes?.length) return null;
  return (
    <details className="group border-t border-sable-200 py-2 first:border-t-0">
      <summary className="text-[0.84rem] font-semibold text-marine-700 hover:underline">{titre} — détail</summary>
      <ul className="mt-1.5 space-y-1 text-[0.82rem]">
        {lignes.map((ligne, index) => (
          <li key={index} className="flex gap-2">
            <span className="w-14 shrink-0 text-right font-bold tabular-nums">
              {ligne.points > 0 ? '+' : ''}
              {ligne.points}
              {ligne.max ? <span className="font-normal text-encre-douce">/{ligne.max}</span> : null}
            </span>
            <span className="text-encre-douce">
              <strong className="text-marine-900">{ligne.critere}</strong> — {ligne.explication}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Champs dont l'historique garde un code : on affiche son libellé (« Archivée », « Avant le début de la recherche »), pas le code. */
const REFERENTIELS_VERSION: Record<string, { est: (valeur: unknown) => boolean; libelle: (code: string) => string }> = {
  status: STATUTS_OFFRE,
  status_reason: MOTIFS_STATUT,
  verification_status: STATUTS_VERIFICATION,
};

const valeurVersion = (valeur: unknown, champ?: string): string => {
  if (valeur === null || valeur === undefined || valeur === '') return '(vide)';
  const referentiel = champ ? REFERENTIELS_VERSION[champ] : undefined;
  // Le motif « aucun » a un libellé vide (rien à afficher à côté du statut) : dans l'historique, on l'écrit.
  if (referentiel?.est(valeur)) return referentiel.libelle(String(valeur)) || 'aucun';
  if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valeur)) return dateCourte(valeur);
  if (typeof valeur === 'object') return '…';
  return String(valeur).slice(0, 60);
};

export default async function PageOffre({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerPermission('offres.lire');
  const { id } = await params;
  const [offre, parametres] = await Promise.all([offreParId(id), chargerParametres()]);
  if (!offre) notFound();
  const moderer = session.peut('offres.moderer');
  const crm = session.peut('candidats.lire');
  const correspondances = crm ? await listerCorrespondances({ offreId: offre.id, limite: 30 }) : [];
  const maintenant = new Date();
  const seuils = { modere: parametres.risque.seuilModere, eleve: parametres.risque.seuilEleve };
  const risqueEleve = offre.risk_score >= seuils.eleve;
  const details = offre.score_details as { risque?: Signal[]; pertinence?: LigneScore[]; qualite?: LigneScore[]; placement?: LigneScore[]; doublonProbable?: { id: string; reference: string; score: number }; champsVerrouilles?: string[] };
  const explication = explicationStatut(offre, parametres.offres.dureeValiditeJours, parametres.offres.delaiReverificationJours, parametres.perimetre.dateMin);
  const remuneration = salaire(offre.salary_min, offre.salary_max, offre.salary_period);
  const texteAnnonce = offre.description_full ?? offre.description_excerpt;
  const correction = valeursCorrection(offre);
  const archivee = offre.status === 'archive';
  // Une offre archivée ne se corrige plus, sauf si elle l'a été pour sa seule date : une date mal relevée doit pouvoir être rectifiée.
  const corrigeable = moderer && (!archivee || (offre.status_reason === 'hors_perimetre_date' && !offre.duplicate_of_id));
  const plancherDate = dateIso(DEBUT_RECHERCHE_PLANCHER);
  const competences = offre.competences.map((code) => COMPETENCES.find((c) => c.code === code)?.fr ?? code);
  // L'annonce ressemblante a été écartée pour sa date alors que celle-ci est dans la période : le rattachement se ferait dans l'autre sens, on le dit avant.
  const probableEcartee = details.doublonProbable && !offre.duplicate_of_id ? (await sensRattachement(offre, details.doublonProbable.id)) === 'celle-ci' : false;

  return (
    <>
      <p className="hors-impression mb-3 text-[0.86rem]">
        <Link href="/offres" className="font-semibold text-marine-700 underline underline-offset-3">
          ‹ Toutes les offres
        </Link>
      </p>
      <EnTetePage
        surtitre={`${offre.reference} · ${offre.source_name}`}
        titre={<TexteLibre>{offre.title}</TexteLibre>}
        actions={
          offre.source_url ? (
            <LienExterne href={offre.source_url} className="rounded-lg bg-or-500 px-4 py-2.5 text-[0.92rem] font-semibold text-marine-950 no-underline hover:bg-or-300">
              Voir l’annonce d’origine
            </LienExterne>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <EtiquettesOffre offre={offre} seuils={seuils} />
        </div>
      </EnTetePage>

      {offre.is_demo ? (
        <Encart ton="info" className="mb-4" titre="Offre fictive">
          Cette annonce fait partie du jeu de démonstration : elle a été inventée pour montrer le fonctionnement de l’outil. L’employeur n’existe pas ; ne la proposez à personne.
        </Encart>
      ) : null}

      {explication ? (
        <Encart ton={offre.effective_status === 'douteux' ? 'attention' : 'info'} className="mb-4" titre={`${STATUTS_OFFRE.libelle(offre.effective_status)} — ${MOTIFS_STATUT.libelle(offre.effective_reason)}`}>
          <p>{explication.texte}</p>
          {explication.quoiFaire && moderer ? <p className="mt-1 font-semibold">{explication.quoiFaire}</p> : null}
          {offre.principale ? (
            <p className="mt-1">
              Offre principale :{' '}
              <Link href={`/offres/${offre.principale.id}`} className="font-semibold">
                {offre.principale.reference} — <TexteLibre>{offre.principale.title}</TexteLibre>
              </Link>
            </p>
          ) : null}
        </Encart>
      ) : null}

      {details.doublonProbable && !offre.duplicate_of_id ? (
        <Encart ton="attention" className="mb-4" titre="Doublon probable">
          <p>
            Cette annonce ressemble à{' '}
            <Link href={`/offres/${details.doublonProbable.id}`} className="font-semibold">
              {details.doublonProbable.reference}
            </Link>{' '}
            (ressemblance {Math.round(details.doublonProbable.score)} %). Elle n’a pas été rattachée automatiquement : comparez les deux fiches.
            {probableEcartee ? ` ${details.doublonProbable.reference} a été publiée avant le début de la recherche : si c’est la même annonce, c’est elle qui sera rattachée à cette offre, qui restera l’offre principale.` : null}
          </p>
          {moderer ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <BoutonAction
                action={lierDoublonAction}
                champs={{ id: offre.id, principale: details.doublonProbable.id }}
                variante="primaire"
                confirmer={
                  probableEcartee
                    ? `Confirmer que c’est la même annonce ? ${details.doublonProbable.reference} sera rattachée à cette offre, qui restera l’offre principale.`
                    : 'Rattacher cette offre comme doublon ? Elle sera archivée.'
                }
              >
                C’est la même annonce
              </BoutonAction>
              <BoutonAction action={ecarterDoublonAction} champs={{ id: offre.id }}>
                Ce sont deux offres distinctes
              </BoutonAction>
            </div>
          ) : null}
        </Encart>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Carte titre="Le poste">
            <Definitions colonnes="sm:grid-cols-2 lg:grid-cols-3">
              <Definition terme="Métier">
                {offre.metier ? libelleMetier(offre.metier) : <span className="font-semibold text-ambre-800">À confirmer</span>}
                {offre.classification_confidence !== null && offre.metier ? <span className="block text-[0.8rem] text-encre-douce">Classement automatique : confiance {offre.classification_confidence} %</span> : null}
              </Definition>
              <Definition terme="Secteur">{offre.sector_code ? libelleSecteur(offre.sector_code) : '—'}</Definition>
              <Definition terme="Lieu">{lieuOffre(offre)}</Definition>
              <Definition terme="Employeur">
                <TexteLibre>{offre.employer_name}</TexteLibre>
                {offre.employer_name ? null : 'Non identifié'}
                {offre.employer_type_guess ? <span className="block text-[0.8rem] text-encre-douce">{TYPES_EMPLOYEUR.libelle(offre.employer_type_guess)}</span> : null}
              </Definition>
              <Definition terme="Salaire">
                {remuneration ?? 'Non indiqué'}
                {offre.salary_monthly_estimate && offre.salary_period !== 'mois' ? <span className="block text-[0.8rem] text-encre-douce">soit environ {dirhams(offre.salary_monthly_estimate)} par mois (estimation)</span> : null}
                {offre.salary_flag === 'sous_minimum_legal' ? <span className="block text-[0.8rem] font-semibold text-rouge-700">Inférieur au minimum légal de référence</span> : null}
                {offre.salary_flag === 'bas' ? <span className="block text-[0.8rem] font-semibold text-ambre-800">Anormalement bas</span> : null}
                {offre.salary_flag === 'eleve' ? <span className="block text-[0.8rem] font-semibold text-ambre-800">Anormalement élevé : à vérifier</span> : null}
              </Definition>
              <Definition terme="Contrat">{CONTRATS.libelle(offre.contract_type)}</Definition>
              <Definition terme="Rythme">
                {TEMPS_TRAVAIL.libelle(offre.work_time)}
                {offre.work_mode !== 'non_precise' ? ` · ${MODES_TRAVAIL.libelle(offre.work_mode)}` : ''}
              </Definition>
              <Definition terme="Horaires">{offre.schedule_text ?? '—'}</Definition>
              <Definition terme="Expérience">
                {offre.experience_min_years === 0 ? 'Aucune expérience exigée' : offre.experience_min_years !== null ? `${pluriel(offre.experience_min_years, 'an')} minimum` : NIVEAUX_EXPERIENCE.libelle(offre.experience_level)}
              </Definition>
              <Definition terme="Langues">{offre.languages.length ? offre.languages.map((code) => LANGUES.libelle(code)).join(', ') : '—'}</Definition>
              <Definition terme="Logement et repas">
                {offre.housing ? LOGEMENT.libelle(offre.housing) : offre.meals_provided ? 'Logement non précisé' : '—'}
                {offre.meals_provided ? ' · repas fournis' : ''}
              </Definition>
              <Definition terme="Permis de conduire">{offre.driving_license === null ? '—' : offre.driving_license ? 'Demandé' : 'Non demandé'}</Definition>
              <Definition terme="Postes à pourvoir">{offre.headcount ?? (offre.is_bulk_hiring ? 'Plusieurs' : '—')}</Definition>
              <Definition terme="Disponibilité">{offre.availability_text ?? (offre.is_urgent ? 'Urgent' : '—')}</Definition>
              <Definition terme="Compétences repérées">{competences.length ? competences.join(', ') : '—'}</Definition>
            </Definitions>
          </Carte>

          <Carte titre={offre.description_full ? 'Texte de l’annonce' : 'Extrait de l’annonce'}>
            {offre.ai_summary ? (
              <p className="mb-3 rounded-lg bg-marine-50 px-3 py-2 text-[0.9rem]">
                <span className="mr-2 text-[0.7rem] font-bold uppercase tracking-wide text-marine-600">Résumé automatique</span>
                {offre.ai_summary}
              </p>
            ) : null}
            {texteAnnonce ? (
              <p dir="auto" lang={estArabe(texteAnnonce) ? 'ar' : undefined} className="max-w-prose text-[0.95rem] leading-relaxed whitespace-pre-line text-marine-900">
                {texteAnnonce}
              </p>
            ) : (
              <p className="text-encre-douce">Aucun texte n’est conservé pour cette source : seul le lien vers l’annonce est enregistré.</p>
            )}
            <p className="mt-4 border-t border-sable-200 pt-3 text-[0.8rem] text-encre-douce">
              Source : <strong className="text-marine-900">{offre.source_name}</strong>. Ce qui est conservé : {MODES_COLLECTE.libelle(offre.source.collection_mode).toLowerCase()}.{' '}
              {offre.description_full ? null : 'Le texte complet reste sur le site d’origine, qui en est l’éditeur. '}
              {offre.source_url ? <LienExterne href={offre.source_url}>Ouvrir l’annonce</LienExterne> : 'Aucun lien n’est associé à cette annonce.'}
            </p>
          </Carte>

          {crm ? (
            <Carte
              id="candidats"
              titre="Candidats pour ce poste"
              sansMarge
              actions={
                session.peut('candidats.gerer') && offre.effective_status === 'actif' ? (
                  <BoutonAction action={chercherCandidatsPourOffre} champs={{ id: offre.id }} variante="primaire" icone="recherche">
                    Chercher des candidats
                  </BoutonAction>
                ) : null
              }
            >
              {correspondances.length > 0 ? (
                <ListeCorrespondances correspondances={correspondances} vue="candidats" peutAgir={session.peut('candidats.gerer')} maintenant={maintenant} />
              ) : (
                <p className="px-5 py-6 text-[0.9rem] text-encre-douce">
                  {offre.effective_status === 'actif'
                    ? 'Aucun rapprochement calculé. « Chercher des candidats » compare le vivier à ce poste (métier, lieu, disponibilité, expérience, langues, salaire) et explique chaque score.'
                    : 'Les rapprochements ne sont proposés que pour une offre active.'}
                </p>
              )}
            </Carte>
          ) : null}

          <Carte titre="Historique" sansMarge>
            {offre.versions.length > 0 ? (
              <ol className="divide-y divide-sable-100">
                {offre.versions.map((version) => (
                  <li key={version.id} className="px-4 py-3 text-[0.86rem] sm:px-5">
                    <p className="flex flex-wrap items-center gap-x-2 text-encre-douce">
                      <strong className="text-marine-900">{dateHeure(version.observed_at)}</strong>
                      <Badge>{ORIGINES[version.origin] ?? version.origin}</Badge>
                      {version.auteur ? <span>par {version.auteur}</span> : null}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {Object.entries(version.changes ?? {}).slice(0, 8).map(([champ, [avant, apres]]) => (
                        <li key={champ}>
                          <span className="font-semibold text-marine-900">{LIBELLES_CHAMPS[champ] ?? champ}</span> : <span className="text-encre-douce line-through">{valeurVersion(avant, champ)}</span> › {valeurVersion(apres, champ)}
                        </li>
                      ))}
                      {version.changed_fields.length > 0 && Object.keys(version.changes ?? {}).length === 0 ? <li className="text-encre-douce">{version.changed_fields.map((champ) => LIBELLES_CHAMPS[champ] ?? champ).join(', ')}</li> : null}
                    </ul>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Aucune modification depuis l’enregistrement.</p>
            )}
          </Carte>
          {corrigeable ? (
            <Carte titre="Corriger">
              <Formulaire action={corrigerOffreAction} className="space-y-3">
                <input type="hidden" name="id" value={offre.id} />
                <p className="text-[0.82rem] text-encre-douce">Ne modifiez que ce qui est faux ou manquant. Un champ corrigé ici ne sera plus écrasé par une collecte, et le statut est recalculé.</p>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Champ libelle="Date de publication">
                    {/* Pas de borne si la date enregistrée est déjà antérieure au plancher : le navigateur bloquerait toute autre correction. */}
                    <input className="champ" type="date" name="datePublication" defaultValue={correction.datePublication} min={correction.datePublication && correction.datePublication < plancherDate ? undefined : plancherDate} />
                  </Champ>
                  <Champ libelle="Date limite">
                    <input className="champ" type="date" name="dateExpiration" defaultValue={correction.dateExpiration} />
                  </Champ>
                  <Champ libelle="Ville">
                    <Selection name="ville" defaultValue={correction.ville} vide="Non précisée" options={OPTIONS_VILLES} />
                  </Champ>
                  <Champ libelle="Quartier">
                    <input className="champ" name="quartier" defaultValue={correction.quartier} maxLength={80} />
                  </Champ>
                  <Champ libelle="Métier" className="col-span-2">
                    <SelectionMetier name="metier" defaultValue={correction.metier} vide="À confirmer" />
                  </Champ>
                  <Champ libelle="Employeur">
                    <input className="champ" name="employeur" defaultValue={correction.employeur} maxLength={200} dir="auto" />
                  </Champ>
                  <Champ libelle="Type d’employeur">
                    <Selection name="typeEmployeur" defaultValue={correction.typeEmployeur} vide="Inconnu" options={TYPES_EMPLOYEUR.options} />
                  </Champ>
                  <Champ libelle="Contrat" className="col-span-2 lg:col-span-1">
                    <Selection name="contrat" defaultValue={correction.contrat} options={CONTRATS.options} />
                  </Champ>
                  <Champ libelle="Salaire min. (DH)">
                    <input className="champ" name="salaireMin" defaultValue={correction.salaireMin} inputMode="decimal" />
                  </Champ>
                  <Champ libelle="Salaire max. (DH)">
                    <input className="champ" name="salaireMax" defaultValue={correction.salaireMax} inputMode="decimal" />
                  </Champ>
                  <Champ libelle="Période du salaire" className="col-span-2 lg:col-span-1">
                    <Selection name="periodeSalaire" defaultValue={correction.periodeSalaire} vide="—" options={PERIODES_SALAIRE.options} />
                  </Champ>
                </div>
                <BoutonEnvoi variante="secondaire">Enregistrer la correction</BoutonEnvoi>
              </Formulaire>
            </Carte>
          ) : null}

        </div>

        <aside className="min-w-0 space-y-6">
          <Carte titre="Dates et suivi">
            <Definitions colonnes="grid-cols-2">
              <Definition terme="Publication">
                {offre.published_at ? dateCourte(offre.published_at) : <span className="font-semibold text-ambre-800">Inconnue</span>}
                {offre.published_at ? <span className="block text-[0.8rem] text-encre-douce">{ilYA(offre.published_at, maintenant)}{offre.date_precision === 'approximative' ? ' · date approximative' : ''}</span> : null}
              </Definition>
              <Definition terme="Date limite">{offre.expires_at ? dateCourte(offre.expires_at) : 'Non indiquée'}</Definition>
              <Definition terme="Enregistrée le">{dateCourte(offre.first_seen_at)}</Definition>
              <Definition terme="Dernier contrôle">{dateCourte(offre.last_checked_at)}</Definition>
              <Definition terme="Vérification">{STATUTS_VERIFICATION.libelle(offre.verification_status)}</Definition>
              <Definition terme="Extraction">{offre.extraction_method === 'manuel' ? 'Saisie' : offre.extraction_method === 'mixte' ? 'Règles + IA' : 'Règles'}</Definition>
            </Definitions>
            {offre.review_notes ? <p className="mt-3 rounded-lg bg-sable-100 px-3 py-2 text-[0.86rem]">Note du courtier : {offre.review_notes}</p> : null}
            {details.champsVerrouilles?.length ? <p className="mt-3 text-[0.78rem] text-encre-douce">Champs corrigés à la main (protégés contre les collectes suivantes) : {details.champsVerrouilles.map((champ) => LIBELLES_CHAMPS[champ] ?? (champ === 'categories' ? 'Métier' : champ)).join(', ')}.</p> : null}
          </Carte>

          <Carte titre="Scores">
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">
              <Jauge valeur={offre.relevance_score} libelle="Pertinence Yallah" />
              <Jauge valeur={offre.placement_score} libelle="Chances de placement" />
              <Jauge valeur={offre.freshness_score} libelle="Fraîcheur" />
              <Jauge valeur={offre.quality_score} libelle="Qualité de l’annonce" />
            </div>
            <div className="mt-3">
              <LignesScore titre="Pertinence" lignes={details.pertinence} />
              <LignesScore titre="Qualité" lignes={details.qualite} />
              <LignesScore titre="Placement" lignes={details.placement} />
            </div>
          </Carte>

          <Carte titre="Risques">
            <Jauge valeur={offre.risk_score} libelle="Score de risque" inverse />
            {details.risque?.length ? (
              <ul className="mt-3 space-y-2 text-[0.88rem]">
                {details.risque.map((signal) => (
                  <li key={signal.code} className="flex gap-2">
                    <span className="w-9 shrink-0 text-right font-bold text-rouge-700 tabular-nums">+{signal.poids}</span>
                    <span>
                      {signal.libelle}
                      {signal.extrait ? <span className="block text-[0.8rem] text-encre-douce" dir="auto">« {signal.extrait} »</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[0.88rem] text-encre-douce">Aucun signal relevé par les règles automatiques. Cela ne remplace pas la vérification de l’employeur.</p>
            )}
            <p className="mt-4 border-t border-sable-200 pt-3 text-[0.8rem] text-encre-douce">
              {AVERTISSEMENT_ENGAGEMENT} {MENTION_INTERMEDIAIRE}
            </p>
          </Carte>

          {moderer ? (
            <Carte titre="Contact et employeur">
              <p className="mb-3 text-[0.86rem] text-encre-douce">
                {offre.a_contact
                  ? 'Des coordonnées ont été confiées avec cette annonce. Elles sont chiffrées ; chaque affichage est journalisé.'
                  : offre.has_contact_in_source
                    ? 'L’annonce d’origine affiche des coordonnées, qui ne sont pas recopiées ici : ouvrez l’annonce pour contacter l’employeur.'
                    : 'Aucune coordonnée repérée dans l’annonce.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {offre.a_contact ? (
                  <BoutonAction action={revelerContact} champs={{ id: offre.id }} icone="telephone">
                    Afficher les coordonnées
                  </BoutonAction>
                ) : null}
                {offre.employer_id ? (
                  <LienBouton href={`/employeurs/${offre.employer_id}`} taille="petit" icone="employeurs">
                    Fiche employeur
                  </LienBouton>
                ) : session.peut('employeurs.gerer') && !offre.is_demo ? (
                  <BoutonAction action={creerEmployeurDepuisOffre} champs={{ id: offre.id }} icone="employeurs">
                    Créer la fiche employeur
                  </BoutonAction>
                ) : null}
              </div>
            </Carte>
          ) : null}

          {moderer ? (
            <Carte titre="Vérification">
              {archivee ? (
                <div className="space-y-3">
                  <p className="text-[0.88rem] text-encre-douce">Cette offre est archivée ({MOTIFS_STATUT.libelle(offre.status_reason).toLowerCase() || 'sans motif'}).</p>
                  {offre.duplicate_of_id ? (
                    <BoutonAction action={dissocierDoublonAction} champs={{ id: offre.id }} confirmer="Dissocier cette offre de l’offre principale ?">
                      Ce n’est pas un doublon : dissocier
                    </BoutonAction>
                  ) : offre.status_reason === 'hors_perimetre_date' ? (
                    <p className="text-[0.88rem] text-encre-douce">
                      Elle ne se rouvre pas à la main : elle reviendra d’elle-même si le début de la recherche est reculé jusqu’à sa date de publication, ou si cette date est rectifiée dans « Corriger ».
                    </p>
                  ) : (
                    <Formulaire action={verifierOffreAction} className="space-y-2">
                      <input type="hidden" name="id" value={offre.id} />
                      {risqueEleve ? (
                        <Champ libelle="Pourquoi cette offre est fiable" obligatoire aide="Obligatoire : l’offre porte des signaux de risque élevé. Consigné au journal d’audit.">
                          <input className="champ" name="note" maxLength={300} required minLength={10} />
                        </Champ>
                      ) : null}
                      <BoutonEnvoi variante="secondaire" taille="petit">
                        Rouvrir : l’offre est de nouveau valable
                      </BoutonEnvoi>
                    </Formulaire>
                  )}
                </div>
              ) : (
                <div className="space-y-5">
                  {risqueEleve ? (
                    <Formulaire action={verifierOffreAction} className="space-y-2" confirmer="Cette offre porte des signaux de risque. Confirmer qu’elle est fiable et la rendre active ?">
                      <input type="hidden" name="id" value={offre.id} />
                      <Champ libelle="Pourquoi cette offre est fiable" obligatoire aide="Obligatoire : l’offre porte des signaux de risque élevé. Par exemple : « employeur joint, aucun frais demandé ». Consigné au journal d’audit.">
                        <input className="champ" name="note" maxLength={300} required minLength={10} />
                      </Champ>
                      <BoutonEnvoi variante="secondaire" icone="verifier">
                        Je confirme que cette offre est fiable
                      </BoutonEnvoi>
                      <p className="text-[0.78rem] text-encre-douce">Si le doute persiste, écartez-la ci-dessous : c’est le choix le plus sûr pour les candidats.</p>
                    </Formulaire>
                  ) : (
                    <Formulaire action={verifierOffreAction} className="space-y-2">
                      <input type="hidden" name="id" value={offre.id} />
                      <Champ libelle="Note (facultative)" aide="Par exemple : « annonce toujours en ligne », « employeur joint par téléphone ».">
                        <input className="champ" name="note" maxLength={300} />
                      </Champ>
                      <BoutonEnvoi icone="verifier">J’ai vérifié cette offre</BoutonEnvoi>
                    </Formulaire>
                  )}
                  <Formulaire action={archiverOffreAction} className="space-y-2 border-t border-sable-200 pt-4" confirmer="Archiver cette offre ?">
                    <input type="hidden" name="id" value={offre.id} />
                    <Champ libelle="Retirer l’offre">
                      <Selection
                        name="motif"
                        options={[
                          { valeur: 'rejetee_moderation', libelle: 'Écarter : annonce fausse, risquée ou hors sujet' },
                          { valeur: 'pourvue', libelle: 'Le poste est pourvu' },
                          { valeur: 'archivage_manuel', libelle: 'Archiver sans autre précision' },
                        ]}
                      />
                    </Champ>
                    <Champ libelle="Motif" aide="Obligatoire si l’offre est écartée : il explique la décision à vos collègues.">
                      <input className="champ" name="note" maxLength={300} />
                    </Champ>
                    <BoutonEnvoi variante="danger">Archiver</BoutonEnvoi>
                  </Formulaire>
                </div>
              )}
            </Carte>
          ) : null}

          {offre.doublons.length > 0 ? (
            <Carte titre={`Doublons rattachés (${offre.doublons.length})`} sansMarge>
              <ul className="divide-y divide-sable-100 text-[0.88rem]">
                {offre.doublons.map((doublon) => (
                  <li key={doublon.id} className="px-4 py-3 sm:px-5">
                    <Link href={`/offres/${doublon.id}`} className="font-semibold text-marine-900 underline underline-offset-3">
                      {doublon.reference}
                    </Link>{' '}
                    <span className="text-encre-douce">
                      · {doublon.source_name}
                      {doublon.duplicate_score !== null ? ` · ressemblance ${Math.round(doublon.duplicate_score)} %` : ''}
                    </span>
                    <p className="text-encre-douce">
                      <TexteLibre>{doublon.title}</TexteLibre>
                    </p>
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}
        </aside>
      </div>
    </>
  );
}
