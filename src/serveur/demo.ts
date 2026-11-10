/**
 * Jeu de démonstration — DONNÉES FICTIVES.
 *
 * La base démarre vide : aucune offre n'est inventée. Ce jeu n'est chargé que
 * par une action explicite d'un administrateur, pour découvrir l'outil ou
 * former un courtier. Tout ce qu'il crée est marqué `is_demo`, affiché avec un
 * badge « FICTIF » et un bandeau sur chaque page, tenu à l'écart des alertes
 * et de l'appariement des fiches réelles, et supprimé en un clic.
 *
 * Aucune de ces annonces ne provient d'un site : employeurs, personnes et
 * textes sont imaginaires, sans lien ni numéro de téléphone.
 */
import { analyserOffre } from '@/collecte/pipeline';
import { offreDepuisSaisie, type SaisieManuelle } from '@/collecte/connecteurs/manuel';
import { calculerPourBesoin, calculerPourOffre, rafraichirScores } from './appariements';
import { journaliser, type Acteur } from './audit';
import { creerCandidat, type SaisieCandidat } from './candidats';
import { executer, requete, transaction, uneLigne } from './db';
import { creerBesoin, creerEmployeur, ajouterEchange } from './employeurs';
import { enregistrerOffre, politique } from './ingestion';
import { chargerParametres } from './parametres';
import { changerStatutCommission, changerStatutPlacement, creerPlacement } from './placements';
import { sourceParCode } from './sources';
import { ErreurMetier } from '@/domaine/erreurs';

const CODE_SOURCE = 'jeu-demonstration';
const JOUR = 86_400_000;

const jourAvant = (maintenant: Date, jours: number): string => new Date(maintenant.getTime() - jours * JOUR).toISOString().slice(0, 10);

type OffreDemo = Omit<SaisieManuelle, 'datePublication'> & { ilYa: number | null };

