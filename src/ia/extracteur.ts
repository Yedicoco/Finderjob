/**
 * Complément d'extraction par modèle de langage — FACULTATIF et désactivé
 * tant que YS_IA_API_URL, YS_IA_API_CLE et YS_IA_MODELE ne sont pas définis.
 *
 * Garde-fous :
 *   - appelé uniquement si la source l'autorise (allow_ai_processing) et si
 *     robots.txt ne l'interdit pas (Content-Signal ai-input=no) — voir
 *     src/serveur/ingestion.ts ;
 *   - les coordonnées sont masquées AVANT l'envoi au fournisseur ;
 *   - la réponse est validée par un schéma strict ; toute valeur hors
 *     référentiel est écartée, toute réponse invalide est ignorée ;
 *   - le modèle ne peut modifier ni pays, ni date, ni salaire, ni métier,
 *     ni statut, ni risque ; un contrat ou un nombre de postes complétés
 *     peuvent déplacer la pertinence de 10 points au plus (testé).
 */
import { z } from 'zod';
import type { ComplementIA } from '@/collecte/pipeline';
import type { OffreBrute } from '@/collecte/types';
import { masquerContacts } from '@/domaine/extraction';
import { CONTRATS, LANGUES, TEMPS_TRAVAIL } from '@/domaine/referentiels';
import { PROMPT_SYSTEME, promptUtilisateur } from './prompts';

const texteCourt = (max: number) => z.string().trim().min(1).max(max).nullable().catch(null);

export const SchemaComplement = z.object({
  resume: texteCourt(300),
  employeur: texteCourt(120),
  contrat: z.string().nullable().catch(null),
  tempsTravail: z.string().nullable().catch(null),
  experienceAnnees: z.number().min(0).max(40).nullable().catch(null),
  langues: z.array(z.string()).max(10).catch([]),
  logement: z.enum(['loge', 'non_loge']).nullable().catch(null),
  nombrePostes: z.number().int().min(1).max(500).nullable().catch(null),
});

/** Valide et nettoie la réponse brute du modèle. Renvoie null si elle n'est pas exploitable. */
export function validerComplement(brut: unknown): ComplementIA | null {
  let objet: unknown = brut;
  if (typeof brut === 'string') {
    // Certains modèles entourent le JSON de texte ou de balises de code.
    const debut = brut.indexOf('{');
    const fin = brut.lastIndexOf('}');
    if (debut < 0 || fin <= debut) return null;
    try {
      objet = JSON.parse(brut.slice(debut, fin + 1));
    } catch {
      return null;
    }
  }
  const lu = SchemaComplement.safeParse(objet);
  if (!lu.success) return null;
  const d = lu.data;
  // Le résumé et l'employeur ne doivent jamais transporter de coordonnées.
  const sansContact = (valeur: string | null) => (valeur ? masquerContacts(valeur).replace(/\s+/g, ' ').trim() || null : null);
  return {
    resume: sansContact(d.resume),
    employeur: sansContact(d.employeur),
    contrat: d.contrat && CONTRATS.est(d.contrat) && d.contrat !== 'non_precise' ? d.contrat : null,
    tempsTravail: d.tempsTravail && TEMPS_TRAVAIL.est(d.tempsTravail) && d.tempsTravail !== 'non_precise' ? d.tempsTravail : null,
    experienceAnnees: d.experienceAnnees,
    langues: [...new Set(d.langues)].filter((code) => LANGUES.est(code)),
    logement: d.logement,
    nombrePostes: d.nombrePostes,
  };
}

export type ConfigIA = { url: string; cle: string; modele: string; fetch?: typeof fetch; delaiMs?: number };

export function configIADepuisEnv(): ConfigIA | null {
  const url = process.env.YS_IA_API_URL?.trim();
  const cle = process.env.YS_IA_API_CLE?.trim();
  const modele = process.env.YS_IA_MODELE?.trim();
  return url && cle && modele ? { url, cle, modele } : null;
}

/** Fabrique la fonction passée à executerCollecte({ completerIA }). API compatible « chat completions ». */
export function creerExtracteurIA(configuration: ConfigIA): (brute: OffreBrute) => Promise<ComplementIA | null> {
  const appeler = configuration.fetch ?? fetch;
  return async (brute) => {
    if (brute.texte.trim().length < 80) return null;
    const reponse = await appeler(configuration.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${configuration.cle}` },
      body: JSON.stringify({
        model: configuration.modele,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPT_SYSTEME },
          { role: 'user', content: promptUtilisateur(masquerContacts(brute.titre), masquerContacts(brute.texte)) },
        ],
      }),
      signal: AbortSignal.timeout(configuration.delaiMs ?? 20_000),
    });
    if (!reponse.ok) return null;
    const corps = (await reponse.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    return validerComplement(corps?.choices?.[0]?.message?.content ?? null);
  };
}
