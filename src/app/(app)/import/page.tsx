import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { OPTIONS_VILLES } from '@/composants/options';
import { Carte, EnTetePage, Encart } from '@/composants/ui';
import { TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { exigerPermission } from '@/serveur/session-next';
import { FormulaireFichier, FormulaireImport } from './formulaire-import';

export const metadata: Metadata = { title: 'Ajouter une offre' };

export default async function PageImport({ searchParams }: { searchParams: Promise<{ origine?: string }> }) {
  const session = await exigerPermission('offres.importer');
  const { origine } = await searchParams;

  return (
    <>
      <EnTetePage surtitre="Offres" titre="Ajouter une offre">
        <p>Collez le texte d’une annonce que vous avez lue ou reçue. L’outil en extrait les informations utiles, signale les risques et vérifie qu’elle n’est pas déjà enregistrée.</p>
      </EnTetePage>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Carte titre="Coller une annonce">
          <FormulaireImport villes={OPTIONS_VILLES} typesEmployeur={[...TYPES_EMPLOYEUR.options]} origineInitiale={origine === 'employeur' ? 'employeur' : 'site'} />
        </Carte>

        <div className="space-y-6">
          <Encart ton="info" titre="Ce qui est conservé">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Annonce lue sur un site</strong> : un court extrait, les informations structurées et le lien. Le texte complet et les coordonnées restent sur le site d’origine.
              </li>
              <li>
                <strong>Annonce confiée par un employeur</strong> : le texte complet et ses coordonnées (chiffrées), puisqu’il nous les a transmises lui-même.
              </li>
              <li>Une annonce hors du Maroc est refusée. Une annonce sans date ou risquée est enregistrée comme « douteuse », jamais comme active.</li>
            </ul>
          </Encart>

          <Carte titre="Importer un fichier">
            <p className="mb-3 text-[0.88rem] text-encre-douce">
              Pour une liste fournie par un partenaire ou tenue dans un tableur. Colonnes reconnues : <code className="text-[0.82rem]">titre</code> (obligatoire), <code className="text-[0.82rem]">description</code>, <code className="text-[0.82rem]">employeur</code>,{' '}
              <code className="text-[0.82rem]">ville</code>, <code className="text-[0.82rem]">url</code>, <code className="text-[0.82rem]">date_publication</code>, <code className="text-[0.82rem]">salaire_min</code>…{' '}
              <a href="/modeles/offres-modele.csv" download className="font-semibold text-marine-800 underline decoration-or-500 decoration-2 underline-offset-3">
                Télécharger le modèle CSV
              </a>
            </p>
            <FormulaireFichier />
          </Carte>

          {session.peut('sources.gerer') ? (
            <p className="text-[0.86rem] text-encre-douce">
              La collecte automatique d’un site se règle dans{' '}
              <Link href="/administration/sources" className="font-semibold text-marine-800 underline underline-offset-3">
                Administration › Sources
              </Link>
              . Elle reste désactivée tant que les conditions du site n’ont pas été vérifiées.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
