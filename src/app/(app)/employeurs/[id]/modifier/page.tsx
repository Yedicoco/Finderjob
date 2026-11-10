import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { notFound } from 'next/navigation';
import { ChampsEmployeur } from '@/composants/employeurs';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { EnTetePage, classesBouton } from '@/composants/ui';
import { employeurParId } from '@/serveur/employeurs';
import { exigerPermission } from '@/serveur/session-next';
import { modifierEmployeurAction } from '../../actions';

export const metadata: Metadata = { title: 'Modifier l’employeur' };

export default async function PageModifierEmployeur({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerPermission('employeurs.gerer');
  const { id } = await params;
  const employeur = await employeurParId(id, session.acteur);
  if (!employeur) notFound();
  return (
    <>
      <EnTetePage surtitre={`Employeurs · ${employeur.reference}`} titre={`Modifier — ${employeur.name}`} />
      <Formulaire action={modifierEmployeurAction} className="max-w-5xl">
        <input type="hidden" name="id" value={employeur.id} />
        <ChampsEmployeur employeur={employeur} />
        <div className="mt-5 flex flex-wrap gap-3">
          <BoutonEnvoi icone="coche">Enregistrer les modifications</BoutonEnvoi>
          <Link href={`/employeurs/${employeur.id}`} className={classesBouton('secondaire')}>
            Annuler
          </Link>
        </div>
      </Formulaire>
    </>
  );
}
