/**
 * Référentiels : valeurs autorisées et libellés français affichés.
 *
 * Une seule source pour la base (contraintes CHECK de db/migrations), la
 * validation de l'API et l'interface. Les codes viennent du cahier des charges
 * (statuts d'offre, de candidat, d'employeur, de commission) et du formulaire
 * de candidature du site Yallah Services (expérience, logement, langues,
 * documents, liens de référence).
 */

/** Avertissement obligatoire, affiché sur chaque liste et chaque fiche d'offre. */
export const AVERTISSEMENT_ENGAGEMENT =
  'Vérifiez toujours l’employeur, le contrat et les conditions avant tout engagement.';

/** Mention d'identité, reprise des mentions légales du site Yallah Services. */
export const MENTION_INTERMEDIAIRE =
  'Yallah Services met en relation ; l’employeur reste seul responsable du contrat, du salaire et des conditions de travail.';

function creerReferentiel<const T extends Record<string, string>>(libelles: T) {
  const codes = Object.keys(libelles) as [keyof T & string, ...(keyof T & string)[]];
  return {
    codes,
    libelles,
    // Object.hasOwn : « constructor » ou « toString » ne sont pas des codes valides.
    libelle: (code: string | null | undefined): string => (code ? (Object.hasOwn(libelles, code) ? (libelles as Record<string, string>)[code]! : code) : '—'),
    options: codes.map((code) => ({ valeur: code, libelle: libelles[code] as string })),
    est: (valeur: unknown): valeur is keyof T & string => typeof valeur === 'string' && Object.hasOwn(libelles, valeur),
  };
}

export const CONTRATS = creerReferentiel({
  cdi: 'CDI',
  cdd: 'CDD',
  interim: 'Intérim',
  saisonnier: 'Saisonnier',
  journalier: 'À la journée',
  stage: 'Stage',
  freelance: 'Indépendant',
  anapec: 'Contrat ANAPEC',
  non_precise: 'Contrat non précisé',
});

export const TEMPS_TRAVAIL = creerReferentiel({
  temps_plein: 'Temps plein',
  temps_partiel: 'Temps partiel',
  nuit: 'Nuit',
  week_end: 'Week-end',
  non_precise: 'Rythme non précisé',
});

export const MODES_TRAVAIL = creerReferentiel({
  sur_site: 'Sur site',
  a_domicile: 'Au domicile de l’employeur',
  hybride: 'Hybride',
  teletravail: 'Télétravail',
  non_precise: 'Mode non précisé',
});

export const NIVEAUX_EXPERIENCE = creerReferentiel({
  debutant: 'Aucune expérience',
  moins_1_an: 'Moins d’un an',
  '1_2_ans': '1 à 2 ans',
  '3_5_ans': '3 à 5 ans',
  plus_5_ans: 'Plus de 5 ans',
  non_precise: 'Non précisée',
});

export const LANGUES = creerReferentiel({
  darija: 'Darija marocaine',
  ar: 'Arabe',
  fr: 'Français',
  en: 'Anglais',
  amazigh: 'Amazigh',
  es: 'Espagnol',
  de: 'Allemand',
  it: 'Italien',
});

export const LOGEMENT = creerReferentiel({
  loge: 'Logé(e)',
  non_loge: 'Non logé(e)',
  indifferent: 'Peu importe',
});

export const PERIODES_SALAIRE = creerReferentiel({
  mois: 'par mois',
  semaine: 'par semaine',
  jour: 'par jour',
  heure: 'par heure',
});

export const STATUTS_OFFRE = creerReferentiel({
  actif: 'Active',
  expire: 'Expirée',
  douteux: 'Douteuse',
  archive: 'Archivée',
});

export const MOTIFS_STATUT = creerReferentiel({
  aucun: '',
  date_inconnue: 'Date inconnue',
  date_incoherente: 'Date incohérente',
  hors_perimetre_date: 'Hors périmètre (antérieure à 2026)',
  localisation_inconnue: 'Lieu non confirmé au Maroc',
  expiree_source: 'Expirée selon la source',
  expiree_anciennete: 'Trop ancienne',
  non_reverifiee: 'Non revérifiée récemment',
  risque_eleve: 'Risque élevé',
  doublon: 'Doublon d’une autre offre',
  source_indisponible: 'Source indisponible',
  rejetee_moderation: 'Écartée après vérification',
  pourvue: 'Poste pourvu',
  archivage_manuel: 'Archivée manuellement',
});

export const STATUTS_VERIFICATION = creerReferentiel({
  non_requise: 'Vérification non requise',
  a_verifier: 'À vérifier',
  verifiee: 'Vérifiée par un courtier',
  rejetee: 'Rejetée',
});

export const TYPES_EMPLOYEUR = creerReferentiel({
  famille: 'Famille',
  particulier: 'Particulier',
  residence: 'Résidence',
  riad: 'Riad',
  hotel: 'Hôtel',
  spa: 'Spa',
  salon: 'Salon',
  entreprise: 'Entreprise',
  autre: 'Autre',
});

