/**
 * Taxonomie Yallah : 3 secteurs, 42 métiers, mots-clés en français, arabe
 * (standard et darija) et anglais.
 *
 * Source des listes : le cahier des charges « Job Radar », complété par les
 * postes du formulaire de candidature du site Yallah Services (Ménage, Cuisine,
 * Nounou, Garde malade, Chauffeur…). Ce fichier est la référence du classifieur
 * et alimente la table job_categories (scripts/initialiser.ts).
 *
 * Champs d'un métier
 *   forts          expressions qui désignent le métier sans ambiguïté
 *   faibles        expressions ambiguës : comptent peu, sauf contexte favorable
 *   contextePlus   mots qui confirment le métier quand il est déjà détecté
 *   contexteMoins  mots qui l'infirment (ex. « gouvernante » + « hôtel »)
 *   exclusions     expressions qui annulent une détection (faux amis)
 *   priorite       poids dans le score de pertinence Yallah (0 à 100)
 *   proches        métiers voisins, utilisés par l'appariement candidat ↔ offre
 */
import { cle } from './texte';

export type CodeSecteur = 'maison' | 'beaute' | 'hospitalite';

export type Secteur = {
  code: CodeSecteur;
  libelle: { fr: string; ar: string; en: string };
  ordre: number;
};

export type Metier = {
  code: string;
  secteur: CodeSecteur;
  libelle: { fr: string; ar: string; en: string };
  forts: string[];
  faibles?: string[];
  contextePlus?: string[];
  contexteMoins?: string[];
  exclusions?: string[];
  priorite: number;
  proches?: string[];
};

export const SECTEURS: Secteur[] = [
  {
    code: 'maison',
    libelle: { fr: 'Personnel de maison et services à la personne', ar: 'عمال المنازل وخدمات الأشخاص', en: 'Household staff and personal care' },
    ordre: 1,
  },
  {
    code: 'beaute',
    libelle: { fr: 'Beauté, esthétique et bien-être', ar: 'التجميل والعناية والرفاه', en: 'Beauty, aesthetics and wellness' },
    ordre: 2,
  },
  {
    code: 'hospitalite',
    libelle: { fr: 'Conciergerie et hospitalité', ar: 'الكونسيرج والضيافة', en: 'Concierge and hospitality' },
    ordre: 3,
  },
];

const CONTEXTE_FOYER = ['domicile', 'maison', 'villa', 'famille', 'particulier', 'prive', 'privee', 'appartement', 'foyer', 'منزل', 'فيلا', 'عائله', 'اسره', 'بيت'];
const CONTEXTE_HOTEL = ['hotel', 'hotellerie', 'hotelier', 'hoteliere', 'palace', 'resort', 'etage', 'etages', 'hebergement', 'riad', 'فندق', 'فنادق', 'رياض'];

