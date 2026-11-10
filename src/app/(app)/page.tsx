import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { dateLongue, echeance, pluriel } from '@/composants/format';
import { Icone, type NomIcone } from '@/composants/icones';
import { LigneOffre } from '@/composants/offres';
import { Badge, BadgeFictif, Carte, Chiffre, EnTetePage, Encart, LienBouton, TexteLibre, Vide } from '@/composants/ui';
import { nomVille } from '@/domaine/geographie';
import { libelleMetier } from '@/domaine/taxonomie';
import { listerCorrespondances } from '@/serveur/appariements';
import { listerEmployeurs } from '@/serveur/employeurs';
import { offresAVerifier, rechercherOffres } from '@/serveur/offres';
import { chargerParametres } from '@/serveur/parametres';
import { exigerSession } from '@/serveur/session-next';
import { aFaire } from '@/serveur/tableau-de-bord';

export const metadata: Metadata = { title: 'À faire aujourd’hui' };

function Etape({ numero, icone, titre, children }: { numero: number; icone: NomIcone; titre: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4 rounded-xl border border-sable-200 bg-white p-4 shadow-carte">
      <span className="chiffre grid size-10 shrink-0 place-items-center rounded-full bg-marine-900 text-[1.3rem] text-or-300">{numero}</span>
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-bold text-marine-900">
          <Icone nom={icone} className="size-4 text-or-600" />
          {titre}
        </p>
        <div className="mt-1 text-[0.9rem] text-encre-douce">{children}</div>
      </div>
    </li>
  );
}

