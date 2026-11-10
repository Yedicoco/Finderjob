/**
 * Sonde de disponibilité (supervision, équilibreur de charge).
 * Publique, donc volontairement muette : ni version, ni message d'erreur, ni compteur.
 */
import { uneLigne } from '@/serveur/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const entetes = { 'cache-control': 'no-store' };
  try {
    const ligne = await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM schema_migrations`);
    if (!ligne || ligne.n < 1) return Response.json({ etat: 'indisponible' }, { status: 503, headers: entetes });
    return Response.json({ etat: 'ok' }, { headers: entetes });
  } catch {
    return Response.json({ etat: 'indisponible' }, { status: 503, headers: entetes });
  }
}
