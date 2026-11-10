/** Composants d'interface partagés (sans état : utilisables côté serveur). */
import Link from '@/composants/lien';
import type { ComponentProps, ReactNode } from 'react';
import { Icone, type NomIcone } from './icones';

export const cx = (...classes: (string | false | null | undefined)[]): string => classes.filter(Boolean).join(' ');

// ------------------------------------------------------------------ boutons --

type Variante = 'primaire' | 'or' | 'secondaire' | 'danger' | 'discret';
type Taille = 'normal' | 'petit';

const VARIANTES: Record<Variante, string> = {
  primaire: 'bg-marine-900 text-white hover:bg-marine-700 active:bg-marine-950',
  or: 'bg-or-500 text-marine-950 hover:bg-or-300 active:bg-or-600',
  secondaire: 'bg-white text-marine-900 border border-sable-300 hover:border-marine-300 hover:bg-marine-50',
  danger: 'bg-white text-rouge-700 border border-rouge-100 hover:bg-rouge-50 hover:border-rouge-600',
  discret: 'text-marine-700 hover:bg-marine-100',
};

export function classesBouton(variante: Variante = 'secondaire', taille: Taille = 'normal'): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors select-none disabled:opacity-55 disabled:cursor-not-allowed whitespace-nowrap',
    taille === 'petit' ? 'min-h-8 px-2.5 text-[0.82rem]' : 'min-h-10 px-4 text-[0.92rem]',
    VARIANTES[variante],
  );
}

export function LienBouton({ variante, taille, icone, children, className, ...reste }: ComponentProps<typeof Link> & { variante?: Variante; taille?: Taille; icone?: NomIcone }) {
  return (
    <Link {...reste} className={cx(classesBouton(variante, taille), className)}>
      {icone ? <Icone nom={icone} className="size-4" /> : null}
      {children}
    </Link>
  );
}

/** Lien vers un site tiers : nouvel onglet, sans référent ni accès à la fenêtre d'origine. */
export function LienExterne({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const sur = /^https?:\/\//i.test(href);
  if (!sur) return <span className={className}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={cx('inline-flex items-center gap-1.5 underline decoration-or-500 decoration-2 underline-offset-3 hover:text-marine-600', className)}>
      {children}
      <Icone nom="externe" className="size-3.5" />
    </a>
  );
}

// -------------------------------------------------------------------- pages --

