import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { LigneCommission } from '@/composants/commissions';
import { dirhams, pluriel } from '@/composants/format';
import { un, type ParametresAdresse } from '@/composants/requete';
import { Carte, Champ, Chiffre, EnTetePage, Encart, Selection, Vide, classesBouton } from '@/composants/ui';
import { totaliser } from '@/domaine/commissions';
import { STATUTS_COMMISSION } from '@/domaine/referentiels';
import { commissionsReelles, listerCommissions } from '@/serveur/placements';
import { exigerPermission } from '@/serveur/session-next';

export const metadata: Metadata = { title: 'Commissions' };

const estDate = (valeur: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(valeur) && !Number.isNaN(Date.parse(valeur));

export default async function PageCommissions({ searchParams }: { searchParams: Promise<ParametresAdresse> }) {
  const session = await exigerPermission('placements.lire');
  const p = await searchParams;
  const statut = un(p.statut) === 'ouvertes' || STATUTS_COMMISSION.est(un(p.statut)) ? un(p.statut) : '';
  const depuis = estDate(un(p.depuis)) ? un(p.depuis) : undefined;
  const jusque = estDate(un(p.jusque)) ? un(p.jusque) : undefined;
  // Les totaux portent sur toute la période ; le filtre de statut ne restreint que la liste.
  const toutes = await listerCommissions({ depuis, jusque });
  // Les commissions du jeu de démonstration restent visibles dans la liste, mais n'entrent dans aucun total.
  const totaux = totaliser(commissionsReelles(toutes));
  const fictives = toutes.length - commissionsReelles(toutes).length;
  const commissions = toutes.filter((commission) => (statut === 'ouvertes' ? commission.status === 'du' || commission.status === 'facture' : statut ? commission.status === statut : true));
  const filtre = Boolean(statut || depuis || jusque);

  return (
    <>
      <EnTetePage surtitre="Placement" titre="Commissions">
        <p>Les frais de placement dus par les employeurs, de la création à l’encaissement. Les montants annulés ne sont comptés nulle part.</p>
      </EnTetePage>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Chiffre valeur={dirhams(totaux.du)} libelle="Dû" detail="à facturer ou à encaisser" ton={totaux.du > 0 ? 'or' : 'marine'} />
        <Chiffre valeur={dirhams(totaux.facture)} libelle="Facturé" detail="en attente de paiement" />
        <Chiffre valeur={dirhams(totaux.encaisse)} libelle="Encaissé" detail={depuis || jusque ? 'sur la période choisie' : 'depuis le début'} ton="vert" />
        <Chiffre valeur={dirhams(totaux.annule)} libelle="Annulé" detail="pour mémoire" />
      </div>

      {fictives > 0 ? (
        <Encart ton="info" className="mb-5" titre="Les totaux ne comptent que les commissions réelles">
          {pluriel(fictives, 'commission')} du jeu de démonstration {fictives > 1 ? 'apparaissent' : 'apparaît'} dans la liste avec la mention « Fictif » ; {fictives > 1 ? 'leurs montants ne sont' : 'son montant n’est'} additionné{fictives > 1 ? 's' : ''} nulle part.
        </Encart>
      ) : null}

      {totaux.parPayeur.travailleur > 0 ? (
        <Encart ton="danger" className="mb-5" titre={`${dirhams(totaux.parPayeur.travailleur)} à la charge de travailleurs`}>
          Des commissions côté travailleur existent sur cette période. Chacune porte sa justification et figure au journal d’audit ; faites-les valider par votre conseil juridique (article 480 du Code du travail).
        </Encart>
      ) : null}

      <Carte className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
          <Champ libelle="Statut">
            <Selection name="statut" defaultValue={statut} vide="Toutes" options={[{ valeur: 'ouvertes', libelle: 'À encaisser (dues et facturées)' }, ...STATUTS_COMMISSION.options]} />
          </Champ>
          <Champ libelle="Créées depuis le">
            <input className="champ" type="date" name="depuis" defaultValue={depuis ?? ''} />
          </Champ>
          <Champ libelle="Jusqu’au">
            <input className="champ" type="date" name="jusque" defaultValue={jusque ?? ''} />
          </Champ>
          <div className="flex gap-2">
            <button type="submit" className={classesBouton('primaire')}>
              Filtrer
            </button>
            {filtre ? (
              <Link href="/commissions" className={classesBouton('secondaire')}>
                Effacer
              </Link>
            ) : null}
          </div>
        </form>
      </Carte>

      {commissions.length === 0 ? (
        <Vide titre={filtre ? 'Aucune commission ne correspond' : 'Aucune commission enregistrée'}>
          <p>Une commission est créée à l’enregistrement d’un placement (formule Premium, Sérénité ou sur mesure), ou ajoutée depuis la fiche du placement.</p>
        </Vide>
      ) : (
        <Carte sansMarge titre={pluriel(commissions.length, 'commission')}>
          <ul className="divide-y divide-sable-200">
            {commissions.map((commission) => (
              <LigneCommission key={commission.id} commission={commission} peutAgir={session.peut('placements.gerer')} avecPlacement />
            ))}
          </ul>
        </Carte>
      )}
    </>
  );
}
