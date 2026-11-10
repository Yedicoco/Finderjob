import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { notFound } from 'next/navigation';
import { ListeCorrespondances } from '@/composants/correspondances';
import { StatutBesoin, libelleFormule } from '@/composants/employeurs';
import { BoutonAction, BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { accord, dateCourte, pluriel, salaire } from '@/composants/format';
import { Badge, BadgeFictif, Carte, Champ, Definition, Definitions, EnTetePage, Encart, LienBouton, Selection, TexteLibre } from '@/composants/ui';
import { nomVille } from '@/domaine/geographie';
import { CONTRATS, LANGUES, LOGEMENT, STATUTS_BESOIN, STATUTS_PLACEMENT, TEMPS_TRAVAIL, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { libelleMetier } from '@/domaine/taxonomie';
import { listerCorrespondances } from '@/serveur/appariements';
import { besoinParId } from '@/serveur/employeurs';
import { chargerParametres } from '@/serveur/parametres';
import { listerPlacements } from '@/serveur/placements';
import { exigerPermission } from '@/serveur/session-next';
import { chercherCandidatsPourBesoin } from '../../appariements/actions';
import { changerStatutBesoinAction } from '../../employeurs/actions';

export const metadata: Metadata = { title: 'Besoin' };

export default async function PageBesoin({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerPermission('employeurs.lire');
  const { id } = await params;
  const besoin = await besoinParId(id);
  if (!besoin) notFound();
  const [parametres, correspondances, placements] = await Promise.all([
    chargerParametres(),
    session.peut('candidats.lire') ? listerCorrespondances({ besoinId: besoin.id, limite: 40 }) : Promise.resolve([]),
    listerPlacements({ employeur: besoin.employer_id }),
  ]);
  const placementsDuBesoin = placements.filter((placement) => placement.employer_need_id === besoin.id);
  const gerer = session.peut('employeurs.gerer');
  const ouvert = besoin.status === 'ouvert' || besoin.status === 'en_cours';
  const maintenant = new Date();

  return (
    <>
      <p className="hors-impression mb-3 text-[0.86rem]">
        <Link href="/besoins" className="font-semibold text-marine-700 underline underline-offset-3">
          ‹ Tous les besoins
        </Link>
      </p>
      <EnTetePage
        surtitre={
          <>
            {besoin.reference} ·{' '}
            <Link href={`/employeurs/${besoin.employer_id}`} className="underline underline-offset-3">
              {besoin.employeur}
            </Link>{' '}
            ({TYPES_EMPLOYEUR.libelle(besoin.employer_type).toLowerCase()})
          </>
        }
        titre={<TexteLibre>{besoin.title}</TexteLibre>}
        actions={
          gerer ? (
            <LienBouton href={`/besoins/${besoin.id}/modifier`} icone="modifier">
              Modifier
            </LienBouton>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <StatutBesoin statut={besoin.status} />
          {besoin.is_urgent ? <Badge ton="rouge">Urgent</Badge> : null}
          <Badge>
            {besoin.places} / {besoin.headcount} {accord(besoin.places, 'pourvu')}
          </Badge>
          {besoin.is_demo ? <BadgeFictif /> : null}
        </div>
      </EnTetePage>

      {!besoin.metier && ouvert ? (
        <Encart ton="attention" className="mb-4" titre="Métier à préciser">
          Sans métier, aucun candidat ne peut être proposé pour ce besoin. Complétez-le avec « Modifier ».
        </Encart>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Carte
            id="candidats"
            titre="Candidats pour ce besoin"
            sansMarge
            actions={
              session.peut('candidats.gerer') && ouvert ? (
                <BoutonAction action={chercherCandidatsPourBesoin} champs={{ id: besoin.id }} variante="primaire" icone="recherche">
                  Chercher des candidats
                </BoutonAction>
              ) : null
            }
          >
            {correspondances.length > 0 ? (
              <ListeCorrespondances correspondances={correspondances} vue="candidats" peutAgir={session.peut('candidats.gerer')} maintenant={maintenant} />
            ) : (
              <p className="px-5 py-6 text-[0.9rem] text-encre-douce">
                {ouvert
                  ? 'Aucun rapprochement calculé. « Chercher des candidats » compare le vivier à ce besoin et explique chaque score ; vous décidez ensuite qui retenir et qui proposer à l’employeur.'
                  : 'Ce besoin est clos : les rapprochements ne sont plus calculés.'}
              </p>
            )}
          </Carte>

          {placementsDuBesoin.length > 0 ? (
            <Carte titre="Placements" sansMarge>
              <ul className="divide-y divide-sable-100 text-[0.9rem]">
                {placementsDuBesoin.map((placement) => (
                  <li key={placement.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <span>
                      <Link href={`/placements/${placement.id}`} className="font-semibold text-marine-900 underline underline-offset-3">
                        {placement.reference}
                      </Link>{' '}
                      — {placement.candidat_nom ?? placement.candidat_reference} · début le {dateCourte(placement.start_date)}
                    </span>
                    <Badge ton={placement.status === 'en_cours' || placement.status === 'confirme' ? 'vert' : 'neutre'}>{STATUTS_PLACEMENT.libelle(placement.status)}</Badge>
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          <Carte titre="Le poste">
            <Definitions colonnes="grid-cols-2">
              <Definition terme="Métier">{besoin.metier ? libelleMetier(besoin.metier) : <span className="font-semibold text-ambre-800">À préciser</span>}</Definition>
              <Definition terme="Postes">{besoin.headcount}</Definition>
              <Definition terme="Lieu">
                {besoin.city_code ? nomVille(besoin.city_code) : '—'}
                {besoin.district ? ` · ${besoin.district}` : ''}
              </Definition>
              <Definition terme="Début souhaité">{besoin.start_date ? dateCourte(besoin.start_date) : 'Non précisé'}</Definition>
              <Definition terme="Salaire">{salaire(besoin.salary_min, besoin.salary_max, besoin.salary_period) ?? 'Non précisé'}</Definition>
              <Definition terme="Contrat">{CONTRATS.libelle(besoin.contract_type)}</Definition>
              <Definition terme="Rythme">{TEMPS_TRAVAIL.libelle(besoin.work_time)}</Definition>
              <Definition terme="Logement">{besoin.housing ? LOGEMENT.libelle(besoin.housing) : 'Non précisé'}</Definition>
              <Definition terme="Expérience minimale">{besoin.experience_min_years !== null ? pluriel(besoin.experience_min_years, 'an') : '—'}</Definition>
              <Definition terme="Permis">{besoin.driving_license === null ? 'Sans importance' : besoin.driving_license ? 'Exigé' : 'Non exigé'}</Definition>
              <Definition terme="Langues">{besoin.languages.length ? besoin.languages.map((code) => LANGUES.libelle(code)).join(', ') : '—'}</Definition>
              <Definition terme="Créé le">{dateCourte(besoin.created_at)}</Definition>
            </Definitions>
            {besoin.requirements ? (
              <p className="mt-3 border-t border-sable-200 pt-3 text-[0.9rem] whitespace-pre-line" dir="auto">
                {besoin.requirements}
              </p>
            ) : null}
            {besoin.notes ? (
              <p className="mt-3 rounded-lg bg-sable-100 px-3 py-2 text-[0.88rem] whitespace-pre-line" dir="auto">
                {besoin.notes}
              </p>
            ) : null}
            {besoin.job_offer_id ? (
              <p className="mt-3 text-[0.86rem]">
                <Link href={`/offres/${besoin.job_offer_id}`} className="font-semibold text-marine-800 underline underline-offset-3">
                  Voir l’offre à l’origine de ce besoin
                </Link>
              </p>
            ) : null}
          </Carte>

          <Carte titre="Frais de placement">
            <p className="text-[0.95rem] font-semibold text-marine-900">{libelleFormule(besoin.fee_plan, besoin.fee_amount, parametres)}</p>
            <p className="mt-1 text-[0.82rem] text-encre-douce">Payés par l’employeur. La commission est créée à l’enregistrement du placement ; aucun frais n’est demandé au candidat.</p>
          </Carte>

          {gerer ? (
            <Carte titre="Statut du besoin">
              <Formulaire action={changerStatutBesoinAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={besoin.id} />
                <Champ libelle="Statut" className="min-w-40 flex-1">
                  <Selection name="statut" defaultValue={besoin.status} options={STATUTS_BESOIN.options} />
                </Champ>
                <BoutonEnvoi variante="secondaire">Changer</BoutonEnvoi>
              </Formulaire>
              <p className="mt-3 text-[0.78rem] text-encre-douce">Le besoin passe seul à « Pourvu » quand tous les postes ont un placement, et se rouvre si un placement est rompu.</p>
            </Carte>
          ) : null}
        </aside>
      </div>
    </>
  );
}
