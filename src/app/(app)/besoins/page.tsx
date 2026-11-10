import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { StatutBesoin } from '@/composants/employeurs';
import { dateCourte, pluriel, salaire } from '@/composants/format';
import { OPTIONS_VILLES, SelectionMetier } from '@/composants/options';
import { un, type ParametresAdresse } from '@/composants/requete';
import { Badge, BadgeFictif, Carte, Champ, EnTetePage, LienBouton, Selection, Tableau, TexteLibre, Vide, classesBouton } from '@/composants/ui';
import { nomVille, villeParCode } from '@/domaine/geographie';
import { STATUTS_BESOIN } from '@/domaine/referentiels';
import { libelleMetier, metierParCode } from '@/domaine/taxonomie';
import { listerBesoins } from '@/serveur/employeurs';
import { exigerPermission } from '@/serveur/session-next';

export const metadata: Metadata = { title: 'Besoins et appariements' };

export default async function PageBesoins({ searchParams }: { searchParams: Promise<ParametresAdresse> }) {
  const session = await exigerPermission('employeurs.lire');
  const p = await searchParams;
  const statut = un(p.statut);
  const filtres = {
    statut: statut === 'tous' || STATUTS_BESOIN.est(statut) ? statut : 'ouverts',
    metier: metierParCode(un(p.metier)) ? un(p.metier) : undefined,
    ville: villeParCode(un(p.ville)) ? un(p.ville) : undefined,
  };
  const { besoins } = await listerBesoins(filtres);
  const filtre = Boolean(filtres.statut !== 'ouverts' || filtres.metier || filtres.ville);

  return (
    <>
      <EnTetePage
        surtitre="Placement"
        titre="Besoins et appariements"
        actions={
          session.peut('employeurs.gerer') ? (
            <LienBouton href="/besoins/nouveau" variante="primaire" icone="plus">
              Nouveau besoin
            </LienBouton>
          ) : null
        }
      >
        <p>Les postes que des employeurs ont confiés à Yallah Services. Ouvrez un besoin pour chercher des candidats et suivre les propositions.</p>
      </EnTetePage>

      <Carte className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.3fr_1fr_auto] lg:items-end">
          <Champ libelle="Statut">
            <Selection name="statut" defaultValue={filtres.statut} options={[{ valeur: 'ouverts', libelle: 'Ouverts et en cours' }, ...STATUTS_BESOIN.options, { valeur: 'tous', libelle: 'Tous' }]} />
          </Champ>
          <Champ libelle="Métier">
            <SelectionMetier name="metier" defaultValue={filtres.metier ?? ''} vide="Tous" />
          </Champ>
          <Champ libelle="Ville">
            <Selection name="ville" defaultValue={filtres.ville ?? ''} vide="Toutes" options={OPTIONS_VILLES} />
          </Champ>
          <div className="flex gap-2">
            <button type="submit" className={classesBouton('primaire')}>
              Filtrer
            </button>
            {filtre ? (
              <Link href="/besoins" className={classesBouton('secondaire')}>
                Effacer
              </Link>
            ) : null}
          </div>
        </form>
      </Carte>

      {besoins.length === 0 ? (
        <Vide titre={filtre ? 'Aucun besoin ne correspond' : 'Aucun besoin ouvert'}>
          <p>Un besoin se crée depuis la fiche d’un employeur (« Nouveau besoin »).</p>
        </Vide>
      ) : (
        <Carte sansMarge titre={pluriel(besoins.length, 'besoin')}>
          <Tableau entetes={['Besoin', 'Employeur', 'Lieu', 'Conditions', 'Pourvus', 'Candidats en cours', 'Statut']}>
            {besoins.map((besoin) => (
              <tr key={besoin.id} className="relative">
                <td>
                  <Link href={`/besoins/${besoin.id}`} className="font-semibold text-marine-900 after:absolute after:inset-0 hover:underline">
                    <TexteLibre>{besoin.title}</TexteLibre>
                  </Link>
                  <span className="block text-[0.78rem] text-encre-douce">
                    {besoin.reference} · {libelleMetier(besoin.metier)} {besoin.is_demo ? <BadgeFictif /> : null}
                  </span>
                </td>
                <td>
                  <TexteLibre>{besoin.employeur}</TexteLibre>
                </td>
                <td>{besoin.city_code ? nomVille(besoin.city_code) : '—'}</td>
                <td>
                  {salaire(besoin.salary_min, besoin.salary_max, besoin.salary_period) ?? 'Salaire non précisé'}
                  {besoin.start_date ? <span className="block text-[0.78rem] text-encre-douce">début le {dateCourte(besoin.start_date)}</span> : null}
                </td>
                <td className="whitespace-nowrap tabular-nums">
                  {besoin.places} / {besoin.headcount}
                </td>
                <td className="tabular-nums">{besoin.correspondances || '—'}</td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {besoin.is_urgent ? <Badge ton="rouge">Urgent</Badge> : null}
                    <StatutBesoin statut={besoin.status} />
                  </span>
                </td>
              </tr>
            ))}
          </Tableau>
        </Carte>
      )}
    </>
  );
}
