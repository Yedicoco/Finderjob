import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { BoutonAction } from '@/composants/formulaire';
import { nombre } from '@/composants/format';
import { Carte, Chiffre, EnTetePage, Encart } from '@/composants/ui';
import { etatDemo } from '@/serveur/demo';
import { exigerPermission } from '@/serveur/session-next';
import { chargerDemoAction, supprimerDemoAction } from '../actions';

export const metadata: Metadata = { title: 'Démonstration' };

export default async function PageDemonstration() {
  await exigerPermission('parametres.gerer');
  const etat = await etatDemo();
  const charge = etat.offres + etat.candidats + etat.employeurs > 0;

  return (
    <>
      <EnTetePage surtitre="Administration" titre="Jeu de démonstration">
        <p>Des données entièrement imaginaires, pour découvrir l’outil ou former un courtier sans toucher aux vraies fiches.</p>
      </EnTetePage>

      <Encart ton={charge ? 'attention' : 'info'} className="mb-5" titre={charge ? 'Le jeu de démonstration est chargé' : 'Aucune donnée fictive dans la base'}>
        {charge
          ? 'Tant qu’il est présent, un bandeau le rappelle sur toutes les pages et les chiffres du tableau de bord mélangent le fictif et le réel. Supprimez-le avant de travailler sur de vraies offres.'
          : 'Par défaut, l’outil ne contient que ce que vous y saisissez ou importez.'}
      </Encart>

      <div className="mb-6 grid grid-cols-3 gap-3 sm:max-w-xl">
        <Chiffre valeur={nombre(etat.offres)} libelle="Offres fictives" href={charge ? '/offres?statut=tous' : undefined} />
        <Chiffre valeur={nombre(etat.candidats)} libelle="Candidats fictifs" href={charge ? '/candidats' : undefined} />
        <Chiffre valeur={nombre(etat.employeurs)} libelle="Employeurs fictifs" href={charge ? '/employeurs' : undefined} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Carte titre="Ce que contient le jeu">
          <ul className="list-disc space-y-1.5 pl-5 text-[0.9rem]">
            <li>18 annonces inventées dans les trois secteurs (maison, beauté, hospitalité) — en français, plus une en arabe et une en anglais — dont : une offre urgente, un recrutement en nombre, une annonce à risque (frais demandés au candidat), une annonce trop ancienne (expirée, ou écartée si elle précède le début de la recherche), une offre sans date, un doublon exact et un doublon probable. Les dates de publication sont réparties entre le début de la recherche et aujourd’hui.</li>
            <li>8 candidats nommés « Candidat fictif n° … », sans téléphone ni e-mail.</li>
            <li>2 employeurs fictifs (une famille, un riad) avec leurs besoins, des rapprochements calculés, un placement confirmé et une commission encaissée.</li>
          </ul>
          <p className="mt-3 text-[0.84rem] text-encre-douce">Aucun site n’est consulté et aucun message n’est envoyé. Chaque fiche porte l’étiquette « Fictif » ; les fiches fictives ne peuvent pas être associées à des fiches réelles et ne déclenchent aucune alerte.</p>
        </Carte>

        <Carte titre={charge ? 'Retirer le jeu de démonstration' : 'Charger le jeu de démonstration'}>
          {charge ? (
            <>
              <p className="mb-3 text-[0.9rem]">Supprime les offres, candidats, employeurs, besoins, placements et commissions fictifs — et rien d’autre. Vos données réelles ne sont pas touchées.</p>
              <BoutonAction action={supprimerDemoAction} variante="danger" taille="normal" confirmer="Supprimer toutes les données fictives du jeu de démonstration ?">
                Supprimer le jeu de démonstration
              </BoutonAction>
            </>
          ) : (
            <>
              <p className="mb-3 text-[0.9rem]">Le chargement prend quelques secondes. Vous pourrez tout retirer d’un clic depuis cette page.</p>
              <BoutonAction action={chargerDemoAction} variante="primaire" taille="normal" icone="demo">
                Charger le jeu de démonstration
              </BoutonAction>
            </>
          )}
          <p className="mt-4 text-[0.82rem] text-encre-douce">
            Le chargement et la suppression sont consignés dans le{' '}
            <Link href="/administration/journal?entite=systeme" className="font-semibold text-marine-800 underline">
              journal d’audit
            </Link>
            .
          </p>
        </Carte>
      </div>
    </>
  );
}
