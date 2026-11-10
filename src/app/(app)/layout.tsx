import Image from 'next/image';
import Link from '@/composants/lien';
import type { ReactNode } from 'react';
import { Icone } from '@/composants/icones';
import { LienNav, MenuMobile } from '@/composants/navigation';
import { initiales } from '@/composants/format';
import { ROLES } from '@/domaine/referentiels';
import { etatDemo } from '@/serveur/demo';
import { exigerSession, type Session } from '@/serveur/session-next';
import { aFaire } from '@/serveur/tableau-de-bord';
import { seDeconnecter } from '../connexion/actions';

type Compteurs = Awaited<ReturnType<typeof aFaire>>;

function Groupe({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 px-3 text-[0.66rem] font-bold uppercase tracking-[0.18em] text-marine-500">{titre}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Menu({ session, compteurs }: { session: Session; compteurs: Compteurs }) {
  const { peut } = session;
  return (
    <nav aria-label="Navigation principale" className="space-y-5">
      <Groupe titre="Veille">
        <LienNav href="/" icone="accueil" exact>
          À faire aujourd’hui
        </LienNav>
        <LienNav href="/offres" icone="offres" compteur={peut('offres.moderer') ? compteurs.aVerifier : undefined}>
          Offres
        </LienNav>
        {peut('offres.importer') ? (
          <LienNav href="/import" icone="importer">
            Ajouter des offres
          </LienNav>
        ) : null}
      </Groupe>
      {peut('candidats.lire') ? (
        <Groupe titre="Placement">
          <LienNav href="/candidats" icone="candidats">
            Candidats
          </LienNav>
          <LienNav href="/employeurs" icone="employeurs" compteur={compteurs.relances}>
            Employeurs
          </LienNav>
          <LienNav href="/besoins" icone="besoins" compteur={compteurs.suggestions}>
            Besoins
          </LienNav>
          <LienNav href="/placements" icone="placements">
            Placements
          </LienNav>
          <LienNav href="/commissions" icone="commissions" compteur={compteurs.commissionsDues}>
            Commissions
          </LienNav>
        </Groupe>
      ) : null}
      <Groupe titre="Suivi">
        <LienNav href="/alertes" icone="alertes" compteur={compteurs.nonLues}>
          Alertes
        </LienNav>
        <LienNav href="/tableau-de-bord" icone="tableau">
          Tableau de bord
        </LienNav>
      </Groupe>
      {peut('sources.gerer') ? (
        <Groupe titre="Administration">
          <LienNav href="/administration/sources" icone="sources">
            Sources et collecte
          </LienNav>
          <LienNav href="/administration/utilisateurs" icone="utilisateurs">
            Utilisateurs
          </LienNav>
          <LienNav href="/administration/parametres" icone="parametres">
            Paramètres
          </LienNav>
          <LienNav href="/administration/journal" icone="journal">
            Journal d’audit
          </LienNav>
          <LienNav href="/administration/demonstration" icone="demo">
            Jeu de démonstration
          </LienNav>
        </Groupe>
      ) : null}
    </nav>
  );
}

function Compte({ session }: { session: Session }) {
  const { utilisateur } = session;
  return (
    <div className="border-t border-marine-700 pt-3">
      <Link href="/compte" className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-marine-800">
        <span className="grid size-9 place-items-center rounded-full bg-or-500 text-[0.8rem] font-bold text-marine-950" aria-hidden="true">
          {initiales(utilisateur.full_name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[0.88rem] font-semibold text-white">{utilisateur.full_name}</span>
          <span className="block text-[0.74rem] text-marine-300">{ROLES.libelle(utilisateur.role_code)} · Mon compte</span>
        </span>
      </Link>
      <form action={seDeconnecter}>
        <button type="submit" className="mt-1 flex min-h-9 w-full items-center gap-3 rounded-lg px-3 text-[0.86rem] font-medium text-marine-200 hover:bg-marine-800 hover:text-white">
          <Icone nom="sortir" className="size-[1.1rem] text-marine-300" />
          Se déconnecter
        </button>
      </form>
    </div>
  );
}

function Marque() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <Image src="/marque/logo-128.png" alt="" width={36} height={36} className="rounded-full" unoptimized priority />
      <span>
        <span className="titre block text-[1.08rem] text-or-300">Yallah Services</span>
        <span className="block text-[0.66rem] font-bold uppercase tracking-[0.2em] text-marine-300">Job Radar</span>
      </span>
    </Link>
  );
}

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  const session = await exigerSession({ autoriserMotDePasseProvisoire: true });
  const [compteurs, demo] = await Promise.all([aFaire(session.utilisateur.id), etatDemo()]);
  const demoCharge = demo.offres + demo.candidats + demo.employeurs > 0;
  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[15.5rem_minmax(0,1fr)] print:block print:min-h-0">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-or-500 focus:px-3 focus:py-2 focus:font-semibold focus:text-marine-950">
        Aller au contenu
      </a>

      {/* Grand écran : barre latérale fixe */}
      <aside className="hors-impression sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto bg-marine-900 px-3 py-5 lg:flex">
        <div className="px-2">
          <Marque />
        </div>
        <div className="flex-1">
          <Menu session={session} compteurs={compteurs} />
        </div>
        <Compte session={session} />
      </aside>

      {/* Petit écran : bandeau + menu replié */}
      <div className="hors-impression sticky top-0 z-30 flex h-14 items-center justify-between bg-marine-900 px-3 lg:hidden">
        <Marque />
        <MenuMobile libelle="Menu">
          <Menu session={session} compteurs={compteurs} />
          <div className="mt-4">
            <Compte session={session} />
          </div>
        </MenuMobile>
      </div>

      <div className="min-w-0">
        {demoCharge ? (
          <div role="note" className="hors-impression flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-or-300 bg-or-100 px-4 py-2 text-[0.84rem] text-marine-900 sm:px-8">
            <Icone nom="demo" className="size-4 text-or-700" />
            <p className="min-w-0 flex-1">
              <strong>Jeu de démonstration chargé.</strong> {demo.offres} offres, {demo.candidats} candidats et {demo.employeurs} employeurs marqués « FICTIF » sont des exemples inventés : aucune annonce, personne ou
              entreprise réelle.
            </p>
            {session.peut('parametres.gerer') ? (
              <Link href="/administration/demonstration" className="font-semibold underline decoration-or-600 decoration-2 underline-offset-3">
                Gérer
              </Link>
            ) : null}
          </div>
        ) : null}
        <main id="contenu" className="mx-auto w-full max-w-[82rem] px-4 py-6 sm:px-8 sm:py-8 print:max-w-none print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
