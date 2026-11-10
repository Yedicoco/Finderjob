/**
 * Alertes et notifications.
 *
 * Canaux : notification interne (toujours disponible), e-mail et WhatsApp
 * Business (facultatifs). Sans fournisseur configuré, un envoi externe n'a pas
 * lieu : la notification est enregistrée avec le statut « simulé », affiché tel
 * quel — l'outil ne prétend jamais avoir envoyé un message qui n'est pas parti.
 */
import { normaliserCriteres, offreCorrespond, resumerCriteres, type CriteresAlerte, type OffrePourAlerte } from '@/domaine/alertes';
import { compter } from '@/domaine/accord';
import { nomVille } from '@/domaine/geographie';
import { AVERTISSEMENT_ENGAGEMENT, CANAUX_ALERTE, FREQUENCES_ALERTE } from '@/domaine/referentiels';
import { journaliser, type Acteur } from './audit';
import { chiffrer, chiffresTelephone, dechiffrerOuVide } from './chiffrement';
import { config } from './config';
import { executer, requete, uneLigne } from './db';
import { ErreurMetier } from '@/domaine/erreurs';

export class ErreurAlerte extends ErreurMetier {}

export type Alerte = {
  id: string; user_id: string; name: string; criteria: CriteresAlerte; channels: string[]; frequency: string; is_active: boolean; last_run_at: Date | null;
  last_sent_at: Date | null; created_at: Date; resume: string; notifications: number;
};

export type SaisieAlerte = { nom: string; criteres: unknown; canaux: string[]; frequence: string; active?: boolean };

function valider(s: SaisieAlerte) {
  const nom = (s.nom ?? '').replace(/\s+/g, ' ').trim();
  if (nom.length < 2 || nom.length > 80) throw new ErreurAlerte('Nom de l’alerte : 2 à 80 caractères.');
  const canaux = [...new Set(s.canaux ?? [])].filter((canal) => CANAUX_ALERTE.est(canal));
  if (canaux.length === 0) throw new ErreurAlerte('Choisissez au moins un canal.');
  if (!FREQUENCES_ALERTE.est(s.frequence)) throw new ErreurAlerte('Fréquence inconnue.');
  return { nom, canaux, frequence: s.frequence, criteres: normaliserCriteres(s.criteres), active: s.active ?? true };
}

