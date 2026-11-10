import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { dateHeure } from '@/composants/format';
import { adresseAvec, pageDemandee, un, type ParametresAdresse } from '@/composants/requete';
import { Carte, Champ, EnTetePage, Selection, Tableau, Vide, classesBouton } from '@/composants/ui';
import { ROLES } from '@/domaine/referentiels';
import { lireJournal } from '@/serveur/audit';
import { exigerPermission } from '@/serveur/session-next';

export const metadata: Metadata = { title: 'Journal d’audit' };

const ENTITES: Record<string, string> = {
  offre: 'Offre', candidat: 'Candidat', employeur: 'Employeur', besoin: 'Besoin', correspondance: 'Rapprochement', placement: 'Placement', commission: 'Commission',
  source: 'Source', alerte: 'Alerte', parametre: 'Paramètre', utilisateur: 'Utilisateur', systeme: 'Système',
};
const LIENS: Record<string, (id: string) => string> = {
  offre: (id) => `/offres/${id}`, candidat: (id) => `/candidats/${id}`, employeur: (id) => `/employeurs/${id}`, besoin: (id) => `/besoins/${id}`, placement: (id) => `/placements/${id}`,
};
const PAR_PAGE = 100;

export default async function PageJournal({ searchParams }: { searchParams: Promise<ParametresAdresse> }) {
  await exigerPermission('journal.lire');
  const p = await searchParams;
  const entite = Object.hasOwn(ENTITES, un(p.entite)) ? un(p.entite) : undefined;
  const action = /^[a-z_.]{3,60}$/.test(un(p.action)) ? un(p.action) : undefined;
  const id = /^[\w.-]{1,80}$/.test(un(p.id)) ? un(p.id) : undefined;
  const page = pageDemandee(p);
  // Une ligne de plus que la page : indique s'il existe une suite, sans compter toute la table.
  const lignes = await lireJournal({ entite, action, id, limite: PAR_PAGE + 1, decalage: (page - 1) * PAR_PAGE });
  const suite = lignes.length > PAR_PAGE;
  const visibles = lignes.slice(0, PAR_PAGE);
  const filtre = Boolean(entite || action || id);

  return (
    <>
      <EnTetePage surtitre="Administration" titre="Journal d’audit">
        <p>Qui a fait quoi, et quand. Le journal ne peut être ni modifié ni effacé depuis l’outil (la base de données le refuse). Il ne contient aucune donnée personnelle en clair : seulement des références.</p>
      </EnTetePage>

      <Carte className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
          <Champ libelle="Objet">
            <Selection name="entite" defaultValue={entite ?? ''} vide="Tous" options={Object.entries(ENTITES).map(([valeur, libelle]) => ({ valeur, libelle }))} />
          </Champ>
          <Champ libelle="Action">
            <input className="champ" name="action" defaultValue={action ?? ''} maxLength={60} placeholder="Ex. : candidat.consultation" />
          </Champ>
          <Champ libelle="Identifiant de l’objet">
            <input className="champ" name="id" defaultValue={id ?? ''} maxLength={80} />
          </Champ>
          <div className="flex gap-2">
            <button type="submit" className={classesBouton('primaire')}>
              Filtrer
            </button>
            {filtre ? (
              <Link href="/administration/journal" className={classesBouton('secondaire')}>
                Effacer
              </Link>
            ) : null}
          </div>
        </form>
      </Carte>

      {visibles.length === 0 ? (
        <Vide titre="Aucune ligne">
          <p>{filtre ? 'Aucune action ne correspond à ces filtres.' : 'Le journal est vide.'}</p>
        </Vide>
      ) : (
        <Carte sansMarge titre={`Page ${page}`}>
          <Tableau entetes={['Date', 'Qui', 'Action', 'Objet', 'Résumé']}>
            {visibles.map((ligne) => {
              const lien = ligne.entity_id && LIENS[ligne.entity_type] && /^[0-9a-f-]{36}$/i.test(ligne.entity_id) ? LIENS[ligne.entity_type]!(ligne.entity_id) : null;
              const details = Object.keys(ligne.changes ?? {}).length > 0;
              return (
                <tr key={ligne.id}>
                  <td className="whitespace-nowrap tabular-nums">{dateHeure(ligne.occurred_at)}</td>
                  <td>
                    {ligne.actor_label === 'systeme' ? 'Système' : ligne.actor_label}
                    {ligne.actor_role ? <span className="block text-[0.76rem] text-encre-douce">{ROLES.libelle(ligne.actor_role)}</span> : null}
                  </td>
                  <td>
                    <Link href={adresseAvec('/administration/journal', p, { action: ligne.action })} className="font-mono text-[0.8rem] text-marine-800 underline decoration-sable-300 underline-offset-2">
                      {ligne.action}
                    </Link>
                  </td>
                  <td>
                    {ENTITES[ligne.entity_type] ?? ligne.entity_type}
                    {lien ? (
                      <Link href={lien} className="block text-[0.76rem] font-semibold text-marine-800 underline">
                        Ouvrir
                      </Link>
                    ) : ligne.entity_id ? (
                      <span className="block max-w-40 truncate font-mono text-[0.72rem] text-encre-douce" title={ligne.entity_id}>
                        {ligne.entity_id}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span dir="auto">{ligne.summary}</span>
                    {details ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[0.76rem] font-semibold text-marine-700">Détail</summary>
                        <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-sable-100 p-2 text-[0.72rem] whitespace-pre-wrap">{JSON.stringify(ligne.changes, null, 1)}</pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </Tableau>
        </Carte>
      )}

      {page > 1 || suite ? (
        <nav aria-label="Pagination" className="hors-impression mt-5 flex items-center justify-between gap-3 text-[0.88rem]">
          {page > 1 ? (
            <Link href={adresseAvec('/administration/journal', p, page > 2 ? { page: String(page - 1) } : {})} className={classesBouton('secondaire')}>
              ‹ Plus récent
            </Link>
          ) : (
            <span />
          )}
          {suite ? (
            <Link href={adresseAvec('/administration/journal', p, { page: String(page + 1) })} className={classesBouton('secondaire')}>
              Plus ancien ›
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
