/**
 * Employeurs (CRM), échanges et besoins de recrutement.
 *
 * Un employeur peut être une personne physique (famille, particulier) : ses
 * coordonnées sont chiffrées, la base de traitement est consignée et le
 * drapeau « ne pas contacter » est respecté partout.
 */
import type { PosteAPourvoir } from '@/domaine/appariement';
import { normaliserEmployeur } from '@/domaine/doublons';
import type { PeriodeSalaire } from '@/domaine/extraction';
import { villeParCode } from '@/domaine/geographie';
import { BASES_CONTACT, CONTRATS, LANGUES, LOGEMENT, PERIODES_SALAIRE, STATUTS_BESOIN, STATUTS_EMPLOYEUR, TEMPS_TRAVAIL, TYPES_ECHANGE, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { metierParCode } from '@/domaine/taxonomie';
import { journaliser, type Acteur } from './audit';
import { chiffrer, chiffresTelephone, dechiffrerOuVide, indexTelephone } from './chiffrement';
import { executer, prochaineReference, requete, transaction, uneLigne, type Executeur } from './db';
import { chargerParametres } from './parametres';
import { idsCategories } from './referentiel';
import { ErreurMetier } from '@/domaine/erreurs';
import { dateSaisieMaroc } from '@/domaine/fuseau';

export class ErreurEmployeur extends ErreurMetier {}

const ORIGINES = ['saisie', 'offre', 'demande_entrante', 'recommandation', 'site_yallah', 'import'] as const;

export type SaisieEmployeur = {
  type: string;
  nom: string;
  contact?: string | null;
  telephone?: string | null;
  email?: string | null;
  adresse?: string | null;
  ville?: string | null;
  quartier?: string | null;
  origine?: string;
  baseContact?: string;
  nePasContacter?: boolean;
  notes?: string | null;
  prochaineRelance?: string | null;
};

function dateOuNull(valeur: string | null | undefined, libelle: string): Date | null {
  if (!valeur?.trim()) return null;
  // Un jour seul est placé à 10 h, heure de Casablanca (heure des rappels de relance).
  const date = dateSaisieMaroc(valeur, 'midi', 10);
  if (!date) throw new ErreurEmployeur(`${libelle} : date invalide.`);
  return date;
}

function validerEmployeur(s: SaisieEmployeur) {
  if (!TYPES_EMPLOYEUR.est(s.type)) throw new ErreurEmployeur('Type d’employeur inconnu.');
  const nom = (s.nom ?? '').replace(/\s+/g, ' ').trim();
  if (nom.length < 2 || nom.length > 160) throw new ErreurEmployeur('Nom de l’employeur : 2 à 160 caractères.');
  let telephone: string | null = null;
  if (s.telephone?.trim()) {
    const chiffres = chiffresTelephone(s.telephone);
    if (!chiffres) throw new ErreurEmployeur('Numéro de téléphone invalide.');
    telephone = `+${chiffres}`;
  }
  const email = s.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ErreurEmployeur('Adresse e-mail invalide.');
  if (s.ville && !villeParCode(s.ville)) throw new ErreurEmployeur('Ville inconnue du référentiel.');
  const origine = s.origine ?? 'saisie';
  if (!(ORIGINES as readonly string[]).includes(origine)) throw new ErreurEmployeur('Origine inconnue.');
  const base = s.baseContact ?? 'non_renseignee';
  if (!BASES_CONTACT.est(base)) throw new ErreurEmployeur('Base de contact inconnue.');
  const personnePhysique = s.type === 'famille' || s.type === 'particulier';
  if (personnePhysique && (telephone || email) && base === 'non_renseignee') {
    throw new ErreurEmployeur('Pour une famille ou un particulier, indiquez comment ses coordonnées ont été obtenues (loi n° 09-08).');
  }
  return {
    type: s.type, nom, contact: s.contact?.replace(/\s+/g, ' ').trim().slice(0, 120) || null, telephone, email, adresse: s.adresse?.trim().slice(0, 300) || null,
    ville: s.ville || null, quartier: s.quartier?.trim().slice(0, 80) || null, origine, base, nePasContacter: Boolean(s.nePasContacter),
    notes: s.notes?.trim().slice(0, 4000) || null, relance: dateOuNull(s.prochaineRelance, 'Prochaine relance'),
  };
}

export async function creerEmployeur(saisie: SaisieEmployeur, acteur: Acteur, tx?: Executeur, options: { estDemo?: boolean } = {}): Promise<{ id: string; reference: string }> {
  const v = validerEmployeur(saisie);
  const travail = async (t: Executeur) => {
    const indexTel = indexTelephone(v.telephone);
    if (indexTel) {
      const doublon = await uneLigne<{ reference: string; name: string }>(`SELECT reference, name FROM employers WHERE phone_bidx = $1`, [indexTel], t);
      if (doublon) throw new ErreurEmployeur(`Un employeur existe déjà avec ce numéro : ${doublon.name} (${doublon.reference}).`);
    }
    const cree = await uneLigne<{ id: string; reference: string }>(
      `INSERT INTO employers (reference, employer_type, name, name_normalized, contact_name_enc, phone_enc, phone_bidx, email_enc, address_enc, city_code, district,
                              origin, contact_basis, do_not_contact, next_follow_up_at, notes, assigned_to, created_by, is_demo)
       VALUES (${prochaineReference('EM', Boolean(options.estDemo))}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16, $17) RETURNING id, reference`,
      [v.type, v.nom, normaliserEmployeur(v.nom) || v.nom.toLowerCase(), chiffrer(v.contact), chiffrer(v.telephone), indexTel, chiffrer(v.email), chiffrer(v.adresse), v.ville,
        v.quartier, v.origine, v.base, v.nePasContacter, v.relance, v.notes, acteur.id, Boolean(options.estDemo)],
      t,
    );
    await journaliser({ acteur, action: 'employeur.creation', entite: 'employeur', id: cree!.id, resume: `Employeur ${cree!.reference} créé`, changements: { type: v.type, origine: v.origine, base: v.base } }, t);
    return cree!;
  };
  return tx ? travail(tx) : transaction(travail);
}

export async function modifierEmployeur(id: string, saisie: SaisieEmployeur, acteur: Acteur): Promise<void> {
  const v = validerEmployeur(saisie);
  await transaction(async (tx) => {
    const actuel = await uneLigne<{ reference: string }>(`SELECT reference FROM employers WHERE id = $1 FOR UPDATE`, [id], tx);
    if (!actuel) throw new ErreurEmployeur('Employeur introuvable.');
    const indexTel = indexTelephone(v.telephone);
    if (indexTel) {
      const doublon = await uneLigne<{ reference: string }>(`SELECT reference FROM employers WHERE phone_bidx = $1 AND id <> $2`, [indexTel, id], tx);
      if (doublon) throw new ErreurEmployeur(`Un autre employeur porte déjà ce numéro (${doublon.reference}).`);
    }
    await executer(
      `UPDATE employers SET employer_type = $2, name = $3, name_normalized = $4, contact_name_enc = $5, phone_enc = $6, phone_bidx = $7, email_enc = $8, address_enc = $9,
              city_code = $10, district = $11, contact_basis = $12, do_not_contact = $13, next_follow_up_at = $14, notes = $15 WHERE id = $1`,
      [id, v.type, v.nom, normaliserEmployeur(v.nom) || v.nom.toLowerCase(), chiffrer(v.contact), chiffrer(v.telephone), indexTel, chiffrer(v.email), chiffrer(v.adresse), v.ville,
        v.quartier, v.base, v.nePasContacter, v.relance, v.notes],
      tx,
    );
    await journaliser({ acteur, action: 'employeur.modification', entite: 'employeur', id, resume: `Employeur ${actuel.reference} modifié`, changements: { nePasContacter: v.nePasContacter } }, tx);
  });
}

export async function changerStatutEmployeur(id: string, statut: string, acteur: Acteur, tx?: Executeur): Promise<void> {
  if (!STATUTS_EMPLOYEUR.est(statut)) throw new ErreurEmployeur('Statut inconnu.');
  const avant = await uneLigne<{ status: string; reference: string }>(`SELECT status, reference FROM employers WHERE id = $1`, [id], tx);
  if (!avant) throw new ErreurEmployeur('Employeur introuvable.');
  if (avant.status === statut) return;
  await executer(`UPDATE employers SET status = $2 WHERE id = $1`, [id, statut], tx);
  await journaliser({ acteur, action: 'employeur.statut', entite: 'employeur', id, resume: `${avant.reference} : ${avant.status} › ${statut}`, changements: { avant: avant.status, apres: statut } }, tx);
}

export type EmployeurListe = {
  id: string; reference: string; employer_type: string; name: string; city_code: string | null; district: string | null; status: string; origin: string;
  do_not_contact: boolean; next_follow_up_at: Date | null; besoins_ouverts: number; offres: number; dernier_echange: Date | null; updated_at: Date; is_demo: boolean;
};

export async function listerEmployeurs(filtres: { q?: string; statut?: string; type?: string; ville?: string; relances?: boolean; page?: number } = {}): Promise<{ employeurs: EmployeurListe[]; total: number; parStatut: Record<string, number> }> {
  const conditions: string[] = [];
  const valeurs: unknown[] = [];
  const p = (valeur: unknown) => `$${valeurs.push(valeur)}`;
  const q = filtres.q?.trim();
  if (q) {
    const tel = indexTelephone(q);
    const norme = normaliserEmployeur(q) || q.toLowerCase();
    conditions.push(`(e.reference = upper(${p(q)}) OR e.name_normalized LIKE '%' || ${p(norme.replace(/[%_\\]/g, ''))} || '%'${tel ? ` OR e.phone_bidx = ${p(tel)}` : ''})`);
  }
  if (filtres.type) conditions.push(`e.employer_type = ${p(filtres.type)}`);
  if (filtres.ville) conditions.push(`e.city_code = ${p(filtres.ville)}`);
  if (filtres.relances) conditions.push(`e.next_follow_up_at IS NOT NULL AND e.next_follow_up_at <= now() + interval '1 day' AND NOT e.do_not_contact AND e.status <> 'cloture'`);
  const sansStatut = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const comptes = await requete<{ status: string; n: number }>(`SELECT e.status, count(*)::int AS n FROM employers e ${sansStatut} GROUP BY 1`, [...valeurs]);
  if (filtres.statut) conditions.push(`e.status = ${p(filtres.statut)}`);
  const page = Math.max(filtres.page ?? 1, 1);
  const lignes = await requete<EmployeurListe & { total: number }>(
    `SELECT e.id, e.reference, e.employer_type, e.name, e.city_code, e.district, e.status, e.origin, e.do_not_contact, e.next_follow_up_at, e.updated_at, e.is_demo,
            (SELECT count(*)::int FROM employer_needs n WHERE n.employer_id = e.id AND n.status IN ('ouvert', 'en_cours')) AS besoins_ouverts,
            (SELECT count(*)::int FROM job_offers o WHERE o.employer_id = e.id) AS offres,
            (SELECT max(i.occurred_at) FROM employer_interactions i WHERE i.employer_id = e.id) AS dernier_echange,
            count(*) OVER() AS total
       FROM employers e ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY (e.next_follow_up_at IS NULL), e.next_follow_up_at, e.updated_at DESC LIMIT 30 OFFSET ${(page - 1) * 30}`,
    valeurs,
  );
  const parStatut: Record<string, number> = {};
  for (const ligne of comptes) parStatut[ligne.status] = ligne.n;
  return { total: Number(lignes[0]?.total ?? 0), parStatut, employeurs: lignes.map(({ total: _t, ...reste }) => { void _t; return reste; }) };
}

export type EmployeurDetail = Omit<EmployeurListe, 'besoins_ouverts' | 'offres' | 'dernier_echange'> & {
  contact: string | null; telephone: string | null; email: string | null; adresse: string | null; contact_basis: string; notes: string | null; created_at: Date;
  echanges: { id: string; kind: string; summary: string; occurred_at: Date; next_action_at: Date | null; auteur: string | null }[];
  besoins: BesoinListe[];
  offres: { id: string; reference: string; title: string; effective_status: string; published_at: Date | null }[];
  placements: { id: string; reference: string; status: string; start_date: string; candidat: string }[];
};

export async function employeurParId(id: string, acteur: Acteur): Promise<EmployeurDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const e = await uneLigne<Record<string, unknown> & { reference: string; employer_type: string }>(`SELECT * FROM employers WHERE id = $1`, [id]);
  if (!e) return null;
  const [echanges, besoins, offres, placements] = await Promise.all([
    requete<EmployeurDetail['echanges'][number]>(`SELECT i.id, i.kind, i.summary, i.occurred_at, i.next_action_at, u.full_name AS auteur FROM employer_interactions i LEFT JOIN users u ON u.id = i.user_id WHERE i.employer_id = $1 ORDER BY i.occurred_at DESC LIMIT 50`, [id]),
    listerBesoins({ employeur: id, statut: 'tous' }),
    requete<EmployeurDetail['offres'][number]>(`SELECT id, reference, title, effective_status, published_at FROM v_job_offers WHERE employer_id = $1 ORDER BY published_at DESC NULLS LAST LIMIT 30`, [id]),
    requete<EmployeurDetail['placements'][number]>(`SELECT p.id, p.reference, p.status, p.start_date, k.reference AS candidat FROM placements p JOIN candidates k ON k.id = p.candidate_id WHERE p.employer_id = $1 ORDER BY p.start_date DESC`, [id]),
  ]);
  if (e.employer_type === 'famille' || e.employer_type === 'particulier') {
    await journaliser({ acteur, action: 'employeur.consultation', entite: 'employeur', id, resume: `Fiche ${e.reference} consultée (personne physique)` });
  }
  const { contact_name_enc, phone_enc, email_enc, address_enc, phone_bidx: _b, name_normalized: _n, ...reste } = e as Record<string, unknown>;
  void _b; void _n;
  return {
    ...(reste as unknown as EmployeurDetail),
    contact: dechiffrerOuVide(contact_name_enc as string | null), telephone: dechiffrerOuVide(phone_enc as string | null), email: dechiffrerOuVide(email_enc as string | null),
    adresse: dechiffrerOuVide(address_enc as string | null), echanges, besoins: besoins.besoins, offres, placements,
  };
}

