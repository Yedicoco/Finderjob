import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { StatutEmployeur } from '@/composants/employeurs';
import { echeance, ilYA, pluriel } from '@/composants/format';
import { OPTIONS_VILLES } from '@/composants/options';
import { adresseAvec, pageDemandee, un, type ParametresAdresse } from '@/composants/requete';
import { Badge, BadgeFictif, Carte, Champ, EnTetePage, LienBouton, Pagination, Selection, Tableau, TexteLibre, Vide, classesBouton, cx } from '@/composants/ui';
import { nomVille, villeParCode } from '@/domaine/geographie';
import { STATUTS_EMPLOYEUR, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { listerEmployeurs } from '@/serveur/employeurs';
import { exigerPermission } from '@/serveur/session-next';

export const metadata: Metadata = { title: 'Employeurs' };

export default async function PageEmployeurs({ searchParams }: { searchParams: Promise<ParametresAdresse> }) {
  const session = await exigerPermission('employeurs.lire');
  const p = await searchParams;
  const filtres = {
    q: un(p.q) || undefined,
    statut: STATUTS_EMPLOYEUR.est(un(p.statut)) ? un(p.statut) : undefined,
    type: TYPES_EMPLOYEUR.est(un(p.type)) ? un(p.type) : undefined,
    ville: villeParCode(un(p.ville)) ? un(p.ville) : undefined,
    relances: un(p.relances) === '1' || undefined,
    page: pageDemandee(p),
  };
  const { employeurs, total, parStatut } = await listerEmployeurs(filtres);
  const filtre = Boolean(filtres.q || filtres.statut || filtres.type || filtres.ville || filtres.relances);
  const maintenant = new Date();
  const tous = Object.values(parStatut).reduce((somme, n) => somme + n, 0);

  return (
    <>
      <EnTetePage
        surtitre="Placement"
        titre="Employeurs"
        actions={
          session.peut('employeurs.gerer') ? (
            <LienBouton href="/employeurs/nouveau" variante="primaire" icone="plus">
              Nouvel employeur
            </LienBouton>
          ) : null
        }
      >
        <p>Familles, riads, hôtels, spas et salons suivis par Yallah Services : du premier contact au placement.</p>
      </EnTetePage>

      <nav aria-label="Étapes du suivi" className="hors-impression mb-4 flex flex-wrap gap-1.5 text-[0.86rem]">
        <Link href={adresseAvec('/employeurs', p, { statut: null })} className={cx('rounded-full border px-3 py-1.5 font-semibold', !filtres.statut ? 'border-marine-900 bg-marine-900 text-white' : 'border-sable-300 bg-white text-marine-800 hover:border-marine-400')}>
          Tous <span className="tabular-nums opacity-75">{tous}</span>
        </Link>
        {STATUTS_EMPLOYEUR.options.map((option) => (
          <Link key={option.valeur} href={adresseAvec('/employeurs', p, { statut: option.valeur })} className={cx('rounded-full border px-3 py-1.5 font-semibold', filtres.statut === option.valeur ? 'border-marine-900 bg-marine-900 text-white' : 'border-sable-300 bg-white text-marine-800 hover:border-marine-400')}>
            {option.libelle} <span className="tabular-nums opacity-75">{parStatut[option.valeur] ?? 0}</span>
          </Link>
        ))}
        <Link
          href={adresseAvec('/employeurs', p, { relances: filtres.relances ? null : '1' })}
          aria-pressed={Boolean(filtres.relances)}
          className={cx('ml-auto rounded-full border px-3 py-1.5 font-semibold', filtres.relances ? 'border-or-600 bg-or-500 text-marine-950' : 'border-or-300 bg-or-50 text-marine-800 hover:border-or-500')}
        >
          {filtres.relances ? 'Relances à faire seulement (filtre actif)' : 'Relances à faire seulement'}
        </Link>
      </nav>

      <Carte className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_auto] lg:items-end">
          {filtres.statut ? <input type="hidden" name="statut" value={filtres.statut} /> : null}
          {filtres.relances ? <input type="hidden" name="relances" value="1" /> : null}
          <Champ libelle="Rechercher (nom, référence ou téléphone)">
            <input className="champ" type="search" name="q" defaultValue={filtres.q ?? ''} dir="auto" placeholder="Ex. : YS-EM-2026-0001" />
          </Champ>
          <Champ libelle="Type">
            <Selection name="type" defaultValue={filtres.type ?? ''} vide="Tous" options={TYPES_EMPLOYEUR.options} />
          </Champ>
          <Champ libelle="Ville">
            <Selection name="ville" defaultValue={filtres.ville ?? ''} vide="Toutes" options={OPTIONS_VILLES} />
          </Champ>
          <div className="flex gap-2 lg:pb-[1.35rem]">
            <button type="submit" className={classesBouton('primaire')}>
              Filtrer
            </button>
            {filtre ? (
              <Link href="/employeurs" className={classesBouton('secondaire')}>
                Effacer
              </Link>
            ) : null}
          </div>
        </form>
      </Carte>

      {employeurs.length === 0 ? (
        <Vide
          titre={filtres.relances ? 'Aucune relance à faire' : filtre ? 'Aucun employeur ne correspond' : 'Aucun employeur enregistré'}
          action={
            !filtre && session.peut('employeurs.gerer') ? (
              <LienBouton href="/employeurs/nouveau" variante="primaire" icone="plus">
                Enregistrer un premier employeur
              </LienBouton>
            ) : null
          }
        >
          <p>{filtres.relances ? 'Les relances apparaissent quand un échange est noté avec une date de « prochaine action ».' : 'Une fiche se crée à la main, ou depuis une offre (« Créer la fiche employeur »).'}</p>
        </Vide>
      ) : (
        <Carte sansMarge titre={pluriel(total, 'employeur')}>
          <Tableau entetes={['Employeur', 'Type', 'Ville', 'Étape', 'Besoins ouverts', 'Dernier échange', 'Relance']}>
            {employeurs.map((employeur) => {
              const relance = employeur.next_follow_up_at && !employeur.do_not_contact && employeur.status !== 'cloture' ? echeance(employeur.next_follow_up_at, maintenant) : null;
              return (
                <tr key={employeur.id} className="relative">
                  <td>
                    <Link href={`/employeurs/${employeur.id}`} className="font-semibold text-marine-900 after:absolute after:inset-0 hover:underline">
                      <TexteLibre>{employeur.name}</TexteLibre>
                    </Link>
                    <span className="block text-[0.78rem] text-encre-douce">
                      {employeur.reference} {employeur.is_demo ? <BadgeFictif /> : null} {employeur.do_not_contact ? <Badge ton="rouge">Ne pas contacter</Badge> : null}
                    </span>
                  </td>
                  <td>{TYPES_EMPLOYEUR.libelle(employeur.employer_type)}</td>
                  <td>{employeur.city_code ? nomVille(employeur.city_code) : '—'}</td>
                  <td>
                    <StatutEmployeur statut={employeur.status} />
                  </td>
                  <td className="tabular-nums">{employeur.besoins_ouverts || '—'}</td>
                  <td className="whitespace-nowrap text-encre-douce">{employeur.dernier_echange ? ilYA(employeur.dernier_echange, maintenant) : 'Aucun'}</td>
                  <td className="whitespace-nowrap">{relance ? <Badge ton={relance.retard ? 'rouge' : 'or'}>{relance.texte}</Badge> : <span className="text-encre-douce">—</span>}</td>
                </tr>
              );
            })}
          </Tableau>
        </Carte>
      )}
      <Pagination page={filtres.page} total={total} parPage={30} lien={(page) => adresseAvec('/employeurs', p, { page: String(page) })} />
    </>
  );
}
