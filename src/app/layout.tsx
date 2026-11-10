import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// Polices auto-hébergées (aucun appel à un service tiers) — licences : src/app/polices/LICENCES.md
// Une famille par fichier : le navigateur passe à la suivante, glyphe par glyphe,
// et ne télécharge les compléments (latin étendu, arabe) que s'ils sont utilisés.
const montserrat = localFont({ src: './polices/montserrat-latin-wght-normal.woff2', weight: '100 900', variable: '--font-montserrat', display: 'swap' });
const montserratEtendu = localFont({ src: './polices/montserrat-latin-ext-wght-normal.woff2', weight: '100 900', variable: '--font-montserrat-etendu', display: 'swap', preload: false, adjustFontFallback: false });
const barlow = localFont({ src: './polices/barlow-condensed-latin-800-normal.woff2', weight: '800', variable: '--font-barlow', display: 'swap', adjustFontFallback: 'Arial' });
const barlowEtendu = localFont({ src: './polices/barlow-condensed-latin-ext-800-normal.woff2', weight: '800', variable: '--font-barlow-etendu', display: 'swap', preload: false, adjustFontFallback: false });
const cairo = localFont({ src: './polices/cairo-arabic-wght-normal.woff2', weight: '200 1000', variable: '--font-cairo', display: 'swap', preload: false, adjustFontFallback: false });

export const metadata: Metadata = {
  title: { default: 'Job Radar — Yallah Services', template: '%s · Job Radar' },
  description: 'Outil interne Yallah Services : veille des offres d’emploi au Maroc, candidats, employeurs et placements.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0d2136', width: 'device-width', initialScale: 1 };

export default function RacineLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={[montserrat, montserratEtendu, barlow, barlowEtendu, cairo].map((police) => police.variable).join(' ')}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
