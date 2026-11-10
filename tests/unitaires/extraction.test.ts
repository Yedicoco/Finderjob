import { describe, expect, it } from 'vitest';
import {
  devinerTypeEmployeur, extraire, extraireContacts, extraireDates, extraireExperience, extraireLangues, extraireSalaire,
  formaterTelephone, lireDate, lireDateRelative, masquerContacts, mensualiser, versNombre,
} from '@/domaine/extraction';

const MAINTENANT = new Date('2026-11-10T10:00:00Z');

describe('salaires', () => {
  it.each([
    ['Salaire : 4 000 DH par mois', 4000, null, 'mois'],
    ['Salaire 3500dh/mois', 3500, null, 'mois'],
    ['Rémunération entre 4000 et 5000 dhs', 4000, 5000, 'mois'],
    ['4.500,00 MAD net mensuel', 4500, null, 'mois'],
    ['350 dh par jour', 350, null, 'jour'],
    ['Salaire 30 DH/h', 30, null, 'heure'],
    ['الراتب 3000 درهم شهريا', 3000, null, 'mois'],
    ['من 3000 إلى 4000 درهم', 3000, 4000, 'mois'],
    ['Salaire : 5k dh', 5000, null, 'mois'],
    ['Salaire mensuel : 4500', 4500, null, 'mois'],
    ['MAD 6000 per month', 6000, null, 'mois'],
    ['2 à 3 000 dh selon profil', 2000, 3000, 'mois'],
  ])('%s', (texte, min, max, periode) => {
    const salaire = extraireSalaire(texte);
    expect(salaire.min).toBe(min);
    expect(salaire.max).toBe(max);
    expect(salaire.periode).toBe(periode);
  });

  it('ne prend pas des frais ou une prime pour un salaire', () => {
    expect(extraireSalaire('Frais de dossier 200 dh à régler').min).toBeNull();
    expect(extraireSalaire('Prime de 500 dh. Salaire 4000 dh').min).toBe(4000);
  });

  it('ne prend pas un âge ou des horaires pour un salaire', () => {
    expect(extraireSalaire('Âge 25 à 40 ans, horaires de 8h à 17h').min).toBeNull();
  });

  it('n’invente pas de salaire quand il n’y en a pas', () => {
    const salaire = extraireSalaire('Poste à pourvoir immédiatement. Salaire selon profil.');
    expect(salaire).toMatchObject({ min: null, max: null, periode: null, mensuelEstime: null });
  });

  it('signale une devise étrangère', () => {
    expect(extraireSalaire('Salaire 1500 € par mois').deviseEtrangere).toBe('€');
    expect(extraireSalaire('Salary: $2000 monthly').deviseEtrangere).toBe('$');
  });

  it('indique quand la période a été déduite', () => {
    expect(extraireSalaire('Salaire 4000 dh').periodeDeduite).toBe(true);
    expect(extraireSalaire('Salaire 4000 dh par mois').periodeDeduite).toBe(false);
  });

  it('retient la période la plus proche du montant', () => {
    expect(extraireSalaire('4000 dh par mois, 8h par jour').periode).toBe('mois');
  });

  it('convertit en équivalent mensuel', () => {
    expect(mensualiser(300, 'jour')).toBe(7800);
    expect(mensualiser(20, 'heure')).toBe(3820);
    expect(versNombre('4.500,50')).toBe(4500.5);
    expect(versNombre('12 000')).toBe(12000);
  });
});

