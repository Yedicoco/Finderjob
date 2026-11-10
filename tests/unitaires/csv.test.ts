import { describe, expect, it } from 'vitest';
import { celluleCsv, versCsv } from '@/domaine/csv';

describe('export CSV', () => {
  it('neutralise les cellules qui seraient lues comme des formules', () => {
    expect(celluleCsv('=HYPERLINK("http://exemple.invalid";"clic")')).toBe(`"'=HYPERLINK(""http://exemple.invalid"";""clic"")"`);
    expect(celluleCsv('+212600000000')).toBe(`'+212600000000`);
    expect(celluleCsv('-5')).toBe(`'-5`);
    expect(celluleCsv('@commande')).toBe(`'@commande`);
    expect(celluleCsv('\tcaché')).toBe(`'\tcaché`);
  });

  it('laisse intacts les textes ordinaires, y compris en arabe', () => {
    expect(celluleCsv('Femme de ménage')).toBe('Femme de ménage');
    expect(celluleCsv('عاملة نظافة')).toBe('عاملة نظافة');
    expect(celluleCsv('3 500 DH - négociable')).toBe('3 500 DH - négociable');
  });

  it('met entre guillemets ce qui contient le séparateur, un guillemet ou un saut de ligne', () => {
    expect(celluleCsv('Casablanca ; Maârif')).toBe('"Casablanca ; Maârif"');
    expect(celluleCsv('dite « la "perle" »')).toBe('"dite « la ""perle"" »"');
    expect(celluleCsv('ligne 1\r\nligne 2')).toBe('"ligne 1\nligne 2"');
  });

  it('formate nombres, booléens, dates et valeurs absentes', () => {
    expect(celluleCsv(3500.5)).toBe('3500,5');
    expect(celluleCsv(-12)).toBe('-12');
    expect(celluleCsv(Number.NaN)).toBe('');
    expect(celluleCsv(true)).toBe('oui');
    expect(celluleCsv(false)).toBe('non');
    expect(celluleCsv(new Date('2026-11-10T08:00:00Z'))).toBe('2026-11-10');
    expect(celluleCsv(new Date('invalide'))).toBe('');
    expect(celluleCsv(null)).toBe('');
    expect(celluleCsv(undefined)).toBe('');
  });

  it('produit un fichier avec BOM, point-virgule et fins de ligne CRLF', () => {
    const csv = versCsv(['Référence', 'Titre'], [['YS-OF-2026-0001', 'Nounou ; Rabat'], ['YS-OF-2026-0002', null]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('Référence;Titre\r\nYS-OF-2026-0001;"Nounou ; Rabat"\r\nYS-OF-2026-0002;\r\n');
  });
});
