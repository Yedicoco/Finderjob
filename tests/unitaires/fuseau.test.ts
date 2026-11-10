import { describe, expect, it } from 'vitest';
import { decalageMaroc, instantMaroc, jourMaroc } from '@/domaine/fuseau';

const HEURE = 3_600_000;

describe('heure légale du Maroc', () => {
  it('place minuit du 1er janvier 2026 à 23 h UTC la veille (UTC+1)', () => {
    expect(jourMaroc('2026-01-01')?.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(jourMaroc('2026-01-01')?.getTime()).toBe(Date.parse('2026-01-01T00:00:00+01:00'));
  });

  it('place midi et la fin de journée le même jour civil', () => {
    expect(jourMaroc('2026-11-10', 'midi')?.toISOString()).toBe('2026-11-10T11:00:00.000Z');
    expect(jourMaroc('2026-11-10', 'fin')?.toISOString()).toBe('2026-11-10T22:59:59.000Z');
  });

  it('suit la base des fuseaux pendant le ramadan au lieu de supposer UTC+1', () => {
    // Le décalage vaut 0 ou 1 h selon la période ; quel qu'il soit, l'instant
    // calculé doit se relire « minuit » sur une horloge de Casablanca.
    for (const jour of ['2026-01-15', '2026-02-25', '2026-03-10', '2026-03-25', '2026-07-01', '2027-02-20']) {
      const instant = jourMaroc(jour)!;
      const relu = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', hourCycle: 'h23', dateStyle: 'short', timeStyle: 'medium' }).format(instant);
      expect(relu, jour).toBe(`${jour}, 00:00:00`);
      expect([0, HEURE]).toContain(decalageMaroc(instant));
    }
    expect(decalageMaroc(new Date('2026-01-15T12:00:00Z'))).toBe(HEURE);
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
  it('place un jour seul à l’heure demandée, à Casablanca', async () => {
    const { dateSaisieMaroc } = await import('@/domaine/fuseau');
    expect(dateSaisieMaroc('2026-11-10')?.toISOString()).toBe('2026-11-10T11:00:00.000Z');
    expect(dateSaisieMaroc(' 2026-11-10 ', 'debut')?.toISOString()).toBe('2026-11-09T23:00:00.000Z');
    expect(dateSaisieMaroc('2026-11-10', 'midi', 10)?.toISOString()).toBe('2026-11-10T09:00:00.000Z');
    // Pendant le ramadan 2026 (UTC+0), midi à Casablanca est midi UTC.
    expect(dateSaisieMaroc('2026-03-10')?.toISOString()).toBe('2026-03-10T12:00:00.000Z');
  });

  it('accepte un instant complet seulement s’il porte son fuseau', async () => {
    const { dateSaisieMaroc } = await import('@/domaine/fuseau');
    expect(dateSaisieMaroc('2026-01-01T00:00:00+01:00')?.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(dateSaisieMaroc('2026-06-01T08:30:00.000Z')?.toISOString()).toBe('2026-06-01T08:30:00.000Z');
    expect(dateSaisieMaroc('2026-06-01T08:30:00')).toBeNull();
    expect(dateSaisieMaroc('demain')).toBeNull();
    expect(dateSaisieMaroc('2026-02-30')).toBeNull();
    expect(dateSaisieMaroc('')).toBeNull();
  });

  it('lit une date-heure d’annonce sans fuseau comme une heure de Casablanca', async () => {
    const { lireDate } = await import('@/domaine/extraction');
    expect(lireDate('2026-06-15 09:30')?.toISOString()).toBe('2026-06-15T08:30:00.000Z');
    expect(lireDate('2026-03-10T09:30:00')?.toISOString()).toBe('2026-03-10T09:30:00.000Z');
    expect(lireDate('2026-06-15T09:30:00Z')?.toISOString()).toBe('2026-06-15T09:30:00.000Z');
    expect(lireDate('2026-06-15T09:30:00+0200')?.toISOString()).toBe('2026-06-15T07:30:00.000Z');
    expect(lireDate('Mon, 15 Jun 2026 09:30:00')?.toISOString()).toBe('2026-06-15T08:30:00.000Z');
    expect(lireDate('Mon, 15 Jun 2026 09:30:00 +0000')?.toISOString()).toBe('2026-06-15T09:30:00.000Z');
  });
});
