/** Commissions : statut, actions de suivi (facturer, encaisser, annuler) et formulaire de création. */
import Link from '@/composants/lien';
import { changerStatutCommissionAction, creerCommissionAction } from '@/app/(app)/placements/actions';
import { AVERTISSEMENT_COMMISSION_TRAVAILLEUR, LONGUEUR_MIN_JUSTIFICATION, transitionsPossibles } from '@/domaine/commissions';
import { MODES_CALCUL, MOYENS_PAIEMENT, PAYEURS, STATUTS_COMMISSION } from '@/domaine/referentiels';
import type { Commission } from '@/serveur/placements';
import { dateCourte, dateIso, dirhams } from './format';
import { BoutonEnvoi, Formulaire } from './formulaire';
import { Badge, BadgeFictif, Champ, Encart, Selection, TexteLibre, type Ton } from './ui';

const TON: Record<string, Ton> = { du: 'or', facture: 'marine', encaisse: 'vert', annule: 'neutre' };

export function StatutCommission({ statut }: { statut: string }) {
  return <Badge ton={TON[statut] ?? 'neutre'}>{STATUTS_COMMISSION.libelle(statut)}</Badge>;
}

export function detailCalcul(commission: Pick<Commission, 'calc_mode' | 'base_amount' | 'rate_percent'>): string {
  return commission.calc_mode === 'pourcentage' && commission.base_amount !== null && commission.rate_percent !== null ? `${commission.rate_percent} % de ${dirhams(commission.base_amount)}` : 'Montant fixe';
}

export function ActionsCommission({ commission }: { commission: Commission }) {
  const suites = transitionsPossibles(commission.status);
  if (suites.length === 0) return null;
  return (
    <details className="hors-impression group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center rounded-lg border border-sable-300 bg-white px-3 py-1.5 text-[0.84rem] font-semibold text-marine-800 hover:border-marine-400">Suivi du paiement</summary>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {suites.includes('encaisse') ? (
          <Formulaire action={changerStatutCommissionAction} className="space-y-2 rounded-lg border border-vert-100 bg-vert-50 p-3" messageEnBas>
            <input type="hidden" name="id" value={commission.id} />
            <input type="hidden" name="statut" value="encaisse" />
            <Champ libelle="Paiement reçu par">
              <Selection name="moyen" options={MOYENS_PAIEMENT.options} />
            </Champ>
            <BoutonEnvoi taille="petit" icone="coche">
              Encaisser {dirhams(commission.amount)}
            </BoutonEnvoi>
            <p className="text-[0.76rem] text-encre-douce">Un numéro de reçu interne est attribué si aucune facture n’a été saisie.</p>
          </Formulaire>
        ) : null}
        {suites.includes('facture') ? (
          <Formulaire action={changerStatutCommissionAction} className="space-y-2 rounded-lg border border-sable-200 bg-sable-50 p-3" messageEnBas>
            <input type="hidden" name="id" value={commission.id} />
            <input type="hidden" name="statut" value="facture" />
            <Champ libelle="N° de facture (si émise ailleurs)">
              <input className="champ" name="numeroFacture" maxLength={60} />
            </Champ>
            <BoutonEnvoi variante="secondaire" taille="petit">
              Marquer comme facturée
            </BoutonEnvoi>
          </Formulaire>
        ) : null}
        {suites.includes('annule') ? (
          <Formulaire action={changerStatutCommissionAction} className="space-y-2 rounded-lg border border-rouge-100 bg-rouge-50 p-3" messageEnBas confirmer={commission.status === 'encaisse' ? 'Annuler une commission déjà encaissée ? Pensez au remboursement.' : 'Annuler cette commission ?'}>
            <input type="hidden" name="id" value={commission.id} />
            <input type="hidden" name="statut" value="annule" />
            <Champ libelle="Motif de l’annulation">
              <input className="champ" name="motif" required minLength={5} maxLength={500} />
            </Champ>
            <BoutonEnvoi variante="danger" taille="petit">
              Annuler la commission
            </BoutonEnvoi>
          </Formulaire>
        ) : null}
        {suites.includes('du') ? (
          <Formulaire action={changerStatutCommissionAction} className="self-end" messageEnBas>
            <input type="hidden" name="id" value={commission.id} />
            <input type="hidden" name="statut" value="du" />
            <BoutonEnvoi variante="secondaire" taille="petit">
              Revenir à « Dû » (facture non émise)
            </BoutonEnvoi>
          </Formulaire>
        ) : null}
      </div>
    </details>
  );
}