export async function ajouterEchange(employeurId: string, entree: { type: string; resume: string; date?: string | null; prochaineAction?: string | null }, acteur: Acteur, maintenant = new Date()): Promise<void> {
  if (!TYPES_ECHANGE.est(entree.type)) throw new ErreurEmployeur('Type d’échange inconnu.');
  const resume = entree.resume.trim();
  if (resume.length < 2) throw new ErreurEmployeur('Décrivez l’échange en quelques mots.');
  const date = dateOuNull(entree.date, 'Date de l’échange') ?? maintenant;
  const suite = dateOuNull(entree.prochaineAction, 'Prochaine action');
  await transaction(async (tx) => {
    const e = await uneLigne<{ do_not_contact: boolean; status: string; reference: string }>(`SELECT do_not_contact, status, reference FROM employers WHERE id = $1 FOR UPDATE`, [employeurId], tx);
    if (!e) throw new ErreurEmployeur('Employeur introuvable.');
    if (e.do_not_contact && entree.type !== 'note') throw new ErreurEmployeur('Cet employeur a demandé à ne plus être contacté : seule une note interne peut être ajoutée.');
    await executer(`INSERT INTO employer_interactions (employer_id, kind, summary, occurred_at, next_action_at, user_id) VALUES ($1, $2, $3, $4, $5, $6)`, [employeurId, entree.type, resume.slice(0, 2000), date, suite, acteur.id], tx);
    // Un premier contact fait avancer le prospect ; la relance suit la prochaine action annoncée.
    await executer(
      `UPDATE employers SET next_follow_up_at = $2, status = CASE WHEN status IN ('prospect', 'a_contacter') AND $3 <> 'note' THEN 'contacte' ELSE status END WHERE id = $1`,
      [employeurId, suite, entree.type],
      tx,
    );
    await journaliser({ acteur, action: 'employeur.echange', entite: 'employeur', id: employeurId, resume: `${e.reference} : ${entree.type}` }, tx);
  });
}

