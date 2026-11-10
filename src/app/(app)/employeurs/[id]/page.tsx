import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { notFound } from 'next/navigation';
import { StatutBesoin, StatutEmployeur, libelleFormule } from '@/composants/employeurs';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { accord, dateCourte, dateHeure, dateIso, echeance, pluriel } from '@/composants/format';
import { StatutOffre } from '@/composants/offres';
import { Badge, BadgeFictif, Carte, Champ, Definition, Definitions, EnTetePage, Encart, LienBouton, Selection, TexteLibre } from '@/composants/ui';
import { nomVille } from '@/domaine/geographie';
import { BASES_CONTACT, STATUTS_EMPLOYEUR, STATUTS_PLACEMENT, TYPES_ECHANGE, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { libelleMetier } from '@/domaine/taxonomie';
import { employeurParId } from '@/serveur/employeurs';
import { chargerParametres } from '@/serveur/parametres';
import { exigerPermission } from '@/serveur/session-next';
import { ajouterEchangeAction, changerStatutEmployeurAction } from '../actions';

export const metadata: Metadata = { title: 'Fiche employeur' };

const ORIGINES: Record<string, string> = { saisie: 'Prospection / saisie', offre: 'Créée depuis une offre', demande_entrante: 'A contacté Yallah Services', recommandation: 'Recommandation', site_yallah: 'Formulaire du site', import: 'Import' };

export default async function PageEmployeur({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerPermission('employeurs.lire');
  const { id } = await params;
  const [employeur, parametres] = await Promise.all([employeurParId(id, session.acteur), chargerParametres()]);
  if (!employeur) notFound();
  const gerer = session.peut('employeurs.gerer');
  const maintenant = new Date();
  // Aucune relance n'est affichée ni rappelée pour un employeur qui a demandé à ne plus être contacté, ni pour une fiche clôturée.
  const relance = employeur.next_follow_up_at && !employeur.do_not_contact && employeur.status !== 'cloture' ? echeance(employeur.next_follow_up_at, maintenant) : null;

  return (
    <>
      <p className="hors-impression mb-3 text-[0.86rem]">
        <Link href="/employeurs" className="font-semibold text-marine-700 underline underline-offset-3">
          ‹ Tous les employeurs
        </Link>
      </p>
      <EnTetePage
        surtitre={`${employeur.reference} · ${TYPES_EMPLOYEUR.libelle(employeur.employer_type)}`}
        titre={<TexteLibre>{employeur.name}</TexteLibre>}
        actions={
          gerer ? (
            <>
              <LienBouton href={`/besoins/nouveau?employeur=${employeur.id}`} variante="primaire" icone="plus">
                Nouveau besoin
              </LienBouton>
              <LienBouton href={`/employeurs/${employeur.id}/modifier`} icone="modifier">
                Modifier
              </LienBouton>
            </>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <StatutEmployeur statut={employeur.status} />
          {employeur.city_code ? <Badge>{nomVille(employeur.city_code)}</Badge> : null}
          {relance ? <Badge ton={relance.retard ? 'rouge' : 'or'}>Relance {relance.texte}</Badge> : null}
          {employeur.is_demo ? <BadgeFictif /> : null}
        </div>
      </EnTetePage>

      {employeur.do_not_contact ? (
        <Encart ton="attention" className="mb-4" titre="Ne plus contacter">
          Cet employeur a demandé à ne plus être sollicité. Aucun appel, message ou e-mail ne peut être enregistré ; seules des notes internes restent possibles.
        </Encart>
      ) : null}
      {employeur.is_demo ? (
        <Encart ton="info" className="mb-4" titre="Employeur fictif">
          Cet employeur n’existe pas : la fiche fait partie du jeu de démonstration.
        </Encart>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Carte
            titre={`Besoins (${employeur.besoins.length})`}
            sansMarge
            actions={
              gerer ? (
                <LienBouton href={`/besoins/nouveau?employeur=${employeur.id}`} taille="petit" icone="plus">
                  Ajouter
                </LienBouton>
              ) : null
            }
          >
            {employeur.besoins.length > 0 ? (
              <ul className="divide-y divide-sable-100">
                {employeur.besoins.map((besoin) => (
                  <li key={besoin.id} className="relative flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-sable-50 sm:px-5">
                    <div className="min-w-0">
                      <Link href={`/besoins/${besoin.id}`} className="font-semibold text-marine-900 after:absolute after:inset-0 hover:underline">
                        <TexteLibre>{besoin.title}</TexteLibre>
                      </Link>
                      <p className="text-[0.8rem] text-encre-douce">
                        {besoin.reference} · {libelleMetier(besoin.metier)} · {besoin.places}/{besoin.headcount} {accord(besoin.places, 'pourvu')} · {pluriel(besoin.correspondances, 'candidat')} en cours · {libelleFormule(besoin.fee_plan, besoin.fee_amount, parametres)}
                      </p>
                    </div>
                    <span className="flex items-center gap-1.5">
                      {besoin.is_urgent ? <Badge ton="rouge">Urgent</Badge> : null}
                      <StatutBesoin statut={besoin.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Aucun besoin décrit. Un besoin précise le poste, les conditions et la formule ; il permet de proposer des candidats.</p>
            )}
          </Carte>

          <Carte titre="Échanges" sansMarge>
            {gerer ? (
              <Formulaire action={ajouterEchangeAction} className="border-b border-sable-200 px-4 py-4 sm:px-5" viderApresSucces>
                <input type="hidden" name="id" value={employeur.id} />
                <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                  <Champ libelle="Type">
                    <Selection name="type" defaultValue={employeur.do_not_contact ? 'note' : 'appel'} options={employeur.do_not_contact ? TYPES_ECHANGE.options.filter((option) => option.valeur === 'note') : TYPES_ECHANGE.options} />
                  </Champ>
                  <Champ libelle="Ce qui s’est dit" obligatoire>
                    <textarea className="champ" name="resume" rows={2} required minLength={2} maxLength={2000} dir="auto" />
                  </Champ>
                  <Champ libelle="Date de l’échange" aide="Aujourd’hui si vide.">
                    <input className="champ" type="date" name="date" max={dateIso(maintenant)} />
                  </Champ>
                  <Champ libelle="Prochaine action le" aide="Crée un rappel dans « À faire aujourd’hui ». Vide = aucune relance prévue.">
                    <input className="champ sm:max-w-52" type="date" name="prochaineAction" min={dateIso(maintenant)} />
                  </Champ>
                </div>
                <div className="mt-3">
                  <BoutonEnvoi variante="secondaire" icone="plus">
                    Noter l’échange
                  </BoutonEnvoi>
                </div>
              </Formulaire>
            ) : null}
            {employeur.echanges.length > 0 ? (
              <ol className="divide-y divide-sable-100">
                {employeur.echanges.map((echange) => (
                  <li key={echange.id} className="px-4 py-3 text-[0.9rem] sm:px-5">
                    <p className="flex flex-wrap items-center gap-x-2 text-[0.82rem] text-encre-douce">
                      <Badge>{TYPES_ECHANGE.libelle(echange.kind)}</Badge>
                      <strong className="text-marine-900">{dateHeure(echange.occurred_at)}</strong>
                      {echange.auteur ? <span>par {echange.auteur}</span> : null}
                      {echange.next_action_at ? <span>· suite prévue le {dateCourte(echange.next_action_at)}</span> : null}
                    </p>
                    <p className="mt-1 whitespace-pre-line" dir="auto">
                      {echange.summary}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Aucun échange noté.</p>
            )}
          </Carte>

          {employeur.offres.length > 0 ? (
            <Carte titre={`Offres liées (${employeur.offres.length})`} sansMarge>
              <ul className="divide-y divide-sable-100 text-[0.9rem]">
                {employeur.offres.map((offre) => (
                  <li key={offre.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <span className="min-w-0">
                      <Link href={`/offres/${offre.id}`} className="font-semibold text-marine-900 underline underline-offset-3">
                        {offre.reference}
                      </Link>{' '}
                      — <TexteLibre>{offre.title}</TexteLibre>
                      <span className="text-encre-douce"> · {offre.published_at ? dateCourte(offre.published_at) : 'date inconnue'}</span>
                    </span>
                    <StatutOffre statut={offre.effective_status} />
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}

          {employeur.placements.length > 0 ? (
            <Carte titre={`Placements (${employeur.placements.length})`} sansMarge>
              <ul className="divide-y divide-sable-100 text-[0.9rem]">
                {employeur.placements.map((placement) => (
                  <li key={placement.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <span>
                      <Link href={`/placements/${placement.id}`} className="font-semibold text-marine-900 underline underline-offset-3">
                        {placement.reference}
                      </Link>{' '}
                      — candidat {placement.candidat} · début le {dateCourte(placement.start_date)}
                    </span>
                    <Badge ton={placement.status === 'en_cours' || placement.status === 'confirme' ? 'vert' : 'neutre'}>{STATUTS_PLACEMENT.libelle(placement.status)}</Badge>
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          <Carte titre="Coordonnées">
            <Definitions colonnes="grid-cols-1">
              <Definition terme="Personne à contacter">
                <TexteLibre>{employeur.contact}</TexteLibre>
                {employeur.contact ? null : '—'}
              </Definition>
              <Definition terme="Téléphone">
                {employeur.telephone ? (
                  employeur.do_not_contact ? (
                    employeur.telephone
                  ) : (
                    <a href={`tel:${employeur.telephone}`} className="font-semibold">
                      {employeur.telephone}
                    </a>
                  )
                ) : (
                  '—'
                )}
              </Definition>
              <Definition terme="E-mail">{employeur.email ?? '—'}</Definition>
              <Definition terme="Adresse">
                {[employeur.adresse, employeur.district, employeur.city_code ? nomVille(employeur.city_code) : null].filter(Boolean).join(', ') || '—'}
              </Definition>
              <Definition terme="Origine des coordonnées">{BASES_CONTACT.libelle(employeur.contact_basis)}</Definition>
              <Definition terme="Origine de la fiche">{ORIGINES[employeur.origin] ?? employeur.origin}</Definition>
            </Definitions>
            {employeur.notes ? (
              <p className="mt-3 rounded-lg bg-sable-100 px-3 py-2 text-[0.88rem] whitespace-pre-line" dir="auto">
                {employeur.notes}
              </p>
            ) : null}
            <p className="mt-3 text-[0.78rem] text-encre-douce">Fiche créée le {dateCourte(employeur.created_at)}.</p>
          </Carte>

          {gerer ? (
            <Carte titre="Étape du suivi">
              <Formulaire action={changerStatutEmployeurAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={employeur.id} />
                <Champ libelle="Étape" className="min-w-44 flex-1">
                  <Selection name="statut" defaultValue={employeur.status} options={STATUTS_EMPLOYEUR.options} />
                </Champ>
                <BoutonEnvoi variante="secondaire">Changer</BoutonEnvoi>
              </Formulaire>
              <p className="mt-3 text-[0.78rem] text-encre-douce">L’étape avance aussi d’elle-même : « Contacté » au premier échange noté, « Besoin qualifié » dès qu’un besoin est décrit, « Placement réalisé » à l’enregistrement d’un placement.</p>
            </Carte>
          ) : null}
        </aside>
      </div>
    </>
  );
}