const OFFRES: OffreDemo[] = [
  { ilYa: 1, titre: 'Femme de ménage à domicile — Casablanca (Californie)', employeur: 'Famille Démo Californie', typeEmployeur: 'famille', texte: 'Famille de quatre personnes à Casablanca, quartier Californie, recherche une femme de ménage expérimentée pour l’entretien d’une villa : ménage, repassage, rangement. Poste non logé, du lundi au samedi, de 8 h à 16 h. Deux ans d’expérience demandés, références vérifiables. Salaire : 3 500 DH par mois, transport pris en charge. Contrat écrit et déclaration prévus.' },
  { ilYa: 2, titre: 'Nounou logée pour deux enfants — Rabat (Souissi)', employeur: 'Famille Démo Souissi', typeEmployeur: 'famille', texte: 'Famille à Rabat, quartier Souissi, cherche une nounou logée pour deux enfants de 2 et 5 ans. Garde, repas des enfants, accompagnement à l’école. Français parlé exigé, expérience de trois ans avec des enfants en bas âge. Chambre individuelle, un jour et demi de repos par semaine. Salaire 4 000 DH par mois. CDI après période d’essai.' },
  { ilYa: 3, titre: 'Recrutement urgent : 6 femmes de chambre pour la saison — Marrakech', employeur: 'Hôtel Démo Palmeraie', typeEmployeur: 'hotel', urgent: true, texte: 'Hôtel 4 étoiles à Marrakech (Palmeraie) recrute en urgence 6 femmes de chambre pour la haute saison. Nettoyage et remise en état des chambres, respect des standards d’hygiène. Expérience d’un an en hôtellerie souhaitée. CDD saisonnier de 6 mois, temps plein, repas fournis. Salaire 3 600 DH par mois + pourboires.' },
  { ilYa: 4, titre: 'Réceptionniste H/F — Riad à Marrakech (Médina)', employeur: 'Riad Démo Médina', typeEmployeur: 'riad', texte: 'Riad de 12 chambres dans la médina de Marrakech recherche un(e) réceptionniste. Accueil des clients, check-in et check-out, gestion des réservations, conciergerie. Français et anglais exigés, espagnol apprécié. Deux ans d’expérience. CDI, temps plein, horaires tournants. Salaire entre 5 000 et 6 000 DH par mois.' },
  { ilYa: 5, titre: 'Esthéticienne polyvalente — Institut à Casablanca (Maârif)', employeur: 'Institut Démo Maârif', typeEmployeur: 'salon', texte: 'Institut de beauté à Casablanca, quartier Maârif, recrute une esthéticienne polyvalente : soins du visage, épilation, manucure et pédicure. Diplôme en esthétique et deux ans d’expérience exigés. CDI, temps plein. Salaire 4 500 DH par mois + commissions sur les ventes.' },
  { ilYa: 6, titre: 'Spa thérapeute / masseuse — Spa d’hôtel à Agadir', employeur: 'Spa Démo Atlantique', typeEmployeur: 'spa', texte: 'Spa d’un hôtel en bord de mer à Agadir recherche une spa thérapeute : massages relaxants, hammam et gommage, soins du corps. Anglais souhaité. Trois ans d’expérience en spa hôtelier. CDI. Salaire 5 500 DH par mois, repas fournis.' },
  { ilYa: 7, titre: 'Cuisinière à domicile — Bouskoura', employeur: 'Famille Démo Bouskoura', typeEmployeur: 'famille', texte: 'Famille à Bouskoura (Ville Verte) cherche une cuisinière à domicile maîtrisant la cuisine marocaine et européenne. Courses, préparation des repas, entretien de la cuisine. Cinq jours par semaine, non logée. Salaire 4 500 DH par mois.' },
  { ilYa: 8, titre: 'Chauffeur privé — famille à Rabat (Hay Riad)', employeur: 'Famille Démo Hay Riad', typeEmployeur: 'famille', texte: 'Famille à Rabat, Hay Riad, recrute un chauffeur privé. Permis B depuis plus de cinq ans, excellente connaissance de Rabat et Salé, ponctualité et discrétion. Trajets école et déplacements quotidiens. CDI, temps plein. Salaire 5 000 DH par mois.' },
  { ilYa: 9, titre: 'Gouvernante d’étage — Hôtel à Tanger', employeur: 'Hôtel Démo Détroit', typeEmployeur: 'hotel', texte: 'Hôtel 5 étoiles à Tanger recrute une gouvernante d’étage : encadrement d’une équipe de 10 femmes de chambre, contrôle des chambres, gestion du linge. Cinq ans d’expérience dont deux en encadrement. Français et anglais. CDI. Salaire 8 000 DH par mois.' },
  { ilYa: 10, titre: 'Coiffeuse confirmée — Salon à Rabat (Agdal)', employeur: 'Salon Démo Agdal', typeEmployeur: 'salon', texte: 'Salon de coiffure à Rabat, quartier Agdal, cherche une coiffeuse confirmée : brushing, coloration, coupe, soins. Trois ans d’expérience. Temps plein. Salaire fixe 4 000 DH par mois + pourcentage.' },
  { ilYa: 12, titre: 'عاملة نظافة — الدار البيضاء', employeur: 'شركة ديمو للخدمات', typeEmployeur: 'entreprise', texte: 'شركة خدمات بالدار البيضاء تبحث عن عاملة نظافة للعمل في المكاتب. دوام كامل، من الاثنين إلى السبت. الأجر 3200 درهم في الشهر. الخبرة سنة واحدة على الأقل.' },
  { ilYa: 14, titre: 'Guest Relations Agent — Boutique hotel in Marrakech', employeur: 'Demo Boutique Hotel', typeEmployeur: 'hotel', texte: 'Boutique hotel in Marrakech is looking for a Guest Relations Agent. You will welcome guests, handle requests and reservations, and coordinate with housekeeping. Fluent English and French required. Two years of experience in hospitality. Full-time, permanent contract. Salary 6,500 MAD per month.' },
  { ilYa: 20, titre: 'Jardinier pour résidence — Dar Bouazza', employeur: 'Résidence Démo Océan', typeEmployeur: 'residence', texte: 'Résidence à Dar Bouazza recherche un jardinier : entretien des espaces verts, arrosage, taille. Trois jours par semaine, temps partiel. Salaire 200 DH par jour.' },
  // Cas volontairement problématiques, pour montrer les garde-fous.
  { ilYa: 2, titre: 'Femme de ménage — salaire élevé garanti, Casablanca', employeur: null, texte: 'Recrutement immédiat de femmes de ménage à Casablanca. Salaire garanti. Pour valider votre dossier, envoyez 300 DH de frais d’inscription par transfert d’argent avant l’entretien. Aucune expérience demandée.' },
  { ilYa: null, titre: 'Baby-sitter à Mohammedia', employeur: 'Famille Démo Mohammedia', typeEmployeur: 'famille', texte: 'Famille à Mohammedia cherche une baby-sitter pour les sorties d’école et le mercredi après-midi. Temps partiel. Annonce sans date de publication.' },
  { ilYa: 60, titre: 'Agent d’accueil — Résidence hôtelière à Agadir', employeur: 'Résidence Démo Souss', typeEmployeur: 'residence', texte: 'Résidence hôtelière à Agadir recrute un agent d’accueil pour la réception. Français et anglais. CDD de 3 mois. Salaire 4 000 DH par mois.' },
  // Même annonce reformulée (doublon probable, laissé à l'appréciation du courtier) puis recopiée telle quelle (doublon rattaché automatiquement).
  { ilYa: 3, titre: 'Hôtel Démo Palmeraie recrute des femmes de chambre (saison) — Marrakech', employeur: 'Hôtel Démo Palmeraie', typeEmployeur: 'hotel', urgent: true, texte: 'Hôtel 4 étoiles à Marrakech, Palmeraie : recrutement urgent de 6 femmes de chambre pour la haute saison. CDD saisonnier de 6 mois, temps plein, repas fournis. Salaire 3 600 DH par mois.' },
  { ilYa: 4, titre: 'Réceptionniste (H/F) - Riad à Marrakech, Médina', employeur: 'Riad Démo Médina', typeEmployeur: 'riad', texte: 'Riad de 12 chambres dans la médina de Marrakech recherche un(e) réceptionniste. Accueil des clients, check-in et check-out, gestion des réservations, conciergerie. Français et anglais exigés, espagnol apprécié. Deux ans d’expérience. CDI, temps plein, horaires tournants. Salaire entre 5 000 et 6 000 DH par mois.' },
];

