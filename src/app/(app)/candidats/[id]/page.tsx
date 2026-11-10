import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { notFound } from 'next/navigation';
import { StatutCandidat } from '@/composants/candidats';
import { ListeCorrespondances } from '@/composants/correspondances';
import { BoutonAction, BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { dateCourte, dateHeure, dirhams, pluriel } from '@/composants/format';
import { Badge, BadgeFictif, Carte, Champ, Definition, Definitions, EnTetePage, Encart, LienBouton, Selection, TexteLibre } from '@/composants/ui';
import { nomVille } from '@/domaine/geographie';
import { CANAUX_CONSENTEMENT, COMPETENCES, DOCUMENTS_CANDIDAT, LANGUES, LIENS_REFERENCE, LOGEMENT, PERIODES_SALAIRE, STATUTS_CANDIDAT, STATUTS_PLACEMENT, TEMPS_TRAVAIL } from '@/domaine/referentiels';
import { libelleMetier } from '@/domaine/taxonomie';
import { listerCorrespondances } from '@/serveur/appariements';
import { candidatParId } from '@/serveur/candidats';
import { listerPlacements } from '@/serveur/placements';
import { exigerPermission } from '@/serveur/session-next';
import { chercherPostesPourCandidat } from '../../appariements/actions';
import { ajouterReferenceAction, anonymiserCandidatAction, changerStatutCandidatAction, verifierReferenceAction } from '../actions';

export const metadata: Metadata = { title: 'Fiche candidat' };

const ORIGINES: Record<string, string> = { saisie: 'Saisie par un courtier', formulaire_yallah: 'Formulaire du site Yallah Services', import: 'Import', recommandation: 'Recommandation' };
const RAISONS_ANONYMISATION: Record<string, string> = { demande_candidat: 'à la demande de la personne', fin_conservation: 'fin de la durée de conservation', retrait_consentement: 'retrait du consentement' };

export default async function PageCandidat({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerPermission('candidats.lire');
  const { id } = await params;
  const candidat = await candidatParId(id, session.acteur);
  if (!candidat) notFound();
  const gerer = session.peut('candidats.gerer');
  const [correspondances, placements] = await Promise.all([listerCorrespondances({ candidatId: candidat.id, limite: 30 }), listerPlacements({ candidat: candidat.id })]);
  const maintenant = new Date();
  const placementOuvert = placements.find((placement) => placement.status === 'en_cours' || placement.status === 'confirme');
  const statutsManuels = STATUTS_CANDIDAT.options.filter((option) => option.valeur !== 'place' && option.valeur !== candidat.status);
  const liste = (codes: string[], libelle: (code: string) => string) => (codes.length ? codes.map(libelle).join(', ') : '—');

  return (
    <>
      <p className="hors-impression mb-3 text-[0.86rem]">
        <Link href="/candidats" className="font-semibold text-marine-700 underline underline-offset-3">
          ‹ Tous les candidats
        </Link>
      </p>
      <EnTetePage
        surtitre={candidat.reference}
        titre={candidat.anonymise ? 'Fiche anonymisée' : <TexteLibre>{candidat.nom ?? candidat.reference}</TexteLibre>}
        actions={
          gerer && !candidat.anonymise ? (
            <LienBouton href={`/candidats/${candidat.id}/modifier`} icone="modifier">
              Modifier
            </LienBouton>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <StatutCandidat statut={candidat.status} />
          <Badge>{libelleMetier(candidat.metier)}</Badge>
          {candidat.city_code ? <Badge>{nomVille(candidat.city_code)}</Badge> : null}
          {candidat.is_demo ? <BadgeFictif /> : null}
        </div>
      </EnTetePage>

      {candidat.anonymise ? (
        <Encart ton="info" className="mb-4" titre="Données identifiantes effacées">
          Fiche anonymisée le {dateCourte(candidat.anonymized_at)} ({RAISONS_ANONYMISATION[candidat.anonymized_reason ?? ''] ?? 'motif non précisé'}). Seul le profil professionnel anonyme est conservé, pour les statistiques et l’historique des placements.
        </Encart>
      ) : null}
      {candidat.is_demo ? (
        <Encart ton="info" className="mb-4" titre="Candidat fictif">
          Cette personne n’existe pas : la fiche fait partie du jeu de démonstration.
        </Encart>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Carte titre="Profil professionnel">
            <Definitions colonnes="sm:grid-cols-2 lg:grid-cols-3">
              <Definition terme="Métier principal">{libelleMetier(candidat.metier)}</Definition>
              <Definition terme="Autres métiers">{liste(candidat.metiers.filter((code) => code !== candidat.metier), libelleMetier)}</Definition>
              <Definition terme="Expérience">{candidat.experience_years !== null ? pluriel(candidat.experience_years, 'an') : '—'}</Definition>
              <Definition terme="Ville">
                {candidat.city_code ? nomVille(candidat.city_code) : '—'}
                {candidat.district ? ` · ${candidat.district}` : ''}
              </Definition>
              <Definition terme="Accepte aussi">{liste(candidat.accepted_city_codes, nomVille)}</Definition>
              <Definition terme="Disponibilité">{candidat.available_from && new Date(candidat.available_from) > maintenant ? `à partir du ${dateCourte(candidat.available_from)}` : 'Immédiate'}</Definition>
              <Definition terme="Salaire souhaité">{candidat.expected_salary !== null ? `${dirhams(candidat.expected_salary)} ${PERIODES_SALAIRE.libelle(candidat.salary_period)}` : '—'}</Definition>
              <Definition terme="Logement">{LOGEMENT.libelle(candidat.housing_preference)}</Definition>
              <Definition terme="Rythmes">
                {liste(candidat.work_times, TEMPS_TRAVAIL.libelle)}
                {candidat.days_per_week ? ` · ${candidat.days_per_week} j/semaine` : ''}
              </Definition>
              <Definition terme="Langues">{liste(candidat.languages, LANGUES.libelle)}</Definition>
              <Definition terme="Permis de conduire">{candidat.driving_license ? 'Oui' : 'Non'}</Definition>
              <Definition terme="Documents présentés">{liste(candidat.documents, DOCUMENTS_CANDIDAT.libelle)}</Definition>
              <Definition terme="Compétences">{liste(candidat.competences, (code) => COMPETENCES.find((c) => c.code === code)?.fr ?? code)}</Definition>
            </Definitions>
            {candidat.summary ? (
              <p className="mt-4 border-t border-sable-200 pt-3 text-[0.93rem] whitespace-pre-line" dir="auto">
                {candidat.summary}
              </p>
            ) : null}
          </Carte>

          <Carte
            titre="Postes possibles"
            sansMarge
            actions={
              gerer && !candidat.anonymise && !placementOuvert ? (
                <BoutonAction action={chercherPostesPourCandidat} champs={{ id: candidat.id }} variante="primaire" icone="recherche">
                  Chercher des postes
                </BoutonAction>
              ) : null
            }
          >
            {correspondances.length > 0 ? (
              <ListeCorrespondances correspondances={correspondances} vue="postes" peutAgir={gerer} maintenant={maintenant} />
            ) : (
              <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Aucun rapprochement calculé. « Chercher des postes » compare ce profil aux offres actives et aux besoins ouverts des employeurs.</p>
            )}
          </Carte>

          {placements.length > 0 ? (
            <Carte titre="Placements" sansMarge>
              <ul className="divide-y divide-sable-100 text-[0.9rem]">
                {placements.map((placement) => (
                  <li key={placement.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <span>
                      <Link href={`/placements/${placement.id}`} className="font-semibold text-marine-900 underline underline-offset-3">
                        {placement.reference}
                      </Link>{' '}
                      — <TexteLibre>{placement.employeur}</TexteLibre> · {libelleMetier(placement.metier)} · début le {dateCourte(placement.start_date)}
                    </span>
                    <Badge ton={placement.status === 'en_cours' || placement.status === 'confirme' ? 'vert' : 'neutre'}>{STATUTS_PLACEMENT.libelle(placement.status)}</Badge>
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          {candidat.anonymise ? null : (
            <Carte titre="Coordonnées">
              <Definitions colonnes="grid-cols-1">
                <Definition terme="Téléphone">
                  {candidat.telephone ? (
                    <a href={`tel:${candidat.telephone}`} className="font-semibold">
                      {candidat.telephone}
                    </a>
                  ) : (
                    '—'
                  )}
                  {candidat.telephone ? <span className="block text-[0.8rem] text-encre-douce">{candidat.whatsapp_opt_in ? 'Accepte d’être contacté(e) sur WhatsApp' : 'Ne pas contacter sur WhatsApp'}</span> : null}
                </Definition>
                <Definition terme="E-mail">{candidat.email ?? '—'}</Definition>
                {candidat.declared_age !== null ? <Definition terme="Âge déclaré">{candidat.declared_age} ans</Definition> : null}
              </Definitions>
              {candidat.notes ? (
                <p className="mt-3 rounded-lg bg-sable-100 px-3 py-2 text-[0.88rem] whitespace-pre-line" dir="auto">
                  {candidat.notes}
                </p>
              ) : null}
            </Carte>
          )}

          <Carte titre="Consentement et conservation">
            <Definitions colonnes="grid-cols-2">
              <Definition terme="Accord donné le">{dateCourte(candidat.consent_given_at)}</Definition>
              <Definition terme="Recueilli par">{CANAUX_CONSENTEMENT.libelle(candidat.consent_channel)}</Definition>
              <Definition terme="Version du texte">{candidat.consent_version}</Definition>
              <Definition terme="Origine de la fiche">{ORIGINES[candidat.origin] ?? candidat.origin}</Definition>
              <Definition terme="Dernière activité">{dateHeure(candidat.last_activity_at)}</Definition>
              <Definition terme="Conservée jusqu’au">{candidat.status === 'place' ? 'Tant que le placement dure' : dateCourte(candidat.retention_until)}</Definition>
            </Definitions>
            <p className="mt-3 text-[0.78rem] text-encre-douce">Passé cette date sans nouvelle activité, la fiche est anonymisée automatiquement.</p>
          </Carte>

          {gerer && !candidat.anonymise ? (
            <Carte titre="Statut">
              {placementOuvert ? (
                <p className="text-[0.88rem] text-encre-douce">
                  Placement en cours (
                  <Link href={`/placements/${placementOuvert.id}`} className="font-semibold text-marine-800 underline">
                    {placementOuvert.reference}
                  </Link>
                  ) : le statut se modifie en clôturant ce placement.
                </p>
              ) : (
                <Formulaire action={changerStatutCandidatAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={candidat.id} />
                  <Champ libelle="Passer à" className="min-w-40 flex-1">
                    <Selection name="statut" options={statutsManuels} />
                  </Champ>
                  <BoutonEnvoi variante="secondaire">Changer</BoutonEnvoi>
                </Formulaire>
              )}
              <p className="mt-3 text-[0.78rem] text-encre-douce">« Placé » est attribué automatiquement à l’enregistrement d’un placement. Un candidat refusé ou indisponible n’est plus proposé.</p>
            </Carte>
          ) : null}

          {candidat.anonymise ? null : (
            <Carte titre={`Références (${candidat.references.length})`}>
              {candidat.references.length > 0 ? (
                <ul className="mb-4 space-y-3 text-[0.9rem]">
                  {candidat.references.map((reference) => (
                    <li key={reference.id} className="rounded-lg border border-sable-200 px-3 py-2">
                      <p className="font-semibold text-marine-900" dir="auto">
                        {reference.nom ?? '—'} <span className="font-normal text-encre-douce">· {LIENS_REFERENCE.libelle(reference.relation)}</span>
                      </p>
                      {reference.telephone ? <p className="text-encre-douce">{reference.telephone}</p> : null}
                      {reference.checked_at ? (
                        <p className="mt-1 text-[0.82rem] font-semibold text-vert-700">
                          Vérifiée le {dateCourte(reference.checked_at)}
                          {reference.check_notes ? <span className="font-normal text-encre-douce"> — {reference.check_notes}</span> : null}
                        </p>
                      ) : gerer ? (
                        <Formulaire action={verifierReferenceAction} className="mt-2 flex flex-wrap items-end gap-2" messageEnBas>
                          <input type="hidden" name="reference" value={reference.id} />
                          <input className="champ min-w-40 flex-1" name="note" maxLength={500} placeholder="Ce qu’a dit la référence" aria-label="Note de vérification" />
                          <BoutonEnvoi variante="secondaire" taille="petit">
                            Référence jointe
                          </BoutonEnvoi>
                        </Formulaire>
                      ) : (
                        <p className="mt-1 text-[0.82rem] text-ambre-800">Non vérifiée</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-4 text-[0.88rem] text-encre-douce">Aucune référence enregistrée.</p>
              )}
              {gerer && candidat.references.length < 5 ? (
                <Formulaire action={ajouterReferenceAction} className="space-y-2 border-t border-sable-200 pt-3" viderApresSucces>
                  <input type="hidden" name="id" value={candidat.id} />
                  <p className="text-[0.86rem] font-semibold text-marine-900">Ajouter une référence</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="champ" name="nom" required minLength={2} maxLength={120} placeholder="Nom" aria-label="Nom de la référence" dir="auto" />
                    <input className="champ" name="telephone" type="tel" placeholder="Téléphone" aria-label="Téléphone de la référence" />
                  </div>
                  <Selection name="relation" options={LIENS_REFERENCE.options} aria-label="Lien avec le candidat" />
                  <BoutonEnvoi variante="secondaire" taille="petit" icone="plus">
                    Ajouter
                  </BoutonEnvoi>
                </Formulaire>
              ) : null}
            </Carte>
          )}

          {gerer && !candidat.anonymise ? (
            <Carte titre="Effacer les données personnelles">
              <p className="mb-3 text-[0.86rem] text-encre-douce">
                À utiliser quand la personne le demande ou retire son accord. Le nom, les coordonnées, les notes et les références sont effacés définitivement ; le profil professionnel anonyme est conservé.
              </p>
              <Formulaire action={anonymiserCandidatAction} className="space-y-2" confirmer="Effacer définitivement les données personnelles de ce candidat ? Cette action est irréversible.">
                <input type="hidden" name="id" value={candidat.id} />
                <Selection
                  name="raison"
                  aria-label="Raison"
                  options={[
                    { valeur: 'demande_candidat', libelle: 'La personne l’a demandé' },
                    { valeur: 'retrait_consentement', libelle: 'La personne retire son consentement' },
                  ]}
                />
                <BoutonEnvoi variante="danger" taille="petit">
                  Anonymiser la fiche
                </BoutonEnvoi>
              </Formulaire>
            </Carte>
          ) : null}
        </aside>
      </div>
    </>
  );
}