export const METIERS: Metier[] = [
  // ---------------------------------------------------------------- maison --
  {
    code: 'femme_menage', secteur: 'maison', priorite: 100,
    libelle: { fr: 'Femme de ménage / aide ménagère', ar: 'عاملة نظافة / عاملة منزلية', en: 'Housekeeper / cleaner' },
    forts: [
      'femme de ménage', 'homme de ménage', 'aide ménagère', 'aide-ménagère', 'employée de maison', 'employé de maison',
      'agent de ménage', 'agent d\'entretien', 'agent de nettoyage', 'agent de propreté', 'technicien de surface', 'technicienne de surface',
      'bonne à tout faire', 'ménagère', 'personnel de ménage',
      'عاملة نظافة', 'عامل نظافة', 'عاملة منزلية', 'عاملة منزل', 'عاملة تنظيف', 'عامل تنظيف', 'خادمة', 'خدامة', 'منظفة', 'منظفة منازل', 'عاملة بيت',
      'housekeeper', 'cleaner', 'cleaning lady', 'maid', 'domestic worker', 'house cleaner',
    ],
    faibles: ['ménage', 'nettoyage', 'entretien des locaux', 'تنظيف', 'نظافة', 'cleaning'],
    contextePlus: CONTEXTE_FOYER,
    exclusions: ['superviseur', 'responsable nettoyage', 'chef d\'équipe nettoyage', 'laveur de vitres', 'contrôleur'],
    proches: ['femme_chambre', 'personnel_villa', 'repassage_blanchisserie', 'housekeeping'],
  },
  {
    code: 'femme_chambre', secteur: 'maison', priorite: 90,
    libelle: { fr: 'Femme de chambre', ar: 'عاملة غرف', en: 'Room attendant' },
    forts: ['femme de chambre', 'valet de chambre', 'femme de chambres', 'عاملة غرف', 'منظفة غرف', 'عامل غرف', 'room attendant', 'chambermaid', 'room maid'],
    proches: ['femme_menage', 'housekeeping', 'personnel_villa'],
  },
  {
    code: 'gouvernante', secteur: 'maison', priorite: 90,
    libelle: { fr: 'Gouvernante de maison', ar: 'مدبرة منزل', en: 'House manager / governess' },
    forts: ['gouvernante de maison', 'gouvernante à domicile', 'intendante de maison', 'intendant de maison', 'gouvernante', 'مدبرة منزل', 'مدبرة منزلية', 'مشرفة منزل', 'house manager', 'governess', 'household manager'],
    contextePlus: CONTEXTE_FOYER,
    contexteMoins: ['hotel', 'hotellerie', 'hotelier', 'hoteliere', 'palace', 'resort', 'etage', 'etages', 'housekeeping', 'فندق'],
    proches: ['personnel_villa', 'majordome', 'housekeeping', 'femme_menage'],
  },
  {
    code: 'repassage_blanchisserie', secteur: 'maison', priorite: 85,
    libelle: { fr: 'Repassage / blanchisserie', ar: 'كيّ الملابس / مصبنة', en: 'Ironing / laundry' },
    forts: ['repasseuse', 'repasseur', 'lingère', 'linger', 'blanchisseuse', 'blanchisseur', 'agent de blanchisserie', 'employé de blanchisserie', 'employée de blanchisserie', 'agent de pressing', 'employée de pressing', 'عاملة كي', 'كواية', 'عامل مصبنة', 'عاملة مصبنة', 'laundry attendant', 'ironer', 'laundress', 'presser'],
    faibles: ['repassage', 'blanchisserie', 'lingerie', 'pressing', 'كي الملابس', 'غسيل الملابس', 'laundry', 'ironing'],
    proches: ['femme_menage', 'femme_chambre', 'housekeeping'],
  },
  {
    code: 'cuisinier_domicile', secteur: 'maison', priorite: 100,
    libelle: { fr: 'Chef / cuisinier(ère) à domicile', ar: 'طباخ(ة) منزلي(ة)', en: 'Private chef / cook' },
    forts: ['cuisinière à domicile', 'cuisinier à domicile', 'chef à domicile', 'chef privé', 'chef de maison', 'cuisinière de maison', 'cuisinier de maison', 'cuisinière marocaine', 'cuisinière', 'cuisinier', 'chef cuisinier', 'chef de cuisine', 'طباخة', 'طباخ', 'طاهي', 'طاهية', 'شيف', 'private chef', 'personal chef', 'home cook', 'cook'],
    faibles: ['cuisine marocaine', 'cuisine', 'الطبخ', 'cooking'],
    contextePlus: CONTEXTE_FOYER,
    exclusions: ['aide cuisinier', 'aide cuisinière', 'aide-cuisinier', 'commis de cuisine', 'commercial', 'vendeur', 'équipement de cuisine', 'cuisiniste', 'مساعد طباخ', 'مساعدة طباخ'],
    proches: ['aide_cuisinier', 'personnel_villa'],
  },
  {
    code: 'aide_cuisinier', secteur: 'maison', priorite: 90,
    libelle: { fr: 'Aide-cuisinier(ère)', ar: 'مساعد(ة) طباخ', en: 'Kitchen assistant' },
    forts: ['aide cuisinier', 'aide cuisinière', 'aide-cuisinier', 'aide-cuisinière', 'aide de cuisine', 'aide cuisine', 'commis de cuisine', 'commis cuisine', 'plongeur', 'plongeuse', 'مساعد طباخ', 'مساعدة طباخ', 'مساعد طاهي', 'kitchen assistant', 'kitchen helper', 'commis chef', 'kitchen porter', 'dishwasher'],
    proches: ['cuisinier_domicile'],
  },
  {
    code: 'nounou', secteur: 'maison', priorite: 100,
    libelle: { fr: 'Nounou / garde d\'enfants', ar: 'مربية أطفال', en: 'Nanny' },
    forts: ['nounou', 'nourrice', 'garde d\'enfants', 'garde d\'enfant', 'garde enfant', 'garde enfants', 'auxiliaire de puériculture', 'assistante maternelle', 'puéricultrice', 'مربية', 'مربية اطفال', 'حاضنة', 'حاضنة اطفال', 'nanny', 'childminder', 'child care', 'childcare', 'au pair'],
    exclusions: ['école', 'crèche recrute des éducatrices'],
    proches: ['baby_sitter', 'personnel_villa'],
  },
  {
    code: 'baby_sitter', secteur: 'maison', priorite: 90,
    libelle: { fr: 'Baby-sitter', ar: 'جليسة أطفال', en: 'Babysitter' },
    forts: ['baby-sitter', 'baby sitter', 'babysitter', 'baby-sitting', 'babysitting', 'baby sitting', 'جليسة اطفال', 'بيبي سيتر'],
    proches: ['nounou'],
  },
  {
    code: 'auxiliaire_vie', secteur: 'maison', priorite: 100,
    libelle: { fr: 'Auxiliaire de vie / garde-malade', ar: 'مساعدة حياة / مرافقة مرضى', en: 'Caregiver' },
    forts: ['auxiliaire de vie', 'garde-malade', 'garde malade', 'garde malades', 'aide à domicile', 'aide-soignante à domicile', 'aide soignante à domicile', 'assistante de vie', 'assistant de vie', 'dame de compagnie', 'مساعدة حياة', 'مرافقة مريض', 'مرافقة مرضى', 'مرافق مريض', 'ممرضة منزلية', 'caregiver', 'carer', 'home care assistant', 'home health aide', 'live-in carer'],
    faibles: ['aide soignante', 'aide-soignante', 'aide soignant'],
    contextePlus: CONTEXTE_FOYER,
    proches: ['aide_personnes_agees'],
  },
  {
    code: 'aide_personnes_agees', secteur: 'maison', priorite: 95,
    libelle: { fr: 'Aide aux personnes âgées', ar: 'رعاية المسنين', en: 'Elderly care assistant' },
    forts: ['aide aux personnes âgées', 'aide personnes âgées', 'garde de personnes âgées', 'garde personnes âgées', 'garde personne âgée', 'accompagnement de personnes âgées', 'accompagnant de personnes âgées', 'accompagnatrice de personnes âgées', 'رعاية المسنين', 'مرافقة المسنين', 'رعاية كبار السن', 'مساعدة مسنين', 'elderly care', 'elder care', 'senior care', 'elderly companion'],
    faibles: ['personne âgée', 'personnes âgées', 'المسنين'],
    proches: ['auxiliaire_vie'],
  },
  {
    code: 'jardinier', secteur: 'maison', priorite: 85,
    libelle: { fr: 'Jardinier', ar: 'بستاني', en: 'Gardener' },
    forts: ['jardinier', 'jardinière', 'agent d\'espaces verts', 'ouvrier jardinier', 'paysagiste', 'بستاني', 'جنايني', 'جرديني', 'gardener', 'groundskeeper', 'landscaper'],
    faibles: ['jardinage', 'espaces verts', 'gardening'],
    proches: ['personnel_villa', 'gardien'],
  },
  {
    code: 'chauffeur_prive', secteur: 'maison', priorite: 100,
    libelle: { fr: 'Chauffeur privé', ar: 'سائق خاص', en: 'Private driver' },
    forts: ['chauffeur privé', 'chauffeur personnel', 'chauffeur de maître', 'chauffeur de direction', 'chauffeur particulier', 'chauffeur de famille', 'chauffeur familial', 'chauffeur vip', 'سائق خاص', 'سائق شخصي', 'سائق عائلي', 'private driver', 'personal driver', 'family driver', 'chauffeur driver'],
    faibles: ['chauffeur', 'سائق', 'شيفور', 'driver'],
    contextePlus: [...CONTEXTE_FOYER, 'direction', 'vip', 'pdg', 'directeur', 'permi b', 'vehicule de service'],
    exclusions: ['poids lourd', 'poids lourds', 'semi-remorque', 'camion', 'livreur', 'livraison', 'chauffeur livreur', 'chauffeur-livreur', 'bus', 'autocar', 'taxi', 'engin', 'cariste', 'ambulancier', 'ambulance', 'transport de marchandises', 'permis c', 'permis ec', 'شاحنه', 'truck', 'delivery'],
    proches: ['personnel_villa'],
  },
  {
    code: 'majordome', secteur: 'maison', priorite: 85,
    libelle: { fr: 'Majordome / steward', ar: 'كبير الخدم / ستيوارد', en: 'Butler / steward (private)' },
    forts: ['majordome', 'maître d\'hôtel de maison', 'steward de maison', 'steward de villa', 'intendant de villa', 'كبير الخدم', 'household steward', 'estate manager', 'house steward'],
    faibles: ['steward', 'stewarding', 'ستيوارد'],
    contextePlus: CONTEXTE_FOYER,
    exclusions: ['chief steward', 'steward plonge'],
    proches: ['butler', 'gouvernante', 'personnel_villa'],
  },
  {
    code: 'gardien', secteur: 'maison', priorite: 95,
    libelle: { fr: 'Gardien / veilleur de nuit', ar: 'حارس / حارس ليلي', en: 'Guard / night watchman' },
    forts: ['gardien', 'gardienne', 'veilleur de nuit', 'veilleur', 'vigile', 'agent de sécurité', 'agent de gardiennage', 'agent de surveillance', 'concierge d\'immeuble', 'gardien d\'immeuble', 'gardien de villa', 'gardien de résidence', 'حارس', 'حارس ليلي', 'حارس امن', 'عساس', 'بواب', 'عون حراسه', 'security guard', 'night watchman', 'watchman', 'security officer', 'caretaker'],
    exclusions: ['superviseur', 'contrôleur d\'agents', 'chef de poste', 'responsable sécurité', 'ingénieur sécurité', 'sécurité informatique', 'gardien de but', 'hse'],
    proches: ['personnel_villa', 'jardinier'],
  },
  {
    code: 'personnel_villa', secteur: 'maison', priorite: 90,
    libelle: { fr: 'Personnel de villa, riad ou résidence', ar: 'عامل(ة) فيلا / رياض / إقامة', en: 'Villa / riad / residence staff' },
    forts: ['personnel de villa', 'personnel de maison', 'personnel de riad', 'personnel de résidence', 'employé de villa', 'employée de villa', 'employé polyvalent de villa', 'couple de gardiens', 'couple pour villa', 'employé de riad', 'employée de riad', 'agent polyvalent de riad', 'عامل فيلا', 'عاملة فيلا', 'عمال منازل', 'villa staff', 'household staff', 'domestic staff', 'houseman', 'house staff'],
    faibles: ['agent polyvalent', 'employé polyvalent', 'employée polyvalente', 'polyvalent'],
    contextePlus: ['villa', 'riad', 'residence', 'maison d hote', 'فيلا', 'رياض'],
    proches: ['femme_menage', 'gouvernante', 'gardien', 'jardinier', 'majordome', 'femme_chambre'],
  },

  // ---------------------------------------------------------------- beauté --
  {
    code: 'estheticienne', secteur: 'beaute', priorite: 75,
    libelle: { fr: 'Esthéticienne', ar: 'خبيرة تجميل', en: 'Beautician' },
    forts: ['esthéticienne', 'esthéticien', 'esthéticienne polyvalente', 'esthéticienne confirmée', 'technicienne en esthétique', 'praticienne en esthétique', 'خبيرة تجميل', 'اخصائية تجميل', 'اختصاصية تجميل', 'beautician', 'esthetician', 'aesthetician', 'beauty therapist'],
    faibles: ['esthétique', 'soins esthétiques', 'تجميل'],
    exclusions: ['médecine esthétique', 'chirurgie esthétique', 'médecin', 'chirurgien', 'délégué', 'assistante esthétique', 'assistant esthétique'],
    proches: ['assistante_esthetique', 'epilation_soins', 'onglerie', 'spa_therapeute', 'maquilleuse'],
  },
  {
    code: 'maquilleuse', secteur: 'beaute', priorite: 70,
    libelle: { fr: 'Maquilleuse', ar: 'خبيرة مكياج', en: 'Makeup artist' },
    forts: ['maquilleuse', 'maquilleur', 'maquilleuse professionnelle', 'make-up artist', 'makeup artist', 'make up artist', 'خبيرة مكياج', 'فنانة مكياج', 'ماكيير', 'مكياج عرايس', 'mua'],
    faibles: ['maquillage', 'مكياج', 'ميكاب', 'makeup'],
    proches: ['estheticienne', 'conseillere_beaute'],
  },
  {
    code: 'coiffeuse', secteur: 'beaute', priorite: 75,
    libelle: { fr: 'Coiffeuse / coiffeur', ar: 'مصففة شعر', en: 'Hairdresser' },
    forts: ['coiffeuse', 'coiffeur', 'coiffeuse mixte', 'coiffeur mixte', 'coiffeuse dames', 'coiffeur dames', 'coloriste', 'brusheuse', 'technicienne de coiffure', 'مصففة شعر', 'مصفف شعر', 'كوافيرة', 'كوافور', 'حلاقة نسائية', 'hairdresser', 'hair stylist', 'hairstylist', 'colorist'],
    faibles: ['coiffure', 'brushing', 'تصفيف الشعر'],
    exclusions: ['coiffeur hommes', 'coiffeur homme', 'barbier'],
    proches: ['barbier', 'assistante_esthetique'],
  },
  {
    code: 'barbier', secteur: 'beaute', priorite: 65,
    libelle: { fr: 'Barbier', ar: 'حلاق رجالي', en: 'Barber' },
    forts: ['barbier', 'barber', 'coiffeur barbier', 'coiffeur hommes', 'coiffeur homme', 'coiffeur pour hommes', 'حلاق', 'حلاق رجالي', 'barbershop'],
    proches: ['coiffeuse'],
  },
  {
    code: 'onglerie', secteur: 'beaute', priorite: 70,
    libelle: { fr: 'Technicienne ongles / manucure', ar: 'تقنية أظافر / مانيكير', en: 'Nail technician' },
    forts: ['manucure', 'manucuriste', 'pédicure', 'technicienne ongles', 'technicienne d\'ongles', 'technicienne en onglerie', 'styliste ongulaire', 'nail artist', 'nail technician', 'nail tech', 'manicurist', 'pedicurist', 'مانيكير', 'باديكير', 'تقنية اظافر', 'خبيرة اظافر'],
    faibles: ['onglerie', 'nail art', 'ongles', 'اظافر', 'nails'],
    exclusions: ['prothésiste ongulaire', 'prothesiste ongulaire', 'pédicure podologue', 'podologue'],
    proches: ['prothesiste_ongulaire', 'estheticienne'],
  },
  {
    code: 'prothesiste_ongulaire', secteur: 'beaute', priorite: 70,
    libelle: { fr: 'Prothésiste ongulaire', ar: 'تركيب الأظافر', en: 'Nail prosthetist' },
    forts: ['prothésiste ongulaire', 'prothesiste ongulaire', 'pose de faux ongles', 'pose d\'ongles en gel', 'تركيب اظافر', 'اظافر اصطناعيه', 'nail extension technician', 'gel nail technician', 'acrylic nail technician'],
    proches: ['onglerie'],
  },
  {
    code: 'spa_therapeute', secteur: 'beaute', priorite: 75,
    libelle: { fr: 'Spa thérapeute', ar: 'معالجة سبا', en: 'Spa therapist' },
    forts: ['spa thérapeute', 'spa praticienne', 'spa praticien', 'praticienne spa', 'praticien spa', 'thérapeute spa', 'hammamiste', 'gommeuse', 'tayaba', 'tayeba', 'employée de hammam', 'employé de hammam', 'agent de hammam', 'معالجة سبا', 'طيابة', 'كسالة', 'كسال', 'عاملة حمام', 'spa therapist', 'spa attendant', 'hammam attendant', 'wellness therapist'],
    faibles: ['spa', 'hammam', 'bien-être', 'سبا', 'حمام', 'wellness'],
    exclusions: ['réceptionniste spa', 'receptionniste spa', 'spa manager', 'responsable spa', 'directeur spa', 'directrice spa', 'spa receptionist', 'hôtesse spa'],
    proches: ['masseur', 'estheticienne', 'epilation_soins'],
  },
  {
    code: 'masseur', secteur: 'beaute', priorite: 70,
    libelle: { fr: 'Masseur / masseuse', ar: 'مدلّك(ة)', en: 'Massage therapist' },
    forts: ['masseuse', 'masseur', 'masseur kinésithérapeute bien-être', 'praticienne en massage', 'praticien en massage', 'massothérapeute', 'thérapeute thaï', 'مدلكة', 'مدلك', 'اخصائية مساج', 'اخصائي مساج', 'massage therapist', 'masseuse therapist'],
    faibles: ['massage', 'massages', 'تدليك', 'مساج'],
    exclusions: ['kinésithérapeute', 'kinesitherapeute', 'kiné'],
    proches: ['spa_therapeute'],
  },
  {
    code: 'receptionniste_spa', secteur: 'beaute', priorite: 70,
    libelle: { fr: 'Réceptionniste spa', ar: 'موظفة استقبال سبا', en: 'Spa receptionist' },
    forts: ['réceptionniste spa', 'receptionniste de spa', 'réceptionniste de spa', 'hôtesse spa', 'hôtesse d\'accueil spa', 'réceptionniste institut', 'réceptionniste salon', 'réceptionniste de salon', 'réceptionniste centre esthétique', 'موظفة استقبال سبا', 'spa receptionist', 'spa front desk', 'salon receptionist'],
    proches: ['receptionniste', 'agent_accueil', 'conseillere_beaute'],
  },
  {
    code: 'conseillere_beaute', secteur: 'beaute', priorite: 65,
    libelle: { fr: 'Conseillère beauté', ar: 'مستشارة تجميل', en: 'Beauty advisor' },
    forts: ['conseillère beauté', 'conseiller beauté', 'conseillère de vente beauté', 'conseillère en parfumerie', 'conseillère cosmétique', 'animatrice beauté', 'vendeuse en parfumerie', 'vendeuse cosmétique', 'مستشارة تجميل', 'بائعة مستحضرات التجميل', 'beauty advisor', 'beauty consultant', 'beauty adviser', 'cosmetics advisor'],
    exclusions: ['commercial terrain', 'représentant', 'délégué'],
    proches: ['maquilleuse', 'receptionniste_spa'],
  },
  {
    code: 'responsable_salon_spa', secteur: 'beaute', priorite: 70,
    libelle: { fr: 'Responsable de salon / spa manager', ar: 'مديرة صالون / مدير سبا', en: 'Salon / spa manager' },
    forts: ['spa manager', 'responsable spa', 'responsable de spa', 'directeur spa', 'directrice spa', 'directrice de spa', 'gérante de salon', 'gérant de salon', 'responsable de salon', 'responsable salon', 'gestionnaire de salon', 'manager de salon', 'responsable institut', 'responsable d\'institut', 'salon manager', 'مديرة صالون', 'مدير سبا', 'مسؤولة صالون', 'مديرة مركز تجميل', 'assistant spa manager'],
    proches: ['receptionniste_spa', 'estheticienne'],
  },
  {
    code: 'assistante_esthetique', secteur: 'beaute', priorite: 65,
    libelle: { fr: 'Assistante esthétique', ar: 'مساعدة تجميل', en: 'Beauty assistant' },
    forts: ['assistante esthétique', 'assistant esthétique', 'assistante esthéticienne', 'aide esthéticienne', 'apprentie esthéticienne', 'assistante coiffeuse', 'aide coiffeuse', 'apprentie coiffeuse', 'shampouineuse', 'مساعدة تجميل', 'مساعدة كوافيرة', 'beauty assistant', 'salon assistant', 'junior beautician'],
    exclusions: ['médecine esthétique', 'cabinet médical', 'médecin'],
    proches: ['estheticienne', 'coiffeuse'],
  },
  {
    code: 'epilation_soins', secteur: 'beaute', priorite: 65,
    libelle: { fr: 'Épilation, soins et nail art', ar: 'إزالة الشعر والعناية', en: 'Hair removal and skincare' },
    forts: ['épileuse', 'technicienne épilation', 'technicienne laser', 'technicienne en épilation', 'opératrice laser', 'spécialiste épilation', 'spécialiste soins du visage', 'technicienne soins', 'اخصائية ازاله الشعر', 'اخصائية عنايه بالبشره', 'waxing specialist', 'laser technician', 'skincare specialist', 'facialist', 'lash technician', 'technicienne cils'],
    faibles: ['épilation', 'soins du visage', 'soins du corps', 'extension de cils', 'ازاله الشعر', 'waxing'],
    proches: ['estheticienne', 'spa_therapeute'],
  },

  // ----------------------------------------------------------- hospitalité --
  {
    code: 'concierge', secteur: 'hospitalite', priorite: 85,
    libelle: { fr: 'Concierge / concierge d\'hôtel', ar: 'كونسيرج', en: 'Concierge' },
    forts: ['concierge d\'hôtel', 'concierge hôtel', 'chef concierge', 'assistant concierge', 'assistante concierge', 'concierge de nuit', 'concierge clefs d\'or', 'concierge', 'كونسيرج', 'hotel concierge', 'head concierge', 'night concierge'],
    contextePlus: CONTEXTE_HOTEL,
    exclusions: ['concierge d\'immeuble', 'gardien d\'immeuble', 'conciergerie de luxe', 'conciergerie privée', 'gestionnaire de conciergerie', 'responsable conciergerie', 'syndic'],
    proches: ['conciergerie_luxe', 'receptionniste', 'guest_experience', 'butler'],
  },
  {
    code: 'conciergerie_luxe', secteur: 'hospitalite', priorite: 85,
    libelle: { fr: 'Conciergerie de luxe', ar: 'كونسيرج فاخر', en: 'Luxury concierge' },
    forts: ['conciergerie de luxe', 'conciergerie privée', 'concierge de luxe', 'concierge privé', 'concierge privée', 'concierge personnel', 'chargé de conciergerie', 'chargée de conciergerie', 'agent de conciergerie', 'conseiller conciergerie', 'conseillère conciergerie', 'luxury concierge', 'private concierge', 'personal concierge', 'vip concierge', 'كونسيرج فاخر', 'خدمات الكونسيرج'],
    faibles: ['conciergerie'],
    exclusions: ['gestionnaire de conciergerie', 'responsable conciergerie', 'responsable de conciergerie', 'directeur conciergerie'],
    proches: ['concierge', 'lifestyle_manager', 'gestionnaire_conciergerie'],
  },
  {
    code: 'gestionnaire_conciergerie', secteur: 'hospitalite', priorite: 80,
    libelle: { fr: 'Gestionnaire de conciergerie', ar: 'مسيّر كونسيرج', en: 'Concierge service manager' },
    forts: ['gestionnaire de conciergerie', 'responsable conciergerie', 'responsable de conciergerie', 'directeur conciergerie', 'directrice conciergerie', 'manager conciergerie', 'responsable de la conciergerie', 'concierge manager', 'concierge service manager', 'مسير كونسيرج', 'مدير الكونسيرج'],
    proches: ['conciergerie_luxe', 'coordinateur_operations_locatives', 'lifestyle_manager'],
  },
  {
    code: 'agent_location_saisonniere', secteur: 'hospitalite', priorite: 85,
    libelle: { fr: 'Agent Airbnb / location saisonnière', ar: 'عون كراء موسمي', en: 'Short-term rental agent' },
    forts: ['agent airbnb', 'gestionnaire airbnb', 'gestionnaire de locations saisonnières', 'gestionnaire location saisonnière', 'agent de location saisonnière', 'agent location saisonnière', 'agent de check-in', 'agent check-in', 'agent d\'accueil airbnb', 'property manager airbnb', 'chargé de check-in', 'chargée de check-in', 'co-hôte', 'cohost', 'co-host', 'airbnb host', 'short-term rental agent', 'vacation rental agent', 'عون كراء موسمي', 'مسير شقق مفروشه'],
    faibles: ['airbnb', 'location saisonnière', 'locations saisonnières', 'location courte durée', 'booking', 'كراء موسمي', 'شقق مفروشه', 'short-term rental'],
    exclusions: ['coordinateur', 'coordinatrice', 'responsable des opérations'],
    proches: ['coordinateur_operations_locatives', 'responsable_riad', 'agent_accueil', 'conciergerie_luxe'],
  },
  {
    code: 'responsable_riad', secteur: 'hospitalite', priorite: 90,
    libelle: { fr: 'Responsable de riad / maison d\'hôtes', ar: 'مسيّر رياض / دار ضيافة', en: 'Riad / guesthouse manager' },
    forts: ['responsable de riad', 'responsable riad', 'gérant de riad', 'gérante de riad', 'directeur de riad', 'directrice de riad', 'manager de riad', 'gérant de maison d\'hôtes', 'gérante de maison d\'hôtes', 'responsable de maison d\'hôtes', 'responsable maison d\'hôtes', 'مسير رياض', 'مدير رياض', 'مسيره رياض', 'مدير دار الضيافه', 'riad manager', 'guesthouse manager', 'guest house manager'],
    proches: ['responsable_hebergement', 'receptionniste', 'gouvernante', 'personnel_villa'],
  },
  {
    code: 'receptionniste', secteur: 'hospitalite', priorite: 80,
    libelle: { fr: 'Réceptionniste', ar: 'موظف(ة) استقبال', en: 'Receptionist / front desk' },
    forts: ['réceptionniste', 'réceptionniste d\'hôtel', 'réceptionniste hôtel', 'réceptionniste de nuit', 'night auditor', 'réceptionniste polyvalent', 'réceptionniste polyvalente', 'chef de réception', 'agent de réception', 'موظف استقبال', 'موظفة استقبال', 'receptionist', 'front desk agent', 'front desk', 'front office agent'],
    faibles: ['réception', 'استقبال'],
    contextePlus: CONTEXTE_HOTEL,
    exclusions: ['réceptionniste spa', 'réceptionniste de spa', 'réceptionniste salon', 'réceptionniste institut', 'réception marchandise', 'réception de marchandises', 'agent de réception marchandises', 'cabinet médical', 'cabinet dentaire', 'standardiste', 'réceptionnaire'],
    proches: ['agent_accueil', 'guest_experience', 'charge_reservations', 'concierge', 'receptionniste_spa'],
  },
  {
    code: 'guest_experience', secteur: 'hospitalite', priorite: 80,
    libelle: { fr: 'Guest experience / relations clients', ar: 'علاقات النزلاء', en: 'Guest experience / relations' },
    forts: ['guest experience', 'guest relations', 'guest relation', 'guest service', 'guest services', 'responsable relation client hôtel', 'chargé de relation clientèle hôtel', 'agent de relation client hôtel', 'guest experience manager', 'guest relations agent', 'guest relations manager', 'relations clients hôtel', 'علاقات النزلاء', 'علاقات الضيوف', 'خدمه النزلاء'],
    faibles: ['relation client', 'relations clients', 'expérience client'],
    contextePlus: CONTEXTE_HOTEL,
    exclusions: ['centre d\'appels', 'call center', 'téléconseiller', 'télévente', 'banque', 'assurance'],
    proches: ['receptionniste', 'concierge', 'butler', 'agent_accueil'],
  },
  {
    code: 'housekeeping', secteur: 'hospitalite', priorite: 85,
    libelle: { fr: 'Housekeeping / gouvernante d\'hôtel', ar: 'تدبير الغرف / مشرفة غرف', en: 'Housekeeping / executive housekeeper' },
    forts: ['gouvernante d\'hôtel', 'gouvernante d\'étage', 'gouvernante d\'étages', 'gouvernante générale', 'gouvernante hôtelière', 'assistante gouvernante', 'assistant gouvernant', 'gouvernant', 'housekeeping', 'executive housekeeper', 'housekeeping supervisor', 'housekeeping manager', 'équipier d\'étage', 'équipier', 'equipier hebergement', 'تدبير الغرف', 'مشرفة غرف', 'مشرف غرف', 'floor supervisor'],
    faibles: ['gouvernante', 'hébergement et blanchisserie'],
    contextePlus: CONTEXTE_HOTEL,
    proches: ['femme_chambre', 'gouvernante', 'responsable_hebergement', 'femme_menage'],
  },
  {
    code: 'butler', secteur: 'hospitalite', priorite: 80,
    libelle: { fr: 'Butler', ar: 'باتلر', en: 'Butler' },
    forts: ['butler', 'majordome d\'hôtel', 'head butler', 'villa butler', 'butler service', 'باتلر', 'خادم شخصي'],
    proches: ['majordome', 'guest_experience', 'concierge'],
  },
  {
    code: 'agent_accueil', secteur: 'hospitalite', priorite: 75,
    libelle: { fr: 'Agent d\'accueil', ar: 'عون استقبال', en: 'Welcome agent / host' },
    forts: ['agent d\'accueil', 'agente d\'accueil', 'hôtesse d\'accueil', 'hôte d\'accueil', 'chargé d\'accueil', 'chargée d\'accueil', 'hôtesse', 'عون استقبال', 'مضيفه استقبال', 'welcome agent', 'greeter', 'host', 'hostess'],
    exclusions: ['hôtesse de l\'air', 'hôtesse de caisse', 'hôtesse de vente', 'hôtesse spa', 'moyens généraux', 'hôtesse d\'accueil spa'],
    proches: ['receptionniste', 'guest_experience', 'agent_location_saisonniere'],
  },
  {
    code: 'charge_reservations', secteur: 'hospitalite', priorite: 75,
    libelle: { fr: 'Chargé(e) de réservations', ar: 'موظف(ة) حجوزات', en: 'Reservations agent' },
    forts: ['chargé de réservations', 'chargée de réservations', 'chargé de réservation', 'chargée de réservation', 'chargé des réservations', 'chargée des réservations', 'agent de réservation', 'agent de réservations', 'agent réservation', 'responsable réservations', 'responsable des réservations', 'réservationniste', 'reservation agent', 'reservations agent', 'reservations manager', 'reservations officer', 'موظف حجوزات', 'موظفه حجوزات', 'مسؤول الحجوزات'],
    exclusions: ['billetterie aérienne', 'agence de voyages'],
    proches: ['receptionniste', 'agent_location_saisonniere'],
  },
  {
    code: 'coordinateur_operations_locatives', secteur: 'hospitalite', priorite: 80,
    libelle: { fr: 'Coordinateur(trice) d\'opérations locatives', ar: 'منسّق(ة) عمليات الكراء', en: 'Rental operations coordinator' },
    forts: ['coordinateur d\'opérations locatives', 'coordinatrice d\'opérations locatives', 'coordinateur des opérations locatives', 'coordinateur opérations locatives', 'coordinateur location saisonnière', 'coordinatrice location saisonnière', 'coordinateur airbnb', 'coordinatrice airbnb', 'responsable des opérations locatives', 'responsable opérations location saisonnière', 'operations coordinator vacation rentals', 'rental operations coordinator', 'property operations coordinator', 'منسق عمليات الكراء'],
    faibles: ['property manager', 'gestionnaire locatif', 'gestion locative'],
    contextePlus: ['airbnb', 'saisonniere', 'saisonnier', 'courte duree', 'booking', 'conciergerie'],
    proches: ['agent_location_saisonniere', 'gestionnaire_conciergerie', 'responsable_hebergement'],
  },
  {
    code: 'responsable_hebergement', secteur: 'hospitalite', priorite: 80,
    libelle: { fr: 'Responsable hébergement', ar: 'مسؤول(ة) الإيواء', en: 'Rooms division manager' },
    forts: ['responsable hébergement', 'responsable d\'hébergement', 'responsable de l\'hébergement', 'directeur hébergement', 'directrice hébergement', 'directeur de l\'hébergement', 'chef hébergement', 'rooms division manager', 'director of rooms', 'rooms manager', 'front office manager', 'مسؤول الايواء', 'مدير الايواء'],
    proches: ['housekeeping', 'responsable_riad', 'receptionniste'],
  },
  {
    code: 'lifestyle_manager', secteur: 'hospitalite', priorite: 75,
    libelle: { fr: 'Lifestyle manager', ar: 'مدير أسلوب الحياة', en: 'Lifestyle manager' },
    forts: ['lifestyle manager', 'lifestyle management', 'lifestyle concierge', 'personal assistant vip', 'assistant personnel vip', 'assistante personnelle vip', 'gestionnaire lifestyle', 'lifestyle consultant', 'مدير اسلوب الحياه'],
    proches: ['conciergerie_luxe', 'gestionnaire_conciergerie'],
  },
];

