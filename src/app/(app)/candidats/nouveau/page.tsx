import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { ChampsCandidat } from '@/composants/candidats';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { EnTetePage, classesBouton } from '@/composants/ui';
import { chargerParametres } from '@/serveur/parametres';
import { exigerPermission } from '@/serveur/session-next';
import { creerCandidatAction } from '../actions';

export const metadata: Metadata = { title: 'Nouveau candidat' };

export default async function PageNouveauCandidat() {
  await exigerPermission('candidats.gerer');
  const parametres = await chargerParametres();
  return (
    <>
      <EnTetePage surtitre="Candidats" titre="Nouveau candidat">
        <p>Seuls le nom, le métier principal et l’accord de la personne sont obligatoires. Plus le profil est complet, plus les rapprochements sont justes.</p>
      </EnTetePage>
      <Formulaire action={creerCandidatAction} className="max-w-5xl">
        <ChampsCandidat versionConsentement={parametres.candidats.versionConsentement} conservationMois={parametres.candidats.conservationMois} />
        <div className="mt-5 flex flex-wrap gap-3">
          <BoutonEnvoi icone="coche">Enregistrer le candidat</BoutonEnvoi>
          <Link href="/candidats" className={classesBouton('secondaire')}>
            Annuler
          </Link>
        </div>
      </Formulaire>
    </>
  );
}