describe('dates', () => {
  it.each([
    ['2026-06-15', '2026-06-15T11:00:00.000Z'],
    ['2026-06-15T09:30:00+01:00', '2026-06-15T08:30:00.000Z'],
    ['2026-06-15T09:30:00Z', '2026-06-15T09:30:00.000Z'],
    ['15/06/2026', '2026-06-15T11:00:00.000Z'],
    ['15 juin 2026', '2026-06-15T11:00:00.000Z'],
    ['1er août 2026', '2026-08-01T11:00:00.000Z'],
    ['June 15, 2026', '2026-06-15T11:00:00.000Z'],
    ['15 يونيو 2026', '2026-06-15T11:00:00.000Z'],
    ['Tue, 10 Nov 2026 08:00:00 +0000', '2026-11-10T08:00:00.000Z'],
  ])('lit « %s »', (texte, attendu) => {
    expect(lireDate(texte)?.toISOString()).toBe(attendu);
  });

  it('refuse une date impossible ou absente', () => {
    expect(lireDate('31/02/2026')).toBeNull();
    expect(lireDate('bientôt')).toBeNull();
    expect(lireDate(null)).toBeNull();
  });

  it.each([
    ['Il y a 2 heures', 2 * 3_600_000],
    ['il y a 3 jours', 3 * 86_400_000],
    ['Il y a une semaine', 7 * 86_400_000],
    ['2 days ago', 2 * 86_400_000],
    ['منذ 3 أيام', 3 * 86_400_000],
    ['منذ يومين', 2 * 86_400_000],
    ['Publiée hier', 86_400_000],
  ])('date relative « %s »', (texte, ecart) => {
    expect(MAINTENANT.getTime() - (lireDateRelative(texte, MAINTENANT)?.getTime() ?? 0)).toBe(ecart);
  });

  it('extrait publication et expiration d’une annonce', () => {
    const dates = extraireDates('Publiée le 15 juin 2026\nPoste : nounou\nExpire le 30/07/2026', MAINTENANT);
    expect(dates.publication?.toISOString().slice(0, 10)).toBe('2026-06-15');
    expect(dates.precision).toBe('exacte');
    expect(dates.expiration?.toISOString().slice(0, 10)).toBe('2026-07-30');
  });

  it('marque une date relative comme approximative', () => {
    const dates = extraireDates('Nounou | Casablanca\nIl y a 2 jours\nDescription du poste…', MAINTENANT);
    expect(dates.precision).toBe('approximative');
    expect(dates.publication?.toISOString().slice(0, 10)).toBe('2026-11-08');
  });

  it('ne prend pas une phrase quelconque pour une date de publication', () => {
    const dates = extraireDates('Notre société, créée il y a 3 mois à Casablanca, recherche une réceptionniste motivée.', MAINTENANT);
    expect(dates.publication).toBeNull();
    expect(dates.precision).toBe('inconnue');
  });

  it('ne déduit aucune date quand rien n’est écrit', () => {
    expect(extraireDates('Femme de ménage pour villa. Salaire 4000 dh.', MAINTENANT)).toEqual({ publication: null, precision: 'inconnue', expiration: null });
  });
});