export async function creerAlerte(utilisateurId: string, saisie: SaisieAlerte, acteur: Acteur, maintenant = new Date()): Promise<string> {
  const v = valider(saisie);
  const nombre = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM alerts WHERE user_id = $1`, [utilisateurId]))!.n;
  if (nombre >= 30) throw new ErreurAlerte('Trente alertes au plus par utilisateur.');
  // last_run_at = maintenant : une alerte ne signale que les offres arrivées après sa création.
  const ligne = await uneLigne<{ id: string }>(`INSERT INTO alerts (user_id, name, criteria, channels, frequency, is_active, last_run_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7) RETURNING id`, [utilisateurId, v.nom, JSON.stringify(v.criteres), v.canaux, v.frequence, v.active, maintenant]);
  await journaliser({ acteur, action: 'alerte.creation', entite: 'alerte', id: ligne!.id, resume: `Alerte « ${v.nom} »`, changements: { criteres: v.criteres, canaux: v.canaux, frequence: v.frequence } });
  return ligne!.id;
}

export async function modifierAlerte(id: string, utilisateurId: string, saisie: SaisieAlerte, acteur: Acteur): Promise<void> {
  const v = valider(saisie);
  const n = await executer(`UPDATE alerts SET name = $3, criteria = $4::jsonb, channels = $5, frequency = $6, is_active = $7 WHERE id = $1 AND user_id = $2`, [id, utilisateurId, v.nom, JSON.stringify(v.criteres), v.canaux, v.frequence, v.active]);
  if (!n) throw new ErreurAlerte('Alerte introuvable.');
  await journaliser({ acteur, action: 'alerte.modification', entite: 'alerte', id, resume: `Alerte « ${v.nom} » modifiée` });
}

export async function basculerAlerte(id: string, utilisateurId: string, active: boolean, maintenant = new Date()): Promise<void> {
  // À la réactivation, on repart de maintenant : pas de rattrapage massif.
  const n = await executer(`UPDATE alerts SET is_active = $3, last_run_at = CASE WHEN $3 AND NOT is_active THEN $4 ELSE last_run_at END WHERE id = $1 AND user_id = $2`, [id, utilisateurId, active, maintenant]);
  if (!n) throw new ErreurAlerte('Alerte introuvable.');
}

export async function supprimerAlerte(id: string, utilisateurId: string, acteur: Acteur): Promise<void> {
  const n = await executer(`DELETE FROM alerts WHERE id = $1 AND user_id = $2`, [id, utilisateurId]);
  if (n) await journaliser({ acteur, action: 'alerte.suppression', entite: 'alerte', id, resume: 'Alerte supprimée' });
}

export async function listerAlertes(utilisateurId: string): Promise<Alerte[]> {
  const lignes = await requete<Omit<Alerte, 'resume'>>(
    `SELECT a.id, a.user_id, a.name, a.criteria, a.channels, a.frequency, a.is_active, a.last_run_at, a.last_sent_at, a.created_at,
            (SELECT count(*)::int FROM notifications n WHERE n.alert_id = a.id AND n.channel = 'interne') AS notifications
       FROM alerts a WHERE a.user_id = $1 ORDER BY a.created_at`,
    [utilisateurId],
  );
  return lignes.map((ligne) => ({ ...ligne, criteria: normaliserCriteres(ligne.criteria), resume: resumerCriteres(normaliserCriteres(ligne.criteria)) }));
}

// ------------------------------------------------------------------------ envois --

type Envoi = { statut: 'envoye' | 'simule' | 'echec'; detail?: string };
export type Transport = { email: (a: string, sujet: string, texte: string) => Promise<Envoi>; whatsapp: (numero: string, texte: string) => Promise<Envoi> };

async function poster(url: string, cle: string | null, corps: unknown): Promise<Envoi> {
  try {
    const reponse = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(cle ? { authorization: `Bearer ${cle}` } : {}) }, body: JSON.stringify(corps), signal: AbortSignal.timeout(15_000) });
    return reponse.ok ? { statut: 'envoye' } : { statut: 'echec', detail: `HTTP ${reponse.status}` };
  } catch (erreur) {
    return { statut: 'echec', detail: erreur instanceof Error ? erreur.message.slice(0, 200) : 'erreur réseau' };
  }
}

/** Transport réel : n'envoie que si un fournisseur est configuré, sinon « simulé ». */
export const transportConfigure: Transport = {
  async email(a, sujet, texte) {
    const url = config.emailUrl();
    const expediteur = config.emailExpediteur();
    if (!url || !expediteur) return { statut: 'simule', detail: 'Aucun fournisseur d’e-mail configuré' };
    // Format JSON courant des API d'envoi transactionnel (from, to, subject, text).
    return poster(url, config.emailCle(), { from: expediteur, to: [a], subject: sujet, text: texte });
  },
  async whatsapp(numero, texte) {
    const url = config.whatsappUrl();
    if (!url) return { statut: 'simule', detail: 'WhatsApp Business non configuré' };
    // Format de l'API Cloud de WhatsApp Business (message texte ; hors fenêtre de 24 h, un modèle approuvé est exigé par Meta).
    return poster(url, config.whatsappCle(), { messaging_product: 'whatsapp', to: numero.replace(/^\+/, ''), type: 'text', text: { body: texte } });
  },
};

export function canauxDisponibles(): Record<'interne' | 'email' | 'whatsapp', boolean> {
  return { interne: true, email: Boolean(config.emailUrl() && config.emailExpediteur()), whatsapp: Boolean(config.whatsappUrl()) };
}

type OffreNotifiable = OffrePourAlerte & { id: string; reference: string; premiereVue: Date };

async function offresDepuis(depuis: Date): Promise<OffreNotifiable[]> {
  const lignes = await requete<{
    id: string; reference: string; title: string; search_keywords: string | null; employer_name: string | null; sector_code: string | null; city_code: string | null; contract_type: string;
    salary_monthly_estimate: number | null; is_urgent: boolean; is_bulk_hiring: boolean; relevance_score: number; effective_status: string; first_seen_at: Date; metiers: string[];
  }>(
    `SELECT o.id, o.reference, o.title, o.search_keywords, o.employer_name, o.sector_code, o.city_code, o.contract_type, o.salary_monthly_estimate, o.is_urgent, o.is_bulk_hiring,
            o.relevance_score, o.effective_status, o.first_seen_at,
            COALESCE((SELECT array_agg(c.code) FROM job_offer_categories jc JOIN job_categories c ON c.id = jc.category_id WHERE jc.job_offer_id = o.id), '{}') AS metiers
       FROM v_job_offers o
      WHERE o.effective_status = 'actif' AND NOT o.is_demo AND GREATEST(o.first_seen_at, o.status_changed_at) > $1
      ORDER BY o.relevance_score DESC LIMIT 500`,
    [depuis],
  );
  return lignes.map((l) => ({
    id: l.id, reference: l.reference, premiereVue: l.first_seen_at, titre: l.title, motsCles: l.search_keywords ?? '', employeur: l.employer_name, metiers: l.metiers, secteur: l.sector_code,
    ville: l.city_code, contrat: l.contract_type, salaireMensuel: l.salary_monthly_estimate, urgent: l.is_urgent, massif: l.is_bulk_hiring, pertinence: l.relevance_score, statutEffectif: l.effective_status,
  }));
}

const ligneOffre = (offre: OffreNotifiable): string => {
  const lien = config.urlPublique() ? ` — ${config.urlPublique()}/offres/${offre.id}` : '';
  return `• ${offre.titre}${offre.ville ? ` — ${nomVille(offre.ville)}` : ''}${offre.employeur ? ` — ${offre.employeur}` : ''} (${offre.reference})${lien}`;
};

const DELAIS_MS: Record<string, number> = { immediat: 0, quotidien: 23 * 3_600_000, hebdomadaire: 6.9 * 86_400_000 };

export type BilanAlertes = { alertes: number; notifications: number; envoyes: number; simules: number; echecs: number };

/** Compare les offres devenues actives depuis le dernier passage aux alertes dues. Idempotent. */
export async function traiterAlertes(options: { maintenant?: Date; transport?: Transport } = {}): Promise<BilanAlertes> {
  const maintenant = options.maintenant ?? new Date();
  const transport = options.transport ?? transportConfigure;
  const bilan: BilanAlertes = { alertes: 0, notifications: 0, envoyes: 0, simules: 0, echecs: 0 };
  const alertes = await requete<{ id: string; user_id: string; name: string; criteria: unknown; channels: string[]; frequency: string; last_run_at: Date | null; created_at: Date; email: string; phone_enc: string | null }>(
    `SELECT a.id, a.user_id, a.name, a.criteria, a.channels, a.frequency, a.last_run_at, a.created_at, u.email, u.phone_enc
       FROM alerts a JOIN users u ON u.id = a.user_id WHERE a.is_active AND u.is_active ORDER BY a.created_at`,
  );
  for (const alerte of alertes) {
    const depuis = new Date(alerte.last_run_at ?? alerte.created_at);
    if (maintenant.getTime() - depuis.getTime() < (DELAIS_MS[alerte.frequency] ?? 0)) continue;
    bilan.alertes += 1;
    const criteres = normaliserCriteres(alerte.criteria);
    const offres = (await offresDepuis(depuis)).filter((offre) => offreCorrespond(criteres, offre));
    const nouvelles: OffreNotifiable[] = [];
    for (const offre of offres) {
      const genre = offre.urgent ? 'offre_urgente' : offre.massif ? 'recrutement_massif' : 'nouvelle_offre';
      const cree = await uneLigne<{ id: string }>(
        `INSERT INTO notifications (user_id, alert_id, job_offer_id, kind, channel, status, title, body, payload, sent_at)
         VALUES ($1, $2, $3, $4, 'interne', 'envoye', $5, $6, $7::jsonb, $8)
         ON CONFLICT (alert_id, job_offer_id, kind, channel) WHERE alert_id IS NOT NULL AND job_offer_id IS NOT NULL DO NOTHING RETURNING id`,
        [alerte.user_id, alerte.id, offre.id, genre, offre.titre.slice(0, 200), `${offre.ville ? nomVille(offre.ville) : 'Ville à préciser'}${offre.employeur ? ` · ${offre.employeur}` : ''} · alerte « ${alerte.name} »`, JSON.stringify({ reference: offre.reference }), maintenant],
      );
      if (cree) {
        nouvelles.push(offre);
        bilan.notifications += 1;
      }
    }
    if (nouvelles.length > 0) {
      const sujet = nouvelles.length === 1 ? `Nouvelle offre : ${nouvelles[0]!.titre}` : `${nouvelles.length} nouvelles offres — alerte « ${alerte.name} »`;
      const texte = [`Alerte « ${alerte.name} » (${resumerCriteres(criteres)})`, '', ...nouvelles.slice(0, 20).map(ligneOffre), nouvelles.length > 20 ? `… et ${compter(nouvelles.length - 20, 'autre')}.` : '', '', AVERTISSEMENT_ENGAGEMENT, 'Message interne Yallah Services — ne pas transférer.'].filter((ligne, i, tout) => ligne !== '' || tout[i - 1] !== '').join('\n');
      for (const canal of alerte.channels.filter((c) => c !== 'interne')) {
        const numero = canal === 'whatsapp' ? dechiffrerOuVide(alerte.phone_enc) : null;
        const envoi: Envoi = canal === 'email' ? await transport.email(alerte.email, sujet, texte) : numero ? await transport.whatsapp(numero, texte) : { statut: 'echec', detail: 'Aucun numéro WhatsApp renseigné dans « Mon compte »' };
        await executer(
          `INSERT INTO notifications (user_id, alert_id, kind, channel, status, title, body, payload, sent_at) VALUES ($1, $2, 'resume', $3, $4, $5, $6, $7::jsonb, $8)`,
          [alerte.user_id, alerte.id, canal, envoi.statut, sujet.slice(0, 200), texte.slice(0, 4000), JSON.stringify({ offres: nouvelles.map((o) => o.reference), detail: envoi.detail ?? null }), envoi.statut === 'envoye' ? maintenant : null],
        );
        if (envoi.statut === 'envoye') bilan.envoyes += 1;
        else if (envoi.statut === 'simule') bilan.simules += 1;
        else bilan.echecs += 1;
      }
    }
    await executer(`UPDATE alerts SET last_run_at = $2, last_sent_at = CASE WHEN $3 THEN $2 ELSE last_sent_at END WHERE id = $1`, [alerte.id, maintenant, nouvelles.length > 0]);
  }
  return bilan;
}

/** Relances employeurs arrivées à échéance : une notification interne par jour au courtier concerné. */
export async function notifierRelances(maintenant = new Date()): Promise<number> {
  return executer(
    `INSERT INTO notifications (user_id, kind, channel, status, title, body, payload, sent_at)
     SELECT COALESCE(e.assigned_to, e.created_by), 'relance', 'interne', 'envoye', 'Relance à faire : ' || e.name, 'Relance prévue le ' || to_char(e.next_follow_up_at AT TIME ZONE 'Africa/Casablanca', 'DD/MM/YYYY'),
            jsonb_build_object('employeur', e.id::text, 'reference', e.reference), $1
       FROM employers e JOIN users u ON u.id = COALESCE(e.assigned_to, e.created_by) AND u.is_active
      WHERE e.next_follow_up_at <= $1 AND NOT e.do_not_contact AND e.status <> 'cloture'
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.kind = 'relance' AND n.payload->>'employeur' = e.id::text AND n.created_at > $1::timestamptz - interval '20 hours')`,
    [maintenant],
  );
}

export type Notification = { id: string; kind: string; channel: string; status: string; title: string; body: string; payload: Record<string, unknown>; created_at: Date; read_at: Date | null; job_offer_id: string | null; alerte: string | null };

export async function listerNotifications(utilisateurId: string, options: { canal?: 'interne' | 'externe'; limite?: number } = {}): Promise<Notification[]> {
  const canal = options.canal === 'externe' ? `n.channel <> 'interne'` : `n.channel = 'interne'`;
  return requete<Notification>(
    `SELECT n.id, n.kind, n.channel, n.status, n.title, n.body, n.payload, n.created_at, n.read_at, n.job_offer_id, a.name AS alerte
       FROM notifications n LEFT JOIN alerts a ON a.id = n.alert_id WHERE n.user_id = $1 AND ${canal} ORDER BY n.created_at DESC LIMIT $2`,
    [utilisateurId, Math.min(options.limite ?? 50, 200)],
  );
}

export async function compterNonLues(utilisateurId: string): Promise<number> {
  return (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND channel = 'interne' AND read_at IS NULL`, [utilisateurId]))!.n;
}

export async function marquerLues(utilisateurId: string, id?: string, maintenant = new Date()): Promise<void> {
  await executer(`UPDATE notifications SET read_at = $2, status = 'lu' WHERE user_id = $1 AND channel = 'interne' AND read_at IS NULL AND ($3::uuid IS NULL OR id = $3)`, [utilisateurId, maintenant, id ?? null]);
}

/** Numéro WhatsApp personnel de l'utilisateur, pour ses propres alertes (chiffré). */
export async function definirTelephoneAlertes(utilisateurId: string, brut: string | null): Promise<void> {
  let numero: string | null = null;
  if (brut?.trim()) {
    const chiffres = chiffresTelephone(brut);
    if (!chiffres) throw new ErreurAlerte('Numéro de téléphone invalide.');
    numero = `+${chiffres}`;
  }
  await executer(`UPDATE users SET phone_enc = $2 WHERE id = $1`, [utilisateurId, chiffrer(numero)]);
}

export async function telephoneAlertes(utilisateurId: string): Promise<string | null> {
  return dechiffrerOuVide((await uneLigne<{ phone_enc: string | null }>(`SELECT phone_enc FROM users WHERE id = $1`, [utilisateurId]))?.phone_enc);
}