export const STATUTS_EMPLOYEUR = creerReferentiel({
  prospect: 'Prospect',
  a_contacter: 'À contacter',
  contacte: 'Contacté',
  besoin_qualifie: 'Besoin qualifié',
  candidats_proposes: 'Candidats proposés',
  placement_realise: 'Placement réalisé',
  cloture: 'Clôturé',
});

export const BASES_CONTACT = creerReferentiel({
  demande_entrante: 'L’employeur a contacté Yallah Services',
  relation_existante: 'Client existant',
  annonce_publique: 'Annonce publique de l’employeur',
  consentement: 'Consentement recueilli',
  non_renseignee: 'Non renseignée',
});

export const TYPES_ECHANGE = creerReferentiel({
  appel: 'Appel',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  visite: 'Visite',
  note: 'Note',
});

export const STATUTS_CANDIDAT = creerReferentiel({
  nouveau: 'Nouveau',
  contacte: 'Contacté',
  entretien: 'Entretien',
  propose: 'Proposé',
  place: 'Placé',
  refuse: 'Refusé',
  indisponible: 'Indisponible',
});

export const CANAUX_CONSENTEMENT = creerReferentiel({
  formulaire: 'Formulaire signé ou en ligne',
  whatsapp: 'Message WhatsApp du candidat',
  papier: 'Document papier',
  telephone: 'Accord donné par téléphone',
  import: 'Repris du formulaire Yallah Services',
});

export const DOCUMENTS_CANDIDAT = creerReferentiel({
  cin_passeport: 'CIN ou passeport',
  carte_sejour: 'Carte de séjour',
  certificat_medical: 'Certificat médical',
  attestation_travail: 'Attestation de travail',
  photos_identite: 'Photos d’identité',
});

export const LIENS_REFERENCE = creerReferentiel({
  ancien_employeur: 'Ancien employeur',
  employeur_actuel: 'Employeur actuel',
  responsable_entreprise: 'Responsable d’entreprise',
  collegue: 'Collègue',
  famille_recommandante: 'Famille recommandante',
  autre: 'Autre',
});

export const STATUTS_CORRESPONDANCE = creerReferentiel({
  suggere: 'Suggéré',
  retenu: 'Retenu',
  propose: 'Proposé à l’employeur',
  entretien: 'Entretien',
  accepte: 'Accepté',
  refuse_candidat: 'Refusé par le candidat',
  refuse_employeur: 'Refusé par l’employeur',
  ecarte: 'Écarté',
});

export const STATUTS_BESOIN = creerReferentiel({
  ouvert: 'Ouvert',
  en_cours: 'En cours',
  pourvu: 'Pourvu',
  annule: 'Annulé',
});

export const STATUTS_PLACEMENT = creerReferentiel({
  en_cours: 'En cours',
  confirme: 'Confirmé',
  termine: 'Terminé',
  rompu: 'Rompu',
  annule: 'Annulé',
});

export const STATUTS_COMMISSION = creerReferentiel({
  du: 'Dû',
  facture: 'Facturé',
  encaisse: 'Encaissé',
  annule: 'Annulé',
});

export const PAYEURS = creerReferentiel({
  employeur: 'Employeur',
  travailleur: 'Travailleur',
});

export const MODES_CALCUL = creerReferentiel({
  forfait: 'Montant fixe',
  pourcentage: 'Pourcentage du salaire',
});

export const MOYENS_PAIEMENT = creerReferentiel({
  especes: 'Espèces',
  virement: 'Virement',
  cheque: 'Chèque',
  autre: 'Autre',
});

export const CANAUX_ALERTE = creerReferentiel({
  interne: 'Notification interne',
  email: 'E-mail',
  whatsapp: 'WhatsApp Business',
});

export const FREQUENCES_ALERTE = creerReferentiel({
  immediat: 'Dès qu’une offre arrive',
  quotidien: 'Résumé quotidien',
  hebdomadaire: 'Résumé hebdomadaire',
});

export const ROLES = creerReferentiel({
  administrateur: 'Administrateur',
  courtier: 'Courtier',
  lecteur: 'Lecteur',
});

export type CodeRole = (typeof ROLES.codes)[number];

/**
 * Ce que l'application a le droit de faire et de conserver pour une source.
 *   desactive      rien, même pas un import manuel
 *   manuel         import manuel assisté seulement ; on garde un extrait court et le lien
 *   index_liens    collecte automatisée ; on garde le titre, le lien et la date
 *   extrait        collecte automatisée ; on garde un extrait court et le lien
 *   texte_complet  le texte entier est conservé (annonce confiée par l'employeur,
 *                  ou site ayant donné une autorisation écrite)
 */
export const MODES_COLLECTE = creerReferentiel({
  desactive: 'Désactivée',
  manuel: 'Import manuel : extrait court + lien',
  index_liens: 'Automatisée : titre, lien et date',
  extrait: 'Automatisée : extrait court + lien',
  texte_complet: 'Texte complet (annonce confiée ou autorisation écrite)',
});

