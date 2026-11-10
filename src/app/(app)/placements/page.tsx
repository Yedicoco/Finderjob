import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { dateCourte, dirhams, pluriel } from '@/composants/format';
import { un, type ParametresAdresse } from '@/composants/requete';
import { Badge, BadgeFictif, Carte, Champ, EnTetePage, Selection, Tableau, TexteLibre, Vide, classesBouton, type Ton } from '@/composants/ui';
import { nomVille } from '@/domaine/geographie';
import { PERIODES_SALAIRE, STATUTS_PLACEMENT } from '@/domaine/referentiels';
import { libelleMetier } from '@/domaine/taxonomie';
import { listerPlacements } from '@/serveur/placements';
import { exigerPermission } from '@/serveur/session-next';

export const metadata: Metadata = { title: 'Placements' };

const TON: Record<string, Ton> = { en_cours: 'or', confirme: 'vert', termine: 'neutre', rompu: 'rouge', annule: 'neutre' };

export default async function PagePlacements({ searchParams }: { searchParams: Promise<ParametresAdresse> }) {
  await exigerPermission('placements.lire');
  const p = await searchParams;
  const statut = STATUTS_PLACEMENT.est(un(p.statut)) ? un(p.statut) : undefined;
  const placements = await listerPlacements({ statut });

  return (
    <>
      <EnTetePage surtitre="Placement" titre="Placements">
        <p>Chaque candidat effectivement placé chez un employeur, avec sa période de remplacement et les frais associés.</p>
      </EnTetePage>

      <Carte className="mb-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Champ libelle="Statut" className="min-w-52">
            <Selection name="statut" defaultValue={statut ?? ''} vide="Tous" options={STATUTS_PLACEMENT.options} />
          </Champ>
          <button type="submit" className={classesBouton('primaire')}>
            Filtrer
          </button>
        </form>
      </Carte>

      {placements.length === 0 ? (
        <Vide titre={statut ? 'Aucun placement avec ce statut' : 'Aucun placement enregistré'}>
          <p>Un placement s’enregistre depuis un rapprochement accepté par le candidat et l’employeur : ouvrez le besoin ou l’offre, faites avancer le candidat jusqu’à « Accord des deux parties », puis cliquez sur « Enregistrer le placement ».</p>
        </Vide>
      ) : (
        <Carte sansMarge titre={pluriel(placements.length, 'placement')}>
          <Tableau entetes={['Placement', 'Candidat', 'Employeur', 'Poste', 'Début', 'Remplacement jusqu’au', 'Frais', 'Statut']}>
            {placements.map((placement) => (
              <tr key={placement.id} className="relative">
                <td>
                  <Link href={`/placements/${placement.id}`} className="font-semibold text-marine-900 after:absolute after:inset-0 hover:underline">
                    {placement.reference}
                  </Link>
                  {placement.fictif ? (
                    <span className="block">
                      <BadgeFictif />
                    </span>
                  ) : null}
                </td>
                <td>
                  {placement.candidat_nom ?? <span className="text-encre-douce italic">anonymisé</span>}
                  <span className="block text-[0.78rem] text-encre-douce">{placement.candidat_reference}</span>
                </td>
                <td>
                  <TexteLibre>{placement.employeur}</TexteLibre>
                </td>
                <td>
                  {libelleMetier(placement.metier)}
                  <span className="block text-[0.78rem] text-encre-douce">
                    {placement.city_code ? nomVille(placement.city_code) : ''}
                    {placement.agreed_salary !== null ? ` · ${dirhams(placement.agreed_salary)} ${PERIODES_SALAIRE.libelle(placement.salary_period)}` : ''}
                  </span>
                </td>
                <td className="whitespace-nowrap">{dateCourte(placement.start_date)}</td>
                <td className="whitespace-nowrap">{placement.replacement_until ? dateCourte(placement.replacement_until) : '—'}</td>
                <td className="whitespace-nowrap">
                  {placement.commissions_encaissees > 0 ? <span className="block font-semibold text-vert-700">{dirhams(placement.commissions_encaissees)} encaissés</span> : null}
                  {placement.commissions_dues > 0 ? <span className="block font-semibold text-or-700">{dirhams(placement.commissions_dues)} à encaisser</span> : null}
                  {placement.commissions_dues === 0 && placement.commissions_encaissees === 0 ? <span className="text-encre-douce">—</span> : null}
                </td>
                <td>
                  <Badge ton={TON[placement.status] ?? 'neutre'}>{STATUTS_PLACEMENT.libelle(placement.status)}</Badge>
                </td>
              </tr>
            ))}
          </Tableau>
        </Carte>
      )}
    </>
  );
}