/** Crée (ou retrouve) la fiche prospect de l'employeur nommé dans une offre, et la relie à l'offre. */
export async function employeurDepuisOffre(offreId: string, acteur: Acteur): Promise<{ id: string; reference: string; cree: boolean }> {
  return transaction(async (tx) => {
    const offre = await uneLigne<{ reference: string; employer_id: string | null; employer_name: string | null; employer_normalized: string | null; employer_type_guess: string | null; city_code: string | null; district: string | null; contact_phone_enc: string | null; contact_email_enc: string | null; is_demo: boolean }>(
      `SELECT reference, employer_id, employer_name, employer_normalized, employer_type_guess, city_code, district, contact_phone_enc, contact_email_enc, is_demo FROM job_offers WHERE id = $1 FOR UPDATE`,
      [offreId],
      tx,
    );
    if (!offre) throw new ErreurEmployeur('Offre introuvable.');
    if (offre.employer_id) {
      const existant = await uneLigne<{ id: string; reference: string }>(`SELECT id, reference FROM employers WHERE id = $1`, [offre.employer_id], tx);
      if (existant) return { ...existant, cree: false };
    }
    if (!offre.employer_name) throw new ErreurEmployeur('L’annonce ne nomme pas l’employeur : créez la fiche à la main depuis « Employeurs ».');
    if (offre.employer_normalized) {
      const meme = await uneLigne<{ id: string; reference: string }>(`SELECT id, reference FROM employers WHERE name_normalized = $1 AND is_demo = $3 AND (city_code IS NOT DISTINCT FROM $2 OR city_code IS NULL OR $2::text IS NULL) LIMIT 1`, [offre.employer_normalized, offre.city_code, offre.is_demo], tx);
      if (meme) {
        await executer(`UPDATE job_offers SET employer_id = $2 WHERE id = $1`, [offreId, meme.id], tx);
        return { ...meme, cree: false };
      }
    }
    const telephone = dechiffrerOuVide(offre.contact_phone_enc);
    const email = dechiffrerOuVide(offre.contact_email_enc);
    const cree = await creerEmployeur(
      {
        type: offre.employer_type_guess && TYPES_EMPLOYEUR.est(offre.employer_type_guess) ? offre.employer_type_guess : 'autre', nom: offre.employer_name, telephone, email,
        ville: offre.city_code, quartier: offre.district, origine: 'offre', baseContact: 'annonce_publique', notes: `Fiche créée depuis l’offre ${offre.reference}.`,
      },
      acteur,
      tx,
      { estDemo: offre.is_demo },
    );
    await executer(`UPDATE job_offers SET employer_id = $2 WHERE id = $1`, [offreId, cree.id], tx);
    return { ...cree, cree: true };
  });
}