type CandidatDemo = Omit<SaisieCandidat, 'consentementDonne' | 'consentementCanal' | 'nom'>;
const CANDIDATS: CandidatDemo[] = [
  { metiers: ['femme_menage', 'repassage_blanchisserie'], ville: 'casablanca', villesAcceptees: ['bouskoura', 'dar-bouazza'], experienceAnnees: 4, langues: ['darija', 'fr'], salaireAttendu: 3300, logement: 'non_loge', rythmes: ['temps_plein'], competences: ['menage', 'repassage'], documents: ['cin_passeport'], ageDeclare: 34 },
  { metiers: ['nounou', 'baby_sitter'], ville: 'rabat', villesAcceptees: ['sale', 'temara'], experienceAnnees: 6, langues: ['darija', 'fr'], salaireAttendu: 3800, logement: 'loge', rythmes: ['temps_plein'], competences: ['garde_enfants', 'premiers_secours'], documents: ['cin_passeport', 'certificat_medical'], ageDeclare: 41 },
  { metiers: ['femme_chambre', 'housekeeping'], ville: 'marrakech', experienceAnnees: 2, langues: ['darija', 'fr'], salaireAttendu: 3400, logement: 'non_loge', rythmes: ['temps_plein'], competences: ['menage'], ageDeclare: 27 },
  { metiers: ['femme_chambre'], ville: 'marrakech', experienceAnnees: 1, langues: ['darija'], salaireAttendu: 3200, logement: 'indifferent', rythmes: ['temps_plein', 'week_end'], competences: ['menage', 'repassage'], ageDeclare: 23 },
  { metiers: ['receptionniste', 'agent_accueil'], ville: 'marrakech', experienceAnnees: 3, langues: ['darija', 'fr', 'en'], salaireAttendu: 5200, logement: 'non_loge', rythmes: ['temps_plein', 'nuit'], competences: ['accueil_client', 'reservation_pms'], ageDeclare: 29 },
  { metiers: ['estheticienne', 'onglerie'], ville: 'casablanca', experienceAnnees: 5, langues: ['darija', 'fr'], salaireAttendu: 4500, logement: 'non_loge', rythmes: ['temps_plein'], competences: ['soins_visage', 'epilation', 'manucure_pedicure'], ageDeclare: 31 },
  { metiers: ['chauffeur_prive'], ville: 'rabat', villesAcceptees: ['sale', 'temara', 'kenitra'], experienceAnnees: 8, langues: ['darija', 'fr'], salaireAttendu: 5000, logement: 'non_loge', rythmes: ['temps_plein'], permis: true, competences: ['permis_conduire'], ageDeclare: 45 },
  { metiers: ['cuisinier_domicile', 'aide_cuisinier'], ville: 'casablanca', villesAcceptees: ['bouskoura', 'mohammedia'], experienceAnnees: 10, langues: ['darija', 'fr'], salaireAttendu: 4800, logement: 'non_loge', rythmes: ['temps_plein'], competences: ['cuisine_marocaine', 'cuisine_europeenne'], ageDeclare: 48 },
];