export default async function PageAccueil({ searchParams }: { searchParams: Promise<{ refus?: string }> }) {
  const session = await exigerSession();
  const { refus } = await searchParams;
  const { utilisateur, peut } = session;
  const crm = peut('candidats.lire');
  const maintenant = new Date();
  const [compteurs, recentes, aVerifier, relances, suggestions, parametres] = await Promise.all([
    aFaire(utilisateur.id),
    rechercherOffres({ tri: 'date', parPage: 5, statut: 'actif' }),
    peut('offres.moderer') ? offresAVerifier(4) : Promise.resolve([]),
    crm ? listerEmployeurs({ relances: true }) : Promise.resolve(null),
    crm ? listerCorrespondances({ statuts: ['suggere'], limite: 5 }) : Promise.resolve([]),
    chargerParametres(),
  ]);
  const seuils = { modere: parametres.risque.seuilModere, eleve: parametres.risque.seuilEleve };
  const totalOffres = Object.values(recentes.parStatut).reduce((somme, n) => somme + n, 0);
  const prenom = utilisateur.full_name.split(/\s+/)[0];

  return (
    <>
      <EnTetePage surtitre={dateLongue(maintenant)} titre={`Bonjour ${prenom}`}>
        <p>Ce qui attend une décision aujourd’hui, puis les dernières offres actives.</p>
      </EnTetePage>

      {refus ? (
        <Encart ton="attention" className="mb-5" titre="Page réservée">
          Votre rôle ne donne pas accès à la page demandée. Adressez-vous à un administrateur si vous en avez besoin.
        </Encart>
      ) : null}

      <div className="mb-7 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {peut('offres.moderer') ? <Chiffre valeur={compteurs.aVerifier} libelle="Offres à vérifier" detail="date, lieu, risque ou doublon à confirmer" ton={compteurs.aVerifier ? 'or' : 'marine'} href="/offres?statut=tous&aVerifier=1" /> : null}
        {crm ? <Chiffre valeur={compteurs.relances} libelle="Relances employeurs" detail="échéance aujourd’hui ou dépassée" ton={compteurs.relances ? 'or' : 'marine'} href="/employeurs?relances=1" /> : null}
        {crm ? <Chiffre valeur={compteurs.suggestions} libelle="Candidats suggérés" detail="rapprochements à examiner" href="/besoins" /> : null}
        {crm ? <Chiffre valeur={compteurs.commissionsDues} libelle="Commissions à encaisser" detail="dues ou facturées" href="/commissions?statut=ouvertes" /> : null}
        <Chiffre valeur={compteurs.nonLues} libelle="Notifications non lues" detail="alertes et rappels" ton={compteurs.nonLues ? 'or' : 'marine'} href="/alertes" />
      </div>

      {totalOffres === 0 ? (
        <section className="mb-8">
          <h2 className="titre mb-1 text-[1.5rem] text-marine-900">La base ne contient encore aucune offre</h2>
          <p className="mb-4 max-w-3xl text-encre-douce">
            C’est normal après l’installation : l’outil n’invente aucune annonce et ne collecte rien sur un site tant qu’un administrateur n’a pas vérifié ses conditions d’utilisation. Trois façons de commencer :
          </p>
          <ol className="grid gap-3 lg:grid-cols-3">
            <Etape numero={1} icone="importer" titre="Coller une annonce">
              Copiez le texte d’une annonce (WhatsApp, Facebook, site d’emploi) : le métier, la ville, le salaire et les risques sont repérés automatiquement.
              {peut('offres.importer') ? (
                <p className="mt-2">
                  <Link href="/import" className="font-semibold text-marine-800 underline decoration-or-500 decoration-2 underline-offset-3">
                    Ajouter une offre
                  </Link>
                </p>
              ) : null}
            </Etape>
            <Etape numero={2} icone="sources" titre="Autoriser une source">
              Chaque site est décrit avec ses règles (robots.txt, conditions). La collecte automatique reste coupée jusqu’à une autorisation consignée.
              {peut('sources.gerer') ? (
                <p className="mt-2">
                  <Link href="/administration/sources" className="font-semibold text-marine-800 underline decoration-or-500 decoration-2 underline-offset-3">
                    Voir les sources
                  </Link>
                </p>
              ) : null}
            </Etape>
            <Etape numero={3} icone="demo" titre="Découvrir avec des exemples">
              Un jeu de démonstration (offres, candidats et employeurs inventés, marqués « FICTIF ») permet d’essayer l’outil, puis s’efface en un clic.
              {peut('parametres.gerer') ? (
                <p className="mt-2">
                  <Link href="/administration/demonstration" className="font-semibold text-marine-800 underline decoration-or-500 decoration-2 underline-offset-3">
                    Jeu de démonstration
                  </Link>
                </p>
              ) : null}
            </Etape>
          </ol>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {aVerifier.length > 0 ? (
            <Carte
              titre="À vérifier en priorité"
              sansMarge
              actions={
                <LienBouton href="/offres?statut=tous&aVerifier=1" taille="petit">
                  Tout voir ({compteurs.aVerifier})
                </LienBouton>
              }
            >
              <ul className="divide-y divide-sable-200">
                {aVerifier.map((offre) => (
                  <LigneOffre key={offre.id} offre={offre} seuils={seuils} maintenant={maintenant} />
                ))}
              </ul>
            </Carte>
          ) : null}

          {recentes.offres.length > 0 ? (
            <Carte
              titre="Dernières offres actives"
              sansMarge
              actions={
                <LienBouton href="/offres?tri=date" taille="petit">
                  Toutes les offres
                </LienBouton>
              }
            >
              <ul className="divide-y divide-sable-200">
                {recentes.offres.map((offre) => (
                  <LigneOffre key={offre.id} offre={offre} seuils={seuils} maintenant={maintenant} />
                ))}
              </ul>
            </Carte>
          ) : totalOffres > 0 ? (
            <Vide titre="Aucune offre active pour le moment">
              <p>{pluriel(totalOffres, 'offre')} en base, mais aucune n’est active : elles sont expirées, douteuses ou archivées.</p>
            </Vide>
          ) : null}
        </div>

        {crm ? (
          <div className="space-y-6">
            <Carte titre="Relances employeurs" sansMarge>
              {relances && relances.employeurs.length > 0 ? (
                <ul className="divide-y divide-sable-200">
                  {relances.employeurs.slice(0, 6).map((employeur) => {
                    const quand = echeance(employeur.next_follow_up_at, maintenant);
                    return (
                      <li key={employeur.id} className="relative flex items-center justify-between gap-3 px-4 py-3 hover:bg-sable-50 sm:px-5">
                        <div className="min-w-0">
                          <Link href={`/employeurs/${employeur.id}`} className="font-semibold text-marine-900 after:absolute after:inset-0 hover:underline">
                            <TexteLibre>{employeur.name}</TexteLibre>
                          </Link>
                          <p className="text-[0.8rem] text-encre-douce">
                            {employeur.reference}
                            {employeur.city_code ? ` · ${nomVille(employeur.city_code)}` : ''} {employeur.is_demo ? <BadgeFictif /> : null}
                          </p>
                        </div>
                        <Badge ton={quand.retard ? 'rouge' : 'or'}>{quand.texte}</Badge>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Aucune relance à faire. Les rappels apparaissent ici quand un échange est noté avec une « prochaine action ».</p>
              )}
            </Carte>

            <Carte titre="Candidats suggérés" sansMarge>
              {suggestions.length > 0 ? (
                <ul className="divide-y divide-sable-200">
                  {suggestions.map((s) => (
                    <li key={s.id} className="relative flex items-center justify-between gap-3 px-4 py-3 hover:bg-sable-50 sm:px-5">
                      <div className="min-w-0">
                        <Link href={s.employer_need_id ? `/besoins/${s.employer_need_id}` : `/offres/${s.job_offer_id}#candidats`} className="font-semibold text-marine-900 after:absolute after:inset-0 hover:underline">
                          {s.candidat_nom ?? s.candidat_reference}
                        </Link>
                        <p className="truncate text-[0.8rem] text-encre-douce">
                          {libelleMetier(s.candidat_metier)} › <TexteLibre>{s.besoin_titre ?? s.offre_titre}</TexteLibre>
                        </p>
                      </div>
                      <span className="chiffre text-[1.5rem] text-marine-900" title="Score d’adéquation sur 100">
                        {s.score}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Aucune suggestion en attente. Lancez « Chercher des candidats » depuis une offre ou un besoin d’employeur.</p>
              )}
            </Carte>
          </div>
        ) : null}
      </div>
    </>
  );
}