export function EnTetePage({ surtitre, titre, children, actions }: { surtitre?: ReactNode; titre: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {surtitre ? <p className="mb-1 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-or-700">{surtitre}</p> : null}
        <h1 className="titre text-[2rem] text-marine-900 sm:text-[2.4rem]">{titre}</h1>
        {children ? <div className="mt-2 max-w-3xl text-encre-douce">{children}</div> : null}
      </div>
      {actions ? <div className="hors-impression flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Carte({ titre, actions, children, className, sansMarge = false, id }: { titre?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; sansMarge?: boolean; id?: string }) {
  return (
    <section id={id} className={cx('min-w-0 rounded-xl border border-sable-200 bg-white shadow-carte', className)}>
      {titre || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sable-200 px-4 py-3 sm:px-5">
          {titre ? <h2 className="titre text-[1.15rem] text-marine-900">{titre}</h2> : <span />}
          {actions ? <div className="hors-impression flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={sansMarge ? '' : 'p-4 sm:p-5'}>{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------- badges --

export type Ton = 'neutre' | 'vert' | 'ambre' | 'rouge' | 'or' | 'marine';

const TONS: Record<Ton, string> = {
  neutre: 'bg-sable-100 text-encre-douce ring-sable-300',
  vert: 'bg-vert-50 text-vert-800 ring-vert-100',
  ambre: 'bg-ambre-50 text-ambre-800 ring-ambre-100',
  rouge: 'bg-rouge-50 text-rouge-700 ring-rouge-100',
  or: 'bg-or-100 text-or-700 ring-or-300',
  marine: 'bg-marine-100 text-marine-800 ring-marine-200',
};

export function Badge({ ton = 'neutre', children, titre, className }: { ton?: Ton; children: ReactNode; titre?: string; className?: string }) {
  return (
    <span title={titre} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.74rem] font-semibold leading-5 ring-1 ring-inset whitespace-nowrap', TONS[ton], className)}>
      {children}
    </span>
  );
}

/** Donnée d'exemple : le mot est toujours écrit en clair, jamais suggéré par une couleur seule. */
export function BadgeFictif() {
  return (
    <span className="inline-flex items-center rounded-sm bg-marine-900 px-1.5 py-0.5 text-[0.66rem] font-bold uppercase tracking-[0.12em] text-or-300 print:border print:border-marine-900 print:bg-transparent print:text-marine-900" title="Donnée du jeu de démonstration : elle ne correspond à aucune annonce, personne ou entreprise réelle.">
      Fictif
    </span>
  );
}

/** Score de 0 à 100 : nombre + jauge. La couleur double l'information, elle ne la porte pas seule. */
export function Jauge({ valeur, libelle, inverse = false, compact = false }: { valeur: number | null | undefined; libelle: string; inverse?: boolean; compact?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(valeur ?? 0)));
  const bon = inverse ? v < 25 : v >= 70;
  const moyen = inverse ? v < 50 : v >= 45;
  const couleur = valeur == null ? 'fill-sable-300' : bon ? 'fill-vert-600' : moyen ? 'fill-or-500' : inverse ? 'fill-rouge-600' : 'fill-marine-300';
  return (
    <div className={cx('min-w-0', compact ? 'w-20' : 'w-full')}>
      <div className="flex items-baseline justify-between gap-2 text-[0.74rem] text-encre-douce">
        <span className="truncate">{libelle}</span>
        <span className="font-bold text-marine-900">{valeur == null ? '—' : v}</span>
      </div>
      <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-1 block h-1.5 w-full" role="img" aria-label={`${libelle} : ${valeur == null ? 'non calculé' : `${v} sur 100`}`}>
        <rect width="100" height="6" rx="3" className="fill-sable-200" />
        <rect width={v} height="6" rx="3" className={couleur} />
      </svg>
    </div>
  );
}

// ----------------------------------------------------------------- messages --

const ENCARTS: Record<'info' | 'attention' | 'danger' | 'succes', { classes: string; icone: NomIcone }> = {
  info: { classes: 'border-marine-200 bg-marine-50 text-marine-900', icone: 'info' },
  attention: { classes: 'border-ambre-100 bg-ambre-50 text-ambre-800', icone: 'attention' },
  danger: { classes: 'border-rouge-100 bg-rouge-50 text-rouge-700', icone: 'attention' },
  succes: { classes: 'border-vert-100 bg-vert-50 text-vert-800', icone: 'coche' },
};

export function Encart({ ton = 'info', titre, children, className }: { ton?: keyof typeof ENCARTS; titre?: ReactNode; children?: ReactNode; className?: string }) {
  const style = ENCARTS[ton];
  return (
    <div role={ton === 'danger' ? 'alert' : 'note'} className={cx('flex gap-3 rounded-lg border px-3.5 py-3 text-[0.9rem]', style.classes, className)}>
      <Icone nom={style.icone} className="mt-0.5 size-4.5" />
      <div className="min-w-0 space-y-1">
        {titre ? <p className="font-bold">{titre}</p> : null}
        {children ? <div className="[&_a]:underline">{children}</div> : null}
      </div>
    </div>
  );
}

export function Vide({ titre, children, action }: { titre: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-sable-300 bg-white/60 px-6 py-10 text-center">
      <p className="titre text-[1.2rem] text-marine-900">{titre}</p>
      {children ? <div className="mx-auto mt-2 max-w-xl text-encre-douce">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

// -------------------------------------------------------------- formulaires --

export function Champ({ libelle, aide, children, className, obligatoire = false }: { libelle: ReactNode; aide?: ReactNode; children: ReactNode; className?: string; obligatoire?: boolean }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[0.82rem] font-semibold text-marine-900">
        {libelle}
        {obligatoire ? <span className="text-rouge-600" aria-hidden="true"> *</span> : null}
      </span>
      {children}
      {aide ? <span className="mt-1 block text-[0.78rem] leading-snug text-encre-douce">{aide}</span> : null}
    </label>
  );
}

export type Option = { valeur: string; libelle: string };

export function Selection({ options, vide, className, ...reste }: ComponentProps<'select'> & { options: readonly Option[]; vide?: string }) {
  return (
    <select {...reste} className={cx('champ', className)}>
      {vide !== undefined ? <option value="">{vide}</option> : null}
      {options.map((option) => (
        <option key={option.valeur} value={option.valeur}>
          {option.libelle}
        </option>
      ))}
    </select>
  );
}

/** Groupe de cases à cocher portant le même nom (langues, compétences…). */
export function Cases({ nom, options, selection = [], colonnes = 'sm:grid-cols-3' }: { nom: string; options: readonly Option[]; selection?: readonly string[]; colonnes?: string }) {
  return (
    <div className={cx('grid grid-cols-2 gap-x-4 gap-y-1.5', colonnes)}>
      {options.map((option) => (
        <label key={option.valeur} className="flex min-h-8 items-center gap-2 text-[0.9rem]">
          <input type="checkbox" name={nom} value={option.valeur} defaultChecked={selection.includes(option.valeur)} className="size-4 accent-marine-900" />
          {option.libelle}
        </label>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ données --

export function Definitions({ children, colonnes = 'sm:grid-cols-2' }: { children: ReactNode; colonnes?: string }) {
  return <dl className={cx('grid grid-cols-1 gap-x-6 gap-y-3', colonnes)}>{children}</dl>;
}

export function Definition({ terme, children }: { terme: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.74rem] font-semibold uppercase tracking-wide text-encre-douce">{terme}</dt>
      <dd className="mt-0.5 break-words text-marine-900">{children ?? '—'}</dd>
    </div>
  );
}

export function Tableau({ entetes, children, className }: { entetes: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-[0.9rem]">
        <thead>
          <tr className="border-b border-sable-200 text-[0.72rem] uppercase tracking-wide text-encre-douce">
            {entetes.map((entete, index) => (
              <th key={index} scope="col" className="px-4 py-2.5 font-semibold whitespace-nowrap">
                {entete}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-sable-100 [&_td]:px-4 [&_td]:py-3 [&_td]:align-top [&_tr:hover]:bg-sable-50">{children}</tbody>
      </table>
    </div>
  );
}

export function Chiffre({ valeur, libelle, detail, ton = 'marine', href }: { valeur: ReactNode; libelle: string; detail?: ReactNode; ton?: 'marine' | 'or' | 'vert' | 'rouge'; href?: string }) {
  const couleur = { marine: 'text-marine-900', or: 'text-or-600', vert: 'text-vert-600', rouge: 'text-rouge-600' }[ton];
  const contenu = (
    <>
      <p className={cx('chiffre text-[2.5rem]', couleur)}>{valeur}</p>
      <p className="mt-1.5 text-[0.82rem] font-semibold text-marine-900">{libelle}</p>
      {detail ? <p className="mt-0.5 text-[0.78rem] text-encre-douce">{detail}</p> : null}
    </>
  );
  const classes = 'block rounded-xl border border-sable-200 bg-white p-4 shadow-carte';
  return href ? (
    <Link href={href} className={cx(classes, 'transition-colors hover:border-or-500')}>
      {contenu}
    </Link>
  ) : (
    <div className={classes}>{contenu}</div>
  );
}

export function Pagination({ page, total, parPage, lien }: { page: number; total: number; parPage: number; lien: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / parPage));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="hors-impression mt-5 flex items-center justify-between gap-3 text-[0.88rem]">
      {page > 1 ? (
        <Link href={lien(page - 1)} className={classesBouton('secondaire', 'petit')} rel="prev">
          ‹ Précédent
        </Link>
      ) : (
        <span />
      )}
      <span className="text-encre-douce">
        Page <strong className="text-marine-900">{page}</strong> sur {pages}
      </span>
      {page < pages ? (
        <Link href={lien(page + 1)} className={classesBouton('secondaire', 'petit')} rel="next">
          Suivant ›
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** Texte saisi par un tiers (titre d'annonce, employeur) : direction automatique pour l'arabe. */
export function TexteLibre({ children, className }: { children: string | null | undefined; className?: string }) {
  if (!children) return null;
  return (
    <bdi dir="auto" className={className}>
      {children}
    </bdi>
  );
}
