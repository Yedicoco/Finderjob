import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { basculerAlerte, creerAlerte, listerAlertes, listerNotifications, compterNonLues, marquerLues, notifierRelances, traiterAlertes, type Transport } from '@/serveur/alertes';
import { calculerPourBesoin, calculerPourCandidat, calculerPourOffre, changerStatutCorrespondance, listerCorrespondances, rafraichirScores } from '@/serveur/appariements';
import { anonymiserCandidat, candidatParId, changerStatutCandidat, creerCandidat, listerCandidats, purgerCandidatsExpires, type SaisieCandidat } from '@/serveur/candidats';
import { executer, requete, uneLigne } from '@/serveur/db';
import { chargerJeuDemo, etatDemo, supprimerJeuDemo } from '@/serveur/demo';
import { ajouterEchange, creerBesoin, creerEmployeur, employeurDepuisOffre, employeurParId, listerEmployeurs } from '@/serveur/employeurs';
import { importerSaisie } from '@/serveur/ingestion';
import { executerMaintenance, figerStatuts } from '@/serveur/maintenance';
import { offreParId, rechercherOffres } from '@/serveur/offres';
import { definirParametre, oublierParametres } from '@/serveur/parametres';
import { changerStatutCommission, changerStatutPlacement, commissionParId, creerCommission, creerPlacement, listerCommissions, totauxCommissions } from '@/serveur/placements';
import { tableauDeBord } from '@/serveur/tableau-de-bord';
import { fermerBase, MAINTENANT, preparerBase, type Monde } from './outils';

let monde: Monde;
const candidat = (surcharge: Partial<SaisieCandidat> = {}): SaisieCandidat => ({
  nom: 'Fatima Zahra Exemple', telephone: '06 00 00 00 11', consentementDonne: true, consentementCanal: 'papier', metiers: ['femme_menage'], ville: 'casablanca',
  experienceAnnees: 4, langues: ['darija', 'fr'], salaireAttendu: 3300, logement: 'non_loge', rythmes: ['temps_plein'], ageDeclare: 34, ...surcharge,
});
let offreMenage: string;

beforeAll(async () => {
  monde = await preparerBase();
  const resultat = await importerSaisie(
    { texte: 'Femme de ménage à domicile — Casablanca\nFamille à Casablanca, quartier Californie, cherche une femme de ménage expérimentée. Non logée, temps plein. Deux ans d’expérience. Salaire 3 500 DH par mois.', origine: 'employeur', employeur: 'Famille Exemple', typeEmployeur: 'famille', datePublication: '2026-11-08' },
    monde.acteurCourtier, MAINTENANT,
  );
  if (resultat.type === 'rejet') throw new Error('offre attendue');
  offreMenage = resultat.id;
});
afterAll(fermerBase);