// ------------------------------------------------------------------------ besoins --

export type SaisieBesoin = {
  employeurId: string;
  offreId?: string | null;
  titre: string;
  metier?: string | null;
  postes?: number;
  ville?: string | null;
  quartier?: string | null;
  contrat?: string;
  temps?: string;
  logement?: string | null;
  salaireMin?: number | null;
  salaireMax?: number | null;
  periodeSalaire?: string | null;
  langues?: string[];
  permis?: boolean | null;
  experienceMin?: number | null;
  debut?: string | null;
  urgent?: boolean;
  exigences?: string | null;
  formule?: string | null;
  montantFrais?: number | null;
  notes?: string | null;
};

async function validerBesoin(s: SaisieBesoin) {
  const titre = (s.titre ?? '').replace(/\s+/g, ' ').trim();
  if (titre.length < 3 || titre.length > 160) throw new ErreurEmployeur('Intitulé du besoin : 3 à 160 caractères.');
  if (s.metier && !metierParCode(s.metier)) throw new ErreurEmployeur('Métier inconnu.');
  const postes = s.postes ?? 1;
  if (!Number.isInteger(postes) || postes < 1 || postes > 500) throw new ErreurEmployeur('Nombre de postes : de 1 à 500.');
  if (s.ville && !villeParCode(s.ville)) throw new ErreurEmployeur('Ville inconnue du référentiel.');
  const contrat = s.contrat ?? 'non_precise';
  if (!CONTRATS.est(contrat)) throw new ErreurEmployeur('Contrat inconnu.');
  const temps = s.temps ?? 'non_precise';
  if (!TEMPS_TRAVAIL.est(temps)) throw new ErreurEmployeur('Rythme inconnu.');
  if (s.logement && !LOGEMENT.est(s.logement)) throw new ErreurEmployeur('Logement inconnu.');
  const min = s.salaireMin ?? null;
  const max = s.salaireMax ?? null;
  if (min !== null && !(min > 0)) throw new ErreurEmployeur('Salaire minimum invalide.');
  if (max !== null && (min === null || max < min)) throw new ErreurEmployeur('Le salaire maximum doit être supérieur au minimum.');
  const periode = min !== null ? (s.periodeSalaire ?? 'mois') : null;
  if (periode && !PERIODES_SALAIRE.est(periode)) throw new ErreurEmployeur('Période de salaire inconnue.');
  if (s.debut && !/^\d{4}-\d{2}-\d{2}$/.test(s.debut)) throw new ErreurEmployeur('Date de début invalide.');
  const parametres = await chargerParametres();
  const formule = s.formule || null;
  if (formule && !['premium', 'serenite', 'sur_mesure'].includes(formule)) throw new ErreurEmployeur('Formule inconnue.');
  let frais = s.montantFrais ?? null;
  if (formule === 'premium' || formule === 'serenite') frais = parametres.commissions.formules[formule].montant;
  if (frais !== null && !(frais >= 0)) throw new ErreurEmployeur('Montant des frais invalide.');
  const langues = [...new Set(s.langues ?? [])].filter(Boolean);
  const langueInconnue = langues.find((code) => !LANGUES.est(code));
  if (langueInconnue !== undefined) throw new ErreurEmployeur(`Langue inconnue : ${langueInconnue.slice(0, 40)}`);
  const categories = await idsCategories();
  return {
    titre, categorie: s.metier ? (categories.get(s.metier) ?? null) : null, postes, ville: s.ville || null, quartier: s.quartier?.trim().slice(0, 80) || null, contrat, temps,
    logement: s.logement || null, min, max, periode, langues, permis: s.permis ?? null,
    experience: s.experienceMin ?? null, debut: s.debut || null, urgent: Boolean(s.urgent), exigences: s.exigences?.trim().slice(0, 2000) || null, formule, frais,
    notes: s.notes?.trim().slice(0, 2000) || null,
  };
}

