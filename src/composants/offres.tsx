/** Affichage des offres : statut, badges, ligne de liste. */
import Link from '@/composants/lien';
import type { ReactNode } from 'react';
import { CONTRATS, LOGEMENT, MOTIFS_STATUT, STATUTS_OFFRE, TEMPS_TRAVAIL, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { nomVille } from '@/domaine/geographie';
import { libelleMetier } from '@/domaine/taxonomie';
import type { Offre } from '@/serveur/offres';
import { dateCourte, ilYA, salaire } from './format';
import { Icone } from './icones';
import { Badge, BadgeFictif, Jauge, TexteLibre, type Ton } from './ui';

const TON_STATUT: Record<string, Ton> = { actif: 'vert', douteux: 'ambre', expire: 'neutre', archive: 'marine' };

export function StatutOffre({ statut, motif }: { statut: string; motif?: string | null }) {
  const raison = motif && motif !== 'aucun' ? MOTIFS_STATUT.libelle(motif) : '';
  return (
    <Badge ton={TON_STATUT[statut] ?? 'neutre'} titre={raison || undefined}>
      {STATUTS_OFFRE.libelle(statut)}
      {raison ? <span className="font-medium opacity-80">· {raison}</span> : null}
    </Badge>
  );
}

export type SeuilsRisque = { modere: number; eleve: number };

export function BadgeRisque({ score, seuils }: { score: number; seuils: SeuilsRisque }) {
  if (score >= seuils.eleve) return <Badge ton="rouge">Risque élevé · {score}</Badge>;
  if (score >= seuils.modere) return <Badge ton="ambre">Risque modéré · {score}</Badge>;
  return null;
}

export function lieuOffre(offre: Pick<Offre, 'city_code' | 'city_label' | 'district'>): string {
  const ville = offre.city_code ? nomVille(offre.city_code) : offre.city_label;
  if (!ville) return 'Ville non précisée';
  return offre.district ? `${ville} · ${offre.district}` : ville;
}

/** Date de publication, avec sa précision : une date approximative n'est jamais présentée comme exacte. */
export function datePublication(offre: Pick<Offre, 'published_at' | 'date_precision'>, maintenant: Date): ReactNode {
  if (!offre.published_at) return <span className="font-semibold text-ambre-800">Date de publication inconnue</span>;
  return (
    <span title={`Publiée le ${dateCourte(offre.published_at)}${offre.date_precision === 'approximative' ? ' (date approximative, déduite de l’annonce)' : ''}`}>
      Publiée {ilYA(offre.published_at, maintenant)}
      {offre.date_precision === 'approximative' ? ' (date approx.)' : ''}
    </span>
  );
}

export function EtiquettesOffre({ offre, seuils }: { offre: Offre; seuils: SeuilsRisque }) {
  return (
    <>
      <StatutOffre statut={offre.effective_status} motif={offre.effective_reason} />
      {offre.is_demo ? <BadgeFictif /> : null}
      {offre.requires_human_review ? <Badge ton="or">À vérifier</Badge> : null}
      {offre.verification_status === 'verifiee' ? <Badge ton="vert">Vérifiée</Badge> : null}
      {offre.is_urgent ? <Badge ton="rouge">Urgent</Badge> : null}
      {offre.is_bulk_hiring ? <Badge ton="marine">{offre.headcount ? `${offre.headcount} postes` : 'Plusieurs postes'}</Badge> : null}
      <BadgeRisque score={offre.risk_score} seuils={seuils} />
    </>
  );
}

export function LigneOffre({ offre, seuils, maintenant }: { offre: Offre; seuils: SeuilsRisque; maintenant: Date }) {
  const remuneration = salaire(offre.salary_min, offre.salary_max, offre.salary_period);
  const details = [
    offre.contract_type !== 'non_precise' ? CONTRATS.libelle(offre.contract_type) : null,
    offre.work_time !== 'non_precise' ? TEMPS_TRAVAIL.libelle(offre.work_time) : null,
    offre.housing && offre.housing !== 'indifferent' ? LOGEMENT.libelle(offre.housing) : null,
  ].filter(Boolean);
  return (
    <li className="group relative grid gap-x-5 gap-y-3 px-4 py-4 transition-colors hover:bg-sable-50 sm:px-5 md:grid-cols-[minmax(0,1fr)_11.5rem]">
      <div className="min-w-0">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <EtiquettesOffre offre={offre} seuils={seuils} />
        </div>
        <h3 className="text-[1.02rem] leading-snug font-bold text-marine-900">
          <Link href={`/offres/${offre.id}`} className="after:absolute after:inset-0 hover:underline hover:decoration-or-500 hover:decoration-2 hover:underline-offset-3">
            <TexteLibre>{offre.title}</TexteLibre>
          </Link>
        </h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.88rem] text-encre-douce">
          <span className="font-semibold text-marine-800">
            <TexteLibre>{offre.employer_name}</TexteLibre>
            {offre.employer_name ? null : offre.employer_type_guess ? TYPES_EMPLOYEUR.libelle(offre.employer_type_guess) : 'Employeur non identifié'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icone nom="lieu" className="size-3.5" />
            {lieuOffre(offre)}
          </span>
          {offre.metier ? <span>{libelleMetier(offre.metier)}</span> : <span className="font-semibold text-ambre-800">Métier à confirmer</span>}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.84rem] text-encre-douce">
          {remuneration ? <strong className="text-marine-900">{remuneration}</strong> : <span>Salaire non indiqué</span>}
          {details.map((detail) => (
            <span key={detail}>{detail}</span>
          ))}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[0.78rem] text-encre-douce">
          <span className="inline-flex items-center gap-1">
            <Icone nom="horloge" className="size-3.5" />
            {datePublication(offre, maintenant)}
          </span>
          <span>
            Source : {offre.source_name} · <span className="whitespace-nowrap">{offre.reference}</span>
          </span>
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-1 md:gap-2">
        <Jauge valeur={offre.relevance_score} libelle="Pertinence" />
        <Jauge valeur={offre.placement_score} libelle="Placement" />
        <Jauge valeur={offre.risk_score} libelle="Risque" inverse />
      </div>
    </li>
  );
}