export function LigneCommission({ commission, peutAgir, avecPlacement = false }: { commission: Commission; peutAgir: boolean; avecPlacement?: boolean }) {
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-semibold text-marine-900">
            {commission.reference} — {commission.label ?? 'Frais de placement'} {commission.fictif ? <BadgeFictif /> : null}
          </p>
          <p className="text-[0.82rem] text-encre-douce">
            {avecPlacement ? (
              <>
                <Link href={`/placements/${commission.placement_id}`} className="font-semibold text-marine-800 underline underline-offset-2">
                  {commission.placement_reference}
                </Link>{' '}
                · <TexteLibre>{commission.employeur}</TexteLibre> ·{' '}
              </>
            ) : null}
            Payée par : {PAYEURS.libelle(commission.payer).toLowerCase()} · {detailCalcul(commission)}
            {commission.due_date && commission.status !== 'encaisse' && commission.status !== 'annule' ? ` · échéance le ${dateCourte(commission.due_date)}` : ''}
          </p>
          <p className="text-[0.82rem] text-encre-douce">
            {commission.status === 'encaisse' ? (
              <>
                Encaissée le {dateCourte(commission.paid_at)} ({MOYENS_PAIEMENT.libelle(commission.payment_method).toLowerCase()}) · {commission.document_type === 'facture' ? 'facture' : 'reçu'} n° {commission.document_number} ·{' '}
                <Link href={`/commissions/${commission.id}/recu`} className="font-semibold text-marine-800 underline underline-offset-2">
                  {commission.document_type === 'facture' ? 'Voir le justificatif' : 'Imprimer le reçu'}
                </Link>
              </>
            ) : commission.status === 'facture' ? (
              <>
                Facturée le {dateCourte(commission.invoiced_at)}
                {commission.document_number ? ` · facture n° ${commission.document_number}` : ''}
              </>
            ) : commission.status === 'annule' ? (
              <>
                Annulée le {dateCourte(commission.cancelled_at)} : {commission.cancel_reason}
              </>
            ) : null}
          </p>
          {commission.payer === 'travailleur' ? (
            <p className="mt-1 rounded bg-rouge-50 px-2 py-1 text-[0.8rem] text-rouge-700">
              Dérogation — commission à la charge du travailleur, validée par {commission.accuse_par ?? '—'} le {dateCourte(commission.compliance_ack_at)} : « {commission.compliance_note} »
            </p>
          ) : null}
          {commission.notes ? <p className="mt-1 text-[0.82rem] text-encre-douce">Note : {commission.notes}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-2">
          <span className="chiffre text-[1.5rem] whitespace-nowrap text-marine-900">{dirhams(commission.amount)}</span>
          <StatutCommission statut={commission.status} />
        </div>
      </div>
      {peutAgir ? <ActionsCommission commission={commission} /> : null}
    </li>
  );
}

export function FormulaireCommission({ placementId, travailleurActive, salaireDeBase }: { placementId: string; travailleurActive: boolean; salaireDeBase: number | null }) {
  return (
    <Formulaire action={creerCommissionAction} className="space-y-3" viderApresSucces>
      <input type="hidden" name="placement" value={placementId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Champ libelle="Libellé">
          <input className="champ" name="libelle" maxLength={160} placeholder="Frais de placement" />
        </Champ>
        <Champ libelle="Calcul">
          <Selection name="mode" defaultValue="forfait" options={MODES_CALCUL.options} />
        </Champ>
        <Champ libelle="Montant fixe (DH)" aide="Pour un montant fixe.">
          <input className="champ" name="montant" inputMode="decimal" />
        </Champ>
        <Champ libelle="Salaire de base (DH)" aide="Pour un pourcentage.">
          <input className="champ" name="base" inputMode="decimal" defaultValue={salaireDeBase ?? ''} />
        </Champ>
        <Champ libelle="Taux (%)" aide="Pour un pourcentage.">
          <input className="champ" name="taux" inputMode="decimal" />
        </Champ>
        <Champ libelle="Échéance">
          <input className="champ" type="date" name="echeance" defaultValue={dateIso(new Date())} />
        </Champ>
      </div>
      {travailleurActive ? (
        <div className="space-y-3 rounded-lg border border-rouge-100 bg-rouge-50 p-3">
          <Champ libelle="Payée par">
            <Selection name="payeur" defaultValue="employeur" options={PAYEURS.options} className="sm:max-w-60" />
          </Champ>
          <Encart ton="danger" titre="Commission à la charge du travailleur">
            {AVERTISSEMENT_COMMISSION_TRAVAILLEUR}
          </Encart>
          <label className="flex items-start gap-2 text-[0.88rem] font-medium text-marine-900">
            <input type="checkbox" name="accuseLecture" className="mt-0.5 size-4 accent-rouge-600" />
            J’ai lu cet avertissement (à cocher seulement si le payeur est le travailleur).
          </label>
          <Champ libelle={`Justification (${LONGUEUR_MIN_JUSTIFICATION} caractères au moins)`} aide="Base juridique et validation obtenue. Elle est consignée dans le journal d’audit.">
            <textarea className="champ" name="justification" rows={2} maxLength={2000} />
          </Champ>
        </div>
      ) : (
        <>
          <input type="hidden" name="payeur" value="employeur" />
          <p className="text-[0.8rem] text-encre-douce">Payeur : l’employeur. La commission côté travailleur est désactivée (article 480 du Code du travail ; promesse « Aucun frais, jamais » faite aux candidats).</p>
        </>
      )}
      <BoutonEnvoi variante="secondaire" icone="plus">
        Ajouter la commission
      </BoutonEnvoi>
    </Formulaire>
  );
}