export async function creerBesoin(saisie: SaisieBesoin, acteur: Acteur): Promise<{ id: string; reference: string }> {
  const v = await validerBesoin(saisie);
  return transaction(async (tx) => {
    const employeur = await uneLigne<{ status: string; is_demo: boolean }>(`SELECT status, is_demo FROM employers WHERE id = $1 FOR UPDATE`, [saisie.employeurId], tx);
    if (!employeur) throw new ErreurEmployeur('Employeur introuvable.');
    const cree = await uneLigne<{ id: string; reference: string }>(
      `INSERT INTO employer_needs (reference, employer_id, job_offer_id, category_id, title, headcount, city_code, district, contract_type, work_time, housing, salary_min,
                                   salary_max, salary_period, languages, driving_license, experience_min_years, start_date, is_urgent, requirements, fee_plan, fee_amount, notes, created_by)
       VALUES (${prochaineReference('BE', employeur.is_demo)}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) RETURNING id, reference`,
      [saisie.employeurId, saisie.offreId || null, v.categorie, v.titre, v.postes, v.ville, v.quartier, v.contrat, v.temps, v.logement, v.min, v.max, v.periode, v.langues, v.permis,
        v.experience, v.debut, v.urgent, v.exigences, v.formule, v.frais, v.notes, acteur.id],
      tx,
    );
    if (['prospect', 'a_contacter', 'contacte'].includes(employeur.status)) await changerStatutEmployeur(saisie.employeurId, 'besoin_qualifie', acteur, tx);
    await journaliser({ acteur, action: 'besoin.creation', entite: 'besoin', id: cree!.id, resume: `Besoin ${cree!.reference} : ${v.titre}` }, tx);
    return cree!;
  });
}

