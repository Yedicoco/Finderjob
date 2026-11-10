/** Icônes au trait (24 × 24), dessinées pour l'outil : aucune dépendance. */
import type { SVGProps } from 'react';

const TRACES = {
  radar: 'M12 12 19 5M12 3a9 9 0 1 0 9 9M12 7.5a4.5 4.5 0 1 0 4.5 4.5M12 12h.01',
  accueil: 'M3.5 11 12 3.5 20.5 11M5.5 9.5V20h4.75v-5.5h3.5V20h4.75V9.5',
  offres: 'M3.5 8.5h17v11h-17zM8.5 8.5v-3h7v3M3.5 13.5h17M12 12.5v2',
  verifier: 'M12 3.5 19.5 6v5.5c0 4.5-3.2 7.6-7.5 9-4.3-1.4-7.5-4.5-7.5-9V6zM8.75 12l2.25 2.25 4.25-4.5',
  importer: 'M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 15.5v4h15v-4',
  candidats: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.75 20c.4-3.4 2.9-5.5 6.25-5.5s5.85 2.1 6.25 5.5M16 11.25a3 3 0 1 0-1-5.8M17.5 14.6c2 .6 3.4 2.3 3.75 4.9',
  employeurs: 'M4.5 20.5v-16h9v16M13.5 9.5h6v11M2.5 20.5h19M7.5 8h3M7.5 11.5h3M7.5 15h3M16.5 13h.01M16.5 16.5h.01',
  besoins: 'M8.5 4.5h-3v16h13v-16h-3M8.5 3.5h7v3h-7zM8.5 11h7M8.5 14.5h7M8.5 18h4',
  placements: 'M8.5 12.5 11 15l4.75-5.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  commissions: 'M3.5 6.5h17v11h-17zM12 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM6.5 9.5v.01M17.5 14.5v.01',
  alertes: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15zM10 20.5h4',
  tableau: 'M4.5 20.5v-8M9.5 20.5v-14M14.5 20.5v-6M19.5 20.5V3.5M2.5 20.5h19',
  sources: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3Z',
  utilisateurs: 'M15 9.5a3.5 3.5 0 1 0-3.4 3.5L4.5 20v.5h3.25V18.5H10v-2.25h2L13.6 14.7M16.25 8.25h.01',
  parametres: 'M4.5 7h9M17.5 7h2M4.5 12h2M10.5 12h9M4.5 17h9M17.5 17h2M15.5 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8.5 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM15.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  journal: 'M5.5 3.5h13v17h-13zM8.5 8h7M8.5 12h7M8.5 16h4',
  demo: 'M9.5 3.5h5M10.5 3.5v6L5 19.25c-.4.6 0 1.25.75 1.25h12.5c.75 0 1.15-.65.75-1.25L13.5 9.5v-6M8 15h8',
  compte: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5c.6-3.75 3.5-6 7.5-6s6.9 2.25 7.5 6',
  sortir: 'M14.5 4.5h4v15h-4M10.5 8 6.5 12l4 4M6.5 12h9',
  externe: 'M13.5 4.5h6v6M19.5 4.5l-9 9M17.5 13.5v6h-13v-13h6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  recherche: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.25 15.25 20 20',
  plus: 'M12 5v14M5 12h14',
  attention: 'M12 4 2.75 19.5h18.5zM12 10v4.5M12 17.25h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5.5M12 7.75h.01',
  coche: 'M5 12.5 9.75 17 19 7',
  croix: 'M6 6l12 12M18 6 6 18',
  horloge: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2',
  lieu: 'M12 21s6.5-5.6 6.5-10.75a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21ZM12 12.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z',
  telephone: 'M5 4.5h3.5l1.5 4-2 1.5c1 2.25 2.75 4 5 5l1.5-2 4 1.5V18c0 .85-.65 1.5-1.5 1.5C10 19.5 4.5 14 4.5 6c0-.85.65-1.5 1.5-1.5Z',
  imprimer: 'M7 8.5v-5h10v5M7 17.5H4.5v-9h15v9H17M7 14.5h10v6H7z',
  fleche: 'M5 12h14M13 6l6 6-6 6',
  modifier: 'M4.5 19.5h3.75L19 8.75 15.25 5 4.5 15.75zM13 7.25 16.75 11',
} as const;

export type NomIcone = keyof typeof TRACES;

export function Icone({ nom, className = 'size-5', ...reste }: { nom: NomIcone } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`} {...reste}>
      <path d={TRACES[nom]} />
    </svg>
  );
}
