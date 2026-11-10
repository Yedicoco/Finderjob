import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { ChampsEmployeur } from '@/composants/employeurs';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { Champ, EnTetePage, Selection, classesBouton } from '@/composants/ui';
import { exigerPermission } from '@/serveur/session-next';
import { creerEmployeurAction } from '../actions';

export const metadata: Metadata = { title: 'Nouvel employeur' };

export default async function PageNouvelEmployeur() {
  await exigerPermission('employeurs.gerer');
  return (
    <>
      <EnTetePage surtitre="Employeurs" titre="Nouvel employeur">
        <p>Seuls le type et le nom sont obligatoires. Vous pourrez ensuite noter vos échanges et décrire ses besoins.</p>
      </EnTetePage>
      <Formulaire action={creerEmployeurAction} className="max-w-5xl space-y-5">
        <ChampsEmployeur />
        <Champ libelle="Comment cet employeur est-il arrivé ?" className="max-w-sm">
          <Selection
            name="origine"
            defaultValue="saisie"
            options={[
              { valeur: 'demande_entrante', libelle: 'Il a contacté Yallah Services' },
              { valeur: 'site_yallah', libelle: 'Formulaire du site Yallah Services' },
              { valeur: 'recommandation', libelle: 'Recommandation' },
              { valeur: 'saisie', libelle: 'Prospection / autre' },
            ]}
          />
        </Champ>
        <div className="flex flex-wrap gap-3">
          <BoutonEnvoi icone="coche">Enregistrer l’employeur</BoutonEnvoi>
          <Link href="/employeurs" className={classesBouton('secondaire')}>
            Annuler
          </Link>
        </div>
      </Formulaire>
    </>
  );
}