export async function modifierBesoin(id: string, saisie: SaisieBesoin, acteur: Acteur): Promise<void> {
  const v = await validerBesoin(saisie);
  const n = await executer(
    `UPDATE employer_needs SET category_id = $2, title = $3, headcount = $4, city_code = $5, district = $6, contract_type = $7, work_time = $8, housing = $9, salary_min = $10,
            salary_max = $11, salary_period = $12, languages = $13, driving_license = $14, experience_min_years = $15, start_date = $16, is_urgent = $17, requirements = $18,
            fee_plan = $19, fee_amount = $20, notes = $21 WHERE id = $1`,
    [id, v.categorie, v.titre, v.postes, v.ville, v.quartier, v.contrat, v.temps, v.logement, v.min, v.max, v.periode, v.langues, v.permis, v.experience, v.debut, v.urgent,
      v.exigences, v.formule, v.frais, v.notes],
  );
  if (!n) throw new ErreurEmployeur('Besoin introuvable.');
  await journaliser({ acteur, action: 'besoin.modification', entite: 'besoin', id, resume: `Besoin modifié : ${v.titre}` });
}

export async function changerStatutBesoin(id: string, statut: string, acteur: Acteur, tx?: Executeur): Promise<void> {
  if (!STATUTS_BESOIN.est(statut)) throw new ErreurEmployeur('Statut inconnu.');
  const avant = await uneLigne<{ status: string; reference: string }>(`SELECT status, reference FROM employer_needs WHERE id = $1`, [id], tx);
  if (!avant) throw new ErreurEmployeur('Besoin introuvable.');
  if (avant.status === statut) return;
  await executer(`UPDATE employer_needs SET status = $2 WHERE id = $1`, [id, statut], tx);
  await journaliser({ acteur, action: 'besoin.statut', entite: 'besoin', id, resume: `${avant.reference} : ${avant.status} › ${statut}` }, tx);
}

