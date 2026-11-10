import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { StatutCandidat } from '@/composants/candidats';
import { dateCourte, ilYA, pluriel } from '@/composants/format';
import { OPTIONS_VILLES, SelectionMetier } from '@/composants/options';
import { adresseAvec, pageDemandee, un, type ParametresAdresse } from '@/composants/requete';
import { BadgeFictif, Carte, Champ, EnTetePage, LienBouton, Pagination, Selection, Tableau, Vide, classesBouton } from '@/composants/ui';
import { nomVille, villeParCode } from '@/domaine/geographie';
import { STATUTS_CANDIDAT } from '@/domaine/referentiels';
import { libelleMetier, metierParCode } from '@/domaine/taxonomie';
import { listerCandidats } from '@/serveur/candidats';
import { exigerPermission } from '@/serveur/session-next';

export const metadata: Metadata = { title: 'Candidats' };

export default async function PageCandidats({ searchParams }: { searchParams: Promise<ParametresAdresse> }) {
  const session = await exigerPermission('candidats.lire');
  const p = await searchParams;
  const filtres = {
    q: un(p.q) || undefined,
    statut: STATUTS_CANDIDAT.est(un(p.statut)) ? un(p.statut) : undefined,
    metier: metierParCode(un(p.metier)) ? un(p.metier) : undefined,
    ville: villeParCode(un(p.ville)) ? un(p.ville) : undefined,
    page: pageDemandee(p),
  };
  const { candidats, total } = await listerCandidats(filtres);
  const filtre = Boolean(filtres.q || filtres.statut || filtres.metier || filtres.ville);
  const maintenant = new Date();

  return (
    <>
      <EnTetePage
        surtitre="Placement"
        titre="Candidats"
        actions={
          session.peut('candidats.gerer') ? (
            <LienBouton href="/candidats/nouveau" variante="primaire" icone="plus">
              Nouveau candidat
            </LienBouton>
          ) : null
        }
      >
        <p>Le vivier de Yallah Services : uniquement des personnes qui ont donné leur accord. Chaque fiche ouverte est journalisée.</p>
      </EnTetePage>

      <Carte className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] lg:items-end">
          <Champ libelle="Rechercher (nom exact, téléphone ou référence)">
            <input className="champ" type="search" name="q" defaultValue={filtres.q ?? ''} dir="auto" placeholder="Ex. : YS-CA-2026-0001" />
          </Champ>
          <Champ libelle="Statut">
            <Selection name="statut" defaultValue={filtres.statut ?? ''} vide="Tous" options={STATUTS_CANDIDAT.options} />
          </Champ>
          <Champ libelle="Métier">
            <SelectionMetier name="metier" defaultValue={filtres.metier ?? ''} vide="Tous" />
          </Champ>
          <Champ libelle="Ville">
            <Selection name="ville" defaultValue={filtres.ville ?? ''} vide="Toutes" options={OPTIONS_VILLES} />
          </Champ>
          <div className="flex gap-2 lg:pb-[1.35rem]">
            <button type="submit" className={classesBouton('primaire')}>
              Filtrer
            </button>
            {filtre ? (
              <Link href="/candidats" className={classesBouton('secondaire')}>
                Effacer
              </Link>
            ) : null}
          </div>
        </form>
      </Carte>

      {candidats.length === 0 ? (
        <Vide
          titre={filtre ? 'Aucun candidat ne correspond' : 'Aucun candidat enregistré'}
          action={
            !filtre && session.peut('candidats.gerer') ? (
              <LienBouton href="/candidats/nouveau" variante="primaire" icone="plus">
                Enregistrer un premier candidat
              </LienBouton>
            ) : null
          }
        >
          <p>{filtre ? 'La recherche par nom porte sur des mots entiers (les noms sont chiffrés) : essayez le prénom ou le nom complet, ou le numéro de téléphone.' : 'Une fiche ne peut être créée qu’avec l’accord de la personne.'}</p>
        </Vide>
      ) : (
        <Carte sansMarge titre={pluriel(total, 'candidat')}>
          <Tableau entetes={['Candidat', 'Métier', 'Ville', 'Expérience', 'Disponibilité', 'Statut', 'Dernière activité']}>
            {candidats.map((candidat) => (
              <tr key={candidat.id} className="relative">
                <td>
                  <Link href={`/candidats/${candidat.id}`} className="font-semibold text-marine-900 after:absolute after:inset-0 hover:underline">
                    {candidat.anonymise ? <span className="font-normal text-encre-douce italic">Fiche anonymisée</span> : (candidat.nom ?? '—')}
                  </Link>
                  <span className="block text-[0.78rem] text-encre-douce">
                    {candidat.reference} {candidat.is_demo ? <BadgeFictif /> : null}
                  </span>
                </td>
                <td>
                  {libelleMetier(candidat.metier)}
                  {candidat.metiers.length > 1 ? <span className="block text-[0.78rem] text-encre-douce">+ {pluriel(candidat.metiers.length - 1, 'autre')}</span> : null}
                </td>
                <td>{candidat.city_code ? nomVille(candidat.city_code) : '—'}</td>
                <td className="whitespace-nowrap">{candidat.experience_years !== null ? pluriel(candidat.experience_years, 'an') : '—'}</td>
                <td className="whitespace-nowrap">{candidat.available_from && new Date(candidat.available_from) > maintenant ? `le ${dateCourte(candidat.available_from)}` : 'Immédiate'}</td>
                <td>
                  <StatutCandidat statut={candidat.status} />
                </td>
                <td className="whitespace-nowrap text-encre-douce">{ilYA(candidat.last_activity_at, maintenant)}</td>
              </tr>
            ))}
          </Tableau>
        </Carte>
      )}
      <Pagination page={filtres.page} total={total} parPage={30} lien={(page) => adresseAvec('/candidats', p, { page: String(page) })} />
    </>
  );
}
