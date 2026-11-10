import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { accord, dateCourte, dateHeure, dirhams, nombre, pluriel } from '@/composants/format';
import { BoutonImprimer } from '@/composants/navigation';
import { Badge, Carte, Chiffre, EnTetePage, Encart, Tableau, classesBouton, type Ton } from '@/composants/ui';
import { nomVille } from '@/domaine/geographie';
import { STATUTS_CANDIDAT, STATUTS_EMPLOYEUR, STATUTS_EXECUTION } from '@/domaine/referentiels';
import { libelleMetier, libelleSecteur } from '@/domaine/taxonomie';
import { exigerPermission } from '@/serveur/session-next';
import { tableauDeBord } from '@/serveur/tableau-de-bord';

export const metadata: Metadata = { title: 'Tableau de bord' };

const MOTIFS_REJET: Record<string, string> = {
  hors_maroc: 'Poste hors du Maroc',
  hors_taxonomie: 'Métier hors des trois secteurs',
  contenu_vide: 'Annonce vide ou illisible',
  robots_interdit: 'Page interdite par robots.txt',
  erreur_extraction: 'Lecture impossible',
  doublon_exact: 'Déjà enregistrée (copie exacte)',
};
const TON_EXECUTION: Record<string, Ton> = { succes: 'vert', partiel: 'ambre', echec: 'rouge', en_cours: 'marine', ignore: 'neutre' };
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libelleMois = (cle: string): string => `${MOIS[Number(cle.slice(5, 7)) - 1] ?? cle} ${cle.slice(0, 4)}`;