export type BesoinListe = {
  id: string; reference: string; employer_id: string; employeur: string; employer_type: string; job_offer_id: string | null; metier: string | null; title: string;
  headcount: number; city_code: string | null; district: string | null; contract_type: string; work_time: string; housing: string | null; salary_min: number | null;
  salary_max: number | null; salary_period: string | null; languages: string[]; driving_license: boolean | null; experience_min_years: number | null; start_date: string | null;
  is_urgent: boolean; requirements: string | null; status: string; fee_plan: string | null; fee_amount: number | null; notes: string | null; created_at: Date;
  correspondances: number; places: number; is_demo: boolean;
};

export async function listerBesoins(filtres: { statut?: string; employeur?: string; metier?: string; ville?: string } = {}): Promise<{ besoins: BesoinListe[] }> {
  const conditions: string[] = [];
  const valeurs: unknown[] = [];
  const p = (valeur: unknown) => `$${valeurs.push(valeur)}`;
  const statut = filtres.statut ?? 'ouverts';
  if (statut === 'ouverts') conditions.push(`n.status IN ('ouvert', 'en_cours')`);
  else if (statut !== 'tous') conditions.push(`n.status = ${p(statut)}`);
  if (filtres.employeur) conditions.push(`n.employer_id = ${p(filtres.employeur)}`);
  if (filtres.metier) conditions.push(`c.code = ${p(filtres.metier)}`);
  if (filtres.ville) conditions.push(`n.city_code = ${p(filtres.ville)}`);
  const besoins = await requete<BesoinListe>(
    `SELECT n.id, n.reference, n.employer_id, e.name AS employeur, e.employer_type, e.is_demo, n.job_offer_id, c.code AS metier, n.title, n.headcount, n.city_code, n.district,
            n.contract_type, n.work_time, n.housing, n.salary_min, n.salary_max, n.salary_period, n.languages, n.driving_license, n.experience_min_years, n.start_date,
            n.is_urgent, n.requirements, n.status, n.fee_plan, n.fee_amount, n.notes, n.created_at,
            (SELECT count(*)::int FROM matches m WHERE m.employer_need_id = n.id AND m.status NOT IN ('ecarte', 'refuse_candidat', 'refuse_employeur')) AS correspondances,
            (SELECT count(*)::int FROM placements pl WHERE pl.employer_need_id = n.id AND pl.status NOT IN ('annule', 'rompu')) AS places
       FROM employer_needs n JOIN employers e ON e.id = n.employer_id LEFT JOIN job_categories c ON c.id = n.category_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY n.is_urgent DESC, n.created_at DESC LIMIT 200`,
    valeurs,
  );
  return { besoins };
}

