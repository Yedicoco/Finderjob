import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { libelleFormule } from '@/composants/employeurs';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { dateIso } from '@/composants/format';
import { un, type ParametresAdresse } from '@/composants/requete';
import { Carte, Champ, Definition, Definitions, EnTetePage, Encart, LienBouton, Selection, TexteLibre, Vide, classesBouton } from '@/composants/ui';
import { nomVille } from '@/domaine/geographie';
import { CONTRATS, PERIODES_SALAIRE } from '@/domaine/referentiels';
import { libelleMetier } from '@/domaine/taxonomie';
import { listerCorrespondances } from '@/serveur/appariements';
import { besoinParId, employeurParId } from '@/serveur/employeurs';
import { chargerParametres } from '@/serveur/parametres';
import { exigerPermission } from '@/serveur/session-next';
import { creerPlacementAction } from '../actions';

export const metadata: Metadata = { title: 'Enregistrer un placement' };

export default async function PageNouveauPlacement({ searchParams }: { searchParams: Promise<ParametresAdresse> }) {
  const session = await exigerPermission('placements.gerer');
  const p = await searchParams;
  const [rapprochement] = un(p.rapprochement) ? await listerCorrespondances({ id: un(p.rapprochement) }) : [];

  if (!rapprochement) {
    return (
      <>
        <EnTetePage surtitre="Placements" titre="Enregistrer un placement" />
        <Vide
          titre="Partez d’un rapprochement accepté"
          action={
            <LienBouton href="/besoins" variante="primaire" icone="besoins">
              Voir les besoins
            </LienBouton>
          }
        >
          <p>Un placement s’enregistre depuis la liste des candidats d’un besoin ou d’une offre, une fois l’accord du candidat et de l’employeur obtenu (« Accord des deux parties »).</p>
        </Vide>
      </>
    );
  }

  const [besoin, employeur, parametres] = await Promise.all([
    rapprochement.employer_need_id ? besoinParId(rapprochement.employer_need_id) : Promise.resolve(null),
    rapprochement.employer_id ? employeurParId(rapprochement.employer_id, session.acteur) : Promise.resolve(null),
    chargerParametres(),
  ]);
  const retour = besoin ? `/besoins/${besoin.id}` : `/offres/${rapprochement.job_offer_id}`;
  const formule = besoin?.fee_plan && besoin.fee_amount !== null && besoin.fee_amount > 0 ? libelleFormule(besoin.fee_plan, besoin.fee_amount, parametres) : null;

  return (
    <>
      <EnTetePage surtitre="Placements" titre="Enregistrer un placement">
        <p>À enregistrer quand le candidat et l’employeur se sont mis d’accord. Le candidat passe à « Placé » et n’est plus proposé ailleurs.</p>
      </EnTetePage>

      {rapprochement.status !== 'accepte' ? (
        <Encart ton="attention" className="mb-4" titre="Accord non encore noté">
          Ce rapprochement n’est pas au stade « Accord des deux parties ». En enregistrant le placement, vous confirmez que le candidat et l’employeur ont tous deux accepté.
        </Encart>
      ) : null}

      {!employeur ? (
        <Encart ton="danger" className="mb-4" titre="Fiche employeur manquante">
          L’offre n’est rattachée à aucune fiche employeur. Ouvrez l’offre et cliquez sur « Créer la fiche employeur », puis revenez enregistrer le placement.{' '}
          <Link href={retour} className="font-semibold underline">
            Retour à l’offre
          </Link>
        </Encart>
      ) : (
        <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <Carte titre="Récapitulatif">
            <Definitions colonnes="grid-cols-1">
              <Definition terme="Candidat">
                <Link href={`/candidats/${rapprochement.candidate_id}`} className="font-semibold">
                  {rapprochement.candidat_nom ?? rapprochement.candidat_reference}
                </Link>{' '}
                <span className="text-encre-douce">
                  · {rapprochement.candidat_reference} · {libelleMetier(rapprochement.candidat_metier)}
                </span>
              </Definition>
              <Definition terme="Employeur">
                <Link href={`/employeurs/${employeur.id}`} className="font-semibold">
                  <TexteLibre>{employeur.name}</TexteLibre>
                </Link>{' '}
                <span className="text-encre-douce">· {employeur.reference}</span>
              </Definition>
              <Definition terme="Poste">
                <TexteLibre>{besoin?.title ?? rapprochement.offre_titre}</TexteLibre>
                <span className="text-encre-douce">
                  {' '}
                  · {besoin ? besoin.reference : rapprochement.offre_reference}
                  {(besoin?.city_code ?? rapprochement.offre_ville) ? ` · ${nomVille((besoin?.city_code ?? rapprochement.offre_ville)!)}` : ''}
                </span>
              </Definition>
              <Definition terme="Score d’adéquation">{rapprochement.score} / 100</Definition>
            </Definitions>
          </Carte>

          <Carte titre="Conditions convenues">
            <Formulaire action={creerPlacementAction} className="space-y-4">
              <input type="hidden" name="rapprochement" value={rapprochement.id} />
              <input type="hidden" name="candidat" value={rapprochement.candidate_id} />
              <input type="hidden" name="employeur" value={employeur.id} />
              {besoin ? <input type="hidden" name="besoin" value={besoin.id} /> : null}
              {rapprochement.job_offer_id ? <input type="hidden" name="offre" value={rapprochement.job_offer_id} /> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Champ libelle="Date de début" obligatoire>
                  <input className="champ" type="date" name="debut" required defaultValue={besoin?.start_date ? dateIso(besoin.start_date) : dateIso(new Date())} />
                </Champ>
                <Champ libelle="Contrat">
                  <Selection name="contrat" defaultValue={besoin?.contract_type ?? 'non_precise'} options={CONTRATS.options} />
                </Champ>
                <Champ libelle="Salaire convenu (DH)">
                  <input className="champ" name="salaire" inputMode="decimal" defaultValue={besoin?.salary_min ?? ''} />
                </Champ>
                <Champ libelle="Période">
                  <Selection name="periodeSalaire" defaultValue={besoin?.salary_period ?? 'mois'} options={PERIODES_SALAIRE.options} />
                </Champ>
              </div>
              <Champ libelle="Notes">
                <textarea className="champ" name="notes" rows={2} maxLength={2000} dir="auto" />
              </Champ>
              {formule ? (
                <label className="flex items-start gap-2.5 rounded-lg border border-or-300 bg-or-50 px-3 py-2.5 text-[0.9rem] font-medium text-marine-900">
                  <input type="checkbox" name="avecCommission" defaultChecked className="mt-0.5 size-4 accent-marine-900" />
                  <span>
                    Créer la commission due par l’employeur : {formule}
                    <span className="block text-[0.8rem] font-normal text-encre-douce">Elle apparaîtra dans « Commissions » avec le statut « Dû ».</span>
                  </span>
                </label>
              ) : (
                <p className="text-[0.84rem] text-encre-douce">Aucune formule n’est définie pour ce poste : vous pourrez ajouter une commission depuis la fiche du placement.</p>
              )}
              <p className="text-[0.82rem] text-encre-douce">Rappel : Yallah Services met en relation. Le contrat de travail est conclu entre l’employeur et le salarié, qui en restent seuls responsables.</p>
              <div className="flex flex-wrap gap-3">
                <BoutonEnvoi icone="coche">Enregistrer le placement</BoutonEnvoi>
                <Link href={retour} className={classesBouton('secondaire')}>
                  Annuler
                </Link>
              </div>
            </Formulaire>
          </Carte>
        </div>
      )}
    </>
  );
}