export type EtatDemo = { offres: number; candidats: number; employeurs: number };

export async function etatDemo(): Promise<EtatDemo> {
  const ligne = await uneLigne<EtatDemo>(
    `SELECT (SELECT count(*)::int FROM job_offers WHERE is_demo) AS offres, (SELECT count(*)::int FROM candidates WHERE is_demo) AS candidats, (SELECT count(*)::int FROM employers WHERE is_demo) AS employeurs`,
  );
  return ligne!;
}

export class ErreurDemo extends ErreurMetier {}

export async function chargerJeuDemo(acteur: Acteur, maintenant = new Date()): Promise<EtatDemo> {
  const avant = await etatDemo();
  if (avant.offres + avant.candidats + avant.employeurs > 0) throw new ErreurDemo('Le jeu de démonstration est déjà chargé. Supprimez-le avant de le recharger.');
  const parametres = await chargerParametres();
  await executer(
    `INSERT INTO job_sources (code, name, kind, collection_mode, is_active, legal_basis, permission_status, store_contacts, country_default, reliability_score, max_excerpt_chars, notes)
     VALUES ($1, 'Jeu de démonstration (données fictives)', 'manuel', 'texte_complet', true, 'Annonces imaginaires rédigées pour la démonstration : aucun site consulté.', 'non_requise', false, 'MA', 50, 600,
             'Créée par le chargement du jeu de démonstration ; supprimée avec lui.')
     ON CONFLICT (code) DO NOTHING`,
    [CODE_SOURCE],
  );
  const source = (await sourceParCode(CODE_SOURCE))!;
  const idsOffres: string[] = [];
  for (const [index, modele] of OFFRES.entries()) {
    const { ilYa, ...saisie } = modele;
    const brute = offreDepuisSaisie({ ...saisie, datePublication: ilYa === null ? null : jourAvant(maintenant, ilYa) });
    const analyse = analyserOffre({ ...brute, idExterne: `demo-${index + 1}` }, politique(source, { kind: 'manuel' }), { maintenant, parametres });
    if (analyse.type !== 'offre') continue;
    const resultat = await enregistrerOffre(analyse.offre, { sourceId: source.id, maintenant, parametres, acteur, origine: 'saisie', estDemo: true });
    idsOffres.push(resultat.id);
  }

  const candidats: string[] = [];
  for (const [index, profil] of CANDIDATS.entries()) {
    const cree = await creerCandidat(
      { ...profil, nom: `Candidat fictif n° ${index + 1}`, consentementDonne: true, consentementCanal: 'papier', origine: 'saisie', resume: 'Profil imaginaire du jeu de démonstration.' },
      acteur, maintenant, { estDemo: true },
    );
    candidats.push(cree.id);
  }

  const famille = await creerEmployeur({ type: 'famille', nom: 'Famille Démo Anfa (fictif)', ville: 'casablanca', quartier: 'Anfa', origine: 'demande_entrante', baseContact: 'demande_entrante', notes: 'Employeur imaginaire du jeu de démonstration.' }, acteur, undefined, { estDemo: true });
  const riad = await creerEmployeur({ type: 'riad', nom: 'Riad Démo Médina (fictif)', ville: 'marrakech', quartier: 'Médina', origine: 'saisie', baseContact: 'relation_existante', prochaineRelance: jourAvant(maintenant, 0), notes: 'Employeur imaginaire du jeu de démonstration.' }, acteur, undefined, { estDemo: true });
  await ajouterEchange(famille.id, { type: 'appel', resume: 'Besoin précisé : ménage et repassage, cinq jours par semaine (échange fictif).' }, acteur, maintenant);
  const besoinFamille = await creerBesoin({ employeurId: famille.id, titre: 'Femme de ménage non logée', metier: 'femme_menage', ville: 'casablanca', quartier: 'Anfa', contrat: 'cdi', temps: 'temps_plein', logement: 'non_loge', salaireMin: 3500, periodeSalaire: 'mois', langues: ['darija'], experienceMin: 2, formule: 'premium' }, acteur);
  const besoinRiad = await creerBesoin({ employeurId: riad.id, titre: 'Femmes de chambre pour la saison', metier: 'femme_chambre', postes: 3, ville: 'marrakech', contrat: 'saisonnier', temps: 'temps_plein', salaireMin: 3400, salaireMax: 3800, periodeSalaire: 'mois', urgent: true, formule: 'serenite' }, acteur);
  await calculerPourBesoin(besoinFamille.id, acteur, maintenant);
  await calculerPourBesoin(besoinRiad.id, acteur, maintenant);
  // Un placement réalisé, pour montrer le suivi des commissions (payeur : l'employeur).
  const placement = await creerPlacement({ employeurId: famille.id, candidatId: candidats[0]!, besoinId: besoinFamille.id, debut: jourAvant(maintenant, 10), contrat: 'cdi', salaire: 3500, avecCommissionFormule: true }, acteur, maintenant);
  await changerStatutPlacement(placement.id, 'confirme', acteur, null, maintenant);
  if (placement.commissionId) await changerStatutCommission(placement.commissionId, 'encaisse', { moyen: 'virement' }, acteur, maintenant);

  for (const id of idsOffres) {
    const offre = await uneLigne<{ effective_status: string }>(`SELECT effective_status FROM v_job_offers WHERE id = $1`, [id]);
    if (offre?.effective_status === 'actif') await calculerPourOffre(id, acteur, maintenant);
  }
  await rafraichirScores(idsOffres, maintenant);
  const etat = await etatDemo();
  await journaliser({ acteur, action: 'demo.chargement', entite: 'systeme', resume: `Jeu de démonstration chargé : ${etat.offres} offres, ${etat.candidats} candidats, ${etat.employeurs} employeurs (fictifs)`, changements: etat });
  return etat;
}