export async function besoinParId(id: string): Promise<BesoinListe | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { besoins } = await listerBesoinsParIds([id]);
  return besoins[0] ?? null;
}

async function listerBesoinsParIds(ids: string[]): Promise<{ besoins: BesoinListe[] }> {
  const besoins = await requete<BesoinListe>(
    `SELECT n.id, n.reference, n.employer_id, e.name AS employeur, e.employer_type, e.is_demo, n.job_offer_id, c.code AS metier, n.title, n.headcount, n.city_code, n.district,
            n.contract_type, n.work_time, n.housing, n.salary_min, n.salary_max, n.salary_period, n.languages, n.driving_license, n.experience_min_years, n.start_date,
            n.is_urgent, n.requirements, n.status, n.fee_plan, n.fee_amount, n.notes, n.created_at,
            (SELECT count(*)::int FROM matches m WHERE m.employer_need_id = n.id AND m.status NOT IN ('ecarte', 'refuse_candidat', 'refuse_employeur')) AS correspondances,
            (SELECT count(*)::int FROM placements pl WHERE pl.employer_need_id = n.id AND pl.status NOT IN ('annule', 'rompu')) AS places
       FROM employer_needs n JOIN employers e ON e.id = n.employer_id LEFT JOIN job_categories c ON c.id = n.category_id WHERE n.id = ANY($1::uuid[])`,
    [ids],
  );
  return { besoins };
}

export function posteDepuisBesoin(besoin: BesoinListe): PosteAPourvoir {
  return {
    ouvert: besoin.status === 'ouvert' || besoin.status === 'en_cours', metiers: besoin.metier ? [besoin.metier] : [], ville: besoin.city_code,
    experienceMinAnnees: besoin.experience_min_years, langues: besoin.languages ?? [], salaireMin: besoin.salary_min, salaireMax: besoin.salary_max,
    periodeSalaire: (besoin.salary_period as PeriodeSalaire | null) ?? null, logement: (besoin.housing as PosteAPourvoir['logement']) ?? null, tempsTravail: besoin.work_time,
    permis: besoin.driving_license, urgent: besoin.is_urgent, competences: [],
  };
}
