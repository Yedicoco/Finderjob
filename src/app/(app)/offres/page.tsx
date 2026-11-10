import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { dateLongue, nombre, pluriel } from '@/composants/format';
import { Icone } from '@/composants/icones';
import { LigneOffre } from '@/composants/offres';
import { OPTIONS_SECTEURS, OPTIONS_VILLES, SelectionMetier } from '@/composants/options';
import { Carte, Champ, EnTetePage, Encart, LienBouton, Pagination, Selection, Vide, classesBouton, cx } from '@/composants/ui';
import { VILLES } from '@/domaine/geographie';
import { AVERTISSEMENT_ENGAGEMENT, CONTRATS, LOGEMENT, STATUTS_OFFRE, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { METIERS, SECTEURS } from '@/domaine/taxonomie';
import { STATUTS_FILTRE, TRIS, rechercherOffres, type FiltresOffres, type Tri } from '@/serveur/offres';
import { chargerParametres } from '@/serveur/parametres';
import { exigerPermission } from '@/serveur/session-next';

export const metadata: Metadata = { title: 'Offres' };

type Parametres = Record<string, string | string[] | undefined>;

const LIBELLES_TRI: Record<Tri, string> = { pertinence: 'Pertinence', date: 'Les plus récentes', salaire: 'Salaire', placement: 'Chances de placement', risque: 'Risque' };
const un = (valeur: string | string[] | undefined): string => (Array.isArray(valeur) ? (valeur[0] ?? '') : (valeur ?? '')).trim();

function lireFiltres(p: Parametres): FiltresOffres {
  const statut = un(p.statut);
  const tri = un(p.tri);
  const salaireMin = Number.parseInt(un(p.salaireMin), 10);
  const depuis = Number.parseInt(un(p.depuis), 10);
  const page = Number.parseInt(un(p.page), 10);
  return {
    q: un(p.q) || undefined,
    statut: (STATUTS_FILTRE as readonly string[]).includes(statut) ? (statut as FiltresOffres['statut']) : 'actif',
    secteur: SECTEURS.some((s) => s.code === un(p.secteur)) ? un(p.secteur) : undefined,
    metier: METIERS.some((m) => m.code === un(p.metier)) ? un(p.metier) : undefined,
    ville: VILLES.some((v) => v.code === un(p.ville)) ? un(p.ville) : undefined,
    contrat: CONTRATS.est(un(p.contrat)) ? un(p.contrat) : undefined,
    logement: LOGEMENT.est(un(p.logement)) ? un(p.logement) : undefined,
    employeur: TYPES_EMPLOYEUR.est(un(p.employeur)) ? un(p.employeur) : undefined,
    source: /^[a-z0-9-]{2,40}$/.test(un(p.source)) ? un(p.source) : undefined,
    salaireMin: Number.isFinite(salaireMin) && salaireMin > 0 ? salaireMin : undefined,
    depuisJours: [1, 3, 7, 14, 30].includes(depuis) ? depuis : undefined,
    urgent: un(p.urgent) === '1' || undefined,
    massif: un(p.massif) === '1' || undefined,
    aVerifier: un(p.aVerifier) === '1' || undefined,
    tri: (TRIS as readonly string[]).includes(tri) ? (tri as Tri) : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Adresse de la liste avec les filtres en cours, modifiés par `changements`. */
function adresse(p: Parametres, changements: Record<string, string | null>): string {
  const requete = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(p)) {
    const texte = un(valeur);
    if (texte && cle !== 'page') requete.set(cle, texte);
  }
  for (const [cle, valeur] of Object.entries(changements)) {
    if (valeur === null) requete.delete(cle);
    else requete.set(cle, valeur);
  }
  const chaine = requete.toString();
  return chaine ? `/offres?${chaine}` : '/offres';
}

export default async function PageOffres({ searchParams }: { searchParams: Promise<Parametres> }) {
  const session = await exigerPermission('offres.lire');
  const p = await searchParams;
  const filtres = lireFiltres(p);
  const [resultat, parametres] = await Promise.all([rechercherOffres(filtres, session.utilisateur.id), chargerParametres()]);
  const seuils = { modere: parametres.risque.seuilModere, eleve: parametres.risque.seuilEleve };
  const maintenant = new Date();
  const statutCourant = filtres.statut ?? 'actif';
  const filtresSecondaires = [filtres.secteur, filtres.metier, filtres.ville, filtres.contrat, filtres.logement, filtres.employeur, filtres.salaireMin, filtres.depuisJours, filtres.urgent, filtres.massif, filtres.aVerifier, filtres.source].filter(Boolean).length;
  const totalTousStatuts = Object.values(resultat.parStatut).reduce((somme, n) => somme + n, 0);
  const onglets = [...STATUTS_OFFRE.codes.map((code) => ({ code: code as string, libelle: `${STATUTS_OFFRE.libelle(code)}s`, n: resultat.parStatut[code] ?? 0 })), { code: 'tous', libelle: 'Toutes', n: totalTousStatuts }];
  const ordre = ['actif', 'douteux', 'expire', 'archive', 'tous'];
  onglets.sort((a, b) => ordre.indexOf(a.code) - ordre.indexOf(b.code));

  return (
    <>
      <EnTetePage
        surtitre="Veille"
        titre="Offres d’emploi"
        actions={
          session.peut('offres.importer') ? (
            <LienBouton href="/import" variante="or" icone="plus">
              Ajouter une offre
            </LienBouton>
          ) : null
        }
      >
        <p>
          Annonces au Maroc publiées depuis le {dateLongue(parametres.perimetre.dateMin)} — personnel de maison, beauté et bien-être, conciergerie et hospitalité. Par défaut, seules les offres actives sont
          affichées.
        </p>
      </EnTetePage>

      <form method="get" action="/offres" className="mb-4 rounded-xl border border-sable-200 bg-white p-3 shadow-carte sm:p-4" role="search">
        {statutCourant !== 'actif' ? <input type="hidden" name="statut" value={statutCourant} /> : null}
        {filtres.source ? <input type="hidden" name="source" value={filtres.source} /> : null}
        <div className="flex flex-wrap items-end gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Rechercher une offre</span>
            <Icone nom="recherche" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-encre-douce" />
            <input className="champ pl-9" type="search" name="q" defaultValue={filtres.q ?? ''} placeholder="Métier, employeur, mot-clé, référence… (français ou arabe)" />
          </label>
          <Selection name="tri" defaultValue={filtres.tri ?? 'pertinence'} options={TRIS.map((tri) => ({ valeur: tri, libelle: `Tri : ${LIBELLES_TRI[tri]}` }))} className="w-auto" aria-label="Trier" />
          <button type="submit" className={classesBouton('primaire')}>
            Rechercher
          </button>
        </div>
        <details className="group mt-3" open={filtresSecondaires > 0}>
          <summary className="inline-flex min-h-8 list-none items-center gap-2 rounded-lg px-2 text-[0.86rem] font-semibold text-marine-700 hover:bg-marine-50">
            <Icone nom="parametres" className="size-4" />
            Filtres{filtresSecondaires ? ` (${filtresSecondaires})` : ''}
            <span className="text-encre-douce group-open:hidden">— afficher</span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Champ libelle="Secteur">
              <Selection name="secteur" defaultValue={filtres.secteur ?? ''} vide="Tous les secteurs" options={OPTIONS_SECTEURS} />
            </Champ>
            <Champ libelle="Métier">
              <SelectionMetier name="metier" defaultValue={filtres.metier ?? ''} vide="Tous les métiers" />
            </Champ>
            <Champ libelle="Ville">
              <Selection name="ville" defaultValue={filtres.ville ?? ''} vide="Toutes les villes" options={OPTIONS_VILLES} />
            </Champ>
            <Champ libelle="Type d’employeur">
              <Selection name="employeur" defaultValue={filtres.employeur ?? ''} vide="Tous" options={TYPES_EMPLOYEUR.options} />
            </Champ>
            <Champ libelle="Contrat">
              <Selection name="contrat" defaultValue={filtres.contrat ?? ''} vide="Tous" options={CONTRATS.options} />
            </Champ>
            <Champ libelle="Logement">
              <Selection name="logement" defaultValue={filtres.logement ?? ''} vide="Peu importe" options={LOGEMENT.options.filter((o) => o.valeur !== 'indifferent')} />
            </Champ>
            <Champ libelle="Salaire mensuel minimum (DH)">
              <input className="champ" type="number" name="salaireMin" min={0} step={100} defaultValue={filtres.salaireMin ?? ''} inputMode="numeric" />
            </Champ>
            <Champ libelle="Publiée depuis">
              <Selection
                name="depuis"
                defaultValue={filtres.depuisJours ? String(filtres.depuisJours) : ''}
                vide="Toute la période"
                options={[
                  { valeur: '1', libelle: '24 heures' },
                  { valeur: '3', libelle: '3 jours' },
                  { valeur: '7', libelle: '7 jours' },
                  { valeur: '14', libelle: '14 jours' },
                  { valeur: '30', libelle: '30 jours' },
                ]}
              />
            </Champ>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.9rem]">
            {[
              { nom: 'urgent', libelle: 'Recrutement urgent', coche: filtres.urgent },
              { nom: 'massif', libelle: 'Plusieurs postes', coche: filtres.massif },
              { nom: 'aVerifier', libelle: 'À vérifier par un courtier', coche: filtres.aVerifier },
            ].map((case_) => (
              <label key={case_.nom} className="flex min-h-8 items-center gap-2">
                <input type="checkbox" name={case_.nom} value="1" defaultChecked={Boolean(case_.coche)} className="size-4 accent-marine-900" />
                {case_.libelle}
              </label>
            ))}
            <Link href={statutCourant === 'actif' ? '/offres' : `/offres?statut=${statutCourant}`} className="ml-auto text-[0.86rem] font-semibold text-marine-700 underline underline-offset-3">
              Effacer les filtres
            </Link>
          </div>
        </details>
      </form>

      {filtres.source ? (
        <p className="mb-3 text-[0.88rem] text-marine-900">
          Source affichée : <strong>{resultat.offres[0]?.source_name ?? filtres.source}</strong> ·{' '}
          <Link href={adresse(p, { source: null })} className="font-semibold text-marine-700 underline underline-offset-3">
            voir toutes les sources
          </Link>
        </p>
      ) : null}

      <nav aria-label="Statut des offres" className="mb-4 flex flex-wrap gap-1.5">
        {onglets.map((onglet) => {
          const actif = onglet.code === statutCourant;
          return (
            <Link
              key={onglet.code}
              href={adresse(p, { statut: onglet.code === 'actif' ? null : onglet.code })}
              aria-current={actif ? 'page' : undefined}
              className={cx('inline-flex min-h-9 items-center gap-2 rounded-full px-3.5 text-[0.86rem] font-semibold transition-colors', actif ? 'bg-marine-900 text-white' : 'bg-white text-marine-800 ring-1 ring-sable-300 ring-inset hover:bg-marine-50')}
            >
              {onglet.libelle}
              <span className={cx('rounded-full px-1.5 text-[0.74rem] leading-5', actif ? 'bg-or-500 text-marine-950' : 'bg-sable-100 text-encre-douce')}>{nombre(onglet.n)}</span>
            </Link>
          );
        })}
      </nav>

      <Encart ton="attention" className="mb-4">
        {AVERTISSEMENT_ENGAGEMENT}
      </Encart>

      {resultat.total === 0 ? (
        <Vide
          titre={totalTousStatuts === 0 ? 'Aucune offre ne correspond' : `Aucune offre « ${STATUTS_OFFRE.libelle(statutCourant).toLowerCase()} » ne correspond`}
          action={
            <>
              <LienBouton href="/offres" variante="secondaire">
                Effacer les filtres
              </LienBouton>
              {session.peut('offres.importer') ? (
                <LienBouton href="/import" variante="or" icone="plus">
                  Ajouter une offre
                </LienBouton>
              ) : null}
            </>
          }
        >
          {totalTousStatuts > 0 && statutCourant !== 'tous' ? (
            <p>
              {pluriel(totalTousStatuts, 'offre')} correspond{totalTousStatuts > 1 ? 'ent' : ''} avec un autre statut : voir l’onglet « Toutes ».
            </p>
          ) : (
            <p>Élargissez la recherche, ou ajoutez une offre en collant le texte d’une annonce : aucune collecte automatique n’est active tant qu’un administrateur ne l’a pas autorisée source par source.</p>
          )}
        </Vide>
      ) : (
        <Carte sansMarge>
          <p className="border-b border-sable-200 px-4 py-2.5 text-[0.84rem] text-encre-douce sm:px-5">
            <strong className="text-marine-900">{pluriel(resultat.total, 'offre')}</strong> · tri : {LIBELLES_TRI[filtres.tri ?? 'pertinence'].toLowerCase()}
          </p>
          <ul className="divide-y divide-sable-200">
            {resultat.offres.map((offre) => (
              <LigneOffre key={offre.id} offre={offre} seuils={seuils} maintenant={maintenant} />
            ))}
          </ul>
        </Carte>
      )}
      <Pagination page={resultat.page} total={resultat.total} parPage={resultat.parPage} lien={(page) => adresse(p, { page: String(page) })} />
    </>
  );
}