export const STATUTS_AUTORISATION = creerReferentiel({
  non_requise: 'Non requise',
  non_demandee: 'Non demandée',
  demandee: 'Demandée, en attente',
  accordee: 'Accordée',
  refusee: 'Refusée',
});

export const TYPES_SOURCE = creerReferentiel({
  rss: 'Flux RSS / Atom',
  sitemap: 'Sitemap + pages publiques',
  api: 'API officielle',
  manuel: 'Saisie assistée',
  fichier: 'Fichier CSV / JSON',
});

export const STATUTS_EXECUTION = creerReferentiel({
  en_cours: 'En cours',
  succes: 'Succès',
  partiel: 'Partiel',
  echec: 'Échec',
  ignore: 'Ignorée',
});

/** Compétences proposées par défaut (formulaire de candidature Yallah + besoins des trois secteurs). */
export const COMPETENCES: { code: string; fr: string; ar: string; en: string; cles: string[] }[] = [
  { code: 'menage', fr: 'Ménage', ar: 'التنظيف', en: 'Cleaning', cles: ['ménage', 'nettoyage', 'entretien', 'تنظيف', 'cleaning'] },
  { code: 'repassage', fr: 'Repassage', ar: 'كي الملابس', en: 'Ironing', cles: ['repassage', 'linge', 'كي', 'ironing', 'laundry'] },
  { code: 'cuisine_marocaine', fr: 'Cuisine marocaine', ar: 'الطبخ المغربي', en: 'Moroccan cooking', cles: ['cuisine marocaine', 'plats marocains', 'tajine', 'الطبخ المغربي'] },
  { code: 'cuisine_europeenne', fr: 'Cuisine européenne', ar: 'الطبخ الأوروبي', en: 'European cooking', cles: ['cuisine européenne', 'cuisine française', 'cuisine italienne', 'cuisine internationale'] },
  { code: 'garde_enfants', fr: 'Garde d’enfants', ar: 'رعاية الأطفال', en: 'Childcare', cles: ['garde d\'enfants', 'enfants', 'bébé', 'nourrisson', 'اطفال', 'childcare'] },
  { code: 'soins_personnes_agees', fr: 'Soins aux personnes âgées', ar: 'رعاية المسنين', en: 'Elderly care', cles: ['personnes âgées', 'personne âgée', 'المسنين', 'elderly'] },
  { code: 'permis_conduire', fr: 'Permis de conduire', ar: 'رخصة السياقة', en: 'Driving licence', cles: ['permis de conduire', 'permis b', 'رخصة السياقة', 'driving licence'] },
  { code: 'service_table', fr: 'Service à table', ar: 'خدمة المائدة', en: 'Table service', cles: ['service à table', 'service en salle', 'mise en place'] },
  { code: 'soins_visage', fr: 'Soins du visage', ar: 'العناية بالبشرة', en: 'Facials', cles: ['soins du visage', 'soin visage', 'facial'] },
  { code: 'epilation', fr: 'Épilation', ar: 'إزالة الشعر', en: 'Hair removal', cles: ['épilation', 'cire', 'laser', 'waxing'] },
  { code: 'manucure_pedicure', fr: 'Manucure / pédicure', ar: 'مانيكير / باديكير', en: 'Manicure / pedicure', cles: ['manucure', 'pédicure', 'vernis', 'gel', 'manicure'] },
  { code: 'massage', fr: 'Massage', ar: 'التدليك', en: 'Massage', cles: ['massage', 'massages', 'تدليك', 'مساج'] },
  { code: 'hammam', fr: 'Hammam et gommage', ar: 'الحمام والتكييس', en: 'Hammam', cles: ['hammam', 'gommage', 'حمام'] },
  { code: 'coiffure', fr: 'Coiffure', ar: 'تصفيف الشعر', en: 'Hairdressing', cles: ['coiffure', 'brushing', 'coloration', 'coupe'] },
  { code: 'maquillage', fr: 'Maquillage', ar: 'المكياج', en: 'Makeup', cles: ['maquillage', 'make-up', 'makeup', 'مكياج'] },
  { code: 'accueil_client', fr: 'Accueil et relation client', ar: 'الاستقبال وخدمة الزبناء', en: 'Guest relations', cles: ['accueil', 'relation client', 'clientèle', 'guest'] },
  { code: 'reservation_pms', fr: 'Réservations / logiciel hôtelier', ar: 'الحجوزات', en: 'Reservations / PMS', cles: ['opera', 'pms', 'booking', 'réservations', 'channel manager'] },
  { code: 'gestion_equipe', fr: 'Encadrement d’équipe', ar: 'تسيير الفريق', en: 'Team management', cles: ['encadrement', 'gestion d\'équipe', 'management', 'superviser'] },
  { code: 'jardinage', fr: 'Jardinage', ar: 'البستنة', en: 'Gardening', cles: ['jardinage', 'espaces verts', 'piscine', 'arrosage'] },
  { code: 'premiers_secours', fr: 'Premiers secours', ar: 'الإسعافات الأولية', en: 'First aid', cles: ['premiers secours', 'secourisme', 'first aid'] },
];