describe('expérience, langues, conditions', () => {
  it.each([
    ['2 ans d’expérience minimum', 2, '1_2_ans'],
    ['Expérience : 3 à 5 ans', 3, '3_5_ans'],
    ['expérience minimum de 6 ans en hôtellerie', 6, 'plus_5_ans'],
    ['Débutante acceptée', 0, 'debutant'],
    ['Sans expérience', 0, 'debutant'],
    ['6 mois d’expérience', 0.5, 'moins_1_an'],
    ['خبرة 3 سنوات', 3, '3_5_ans'],
    ['At least 2 years of experience', 2, '1_2_ans'],
    ['Deux ans d’expérience exigés', 2, '1_2_ans'],
  ])('%s', (texte, annees, niveau) => {
    expect(extraireExperience(texte)).toEqual({ anneesMin: annees, niveau });
  });

  it('ne prend pas un âge pour une ancienneté', () => {
    expect(extraireExperience('Âgée de 25 à 40 ans, sérieuse').anneesMin).toBeNull();
    expect(extraireExperience('Expérience souhaitée, âge entre 25 et 40 ans').anneesMin).toBeNull();
    expect(extraireExperience('Âge minimum 18 ans').anneesMin).toBeNull();
  });

  it('reconnaît les langues exigées, pas les cuisines ni les clientèles', () => {
    expect(extraireLangues('Français et anglais courants, darija')).toEqual(['darija', 'fr', 'en']);
    expect(extraireLangues('Cuisine marocaine et française pour un restaurant italien')).toEqual([]);
    expect(extraireLangues('Maîtrise de la langue française')).toEqual(['fr']);
    expect(extraireLangues('يتقن العربية والفرنسية')).toEqual(['ar', 'fr']);
  });

  it('extrait les conditions d’une annonce complète', () => {
    const extraction = extraire(
      'Femme de ménage couchante – URGENT',
      'Famille à Casablanca (Californie) cherche femme de ménage logée et nourrie, CDI, temps plein, du lundi au samedi. Salaire 4 000 DH par mois. 2 ans d’expérience. Permis de conduire non exigé.',
      MAINTENANT,
    );
    expect(extraction).toMatchObject({
      contrat: 'cdi',
      tempsTravail: 'temps_plein',
      logement: 'loge',
      repas: true,
      urgent: true,
      permis: false,
      typeEmployeur: 'famille',
      recrutementMassif: false,
    });
    expect(extraction.salaire.mensuelEstime).toBe(4000);
    expect(extraction.experience.anneesMin).toBe(2);
    expect(extraction.horaires).toContain('du lundi au samedi');
  });

  it('détecte un recrutement en nombre', () => {
    expect(extraire('Hôtel recrute 12 femmes de chambre', '', MAINTENANT)).toMatchObject({ nombrePostes: 12, recrutementMassif: true });
    expect(extraire('Réceptionniste', 'Postes vacants : 3', MAINTENANT)).toMatchObject({ nombrePostes: 3, recrutementMassif: false });
    expect(extraire('Recrutement urgent : 6 femmes de chambre pour la saison', '', MAINTENANT)).toMatchObject({ nombrePostes: 6, recrutementMassif: true });
    expect(extraire('Femmes de chambre', 'L’hôtel recrute en urgence 6 femmes de chambre.', MAINTENANT)).toMatchObject({ nombrePostes: 6 });
    expect(extraire('Serveurs', 'Le riad cherche 3 serveurs pour la saison.', MAINTENANT)).toMatchObject({ nombrePostes: 3, recrutementMassif: false });
    expect(extraire('Housekeepers', 'We are hiring 8 housekeepers for the summer.', MAINTENANT)).toMatchObject({ nombrePostes: 8, recrutementMassif: true });
    expect(extraire('عاملات نظافة', 'مطلوب 5 عاملات نظافة بالدار البيضاء', MAINTENANT)).toMatchObject({ nombrePostes: 5 });
    expect(extraire('Recrutement', 'En vue de l’ouverture de notre nouvel hôtel à Agadir', MAINTENANT).recrutementMassif).toBe(true);
  });

  it('ne prend pas une durée, un âge ou un classement pour un nombre de postes', () => {
    expect(extraire('Femme de ménage', 'Nous recherchons 2 ans d’expérience minimum.', MAINTENANT).nombrePostes).toBeNull();
    expect(extraire('Agent d’accueil', 'L’hôtel recrute de 18 à 35 ans.', MAINTENANT).nombrePostes).toBeNull();
    expect(extraire('Réceptionniste', 'Hôtel 4 étoiles recrute pour son établissement 5 étoiles.', MAINTENANT).nombrePostes).toBeNull();
    expect(extraire('Receptionist', 'Looking for 3 years of experience.', MAINTENANT).nombrePostes).toBeNull();
    expect(extraire('Nounou', 'Famille cherche 4 heures par jour.', MAINTENANT).nombrePostes).toBeNull();
    expect(extraire('عاملة', 'مطلوب 3 سنوات خبرة', MAINTENANT).nombrePostes).toBeNull();
  });

  it('distingue logé et non logé, y compris en arabe', () => {
    expect(extraire('Nounou non couchante', '', MAINTENANT).logement).toBe('non_loge');
    expect(extraire('عاملة منزلية مع المبيت', '', MAINTENANT).logement).toBe('loge');
    expect(extraire('عاملة منزلية بدون مبيت', '', MAINTENANT).logement).toBe('non_loge');
    expect(extraire('Agent d’accueil', '', MAINTENANT).logement).toBeNull();
  });

  it('retient le premier type d’employeur cité', () => {
    expect(devinerTypeEmployeur('Hôtel 5 étoiles avec spa recrute')).toBe('hotel');
    expect(devinerTypeEmployeur('Le spa de l’hôtel Atlas recrute')).toBe('spa');
    expect(devinerTypeEmployeur('Riad en médina')).toBe('riad');
    expect(devinerTypeEmployeur('Poste polyvalent, en particulier le week-end')).toBeNull();
  });
});

describe('coordonnées', () => {
  it('normalise les téléphones marocains au format du site Yallah', () => {
    expect(formaterTelephone('0661234567')).toBe('+212 661 234 567');
    expect(formaterTelephone('+212 6 61 23 45 67')).toBe('+212 661 234 567');
    expect(formaterTelephone('00212661234567')).toBe('+212 661 234 567');
    expect(formaterTelephone('12345')).toBeNull();
  });

  it('détecte téléphones, e-mails et WhatsApp', () => {
    const contacts = extraireContacts('Appelez le 06 61 23 45 67 ou écrivez à Contact@Exemple.ma (WhatsApp)');
    expect(contacts).toEqual({ telephones: ['+212 661 234 567'], emails: ['contact@exemple.ma'], whatsapp: true });
  });

  it('masque les coordonnées dans un extrait', () => {
    const masque = masquerContacts('Tél : 0661234567 — mail rh@exemple.ma');
    expect(masque).not.toContain('0661234567');
    expect(masque).not.toContain('rh@exemple.ma');
    expect(masque).toContain('[téléphone masqué]');
  });
});
