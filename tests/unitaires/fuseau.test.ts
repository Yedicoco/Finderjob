import { describe, expect, it } from 'vitest';
import { dateCourte, dateHeure, dateIso, dateLongue, echeance } from '@/composants/format';
import { lireDate } from '@/domaine/extraction';
import { baseFuseauxAJour, dateSaisieMaroc, decalageMaroc, instantMaroc, instantVersHorlogeMaroc, jourEcritMaroc, jourMaroc, RETOUR_GMT_MS } from '@/domaine/fuseau';

const HEURE = 3_600_000;

// Ces tests n'affirment rien sur des dates postérieures à leur écriture (novembre 2026) : la
// règle peut encore changer, et c'est la base des fuseaux à jour qui ferait alors foi.
describe('heure légale du Maroc', () => {
  it('place minuit du 1er janvier 2026 à 23 h UTC la veille (le Maroc était alors à UTC+1)', () => {
    expect(jourMaroc('2026-01-01')?.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(jourMaroc('2026-01-01')?.getTime()).toBe(Date.parse('2026-01-01T00:00:00+01:00'));
  });

  it('revient à GMT (UTC+0) le 20 septembre 2026 à 2 h du matin', () => {
    expect(decalageMaroc(new Date('2026-07-10T12:00:00Z'))).toBe(HEURE);
    expect(decalageMaroc(new Date(RETOUR_GMT_MS - 1000))).toBe(HEURE);
    expect(decalageMaroc(new Date(RETOUR_GMT_MS))).toBe(0);
    expect(decalageMaroc(new Date('2026-11-10T12:00:00Z'))).toBe(0);
    // La dernière seconde à UTC+1 se lit 1 h 59 min 59 s ; la suivante, 1 h 00 min 00 s.
    expect(instantVersHorlogeMaroc(new Date(RETOUR_GMT_MS - 1000)).toISOString()).toBe('2026-09-20T01:59:59.000Z');
    expect(instantVersHorlogeMaroc(new Date(RETOUR_GMT_MS)).toISOString()).toBe('2026-09-20T01:00:00.000Z');
  });

  it('donne le même résultat que la base des fuseaux du serveur soit ancienne ou à jour', () => {
    expect(typeof baseFuseauxAJour).toBe('boolean');
    // Chemin « base ancienne » forcé : après le retour à GMT, la base n'est plus consultée.
    expect(decalageMaroc(new Date('2026-11-10T12:00:00Z'), false)).toBe(0);
    expect(decalageMaroc(new Date('2031-06-01T12:00:00Z'), false)).toBe(0);
    // Avant le retour à GMT, la base est lue dans les deux cas.
    for (const instant of ['2026-01-15T12:00:00Z', '2026-03-10T12:00:00Z', '2026-07-10T12:00:00Z']) {
      expect(decalageMaroc(new Date(instant), false), instant).toBe(decalageMaroc(new Date(instant), true));
    }
  });

  it('place midi et la fin de journée le même jour civil', () => {
    expect(jourMaroc('2026-11-10', 'midi')?.toISOString()).toBe('2026-11-10T12:00:00.000Z');
    expect(jourMaroc('2026-11-10', 'fin')?.toISOString()).toBe('2026-11-10T23:59:59.000Z');
    // Avant le 20 septembre 2026, le Maroc était à UTC+1.
    expect(jourMaroc('2026-07-10', 'midi')?.toISOString()).toBe('2026-07-10T11:00:00.000Z');
    expect(jourMaroc('2026-07-10', 'fin')?.toISOString()).toBe('2026-07-10T22:59:59.000Z');
  });

  it('suit le ramadan 2026 (UTC+0) au lieu de supposer UTC+1', () => {
    // Le décalage vaut 0 ou 1 h selon la période ; quel qu'il soit, l'instant
    // calculé doit se relire « minuit » sur une horloge de Casablanca.
    for (const jour of ['2026-01-15', '2026-02-25', '2026-03-10', '2026-03-25', '2026-07-01', '2026-09-19', '2026-09-21', '2026-11-10']) {
      const instant = jourMaroc(jour)!;
      expect(instantVersHorlogeMaroc(instant).toISOString(), jour).toBe(`${jour}T00:00:00.000Z`);
      expect([0, HEURE]).toContain(decalageMaroc(instant));
    }
    expect(decalageMaroc(new Date('2026-01-15T12:00:00Z'))).toBe(HEURE);
    expect(decalageMaroc(new Date('2026-03-10T12:00:00Z'))).toBe(0);
    expect(decalageMaroc(new Date('2026-07-01T12:00:00Z'))).toBe(HEURE);
  });

  it('refuse les dates qui n’existent pas et les textes qui ne sont pas un jour', () => {
    expect(instantMaroc(2026, 2, 31)).toBeNull();
    expect(instantMaroc(2026, 13, 1)).toBeNull();
    expect(instantMaroc(2026, 1, 1, 24)).toBeNull();
    expect(jourMaroc('01/01/2026')).toBeNull();
    expect(jourMaroc('2026-01-01T00:00:00Z')).toBeNull();
    expect(jourMaroc('')).toBeNull();
  });
});

describe('dates saisies dans les formulaires', () => {
  it('place un jour seul à l’heure demandée, à Casablanca', () => {
    expect(dateSaisieMaroc('2026-11-10')?.toISOString()).toBe('2026-11-10T12:00:00.000Z');
    expect(dateSaisieMaroc(' 2026-11-10 ', 'debut')?.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(dateSaisieMaroc('2026-11-10', 'midi', 10)?.toISOString()).toBe('2026-11-10T10:00:00.000Z');
    // Avant le 20 septembre 2026 : UTC+1…
    expect(dateSaisieMaroc('2026-07-10')?.toISOString()).toBe('2026-07-10T11:00:00.000Z');
    // …sauf pendant le ramadan (UTC+0), où midi à Casablanca est midi UTC.
    expect(dateSaisieMaroc('2026-03-10')?.toISOString()).toBe('2026-03-10T12:00:00.000Z');
  });

  it('accepte un instant complet seulement s’il porte son fuseau', () => {
    expect(dateSaisieMaroc('2026-01-01T00:00:00+01:00')?.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(dateSaisieMaroc('2026-06-01T08:30:00.000Z')?.toISOString()).toBe('2026-06-01T08:30:00.000Z');
    expect(dateSaisieMaroc('2026-06-01T08:30:00')).toBeNull();
    expect(dateSaisieMaroc('demain')).toBeNull();
    expect(dateSaisieMaroc('2026-02-30')).toBeNull();
    expect(dateSaisieMaroc('')).toBeNull();
  });

  it('lit une date-heure d’annonce sans fuseau comme une heure de Casablanca', () => {
    expect(lireDate('2026-06-15 09:30')?.toISOString()).toBe('2026-06-15T08:30:00.000Z');
    expect(lireDate('2026-03-10T09:30:00')?.toISOString()).toBe('2026-03-10T09:30:00.000Z');
    expect(lireDate('2026-11-05 09:30')?.toISOString()).toBe('2026-11-05T09:30:00.000Z');
    expect(lireDate('2026-06-15T09:30:00Z')?.toISOString()).toBe('2026-06-15T09:30:00.000Z');
    expect(lireDate('2026-06-15T09:30:00+0200')?.toISOString()).toBe('2026-06-15T07:30:00.000Z');
    expect(lireDate('Mon, 15 Jun 2026 09:30:00')?.toISOString()).toBe('2026-06-15T08:30:00.000Z');
    expect(lireDate('Thu, 05 Nov 2026 09:30:00')?.toISOString()).toBe('2026-11-05T09:30:00.000Z');
    expect(lireDate('Mon, 15 Jun 2026 09:30:00 +0000')?.toISOString()).toBe('2026-06-15T09:30:00.000Z');
  });
});

describe('affichage à l’heure de Casablanca', () => {
  // Les libellés des mois viennent d'Intl : on vérifie l'heure et le jour, pas la ponctuation.
  it('écrit l’heure GMT depuis le 20 septembre 2026, et UTC+1 avant', () => {
    expect(dateHeure(new Date('2026-11-10T14:32:00Z'))).toMatch(/^10 nov\. 2026\D+14 h 32$/);
    expect(dateHeure(new Date('2026-07-10T14:32:00Z'))).toMatch(/^10 juil\. 2026\D+15 h 32$/);
  });

  it('retient le jour civil de Casablanca', () => {
    expect(dateIso(new Date('2026-11-10T23:30:00Z'))).toBe('2026-11-10');
    expect(dateIso(new Date('2026-07-10T23:30:00Z'))).toBe('2026-07-11');
    expect(dateIso('2026-11-10')).toBe('2026-11-10');
    expect(dateCourte(new Date('2026-07-10T23:30:00Z'))).toMatch(/^11 juil\. 2026$/);
    expect(dateLongue(new Date('2026-11-10T08:00:00Z'))).toBe('mardi 10 novembre 2026');
    expect(jourEcritMaroc(new Date('2026-11-10T23:30:00Z'))).toBe('10 novembre 2026');
    expect(jourEcritMaroc(new Date('2026-07-10T23:30:00Z'))).toBe('11 juillet 2026');
    expect(dateIso(null)).toBe('');
    expect(dateCourte('pas une date')).toBe('—');
  });

  it('compte les échéances en jours civils', () => {
    const maintenant = new Date('2026-11-10T22:30:00Z');
    expect(echeance(new Date('2026-11-10T01:00:00Z'), maintenant)).toEqual({ texte: 'aujourd’hui', retard: false });
    expect(echeance(new Date('2026-11-11T00:30:00Z'), maintenant)).toEqual({ texte: 'demain', retard: false });
    expect(echeance(new Date('2026-11-08T12:00:00Z'), maintenant)).toEqual({ texte: 'en retard de 2 jours', retard: true });
  });
});
