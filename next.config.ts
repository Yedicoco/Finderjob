import type { NextConfig } from 'next';

// Outil interne : aucune donnée d'usage n'est envoyée à un tiers, pas même la télémétrie anonyme de Next.js.
process.env.NEXT_TELEMETRY_DISABLED ??= '1';

/**
 * Hôtes supplémentaires autorisés à appeler les Server Actions (et le serveur
 * de développement) : uniquement utile derrière un tunnel ou un aperçu
 * hébergé qui ne transmet pas l'hôte public. Exemple : YS_ORIGINES_AUTORISEES="*.exemple.dev"
 * Lu au build ET au démarrage : définissez-le dans les deux cas.
 */
const originesAutorisees = (process.env.YS_ORIGINES_AUTORISEES ?? '')
  .split(',')
  .map((origine) => origine.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // pg reste un module Node natif, hors du bundle serveur.
  serverExternalPackages: ['pg'],
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  allowedDevOrigins: originesAutorisees,
  experimental: {
    serverActions: {
      allowedOrigins: originesAutorisees,
      // Import de fichiers CSV de partenaires (limite applicative : 2 Mo).
      bodySizeLimit: '3mb',
    },
  },
  // Les en-têtes de sécurité (CSP avec nonce, anti-intégration) sont posés par src/proxy.ts.
};

export default nextConfig;