describe('candidats : consentement, mineurs, chiffrement', () => {
  it('refuse une fiche sans consentement', async () => {
    await expect(creerCandidat(candidat({ consentementDonne: false }), monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/consentement/i);
    await expect(executer(`INSERT INTO candidates (reference, full_name_enc, consent_version, consent_channel, retention_until) VALUES ('X', 'v1.x', '1', 'papier', '2027-01-01')`)).rejects.toMatchObject({ code: '23502' });
  });

  it('refuse un code inconnu au lieu de l’ignorer', async () => {
    await expect(creerCandidat(candidat({ langues: ['francais'] }), monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/Langue inconnu/);
    await expect(creerCandidat(candidat({ metiers: ['astronaute'] }), monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/Métier inconnu/);
    await expect(creerCandidat(candidat({ villesAcceptees: ['paris'] }), monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/Ville inconnu/);
  });

  it('refuse un mineur, dans l’application comme dans la base', async () => {
    await expect(creerCandidat(candidat({ ageDeclare: 17 }), monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/mineure/);
    await expect(executer(`INSERT INTO candidates (reference, full_name_enc, declared_age, consent_given_at, consent_version, consent_channel, retention_until) VALUES ('X', 'v1.x', 16, now(), '1', 'papier', '2027-01-01')`)).rejects.toMatchObject({ code: '23514' });
  });

  it('chiffre l’identité et retrouve la fiche par téléphone ou par nom', async () => {
    const cree = await creerCandidat(candidat({ notes: 'Très bonne référence chez une famille à Anfa.' }), monde.acteurCourtier, MAINTENANT);
    expect(cree.reference).toBe('YS-CA-2026-0001');
    const brut = (await uneLigne<{ t: string }>(`SELECT row_to_json(k)::text AS t FROM candidates k WHERE id = $1`, [cree.id]))!.t;
    expect(brut).not.toMatch(/Fatima|Exemple|600000011|Anfa/);
    expect((await listerCandidats({ q: '+212 600 000 011' })).candidats.map((c) => c.reference)).toEqual([cree.reference]);
    expect((await listerCandidats({ q: 'fatima' })).candidats[0]!.nom).toBe('Fatima Zahra Exemple');
    expect((await listerCandidats({ q: 'inconnue' })).total).toBe(0);
    await expect(creerCandidat(candidat({ nom: 'Autre Personne' }), monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/existe déjà/);
  });

  it('journalise chaque consultation d’une fiche, sans donnée personnelle dans le journal', async () => {
    const { candidats } = await listerCandidats({});
    const fiche = await candidatParId(candidats[0]!.id, monde.acteurCourtier);
    expect(fiche).toMatchObject({ nom: 'Fatima Zahra Exemple', telephone: '+212600000011', notes: 'Très bonne référence chez une famille à Anfa.' });
    const journal = await requete<{ t: string }>(`SELECT row_to_json(a)::text AS t FROM audit_logs a WHERE entity_type = 'candidat'`);
    expect(journal.some((l) => l.t.includes('candidat.consultation'))).toBe(true);
    for (const ligne of journal) expect(ligne.t).not.toMatch(/Fatima|600000011/);
  });

  it('conserve 12 mois après la dernière activité', async () => {
    const ligne = await uneLigne<{ retention_until: string }>(`SELECT retention_until FROM candidates LIMIT 1`);
    expect(ligne!.retention_until).toBe('2027-11-10');
  });
});

describe('appariement', () => {
  it('suggère le candidat adapté et explique le score', async () => {
    const bilan = await calculerPourOffre(offreMenage, monde.acteurCourtier, MAINTENANT);
    expect(bilan).toMatchObject({ evalues: 1, retenus: 1 });
    const [suggestion] = await listerCorrespondances({ offreId: offreMenage });
    expect(suggestion!.score).toBeGreaterThanOrEqual(80);
    expect(suggestion!.status).toBe('suggere');
    expect(suggestion!.explanation.criteres.map((c) => c.code)).toEqual(expect.arrayContaining(['metier', 'lieu']));
    expect(JSON.stringify(suggestion!.explanation)).not.toMatch(/Fatima|34 ans|nationalit/i);
    // Le vivier remonte dans l'indice de placement de l'offre.
    const offre = await offreParId(offreMenage);
    expect((offre!.score_details.composantes as { candidats: number }).candidats).toBe(1);
  });

  it('ne suggère pas un candidat d’un autre métier dans une autre ville', async () => {
    const autre = await creerCandidat(candidat({ nom: 'Karim Exemple', telephone: '06 00 00 00 12', metiers: ['chauffeur_prive'], ville: 'tanger', permis: true }), monde.acteurCourtier, MAINTENANT);
    const bilan = await calculerPourOffre(offreMenage, monde.acteurCourtier, MAINTENANT);
    expect(bilan).toMatchObject({ evalues: 2, retenus: 1 });
    expect((await listerCorrespondances({ candidatId: autre.id }))).toHaveLength(0);
    expect((await calculerPourCandidat(autre.id, monde.acteurCourtier, MAINTENANT)).retenus).toBe(0);
  });

  it('refuse de proposer un candidat sur une offre qui n’est plus active', async () => {
    const [suggestion] = await listerCorrespondances({ offreId: offreMenage });
    await changerStatutCorrespondance(suggestion!.id, 'retenu', monde.acteurCourtier, MAINTENANT);
    await executer(`UPDATE job_offers SET expires_at = now() - interval '1 hour' WHERE id = $1`, [offreMenage]);
    await expect(changerStatutCorrespondance(suggestion!.id, 'propose', monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/plus active/);
    await expect(calculerPourOffre(offreMenage, monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/pas active/);
    await executer(`UPDATE job_offers SET expires_at = NULL WHERE id = $1`, [offreMenage]);
    await changerStatutCorrespondance(suggestion!.id, 'propose', monde.acteurCourtier, MAINTENANT);
    expect((await listerCandidats({ q: 'fatima' })).candidats[0]!.status).toBe('propose');
    await expect(changerStatutCorrespondance(suggestion!.id, 'suggere', monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/impossible/);
  });
});

describe('employeurs et besoins', () => {
  it('exige la base de traitement pour les coordonnées d’un particulier', async () => {
    await expect(creerEmployeur({ type: 'famille', nom: 'Famille B. — Californie', telephone: '06 00 00 00 21' }, monde.acteurCourtier)).rejects.toThrow(/09-08/);
    const cree = await creerEmployeur({ type: 'famille', nom: 'Famille B. — Californie', contact: 'Mme Exemple', telephone: '06 00 00 00 21', ville: 'casablanca', baseContact: 'demande_entrante', origine: 'demande_entrante' }, monde.acteurCourtier);
    const brut = (await uneLigne<{ t: string }>(`SELECT row_to_json(e)::text AS t FROM employers e WHERE id = $1`, [cree.id]))!.t;
    expect(brut).not.toMatch(/600000021|Mme Exemple/);
    const fiche = await employeurParId(cree.id, monde.acteurCourtier);
    expect(fiche).toMatchObject({ contact: 'Mme Exemple', telephone: '+212600000021', status: 'prospect' });
    expect((await listerEmployeurs({ q: '0600000021' })).total).toBe(1);
    expect((await listerEmployeurs({ q: 'famille b' })).total).toBe(1);
  });

  it('fait avancer le prospect et respecte « ne pas contacter »', async () => {
    const { employeurs } = await listerEmployeurs({});
    const id = employeurs[0]!.id;
    await ajouterEchange(id, { type: 'appel', resume: 'Besoin d’une femme de ménage, cinq jours par semaine.', prochaineAction: '2026-11-09' }, monde.acteurCourtier, MAINTENANT);
    expect((await employeurParId(id, monde.acteurCourtier))!.status).toBe('contacte');
    expect((await listerEmployeurs({ relances: true })).total).toBe(1);
    expect(await notifierRelances(new Date())).toBe(1);
    expect(await notifierRelances(new Date())).toBe(0);
    await executer(`UPDATE employers SET do_not_contact = true WHERE id = $1`, [id]);
    await expect(ajouterEchange(id, { type: 'whatsapp', resume: 'Relance' }, monde.acteurCourtier)).rejects.toThrow(/ne plus être contacté/);
    expect((await listerEmployeurs({ relances: true })).total).toBe(0);
    await executer(`UPDATE employers SET do_not_contact = false WHERE id = $1`, [id]);
  });

  it('crée la fiche employeur depuis une offre, une seule fois', async () => {
    const premier = await employeurDepuisOffre(offreMenage, monde.acteurCourtier);
    expect(premier.cree).toBe(true);
    const second = await employeurDepuisOffre(offreMenage, monde.acteurCourtier);
    expect(second).toMatchObject({ id: premier.id, cree: false });
  });

  it('qualifie un besoin et trouve des candidats', async () => {
    const { employeurs } = await listerEmployeurs({ q: 'famille b' });
    const besoin = await creerBesoin({ employeurId: employeurs[0]!.id, titre: 'Femme de ménage non logée', metier: 'femme_menage', ville: 'casablanca', logement: 'non_loge', temps: 'temps_plein', salaireMin: 3500, formule: 'premium' }, monde.acteurCourtier);
    expect(besoin.reference).toBe('YS-BE-2026-0001');
    expect((await employeurParId(employeurs[0]!.id, monde.acteurCourtier))).toMatchObject({ status: 'besoin_qualifie' });
    expect((await uneLigne<{ fee_amount: number }>(`SELECT fee_amount FROM employer_needs WHERE id = $1`, [besoin.id]))!.fee_amount).toBe(1000);
    expect((await calculerPourBesoin(besoin.id, monde.acteurCourtier, MAINTENANT)).retenus).toBe(1);
  });
});

describe('placements et commissions', () => {
  let placementId: string;

  it('enregistre un placement et la commission employeur de la formule', async () => {
    const { employeurs } = await listerEmployeurs({ q: 'famille b' });
    const { candidats } = await listerCandidats({ q: 'fatima' });
    const besoin = (await uneLigne<{ id: string }>(`SELECT id FROM employer_needs LIMIT 1`))!;
    const placement = await creerPlacement({ employeurId: employeurs[0]!.id, candidatId: candidats[0]!.id, besoinId: besoin.id, debut: '2026-11-15', salaire: 3500, avecCommissionFormule: true }, monde.acteurCourtier, MAINTENANT);
    placementId = placement.id;
    expect(placement.reference).toBe('YS-PL-2026-0001');
    expect(await uneLigne(`SELECT 1 FROM placements WHERE id = $1 AND replacement_until = '2027-05-15'`, [placement.id])).not.toBeNull();
    expect((await listerCandidats({ q: 'fatima' })).candidats[0]!.status).toBe('place');
    expect((await uneLigne<{ status: string }>(`SELECT status FROM employer_needs WHERE id = $1`, [besoin.id]))!.status).toBe('pourvu');
    const commission = await commissionParId(placement.commissionId!);
    expect(commission).toMatchObject({ payer: 'employeur', amount: 1000, status: 'du', label: 'Formule Premium' });
    await expect(creerPlacement({ employeurId: employeurs[0]!.id, candidatId: candidats[0]!.id, debut: '2026-11-20' }, monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/déjà un placement/);
  });

  it('REFUSE par défaut toute commission à la charge du travailleur', async () => {
    await expect(creerCommission(placementId, { payeur: 'travailleur', mode: 'forfait', montant: 200 }, monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/désactivée/);
    await expect(creerCommission(placementId, { payeur: 'travailleur', mode: 'forfait', montant: 200, accuseLecture: true, justification: 'Validation juridique écrite obtenue le 01/11/2026.' }, monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/désactivée/);
    // Même en écrivant directement dans la base, l'accusé de lecture et la justification sont exigés.
    await expect(executer(`INSERT INTO commissions (reference, placement_id, payer, calc_mode, amount) VALUES ('X', $1, 'travailleur', 'forfait', 200)`, [placementId])).rejects.toMatchObject({ code: '23514' });
    expect((await listerCommissions({ payeur: 'travailleur' }))).toHaveLength(0);
  });

  it('ne l’accepte qu’après activation justifiée, accusé de lecture et justification — le tout journalisé', async () => {
    await expect(definirParametre('commissions.travailleur_active', true, monde.acteurAdmin)).rejects.toThrow(/justification/i);
    await definirParametre('commissions.travailleur_active', true, monde.acteurAdmin, { justification: 'Avis écrit du conseil juridique du 01/11/2026 (test).' });
    oublierParametres();
    await expect(creerCommission(placementId, { payeur: 'travailleur', mode: 'forfait', montant: 200 }, monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/avertissement juridique/);
    await expect(creerCommission(placementId, { payeur: 'travailleur', mode: 'forfait', montant: 200, accuseLecture: true, justification: 'trop court' }, monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/justification/);
    const cree = await creerCommission(placementId, { payeur: 'travailleur', mode: 'pourcentage', base: 3500, taux: 10, accuseLecture: true, justification: 'Validation juridique écrite obtenue le 01/11/2026 (test).' }, monde.acteurCourtier, MAINTENANT);
    expect(cree.montant).toBe(350);
    const ligne = await commissionParId(cree.id);
    expect(ligne).toMatchObject({ payer: 'travailleur', accuse_par: 'Courtier Test' });
    expect(await uneLigne(`SELECT 1 FROM audit_logs WHERE action = 'commission.creation_travailleur' AND entity_id = $1`, [cree.id])).not.toBeNull();
    expect(await uneLigne(`SELECT 1 FROM audit_logs WHERE action = 'parametre.modification' AND summary ILIKE '%commissions.travailleur_active%'`)).not.toBeNull();
    await changerStatutCommission(cree.id, 'annule', { motif: 'Commission de test annulée' }, monde.acteurCourtier, MAINTENANT);
    await definirParametre('commissions.travailleur_active', false, monde.acteurAdmin);
    oublierParametres();
  });

  it('suit le cycle dû → facturé → encaissé et numérote le reçu', async () => {
    const [commission] = await listerCommissions({ payeur: 'employeur' });
    await expect(changerStatutCommission(commission!.id, 'encaisse', {}, monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/moyen de paiement/);
    await changerStatutCommission(commission!.id, 'facture', {}, monde.acteurCourtier, MAINTENANT);
    await changerStatutCommission(commission!.id, 'encaisse', { moyen: 'virement' }, monde.acteurCourtier, MAINTENANT);
    expect(await commissionParId(commission!.id)).toMatchObject({ status: 'encaisse', payment_method: 'virement', document_type: 'recu', document_number: 'YS-RE-2026-0001' });
    await expect(changerStatutCommission(commission!.id, 'du', {}, monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/impossible/);
    expect(await totauxCommissions()).toMatchObject({ encaisse: 1000, annule: 350, du: 0, parPayeur: { employeur: 1000, travailleur: 0 } });
  });

  it('une rupture rend le candidat de nouveau disponible et rouvre le besoin', async () => {
    await expect(changerStatutPlacement(placementId, 'rompu', monde.acteurCourtier, '', MAINTENANT)).rejects.toThrow(/motif/);
    await changerStatutPlacement(placementId, 'rompu', monde.acteurCourtier, 'Fin de la période d’essai à la demande de la famille', MAINTENANT);
    expect((await listerCandidats({ q: 'fatima' })).candidats[0]!.status).toBe('contacte');
    expect((await uneLigne<{ status: string }>(`SELECT status FROM employer_needs LIMIT 1`))!.status).toBe('en_cours');
  });
});

describe('alertes', () => {
  const transport = (journal: string[]): Transport => ({
    email: async (a, sujet) => { journal.push(`email:${a}:${sujet}`); return { statut: 'envoye' }; },
    whatsapp: async () => ({ statut: 'simule', detail: 'non configuré' }),
  });

  it('signale une nouvelle offre correspondante, une seule fois', async () => {
    const avant = new Date(Date.now() - 60_000);
    await creerAlerte(monde.courtier.id, { nom: 'Nounous à Rabat', criteres: { categories: ['nounou'], villes: ['rabat'] }, canaux: ['interne', 'email'], frequence: 'immediat' }, monde.acteurCourtier, avant);
    await creerAlerte(monde.courtier.id, { nom: 'Hôtellerie à Agadir', criteres: { secteurs: ['hospitalite'], villes: ['agadir'] }, canaux: ['interne'], frequence: 'immediat' }, monde.acteurCourtier, avant);
    await importerSaisie({ texte: 'Nounou pour deux enfants à Rabat\nFamille à Rabat, quartier Agdal, cherche une nounou expérimentée, non logée. Salaire 4 000 DH par mois.', origine: 'employeur', datePublication: new Date().toISOString().slice(0, 10) }, monde.acteurCourtier);
    const envois: string[] = [];
    const bilan = await traiterAlertes({ transport: transport(envois) });
    expect(bilan).toMatchObject({ alertes: 2, notifications: 1, envoyes: 1 });
    expect(envois).toEqual(['email:courtier@yallah.example:Nouvelle offre : Nounou pour deux enfants à Rabat']);
    expect(await compterNonLues(monde.courtier.id)).toBeGreaterThanOrEqual(1);
    const encore = await traiterAlertes({ transport: transport(envois) });
    expect(encore.notifications).toBe(0);
    expect(envois).toHaveLength(1);
  });

  it('marque « simulé » un envoi sans fournisseur configuré, jamais « envoyé »', async () => {
    const [alerte] = await listerAlertes(monde.courtier.id);
    await executer(`UPDATE alerts SET channels = '{interne,email}', last_run_at = now() - interval '1 minute' WHERE id = $1`, [alerte!.id]);
    await importerSaisie({ texte: 'Nounou de nuit à Rabat\nFamille à Rabat (Souissi) cherche une nounou de nuit pour un nourrisson. Salaire 4 500 DH par mois.', origine: 'employeur', datePublication: new Date().toISOString().slice(0, 10) }, monde.acteurCourtier);
    const bilan = await traiterAlertes({});
    expect(bilan).toMatchObject({ notifications: 1, envoyes: 0, simules: 1 });
    const externes = await listerNotifications(monde.courtier.id, { canal: 'externe' });
    expect(externes[0]).toMatchObject({ channel: 'email', status: 'simule' });
  });

  it('n’alerte jamais sur une offre douteuse ou expirée', async () => {
    await importerSaisie({ texte: 'Nounou à Rabat sans date\nFamille à Rabat cherche une nounou. Temps partiel, mercredi et samedi.', origine: 'employeur' }, monde.acteurCourtier);
    expect((await traiterAlertes({})).notifications).toBe(0);
  });

  it('lit, marque comme lues et met en pause', async () => {
    const internes = await listerNotifications(monde.courtier.id);
    expect(internes.length).toBeGreaterThanOrEqual(2);
    await marquerLues(monde.courtier.id);
    expect(await compterNonLues(monde.courtier.id)).toBe(0);
    const [alerte] = await listerAlertes(monde.courtier.id);
    await basculerAlerte(alerte!.id, monde.courtier.id, false);
    await expect(basculerAlerte(alerte!.id, monde.lecteur.id, true)).rejects.toThrow(/introuvable/);
  });
});

describe('conservation et anonymisation', () => {
  it('anonymise une fiche à la demande : plus aucune donnée identifiante, historique conservé', async () => {
    const { candidats } = await listerCandidats({ q: 'karim' });
    await anonymiserCandidat(candidats[0]!.id, 'demande_candidat', monde.acteurCourtier, MAINTENANT);
    const ligne = await uneLigne<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = $1`, [candidats[0]!.id]);
    expect(ligne).toMatchObject({ full_name_enc: null, phone_enc: null, phone_bidx: null, email_enc: null, notes_enc: null, declared_age: null, anonymized_reason: 'demande_candidat' });
    expect((await listerCandidats({ q: 'karim' })).total).toBe(0);
    await expect(changerStatutCandidat(candidats[0]!.id, 'contacte', monde.acteurCourtier)).rejects.toThrow(/anonymisée/);
    // La base refuse une anonymisation incomplète.
    await expect(executer(`UPDATE candidates SET anonymized_at = now() WHERE anonymized_at IS NULL`)).rejects.toMatchObject({ code: '23514' });
  });

  it('anonymise automatiquement en fin de conservation, sauf les candidats placés', async () => {
    const cree = await creerCandidat(candidat({ nom: 'Ancienne Candidate', telephone: '06 00 00 00 13' }), monde.acteurCourtier, new Date('2025-06-01T10:00:00Z'));
    expect(await purgerCandidatsExpires(monde.acteurAdmin, MAINTENANT)).toBe(1);
    expect(await uneLigne(`SELECT 1 FROM candidates WHERE id = $1 AND anonymized_reason = 'fin_conservation'`, [cree.id])).not.toBeNull();
  });
});

describe('maintenance et tableau de bord', () => {
  it('inscrit en base les expirations constatées par la vue, avec une ligne d’historique', async () => {
    await executer(`UPDATE job_offers SET published_at = now() - interval '50 days' WHERE id = $1`, [offreMenage]);
    expect(await figerStatuts()).toBe(1);
    expect(await offreParId(offreMenage)).toMatchObject({ status: 'expire', status_reason: 'expiree_anciennete' });
    expect((await offreParId(offreMenage))!.versions[0]).toMatchObject({ origin: 'maintenance' });
    expect(await figerStatuts()).toBe(0);
  });

  it('s’exécute sans erreur et reste idempotente', async () => {
    await executerMaintenance();
    const second = await executerMaintenance();
    expect(second).toMatchObject({ statutsFiges: 0, candidatsAnonymises: 0 });
    expect(await rafraichirScores()).toBe(0);
  });

  it('calcule le tableau de bord à partir de la base', async () => {
    const t = await tableauDeBord();
    expect(t.offres.fictives).toBe(0);
    expect(t.offres.actives).toBe((await rechercherOffres({})).total);
    expect(t.placements.total).toBe(1);
    expect(t.commissions.encaisse).toBe(1000);
    expect(t.parJour).toHaveLength(30);
    expect(t.placements.parMois).toHaveLength(6);
  });
});

describe('jeu de démonstration (données fictives, sur demande)', () => {
  const compteursReels = () => requete<{ scope: string; year: number; last_value: number }>(`SELECT scope, year, last_value FROM counters WHERE scope NOT LIKE 'DEMO-%' ORDER BY scope, year`);
  let compteursAvant: Awaited<ReturnType<typeof compteursReels>>;
  let totauxAvant: Awaited<ReturnType<typeof totauxCommissions>>;

  it('charge des données toutes marquées fictives, à l’écart des données réelles', async () => {
    const reelsAvant = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offers WHERE NOT is_demo`))!.n;
    compteursAvant = await compteursReels();
    totauxAvant = await totauxCommissions();
    const etat = await chargerJeuDemo(monde.acteurAdmin);
    expect(etat).toEqual({ offres: 18, candidats: 8, employeurs: 2 });
    await expect(chargerJeuDemo(monde.acteurAdmin)).rejects.toThrow(/déjà chargé/);
    const statuts = await requete<{ s: string; r: string; n: number }>(`SELECT effective_status AS s, effective_reason AS r, count(*)::int AS n FROM v_job_offers WHERE is_demo GROUP BY 1, 2 ORDER BY 1, 2`);
    expect(statuts).toEqual([
      { s: 'actif', r: 'aucun', n: 14 },
      { s: 'archive', r: 'doublon', n: 1 },
      { s: 'douteux', r: 'date_inconnue', n: 1 },
      { s: 'douteux', r: 'risque_eleve', n: 1 },
      { s: 'expire', r: 'expiree_anciennete', n: 1 },
    ]);
    // La reformulation n'est pas rattachée d'office : elle attend l'avis d'un courtier.
    const probable = await uneLigne<{ d: { reference: string } }>(`SELECT score_details->'doublonProbable' AS d FROM job_offers WHERE is_demo AND requires_human_review AND score_details ? 'doublonProbable'`);
    expect(probable!.d.reference).toMatch(/^YS-DEMO-OF-/);
    expect(await uneLigne(`SELECT 1 FROM job_offers WHERE is_demo AND is_bulk_hiring AND headcount = 6`)).not.toBeNull();
    // Aucun lien, aucun téléphone inventé.
    expect(await uneLigne(`SELECT 1 FROM job_offers WHERE is_demo AND (source_url IS NOT NULL OR contact_phone_enc IS NOT NULL)`)).toBeNull();
    // Jamais de correspondance entre une fiche fictive et une fiche réelle.
    expect(await uneLigne(`SELECT 1 FROM matches m JOIN candidates k ON k.id = m.candidate_id LEFT JOIN job_offers o ON o.id = m.job_offer_id WHERE o.id IS NOT NULL AND o.is_demo <> k.is_demo`)).toBeNull();
    expect((await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM matches m JOIN candidates k ON k.id = m.candidate_id WHERE k.is_demo`))!.n).toBeGreaterThan(5);
    expect((await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM job_offers WHERE NOT is_demo`))!.n).toBe(reelsAvant);
    // Les alertes ignorent les offres fictives.
    await executer(`UPDATE alerts SET is_active = true, last_run_at = now() - interval '1 hour'`);
    expect((await traiterAlertes({})).notifications).toBe(0);
  });

  it('numérote les fiches fictives dans des séries à part : aucun numéro réel n’est consommé', async () => {
    for (const table of ['job_offers', 'candidates', 'employers']) {
      expect(await uneLigne(`SELECT 1 FROM ${table} WHERE is_demo AND reference NOT LIKE 'YS-DEMO-%'`), table).toBeNull();
      expect(await uneLigne(`SELECT 1 FROM ${table} WHERE NOT is_demo AND reference LIKE 'YS-DEMO-%'`), table).toBeNull();
    }
    const fictifs = await requete<{ besoin: string; placement: string; commission: string; recu: string | null }>(
      `SELECT n.reference AS besoin, p.reference AS placement, co.reference AS commission, co.document_number AS recu
         FROM placements p JOIN employers e ON e.id = p.employer_id JOIN employer_needs n ON n.id = p.employer_need_id JOIN commissions co ON co.placement_id = p.id WHERE e.is_demo`);
    expect(fictifs).toHaveLength(1);
    expect(fictifs[0]!.besoin).toMatch(/^YS-DEMO-BE-/);
    expect(fictifs[0]!.placement).toMatch(/^YS-DEMO-PL-/);
    expect(fictifs[0]!.commission).toMatch(/^YS-DEMO-CO-/);
    // Le reçu fictif ne prend pas de numéro dans la série des reçus réels.
    expect(fictifs[0]!.recu).toMatch(/^YS-DEMO-RE-/);
    expect(await compteursReels()).toEqual(compteursAvant);
  });

  it('n’additionne aucun montant fictif : commissions et tableau de bord restent ceux des données réelles', async () => {
    const toutes = await listerCommissions();
    const fictives = toutes.filter((commission) => commission.fictif);
    expect(fictives).toHaveLength(1);
    expect(fictives[0]!.status).toBe('encaisse');
    expect(fictives[0]!.amount).toBeGreaterThan(0);
    expect(await totauxCommissions()).toEqual(totauxAvant);
    const t = await tableauDeBord();
    expect(t.offres.fictives).toBe(18);
    expect(t.commissions.encaisse).toBe(totauxAvant.encaisse);
    expect(t.commissions.du).toBe(totauxAvant.du);
    // Une fiche fictive ne peut pas être placée chez un employeur réel (ni l'inverse).
    const fictif = await uneLigne<{ id: string }>(`SELECT id FROM candidates WHERE is_demo AND status = 'nouveau' LIMIT 1`);
    const reel = await uneLigne<{ id: string }>(`SELECT id FROM employers WHERE NOT is_demo LIMIT 1`);
    await expect(creerPlacement({ candidatId: fictif!.id, employeurId: reel!.id, debut: '2026-12-01', contrat: 'cdi' }, monde.acteurCourtier, MAINTENANT)).rejects.toThrow(/fictive/);
  });

  it('se supprime entièrement, sans toucher aux données réelles', async () => {
    const reels = await uneLigne<{ o: number; k: number; e: number; p: number }>(`SELECT (SELECT count(*)::int FROM job_offers WHERE NOT is_demo) AS o, (SELECT count(*)::int FROM candidates WHERE NOT is_demo) AS k, (SELECT count(*)::int FROM employers WHERE NOT is_demo) AS e, (SELECT count(*)::int FROM placements) AS p`);
    await supprimerJeuDemo(monde.acteurAdmin);
    expect(await etatDemo()).toEqual({ offres: 0, candidats: 0, employeurs: 0 });
    const apres = await uneLigne<{ o: number; k: number; e: number; p: number }>(`SELECT (SELECT count(*)::int FROM job_offers) AS o, (SELECT count(*)::int FROM candidates) AS k, (SELECT count(*)::int FROM employers) AS e, (SELECT count(*)::int FROM placements) AS p`);
    expect(apres).toEqual({ ...reels, p: reels!.p - 1 });
    expect(await uneLigne(`SELECT 1 FROM job_sources WHERE code = 'jeu-demonstration'`)).toBeNull();
    // Les séries réelles n'ont pas bougé ; les séries fictives repartent de 1 au prochain chargement.
    expect(await compteursReels()).toEqual(compteursAvant);
    expect(await uneLigne(`SELECT 1 FROM counters WHERE scope LIKE 'DEMO-%'`)).toBeNull();
    expect(await totauxCommissions()).toEqual(totauxAvant);
  });

  it('se recharge après suppression, avec les mêmes références fictives', async () => {
    await chargerJeuDemo(monde.acteurAdmin);
    expect(await uneLigne(`SELECT 1 FROM job_offers WHERE reference = 'YS-DEMO-OF-2026-0001' AND is_demo`)).not.toBeNull();
    expect(await compteursReels()).toEqual(compteursAvant);
    await supprimerJeuDemo(monde.acteurAdmin);
    expect(await etatDemo()).toEqual({ offres: 0, candidats: 0, employeurs: 0 });
  });
});
