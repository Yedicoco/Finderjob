/** Rapprochements candidat ↔ poste : score, explication critère par critère, suites possibles. */
import Link from '@/composants/lien';
import { changerStatutRapprochement } from '@/app/(app)/appariements/actions';
import { nomVille } from '@/domaine/geographie';
import { STATUTS_CANDIDAT, STATUTS_CORRESPONDANCE } from '@/domaine/referentiels';
import { libelleMetier } from '@/domaine/taxonomie';
import { suitesCorrespondance, type Correspondance } from '@/serveur/appariements';
import { ilYA } from './format';
import { BoutonAction } from './formulaire';
import { Badge, LienBouton, TexteLibre, type Ton } from './ui';

const TON: Record<string, Ton> = { suggere: 'or', retenu: 'marine', propose: 'marine', entretien: 'marine', accepte: 'vert', refuse_candidat: 'neutre', refuse_employeur: 'neutre', ecarte: 'neutre' };

const LIBELLES_SUITE: Record<string, { libelle: string; variante: 'primaire' | 'secondaire' | 'danger' }> = {
  retenu: { libelle: 'Retenir', variante: 'primaire' },
  propose: { libelle: 'Proposer à l’employeur', variante: 'primaire' },
  entretien: { libelle: 'Entretien prévu', variante: 'secondaire' },
  accepte: { libelle: 'Accord des deux parties', variante: 'primaire' },
  refuse_candidat: { libelle: 'Refus du candidat', variante: 'secondaire' },
  refuse_employeur: { libelle: 'Refus de l’employeur', variante: 'secondaire' },
  ecarte: { libelle: 'Écarter', variante: 'secondaire' },
};

/**
 * `vue` = ce que la liste montre : les candidats d'un poste, ou les postes d'un candidat.
 */
export function ListeCorrespondances({ correspondances, vue, peutAgir, maintenant }: { correspondances: Correspondance[]; vue: 'candidats' | 'postes'; peutAgir: boolean; maintenant: Date }) {
  if (correspondances.length === 0) return null;
  return (
    <ul className="divide-y divide-sable-200">
      {correspondances.map((c) => {
        const suites = peutAgir ? suitesCorrespondance(c.status) : [];
        const lienPoste = c.employer_need_id ? `/besoins/${c.employer_need_id}` : `/offres/${c.job_offer_id}`;
        return (
          <li key={c.id} className="px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-marine-900 text-or-300" title="Score d’adéquation sur 100">
                <span className="chiffre text-[1.6rem]">{c.score}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {vue === 'candidats' ? (
                    <Link href={`/candidats/${c.candidate_id}`} className="font-bold text-marine-900 underline decoration-or-500 decoration-2 underline-offset-3">
                      {c.candidat_nom ?? c.candidat_reference}
                    </Link>
                  ) : (
                    <Link href={lienPoste} className="font-bold text-marine-900 underline decoration-or-500 decoration-2 underline-offset-3">
                      <TexteLibre>{c.besoin_titre ?? c.offre_titre}</TexteLibre>
                    </Link>
                  )}
                  <Badge ton={TON[c.status] ?? 'neutre'}>{STATUTS_CORRESPONDANCE.libelle(c.status)}</Badge>
                </div>
                <p className="mt-0.5 text-[0.84rem] text-encre-douce">
                  {vue === 'candidats' ? (
                    <>
                      {c.candidat_reference} · {libelleMetier(c.candidat_metier)} · {c.candidat_ville ? nomVille(c.candidat_ville) : 'ville non renseignée'} · {STATUTS_CANDIDAT.libelle(c.candidat_statut)}
                    </>
                  ) : (
                    <>
                      {c.employer_need_id ? `Besoin ${c.besoin_reference} · ${c.besoin_employeur ?? ''}` : `Offre ${c.offre_reference}${c.offre_ville ? ` · ${nomVille(c.offre_ville)}` : ''}`}
                    </>
                  )}{' '}
                  · calculé {ilYA(c.computed_at, maintenant)}
                </p>
                {c.explanation.bloquants.length > 0 ? <p className="mt-1.5 text-[0.86rem] font-semibold text-rouge-700">Bloquant : {c.explanation.bloquants.join(' ; ')}</p> : null}
                {c.explanation.pointsForts.length > 0 ? <p className="mt-1.5 text-[0.86rem] text-marine-900">{c.explanation.pointsForts.slice(0, 3).join(' · ')}</p> : null}
                <details className="mt-1.5">
                  <summary className="w-fit cursor-pointer rounded text-[0.84rem] font-semibold text-marine-700 hover:underline">Pourquoi ce score ?</summary>
                  {/* Sur téléphone : critère et points sur une ligne, explication dessous. Sur grand écran : trois colonnes. */}
                  <dl className="mt-2 max-w-2xl text-[0.84rem]">
                    {c.explanation.criteres.map((critere) => (
                      <div key={critere.code} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-sable-100 py-1 sm:grid-cols-[10rem_4rem_minmax(0,1fr)]">
                        <dt className="font-semibold text-marine-900">{critere.libelle}</dt>
                        <dd className="text-right font-bold whitespace-nowrap tabular-nums">
                          {critere.points} / {critere.max}
                        </dd>
                        <dd className="col-span-2 text-encre-douce sm:col-span-1">{critere.explication}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-1.5 text-[0.76rem] text-encre-douce">Le score n’utilise ni l’âge, ni l’origine, ni le nom du candidat. C’est une aide : la décision reste humaine.</p>
                </details>
              </div>
            </div>
            {suites.length > 0 || (c.status === 'accepte' && peutAgir) ? (
              <div className="hors-impression mt-3 flex flex-wrap gap-2 sm:pl-[4.5rem]">
                {c.status === 'accepte' && peutAgir ? (
                  <LienBouton href={`/placements/nouveau?rapprochement=${c.id}`} variante="or" taille="petit" icone="placements">
                    Enregistrer le placement
                  </LienBouton>
                ) : null}
                {suites.map((suite) => (
                  <BoutonAction key={suite} action={changerStatutRapprochement} champs={{ id: c.id, statut: suite }} variante={LIBELLES_SUITE[suite]?.variante ?? 'secondaire'}>
                    {LIBELLES_SUITE[suite]?.libelle ?? suite}
                  </BoutonAction>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
