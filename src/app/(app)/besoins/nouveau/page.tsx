import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { ChampsBesoin } from '@/composants/employeurs';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { un, type ParametresAdresse } from '@/composants/requete';
import { EnTetePage, LienBouton, Vide, classesBouton } from '@/composants/ui';
import { employeurParId } from '@/serveur/employeurs';
import { chargerParametres } from '@/serveur/parametres';
import { exigerPermission } from '@/serveur/session-next';
import { creerBesoinAction } from '../../employeurs/actions';

export const metadata: Metadata = { title: 'Nouveau besoin' };

export default async function PageNouveauBesoin({ searchParams }: { searchParams: Promise<ParametresAdresse> }) {
  const session = await exigerPermission('employeurs.gerer');
  const p = await searchParams;
  const employeur = un(p.employeur) ? await employeurParId(un(p.employeur), session.acteur) : null;
  if (!employeur) {
    return (
      <>
        <EnTetePage surtitre="Besoins" titre="Nouveau besoin" />
        <Vide
          titre="Choisissez d’abord l’employeur"
          action={
            <LienBouton href="/employeurs" variante="primaire" icone="employeurs">
              Voir les employeurs
            </LienBouton>
          }
        >
          <p>Un besoin appartient toujours à un employeur : ouvrez sa fiche, puis cliquez sur « Nouveau besoin ».</p>
        </Vide>
      </>
    );
  }
  const parametres = await chargerParametres();
  return (
    <>
      <EnTetePage surtitre={`Employeurs · ${employeur.reference}`} titre={`Nouveau besoin — ${employeur.name}`}>
        <p>Décrivez le poste tel que l’employeur l’a exprimé. Le métier et la ville servent à proposer des candidats.</p>
      </EnTetePage>
      <Formulaire action={creerBesoinAction} className="max-w-5xl">
        <input type="hidden" name="employeur" value={employeur.id} />
        <ChampsBesoin parametres={parametres} besoin={undefined} />
        <div className="mt-5 flex flex-wrap gap-3">
          <BoutonEnvoi icone="coche">Enregistrer le besoin</BoutonEnvoi>
          <Link href={`/employeurs/${employeur.id}`} className={classesBouton('secondaire')}>
            Annuler
          </Link>
        </div>
      </Formulaire>
    </>
  );
}