// ---------------------------------------------------------------------------
// Index précalculés
// ---------------------------------------------------------------------------

export type MetierPrepare = Metier & {
  clesFortes: { cle: string; mots: number; brut: string }[];
  clesFaibles: { cle: string; mots: number; brut: string }[];
  clesContextePlus: string[];
  clesContexteMoins: string[];
  clesExclusions: string[];
};

function preparerListe(liste: string[] | undefined) {
  const vues = new Set<string>();
  const sortie: { cle: string; mots: number; brut: string }[] = [];
  for (const brut of liste ?? []) {
    const c = cle(brut);
    if (c.trim() === '' || vues.has(c)) continue;
    vues.add(c);
    sortie.push({ cle: c, mots: c.trim().split(' ').length, brut });
  }
  // Les expressions les plus longues d'abord : « gouvernante d'hôtel » avant « gouvernante ».
  return sortie.sort((a, b) => b.mots - a.mots || b.cle.length - a.cle.length);
}

export const METIERS_PREPARES: MetierPrepare[] = METIERS.map((metier) => ({
  ...metier,
  clesFortes: preparerListe(metier.forts),
  clesFaibles: preparerListe(metier.faibles),
  clesContextePlus: (metier.contextePlus ?? []).map(cle),
  clesContexteMoins: (metier.contexteMoins ?? []).map(cle),
  clesExclusions: (metier.exclusions ?? []).map(cle),
}));