/**
 * Supprime tout ce que le jeu de démonstration a créé, et rien d'autre.
 * Une seule transaction : en cas d'erreur, rien n'est supprimé à moitié.
 */
export async function supprimerJeuDemo(acteur: Acteur): Promise<EtatDemo> {
  const avant = await etatDemo();
  await transaction(async (tx) => {
    const placements = await requete<{ id: string }>(`SELECT p.id FROM placements p JOIN candidates k ON k.id = p.candidate_id JOIN employers e ON e.id = p.employer_id WHERE k.is_demo OR e.is_demo`, [], tx);
    const ids = placements.map((placement) => placement.id);
    await executer(`DELETE FROM commissions WHERE placement_id = ANY($1::uuid[])`, [ids], tx);
    await executer(`DELETE FROM placements WHERE id = ANY($1::uuid[])`, [ids], tx);
    await executer(`DELETE FROM candidates WHERE is_demo`, [], tx);
    await executer(`DELETE FROM employers WHERE is_demo`, [], tx);
    await executer(`UPDATE job_offers SET duplicate_of_id = NULL WHERE is_demo AND duplicate_of_id IS NOT NULL`, [], tx);
    await executer(`DELETE FROM job_offers WHERE is_demo`, [], tx);
    await executer(`DELETE FROM job_sources WHERE code = $1`, [CODE_SOURCE], tx);
    // Les séries « YS-DEMO-… » repartent de 1 au prochain chargement ; les séries réelles ne sont jamais touchées.
    await executer(`DELETE FROM counters WHERE scope LIKE 'DEMO-%'`, [], tx);
    await journaliser({ acteur, action: 'demo.suppression', entite: 'systeme', resume: `Jeu de démonstration supprimé (${avant.offres} offres, ${avant.candidats} candidats, ${avant.employeurs} employeurs fictifs)`, changements: avant }, tx);
  });
  return avant;
}
