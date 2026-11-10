import type { Metadata } from 'next';
import Image from 'next/image';
import Link from '@/composants/lien';
import { notFound } from 'next/navigation';
import { detailCalcul } from '@/composants/commissions';
import { dateLongue, dirhams } from '@/composants/format';
import { BoutonImprimer } from '@/composants/navigation';
import { Encart, classesBouton } from '@/composants/ui';
import { MOYENS_PAIEMENT, PAYEURS } from '@/domaine/referentiels';
import { commissionParId } from '@/serveur/placements';
import { exigerPermission } from '@/serveur/session-next';

export const metadata: Metadata = { title: 'Reçu' };

export default async function PageRecu({ params }: { params: Promise<{ id: string }> }) {
  await exigerPermission('placements.lire');
  const { id } = await params;
  const commission = await commissionParId(id);
  if (!commission) notFound();

  if (commission.status !== 'encaisse') {
    return (
      <Encart ton="attention" titre="Pas encore de reçu">
        Un reçu n’existe que pour une commission encaissée.{' '}
        <Link href={`/placements/${commission.placement_id}`} className="font-semibold underline">
          Retour au placement
        </Link>
      </Encart>
    );
  }
  const estFacture = commission.document_type === 'facture';

  return (
    <>
      <div className="hors-impression mb-5 flex flex-wrap items-center gap-3">
        <BoutonImprimer className={classesBouton('primaire')}>Imprimer ou enregistrer en PDF</BoutonImprimer>
        <Link href={`/placements/${commission.placement_id}`} className={classesBouton('secondaire')}>
          Retour au placement
        </Link>
      </div>

      <article className="mx-auto max-w-2xl rounded-xl border border-sable-300 bg-white p-5 shadow-carte sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {commission.fictif ? (
          <p className="mb-5 border-2 border-rouge-700 px-4 py-2 text-center text-[0.95rem] font-bold tracking-wide text-rouge-700 uppercase">
            Spécimen — jeu de démonstration. Aucun paiement réel : document sans valeur.
          </p>
        ) : null}
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b-2 border-marine-900 pb-5">
          <div className="flex items-center gap-3">
            <Image src="/marque/logo-128.png" alt="" width={56} height={56} unoptimized />
            <div>
              <p className="titre text-[1.5rem] text-marine-900">Yallah Services</p>
              <p className="text-[0.84rem] text-encre-douce">Intermédiation et mise en relation de personnel</p>
              <p className="text-[0.84rem] text-encre-douce">Casablanca — Hay Hassani, 20220, Maroc</p>
            </div>
          </div>
          <div className="ml-auto text-right">
            <p className="titre text-[1.3rem] text-marine-900">{estFacture ? 'Justificatif de paiement' : 'Reçu de paiement'}</p>
            <p className="font-semibold whitespace-nowrap tabular-nums">N° {commission.document_number}</p>
            <p className="text-[0.86rem] text-encre-douce">{dateLongue(commission.paid_at)}</p>
          </div>
        </header>

        <dl className="mt-6 grid gap-x-8 gap-y-4 text-[0.95rem] sm:grid-cols-2">
          <div>
            <dt className="text-[0.74rem] font-semibold tracking-wide text-encre-douce uppercase">Reçu de</dt>
            <dd className="font-semibold text-marine-900" dir="auto">
              {commission.payer === 'employeur' ? commission.employeur : `Candidat ${commission.candidat_reference}`}
            </dd>
            <dd className="text-[0.84rem] text-encre-douce">{PAYEURS.libelle(commission.payer)}</dd>
          </div>
          <div>
            <dt className="text-[0.74rem] font-semibold tracking-wide text-encre-douce uppercase">Mode de paiement</dt>
            <dd className="font-semibold text-marine-900">{MOYENS_PAIEMENT.libelle(commission.payment_method)}</dd>
          </div>
          <div>
            <dt className="text-[0.74rem] font-semibold tracking-wide text-encre-douce uppercase">Objet</dt>
            <dd className="text-marine-900">{commission.label ?? 'Frais de mise en relation'}</dd>
            <dd className="text-[0.84rem] text-encre-douce">
              Placement {commission.placement_reference} · candidat {commission.candidat_reference} · {detailCalcul(commission)}
            </dd>
          </div>
          <div>
            <dt className="text-[0.74rem] font-semibold tracking-wide text-encre-douce uppercase">Références internes</dt>
            <dd className="text-marine-900 tabular-nums">{commission.reference}</dd>
          </div>
        </dl>

        <p className="mt-8 flex items-baseline justify-between border-y border-sable-300 py-4">
          <span className="text-[0.95rem] font-semibold text-marine-900">Montant reçu</span>
          <span className="chiffre text-[2.4rem] text-marine-900">{dirhams(commission.amount)}</span>
        </p>

        <div className="mt-10 grid grid-cols-2 gap-8 text-[0.84rem] text-encre-douce">
          <div>
            <p className="mb-12">Pour Yallah Services (nom et signature)</p>
            <p className="border-t border-sable-300" />
          </div>
          <div>
            <p className="mb-12">Le payeur (nom et signature)</p>
            <p className="border-t border-sable-300" />
          </div>
        </div>

        <footer className="mt-8 space-y-1 border-t border-sable-200 pt-4 text-[0.76rem] text-encre-douce">
          <p>
            {estFacture
              ? `Ce justificatif accompagne la facture n° ${commission.document_number}, émise séparément ; il ne la remplace pas.`
              : 'Reçu interne attestant un paiement. Il ne constitue pas une facture : il ne porte ni identifiant fiscal (ICE, IF) ni TVA. Une facture conforme doit être émise séparément si le payeur la demande.'}
          </p>
          <p>
            Yallah Services met en relation ; le contrat de travail est conclu directement entre l’employeur et la personne recrutée.
            {commission.payer === 'employeur' ? ' Aucun frais n’est demandé aux candidats.' : ''}
          </p>
        </footer>
      </article>
    </>
  );
}
