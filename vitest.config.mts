import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Deux projets de tests :
//   unitaires     règles métier pures (aucune base, aucun réseau)
//   integration   PostgreSQL embarqué + serveur HTTP local simulant les sources
// Aucun test n'appelle un site réel.
const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unitaires',
          environment: 'node',
          include: ['tests/unitaires/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/preparation-globale.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          // Une seule base partagée : les fichiers passent l'un après l'autre.
          fileParallelism: false,
        },
      },
    ],
  },
});
