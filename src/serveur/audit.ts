/**
 * Journal d'audit (ajout seul : la base refuse toute modification ou suppression).
 *
 * Règle : jamais de donnée personnelle en clair. On note QUI a fait QUOI sur
 * QUELLE fiche (par sa référence), et le nom des champs modifiés.
 */
import { executer, requete, type Executeur } from './db';

export type Acteur = { id: string | null; libelle: string; role: string | null; ipHash?: string | null };

export const ACTEUR_SYSTEME: Acteur = { id: null, libelle: 'systeme', role: null };

export async function journaliser(
  entree: { acteur: Acteur; action: string; entite: string; id?: string | null; resume?: string; changements?: Record<string, unknown> },
  tx?: Executeur,
): Promise<void> {
  await executer(
    `INSERT INTO audit_logs (actor_user_id, actor_label, actor_role, action, entity_type, entity_id, summary, changes, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      entree.acteur.id,
      entree.acteur.libelle.slice(0, 120),
      entree.acteur.role,
      entree.action,
      entree.entite,
      entree.id ?? null,
      (entree.resume ?? '').slice(0, 500),
      JSON.stringify(entree.changements ?? {}),
      entree.acteur.ipHash ?? null,
    ],
    tx,
  );
}

export type LigneAudit = {
  id: number;
  occurred_at: Date;
  actor_label: string;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  changes: Record<string, unknown>;
};

export async function lireJournal(filtres: { entite?: string; id?: string; action?: string; limite?: number; decalage?: number } = {}): Promise<LigneAudit[]> {
  const conditions: string[] = [];
  const valeurs: unknown[] = [];
  if (filtres.entite) conditions.push(`entity_type = $${valeurs.push(filtres.entite)}`);
  if (filtres.id) conditions.push(`entity_id = $${valeurs.push(filtres.id)}`);
  if (filtres.action) conditions.push(`action = $${valeurs.push(filtres.action)}`);
  const limite = Math.min(Math.max(filtres.limite ?? 100, 1), 500);
  return requete<LigneAudit>(
    `SELECT id, occurred_at, actor_label, actor_role, action, entity_type, entity_id, summary, changes
       FROM audit_logs ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY occurred_at DESC, id DESC LIMIT ${limite} OFFSET ${Math.max(filtres.decalage ?? 0, 0)}`,
    valeurs,
  );
}
