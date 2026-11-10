import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { Icone } from '@/composants/icones';
import { Champ } from '@/composants/ui';
import { jourEcritMaroc } from '@/domaine/fuseau';
import { chargerParametres } from '@/serveur/parametres';
import { sessionCourante } from '@/serveur/session-next';
import { seConnecter } from './actions';

export const metadata: Metadata = { title: 'Connexion' };

export default async function PageConnexion({ searchParams }: { searchParams: Promise<{ suite?: string }> }) {
  if (await sessionCourante()) redirect('/');
  const { suite } = await searchParams;
  const debutRecherche = jourEcritMaroc(new Date((await chargerParametres()).perimetre.dateMin));
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section className="relative flex flex-col justify-between overflow-hidden bg-marine-900 px-6 py-8 text-marine-200 sm:px-10 lg:px-14 lg:py-12">
        {/* Balayage de radar : motif de marque, purement décoratif */}
        <svg viewBox="0 0 600 600" aria-hidden="true" className="pointer-events-none absolute -right-40 -bottom-48 size-[42rem] text-or-500/25 lg:-right-24">
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="300" cy="300" r="90" />
            <circle cx="300" cy="300" r="170" />
            <circle cx="300" cy="300" r="250" />
            <path d="M300 50v500M50 300h500" />
          </g>
          <path d="M300 300 476 124A250 250 0 0 1 550 300Z" fill="currentColor" opacity="0.35" />
          <circle cx="408" cy="236" r="6" fill="#e9d493" />
          <circle cx="232" cy="398" r="4" fill="#e9d493" opacity="0.7" />
          <circle cx="352" cy="436" r="4" fill="#e9d493" opacity="0.5" />
        </svg>
        <div className="relative flex items-center gap-3">
          <Image src="/marque/logo-128.png" alt="" width={48} height={48} priority unoptimized className="rounded-full" />
          <div>
            <p className="titre text-[1.35rem] text-or-300">Yallah Services</p>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-marine-300">Job Radar · outil interne</p>
          </div>
        </div>
        <div className="relative my-10 max-w-xl">
          <h1 className="titre text-[2.6rem] text-white sm:text-[3.4rem]">
            Les offres du Maroc,
            <br />
            <span className="text-or-300">vérifiées avant d’être proposées.</span>
          </h1>
          <ul className="mt-7 space-y-3 text-[0.98rem]">
            {[
              `Personnel de maison, beauté et hospitalité — annonces publiées depuis le ${debutRecherche}.`,
              'Chaque offre garde sa source, sa date et son niveau de risque.',
              'Candidats, employeurs, placements et commissions au même endroit.',
            ].map((ligne) => (
              <li key={ligne} className="flex gap-3">
                <Icone nom="coche" className="mt-1 size-4 text-or-500" />
                <span>{ligne}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[0.78rem] text-marine-300">Accès réservé à l’équipe Yallah Services. Chaque connexion et chaque consultation de coordonnées sont journalisées.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <h2 className="titre text-[1.9rem] text-marine-900">Connexion</h2>
          <p className="mt-1 mb-6 text-encre-douce">Identifiez-vous avec le compte créé par votre administrateur.</p>
          <Formulaire action={seConnecter} className="space-y-4">
            <input type="hidden" name="suite" value={suite ?? '/'} />
            <Champ libelle="Adresse e-mail">
              <input className="champ" type="email" name="email" autoComplete="username" required autoFocus inputMode="email" />
            </Champ>
            <Champ libelle="Mot de passe">
              <input className="champ" type="password" name="motDePasse" autoComplete="current-password" required />
            </Champ>
            <BoutonEnvoi variante="primaire" className="w-full" enCours="Vérification…">
              Se connecter
            </BoutonEnvoi>
          </Formulaire>
          <p className="mt-6 text-[0.8rem] leading-relaxed text-encre-douce">
            Mot de passe oublié ? Un administrateur peut vous en attribuer un nouveau, provisoire, depuis « Administration › Utilisateurs ».
          </p>
        </div>
      </section>
    </main>
  );
}
