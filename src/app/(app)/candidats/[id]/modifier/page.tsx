import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { notFound, redirect } from 'next/navigation';
import { ChampsCandidat } from '@/composants/candidats';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { EnTetePage, classesBouton } from '@/composants/ui';
import { candidatParId } from '@/serveur/candidats';
import { chargerParametres } from '@/serveur/parametres';
import { exigerPermission } from '@/serveur/session-next';
import { modifierCandidatAction } from '../../actions';

export const metadata: Metadata = { title: 'Modifier le candidat' };

export default async function PageModifierCandidat({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerPermission('candidats.gerer');
  const { id } = await params;
  const [candidat, parametres] = await Promise.all([candidatParId(id, session.acteur), chargerParametres()]);
  if (!candidat) notFound();
  if (candidat.anonymise) redirect(`/candidats/${id}`);
  return (
    <>
      <EnTetePage surtitre={`Candidats · ${candidat.reference}`} titre={`Modifier — ${candidat.nom ?? candidat.reference}`} />
      <Formulaire action={modifierCandidatAction} className="max-w-5xl">
        <input type="hidden" name="id" value={candidat.id} />
        <ChampsCandidat candidat={candidat} versionConsentement={parametres.candidats.versionConsentement} conservationMois={parametres.candidats.conservationMois} />
        <div className="mt-5 flex flex-wrap gap-3">
          <BoutonEnvoi icone="coche">Enregistrer les modifications</BoutonEnvoi>
          <Link href={`/candidats/${candidat.id}`} className={classesBouton('secondaire')}>
            Annuler
          </Link>
        </div>
      </Formulaire>
    </>
  );
}
