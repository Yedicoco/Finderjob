'use client';

import Link from '@/composants/lien';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icone, type NomIcone } from './icones';

export function LienNav({ href, icone, children, compteur, exact = false }: { href: string; icone: NomIcone; children: ReactNode; compteur?: number; exact?: boolean }) {
  const chemin = usePathname();
  const actif = exact ? chemin === href : chemin === href || chemin.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={actif ? 'page' : undefined}
      className={`group flex min-h-10 items-center gap-3 rounded-lg px-3 text-[0.9rem] font-medium transition-colors ${
        actif ? 'bg-marine-700 text-white shadow-[inset_3px_0_0_var(--color-or-500)]' : 'text-marine-200 hover:bg-marine-800 hover:text-white'
      }`}
    >
      <Icone nom={icone} className={`size-[1.15rem] ${actif ? 'text-or-300' : 'text-marine-300 group-hover:text-or-300'}`} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {compteur ? (
        <span className="rounded-full bg-or-500 px-1.5 text-[0.72rem] font-bold leading-5 text-marine-950" aria-label={`${compteur} à traiter`}>
          {compteur > 99 ? '99+' : compteur}
        </span>
      ) : null}
    </Link>
  );
}

/** Menu replié des petits écrans : se referme à chaque changement de page. */
export function MenuMobile({ children, libelle }: { children: ReactNode; libelle: ReactNode }) {
  const chemin = usePathname();
  return (
    <details key={chemin} className="group lg:hidden">
      <summary className="flex min-h-11 list-none items-center gap-2 rounded-lg px-3 text-[0.9rem] font-semibold text-white hover:bg-marine-800">
        <Icone nom="menu" className="size-5 group-open:hidden" />
        <Icone nom="croix" className="hidden size-5 group-open:block" />
        {libelle}
      </summary>
      <div className="absolute inset-x-0 top-full z-40 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-marine-700 bg-marine-900 px-3 pt-2 pb-5 shadow-2xl">{children}</div>
    </details>
  );
}

/** Bouton « Imprimer » (reçus, tableau de bord). */
export function BoutonImprimer({ children = 'Imprimer', className }: { children?: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {children}
    </button>
  );
}
