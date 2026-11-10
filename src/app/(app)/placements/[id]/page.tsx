import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { notFound } from 'next/navigation';
import { FormulaireCommission, LigneCommission } from '@/composants/commissions';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { dateCourte, dateIso, dirhams } from '@/composants/format';
import { Badge, BadgeFictif, Carte, Champ, Definition, Definitions, EnTetePage, Selection, TexteLibre, type Ton } from '@/composants/ui';
import { nomVille } from '@/domaine/geographie';
import { CONTRATS, PERIODES_SALAIRE, STATUTS_PLACEMENT } from '@/domaine/referentiels';
import { libelleMetier } from '@/domaine/taxonomie';
import { chargerParametres } from '@/serveur/parametres';
import { placementParId, suitesPlacement } from '@/serveur/placements';
import { exigerPermission } from '@/serveur/session-next';
import { changerStatutPlacementAction } from '../actions';

export const metadata: Metadata = { title: 'Placement' };

const TON: Record<string, Ton> = { en_cours: 'or', confirme: 'vert', termine: 'neutre', rompu: 'rouge', annule: 'neutre' };
const LIBELLES_SUITE: Record<string, string> = {
  confirme: 'Confirmé — la période d’essai s’est bien passée',
  termine: 'Terminé — fin normale de la mission',
  rompu: 'Rompu — le contrat s’est arrêté (motif obligatoire)',
  annule: 'Annulé — le placement n’a pas eu lieu (motif obligatoire)',
};

export default async function PagePlacement({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerPermission('placements.lire');
  const { id } = await params;
  const [placement, parametres] = await Promise.all([placementParId(id), chargerParametres()]);
  if (!placement) notFound();
  const gerer = session.peut('placements.gerer');
  const suites = suitesPlacement(placement.status);
  const aujourdHui = dateIso(new Date()); // jour de Casablanca, pas le jour UTC
  const remplacementActif = placement.replacement_until !== null && placement.replacement_until >= aujourdHui && (placement.status === 'en_cours' || placement.status === 'confirme' || placement.status === 'rompu');

  return (
    <>
      <p className="hors-impression mb-3 text-[0.86rem]">
        <Link href="/placements" className="font-semibold text-marine-700 underline underline-offset-3">
          ‹ Tous les placements
        </Link>
      </p>
      <EnTetePage surtitre={placement.reference} titre={<>{placement.candidat_nom ?? placement.candidat_reference} chez <TexteLibre>{placement.employeur}</TexteLibre></>}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge ton={TON[placement.status] ?? 'neutre'}>{STATUTS_PLACEMENT.libelle(placement.status)}</Badge>
          <Badge>{libelleMetier(placement.metier)}</Badge>
          {remplacementActif ? <Badge ton="marine">Remplacement garanti jusqu’au {dateCourte(placement.replacement_until)}</Badge> : null}
          {placement.fictif ? <BadgeFictif /> : null}
        </div>
      </EnTetePage>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Carte titre={`Commissions (${placement.commissions.length})`} sansMarge>
            {placement.commissions.length > 0 ? (
              <ul className="divide-y divide-sable-200">
                {placement.commissions.map((commission) => (
                  <LigneCommission key={commission.id} commission={commission} peutAgir={gerer} />
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Aucune commission enregistrée pour ce placement.</p>
            )}
            {gerer && placement.status !== 'annule' ? (
              <details className="hors-impression border-t border-sable-200 px-4 py-4 sm:px-5">
                <summary className="cursor-pointer text-[0.9rem] font-semibold text-marine-800">Ajouter une commission</summary>
                <div className="mt-3">
                  <FormulaireCommission placementId={placement.id} travailleurActive={parametres.commissions.travailleurActive} salaireDeBase={placement.agreed_salary} />
                </div>
              </details>
            ) : null}
          </Carte>

          {placement.notes ? (
            <Carte titre="Notes et historique">
              <p className="text-[0.9rem] whitespace-pre-line" dir="auto">
                {placement.notes}
              </p>
            </Carte>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          <Carte titre="Le placement">
            <Definitions colonnes="grid-cols-2">
              <Definition terme="Candidat">
                <Link href={`/candidats/${placement.candidate_id}`} className="font-semibold">
                  {placement.candidat_nom ?? 'Fiche anonymisée'}
                </Link>
                <span className="block text-[0.8rem] text-encre-douce">{placement.candidat_reference}</span>
              </Definition>
              <Definition terme="Employeur">
                <Link href={`/employeurs/${placement.employer_id}`} className="font-semibold">
                  <TexteLibre>{placement.employeur}</TexteLibre>
                </Link>
              </Definition>
              <Definition terme="Poste">{libelleMetier(placement.metier)}</Definition>
              <Definition terme="Lieu">{placement.city_code ? nomVille(placement.city_code) : '—'}</Definition>
              <Definition terme="Début">{dateCourte(placement.start_date)}</Definition>
              <Definition terme="Contrat">{CONTRATS.libelle(placement.contract_type)}</Definition>
              <Definition terme="Salaire convenu">{placement.agreed_salary !== null ? `${dirhams(placement.agreed_salary)} ${PERIODES_SALAIRE.libelle(placement.salary_period)}` : '—'}</Definition>
              <Definition terme="Remplacement jusqu’au">{placement.replacement_until ? dateCourte(placement.replacement_until) : 'Non prévu'}</Definition>
              <Definition terme="Enregistré le">{dateCourte(placement.created_at)}</Definition>
              <Definition terme="Origine">
                {placement.employer_need_id ? (
                  <Link href={`/besoins/${placement.employer_need_id}`} className="font-semibold">
                    Besoin de l’employeur
                  </Link>
                ) : placement.job_offer_id ? (
                  <Link href={`/offres/${placement.job_offer_id}`} className="font-semibold">
                    Offre
                  </Link>
                ) : (
                  '—'
                )}
              </Definition>
            </Definitions>
            <p className="mt-3 text-[0.78rem] text-encre-douce">Yallah Services met en relation : le contrat de travail lie l’employeur et le salarié.</p>
          </Carte>

          {gerer && suites.length > 0 ? (
            <Carte titre="Faire évoluer le placement">
              <Formulaire action={changerStatutPlacementAction} className="space-y-3">
                <input type="hidden" name="id" value={placement.id} />
                <Champ libelle="Nouveau statut">
                  <Selection name="statut" options={suites.map((suite) => ({ valeur: suite, libelle: LIBELLES_SUITE[suite] ?? STATUTS_PLACEMENT.libelle(suite) }))} />
                </Champ>
                <Champ libelle="Motif ou remarque" aide="Obligatoire pour une rupture ou une annulation.">
                  <input className="champ" name="note" maxLength={500} />
                </Champ>
                <BoutonEnvoi variante="secondaire">Enregistrer</BoutonEnvoi>
              </Formulaire>
              <p className="mt-3 text-[0.78rem] text-encre-douce">Une rupture ou une annulation rend le candidat de nouveau disponible et rouvre le besoin de l’employeur. Les commissions ne sont pas annulées automatiquement.</p>
            </Carte>
          ) : null}
        </aside>
      </div>
    </>
  );
}
