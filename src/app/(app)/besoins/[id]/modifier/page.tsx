import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { notFound } from 'next/navigation';
import { ChampsBesoin } from '@/composants/employeurs';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { EnTetePage, classesBouton } from '@/composants/ui';
import { besoinParId } from '@/serveur/employeurs';
import { chargerParametres } from '@/serveur/parametres';
import { exigerPermission } from '@/serveur/session-next';
import { modifierBesoinAction } from '../../../employeurs/actions';

export const metadata: Metadata = { title: 'Modifier le besoin' };

export default async function PageModifierBesoin({ params }: { params: Promise<{ id: string }> }) {
  await exigerPermission('employeurs.gerer');
  const { id } = await params;
  const [besoin, parametres] = await Promise.all([besoinParId(id), chargerParametres()]);
  if (!besoin) notFound();
  return (
    <>
      <EnTetePage surtitre={`Besoins · ${besoin.reference}`} titre={`Modifier — ${besoin.title}`} />
      <Formulaire action={modifierBesoinAction} className="max-w-5xl">
        <input type="hidden" name="id" value={besoin.id} />
        <input type="hidden" name="employeur" value={besoin.employer_id} />
        <ChampsBesoin besoin={besoin} parametres={parametres} />
        <div className="mt-5 flex flex-wrap gap-3">
          <BoutonEnvoi icone="coche">Enregistrer les modifications</BoutonEnvoi>
          <Link href={`/besoins/${besoin.id}`} className={classesBouton('secondaire')}>
            Annuler
          </Link>
        </div>
      </Formulaire>
    </>
  );
}