/** Barres horizontales : chaque ligne porte son libellé et sa valeur en clair (aucune information n'est portée par la seule couleur). */
function Barres({ lignes, vide, couleur = 'bg-marine-700' }: { lignes: { cle: string; libelle: React.ReactNode; valeur: number; detail?: React.ReactNode }[]; vide: string; couleur?: string }) {
  const max = Math.max(1, ...lignes.map((ligne) => ligne.valeur));
  if (lignes.length === 0 || lignes.every((ligne) => ligne.valeur === 0)) return <p className="text-[0.88rem] text-encre-douce">{vide}</p>;
  return (
    <ul className="space-y-2.5">
      {lignes.map((ligne) => (
        <li key={ligne.cle} className="grid grid-cols-[minmax(0,13rem)_minmax(3rem,1fr)_auto] items-center gap-3 text-[0.88rem]">
          <span className="leading-snug text-marine-900">{ligne.libelle}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-sable-200" aria-hidden="true">
            <span className={`block h-full rounded-full ${couleur}`} style={{ width: ligne.valeur > 0 ? `${Math.max(2, Math.round((ligne.valeur / max) * 100))}%` : 0 }} />
          </span>
          <span className="text-right font-semibold tabular-nums text-marine-900">
            {nombre(ligne.valeur)}
            {ligne.detail ? <span className="ml-1.5 font-normal text-encre-douce">{ligne.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function PageTableauDeBord() {
  const session = await exigerPermission('tableau.lire');
  const t = await tableauDeBord();
  const maxJour = Math.max(1, ...t.parJour.map((jour) => jour.n));
  const total30j = t.parJour.reduce((somme, jour) => somme + jour.n, 0);
  const tension = t.tension.filter((ligne) => ligne.offres > ligne.candidats);
  const voirArgent = session.peut('placements.lire');
  // Un lecteur voit les chiffres agrégés, mais aucun lien vers des fiches qu'il ne peut pas ouvrir.
  const voirCrm = session.peut('candidats.lire');

  return (
    <>
      <EnTetePage
        surtitre="Suivi"
        titre="Tableau de bord"
        actions={
          <>
            <BoutonImprimer className={classesBouton('secondaire')}>Imprimer</BoutonImprimer>
            {session.peut('exports.creer') ? (
              <a href="/api/exports/offres" className={classesBouton('secondaire')}>
                Exporter les offres (CSV)
              </a>
            ) : null}
          </>
        }
      >
        <p>État au {dateHeure(new Date())}. Les offres comptées sont des annonces repérées et vérifiables, pas un recensement du marché.</p>
      </EnTetePage>

      {t.offres.fictives > 0 ? (
        <Encart ton="attention" className="mb-5" titre="Chiffres mêlés de données fictives">
          Les {nombre(t.offres.fictives)} offres du jeu de démonstration, avec ses candidats, employeurs et placements inventés, sont comptées dans les nombres ci-dessous. Seuls les montants de commissions
          ne contiennent jamais de donnée fictive. Retirez le jeu de démonstration (Administration › Jeu de démonstration) avant d’utiliser ces chiffres.
        </Encart>
      ) : null}

      <section aria-label="Offres" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Chiffre valeur={nombre(t.offres.actives)} libelle="Offres actives" detail={`${pluriel(t.offres.nouvelles7j, 'repérée')} depuis 7 jours`} href="/offres" />
        <Chiffre valeur={nombre(t.offres.aVerifier)} libelle="À vérifier" detail={pluriel(t.offres.douteuses, 'douteuse')} ton={t.offres.aVerifier > 0 ? 'or' : 'marine'} href="/offres?statut=tous&aVerifier=1" />
        <Chiffre valeur={nombre(t.offres.urgentes)} libelle="Urgentes" detail={`${pluriel(t.offres.massives, 'recrutement')} en nombre`} href="/offres?urgent=1" />
        <Chiffre valeur={nombre(t.offres.expirees)} libelle="Expirées" detail={pluriel(t.offres.archivees, 'archivée')} href="/offres?statut=expire" />
      </section>

      <section aria-label="Placement" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Chiffre valeur={nombre(t.candidats.disponibles)} libelle="Candidats disponibles" detail={`${pluriel(t.candidats.total, 'fiche')} · ${pluriel(t.candidats.places, 'placé')}`} href={voirCrm ? '/candidats' : undefined} />
        <Chiffre valeur={nombre(t.employeurs.besoinsOuverts)} libelle="Besoins ouverts" detail={`${pluriel(t.employeurs.postesOuverts, 'poste')} · ${pluriel(t.employeurs.total, 'employeur')}`} href={voirCrm ? '/besoins' : undefined} />
        <Chiffre valeur={nombre(t.placements.enCours)} libelle="Placements en cours" detail={`${nombre(t.placements.total)} au total`} ton="vert" href={voirCrm ? '/placements' : undefined} />
        {voirArgent ? (
          <Chiffre valeur={dirhams(t.commissions.encaisse)} libelle="Commissions encaissées" detail={`${dirhams(t.commissions.du + t.commissions.facture)} à encaisser`} ton="vert" href="/commissions" />
        ) : (
          <Chiffre valeur={nombre(t.appariements.proposes)} libelle="Candidats en cours de proposition" detail={`${pluriel(t.appariements.suggeres, 'suggestion')} à examiner`} />
        )}
      </section>

      {t.commissions.nombreTravailleur > 0 ? (
        <Encart ton="danger" className="mb-6" titre="Commissions à la charge de travailleurs">
          {pluriel(t.commissions.nombreTravailleur, 'commission')} {accord(t.commissions.nombreTravailleur, 'facturée')} à des travailleurs, pour {dirhams(t.commissions.parPayeur.travailleur)}. Cette pratique est en principe interdite aux agences de recrutement privées (article 480 du Code du travail) : faites-la valider par votre conseil juridique.
        </Encart>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Carte titre="Offres repérées par jour (30 derniers jours)">
          {total30j === 0 ? (
            <p className="text-[0.88rem] text-encre-douce">Aucune offre enregistrée sur la période.</p>
          ) : (
            <>
              <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={`${nombre(total30j)} offres repérées en 30 jours ; maximum ${nombre(maxJour)} en une journée.`}>
                {t.parJour.map((jour) => (
                  <span key={jour.jour} title={`${dateCourte(jour.jour)} : ${jour.n}`} className={`flex-1 rounded-t ${jour.n ? 'bg-marine-700' : 'bg-sable-200'}`} style={{ height: `${jour.n ? Math.max(6, Math.round((jour.n / maxJour) * 100)) : 2}%` }} />
                ))}
              </div>
              <p className="mt-2 flex justify-between gap-3 text-[0.76rem] text-encre-douce">
                <span>{dateCourte(t.parJour[0]?.jour)}</span>
                <span>{dateCourte(t.parJour.at(-1)?.jour)}</span>
              </p>
              <p className="mt-2 text-[0.82rem] text-encre">
                <strong className="text-marine-900">{pluriel(total30j, 'offre')}</strong> en 30 jours · jusqu’à {nombre(maxJour)} en une journée.
              </p>
              <p className="mt-1 text-[0.76rem] text-encre-douce">Date à laquelle l’outil a enregistré l’offre, pas sa date de publication.</p>
            </>
          )}
        </Carte>

        <Carte titre="Offres actives par secteur">
          <Barres vide="Aucune offre active." couleur="bg-or-500" lignes={t.parSecteur.map((ligne) => ({ cle: ligne.code, libelle: <Link href={`/offres?secteur=${ligne.code}`}>{libelleSecteur(ligne.code)}</Link>, valeur: ligne.n }))} />
        </Carte>

        <Carte titre="Offres actives par ville">
          <Barres
            vide="Aucune offre active."
            lignes={t.parVille.map((ligne) => ({ cle: ligne.code ?? 'inconnue', libelle: ligne.code ? <Link href={`/offres?ville=${ligne.code}`}>{nomVille(ligne.code)}</Link> : 'Ville non identifiée', valeur: ligne.n }))}
          />
        </Carte>

        <Carte titre="Métiers les plus demandés">
          <Barres
            vide="Aucune offre active."
            lignes={t.parMetier.map((ligne) => ({ cle: ligne.code, libelle: <Link href={`/offres?metier=${ligne.code}`}>{libelleMetier(ligne.code)}</Link>, valeur: ligne.n, detail: `· ${pluriel(ligne.candidats, 'candidat')}` }))}
          />
          <p className="mt-3 text-[0.76rem] text-encre-douce">À droite : candidats disponibles du vivier pour ce métier.</p>
        </Carte>

        <Carte titre="Où il manque des candidats" sansMarge>
          {tension.length > 0 ? (
            <Tableau entetes={['Métier', 'Ville', 'Offres', 'Candidats']}>
              {tension.map((ligne) => (
                <tr key={`${ligne.metier}-${ligne.ville}`}>
                  <td className="font-semibold text-marine-900">{libelleMetier(ligne.metier)}</td>
                  <td>{ligne.ville ? nomVille(ligne.ville) : 'Non identifiée'}</td>
                  <td className="tabular-nums">{ligne.offres}</td>
                  <td className="tabular-nums">{ligne.candidats === 0 ? <Badge ton="rouge">Aucun</Badge> : ligne.candidats}</td>
                </tr>
              ))}
            </Tableau>
          ) : (
            <p className="px-5 py-6 text-[0.88rem] text-encre-douce">Aucun déséquilibre : chaque métier demandé a au moins autant de candidats disponibles que d’offres.</p>
          )}
        </Carte>

        <Carte titre="Placements par mois (6 derniers mois)">
          <Barres vide="Aucun placement sur la période." couleur="bg-vert-600" lignes={t.placements.parMois.map((ligne) => ({ cle: ligne.mois, libelle: libelleMois(ligne.mois), valeur: ligne.n }))} />
        </Carte>

        <Carte titre="Candidats par statut">
          <Barres
            vide="Aucun candidat enregistré."
            lignes={STATUTS_CANDIDAT.codes.map((code) => ({ cle: code, libelle: voirCrm ? <Link href={`/candidats?statut=${code}`}>{STATUTS_CANDIDAT.libelle(code)}</Link> : STATUTS_CANDIDAT.libelle(code), valeur: t.candidats.parStatut.find((ligne) => ligne.statut === code)?.n ?? 0 }))}
          />
          {t.candidats.finConservation30j > 0 ? (
            <p className="mt-3 text-[0.82rem] text-ambre-800">{t.candidats.finConservation30j > 1
                ? `${nombre(t.candidats.finConservation30j)} fiches arrivent en fin de conservation dans les 30 jours : elles seront anonymisées sans nouvelle activité.`
                : 'Une fiche arrive en fin de conservation dans les 30 jours : elle sera anonymisée sans nouvelle activité.'}</p>
          ) : null}
        </Carte>

        <Carte titre="Employeurs par étape">
          <Barres
            vide="Aucun employeur enregistré."
            couleur="bg-or-500"
            lignes={STATUTS_EMPLOYEUR.codes.map((code) => ({ cle: code, libelle: voirCrm ? <Link href={`/employeurs?statut=${code}`}>{STATUTS_EMPLOYEUR.libelle(code)}</Link> : STATUTS_EMPLOYEUR.libelle(code), valeur: t.employeurs.parStatut.find((ligne) => ligne.statut === code)?.n ?? 0 }))}
          />
          {t.employeurs.relancesDues > 0 && voirCrm ? (
            <p className="mt-3 text-[0.82rem]">
              <Link href="/employeurs?relances=1" className="font-semibold text-marine-800 underline">
                {pluriel(t.employeurs.relancesDues, 'relance')} à faire
              </Link>
            </p>
          ) : null}
        </Carte>

        <Carte titre="Offres par source" sansMarge>
          {t.parSource.length > 0 ? (
            <Tableau entetes={['Source', 'Actives', 'Total enregistré']}>
              {t.parSource.map((ligne) => (
                <tr key={ligne.code}>
                  <td className="font-semibold text-marine-900">
                    <Link href={`/offres?statut=tous&source=${ligne.code}`} className="hover:underline">
                      {ligne.nom}
                    </Link>
                  </td>
                  <td className="tabular-nums">{nombre(ligne.actives)}</td>
                  <td className="tabular-nums">{nombre(ligne.total)}</td>
                </tr>
              ))}
            </Tableau>
          ) : (
            <p className="px-5 py-6 text-[0.88rem] text-encre-douce">Aucune offre enregistrée.</p>
          )}
        </Carte>

        <Carte titre="Collecte" sansMarge>
          <p className="px-4 pt-4 text-[0.88rem] text-encre-douce sm:px-5">
            {t.collecte.sourcesActives === 0
              ? 'Aucune collecte automatique n’est activée : les offres entrent par saisie, annonce confiée ou fichier.'
              : `${pluriel(t.collecte.sourcesActives, 'source')} ${accord(t.collecte.sourcesActives, 'collectée')} automatiquement${t.collecte.sourcesEnPause ? `, dont ${nombre(t.collecte.sourcesEnPause)} en pause après des erreurs` : ''}.`}{' '}
            {session.peut('sources.gerer') ? (
              <Link href="/administration/sources" className="font-semibold text-marine-800 underline">
                Gérer les sources
              </Link>
            ) : null}
          </p>
          {t.collecte.dernieresExecutions.length > 0 ? (
            <Tableau entetes={['Dernières collectes', 'Résultat', 'Nouvelles', 'Écartées']} className="mt-2">
              {t.collecte.dernieresExecutions.map((execution) => (
                <tr key={execution.id}>
                  <td>
                    <span className="font-semibold text-marine-900">{execution.source}</span>
                    <span className="block text-[0.78rem] text-encre-douce">{dateHeure(execution.debut)}</span>
                  </td>
                  <td>
                    <Badge ton={TON_EXECUTION[execution.statut] ?? 'neutre'}>{STATUTS_EXECUTION.libelle(execution.statut)}</Badge>
                    {execution.message ? <span className="mt-0.5 block max-w-64 text-[0.76rem] text-encre-douce">{execution.message}</span> : null}
                  </td>
                  <td className="tabular-nums">{execution.nouvelles}</td>
                  <td className="tabular-nums">{execution.rejetees}</td>
                </tr>
              ))}
            </Tableau>
          ) : (
            <p className="px-4 py-4 text-[0.88rem] text-encre-douce sm:px-5">Aucune collecte exécutée.</p>
          )}
          {t.collecte.rejets30j.length > 0 ? (
            <div className="border-t border-sable-200 px-4 py-4 sm:px-5">
              <p className="mb-2 text-[0.82rem] font-semibold text-marine-900">Annonces écartées depuis 30 jours</p>
              <Barres vide="" couleur="bg-sable-400" lignes={t.collecte.rejets30j.map((ligne) => ({ cle: ligne.motif, libelle: MOTIFS_REJET[ligne.motif] ?? ligne.motif, valeur: ligne.n }))} />
            </div>
          ) : null}
        </Carte>
      </div>
    </>
  );
}