const PAR_CODE = new Map(METIERS.map((metier) => [metier.code, metier]));
const SECTEUR_PAR_CODE = new Map(SECTEURS.map((secteur) => [secteur.code, secteur]));

export function metierParCode(code: string | null | undefined): Metier | undefined {
  return code ? PAR_CODE.get(code) : undefined;
}

export function secteurParCode(code: string | null | undefined): Secteur | undefined {
  return code ? SECTEUR_PAR_CODE.get(code as CodeSecteur) : undefined;
}

export function metiersDuSecteur(code: CodeSecteur): Metier[] {
  return METIERS.filter((metier) => metier.secteur === code);
}

export function libelleMetier(code: string | null | undefined): string {
  return metierParCode(code)?.libelle.fr ?? 'Métier non classé';
}

export function libelleSecteur(code: string | null | undefined): string {
  return secteurParCode(code)?.libelle.fr ?? 'Secteur non classé';
}

/** Deux métiers sont « proches » si l'un cite l'autre dans sa liste de voisins. */
export function metiersProches(a: string, b: string): boolean {
  if (a === b) return true;
  return Boolean(PAR_CODE.get(a)?.proches?.includes(b) || PAR_CODE.get(b)?.proches?.includes(a));
}

/**
 * Mots-clés injectés dans l'index de recherche d'une offre classée : libellés
 * FR/AR/EN du métier et du secteur + synonymes forts. C'est la « recherche par
 * concept » du MVP : une offre rédigée en arabe est trouvée par une requête en
 * français ou en anglais, et inversement.
 */
export function motsClesRecherche(codes: string[]): string {
  const morceaux = new Set<string>();
  for (const code of codes) {
    const metier = PAR_CODE.get(code);
    if (!metier) continue;
    const secteur = SECTEUR_PAR_CODE.get(metier.secteur);
    morceaux.add(metier.libelle.fr).add(metier.libelle.ar).add(metier.libelle.en);
    if (secteur) morceaux.add(secteur.libelle.fr).add(secteur.libelle.ar).add(secteur.libelle.en);
    for (const expression of metier.forts) morceaux.add(expression);
  }
  return [...morceaux].join(' · ');
}
