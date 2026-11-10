/**
 * Connexion, sessions, droits par rôle, journal d'audit, paramètres, heure
 * légale côté base et reprise d'une source : les garde-fous qui ne dépendent
 * d'aucun écran.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instantVersHorlogeMaroc, RETOUR_GMT_MS } from '@/domaine/fuseau';
import { changerMotDePasse, connecter, creerUtilisateur, ErreurAcces, modifierUtilisateur, peut, utilisateurDeSession } from '@/serveur/auth';
import { executer, requete, uneLigne } from '@/serveur/db';
import { executerCollecte, reprendreSource } from '@/serveur/ingestion';
import { chargerParametres, definirParametre } from '@/serveur/parametres';
import { sourceParId } from '@/serveur/sources';
import { creerSourceTest, fauxSite, fermerBase, MAINTENANT, MOT_DE_PASSE, preparerBase, type Monde } from './outils';

let monde: Monde;
beforeAll(async () => {
  monde = await preparerBase();
});
afterAll(fermerBase);

const echec = async (promesse: Promise<unknown>): Promise<ErreurAcces> => {
  const erreur = await promesse.then(() => null, (e: unknown) => e);
  expect(erreur).toBeInstanceOf(ErreurAcces);
  return erreur as ErreurAcces;
};

describe('connexion et sessions', () => {
  it('ouvre une session avec le bon mot de passe et la retrouve par son jeton', async () => {
    const { jeton, utilisateur, expireLe } = await connecter(' Courtier@Yallah.example ', MOT_DE_PASSE, { ip: '10.0.0.1', maintenant: MAINTENANT });
    expect(utilisateur.role_code).toBe('courtier');
    expect((await utilisateurDeSession(jeton, MAINTENANT))?.id).toBe(monde.courtier.id);
    expect(await utilisateurDeSession('jeton-inconnu', MAINTENANT)).toBeNull();
    expect(await utilisateurDeSession(null, MAINTENANT)).toBeNull();
    // Passé l'échéance, la session ne vaut plus rien.
    expect(await utilisateurDeSession(jeton, new Date(expireLe.getTime() + 1000))).toBeNull();
  });

  it('ne conserve ni le jeton de session ni le mot de passe en clair', async () => {
    const { jeton } = await connecter('courtier@yallah.example', MOT_DE_PASSE, { ip: '10.0.0.1', maintenant: MAINTENANT });
    const sessions = await requete<{ token_hash: string; ip_hash: string | null }>(`SELECT token_hash, ip_hash FROM sessions WHERE user_id = $1`, [monde.courtier.id]);
    expect(sessions.length).toBeGreaterThan(0);
    for (const session of sessions) {
      expect(session.token_hash).not.toBe(jeton);
      expect(session.ip_hash ?? '').not.toContain('10.0.0.1');
    }
    const compte = await uneLigne<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [monde.courtier.id]);
    expect(compte!.password_hash).not.toContain(MOT_DE_PASSE);
  });

  it('refuse un mauvais mot de passe sans dire si le compte existe', async () => {
    const connu = await echec(connecter('courtier@yallah.example', 'mauvais-mot-de-passe', { ip: '10.0.0.2', maintenant: MAINTENANT }));
    const inconnu = await echec(connecter('personne@yallah.example', 'mauvais-mot-de-passe', { ip: '10.0.0.2', maintenant: MAINTENANT }));
    expect(connu.code).toBe('identifiants');
    expect(inconnu.code).toBe('identifiants');
    expect(inconnu.message).toBe(connu.message);
    const traces = await requete<{ action: string }>(`SELECT action FROM audit_logs WHERE action = 'connexion.echec'`);
    expect(traces.length).toBeGreaterThanOrEqual(2);
  });

  it('bloque après 8 essais dans le quart d’heure, pour ce compte et cette adresse seulement', async () => {
    const quand = new Date('2026-11-10T12:00:00Z');
    for (let essai = 0; essai < 8; essai += 1) await echec(connecter('lecteur@yallah.example', 'mauvais-mot-de-passe', { ip: '10.0.0.3', maintenant: quand }));
    // Même avec le bon mot de passe, le neuvième essai est refusé.
    const neuvieme = await echec(connecter('lecteur@yallah.example', MOT_DE_PASSE, { ip: '10.0.0.3', maintenant: quand }));
    expect(neuvieme.code).toBe('trop_de_tentatives');
    // Une autre adresse, un autre compte ou le quart d'heure suivant ne sont pas bloqués.
    await expect(connecter('lecteur@yallah.example', MOT_DE_PASSE, { ip: '10.0.0.4', maintenant: quand })).resolves.toBeTruthy();
    await expect(connecter('courtier@yallah.example', MOT_DE_PASSE, { ip: '10.0.0.3', maintenant: quand })).resolves.toBeTruthy();
    await expect(connecter('lecteur@yallah.example', MOT_DE_PASSE, { ip: '10.0.0.3', maintenant: new Date(quand.getTime() + 15 * 60_000) })).resolves.toBeTruthy();
  });

  it('ferme les sessions d’un compte dont le rôle change, qui est désactivé ou dont le mot de passe change', async () => {
    const compte = await creerUtilisateur({ email: 'essai@yallah.example', nom: 'Compte Essai', role: 'courtier', motDePasse: MOT_DE_PASSE, doitChanger: false }, monde.acteurAdmin);
    const ouvrir = async (motDePasse = MOT_DE_PASSE) => (await connecter('essai@yallah.example', motDePasse, { ip: '10.0.0.5', maintenant: MAINTENANT })).jeton;

    let jeton = await ouvrir();
    await modifierUtilisateur(compte.id, { role: 'lecteur' }, monde.acteurAdmin);
    expect(await utilisateurDeSession(jeton, MAINTENANT)).toBeNull();

    jeton = await ouvrir();
    expect((await utilisateurDeSession(jeton, MAINTENANT))?.role_code).toBe('lecteur');
    await modifierUtilisateur(compte.id, { actif: false }, monde.acteurAdmin);
    expect(await utilisateurDeSession(jeton, MAINTENANT)).toBeNull();
    // Un compte désactivé ne peut plus se connecter, même avec le bon mot de passe.
    expect((await echec(ouvrir())).code).toBe('identifiants');

    await modifierUtilisateur(compte.id, { actif: true }, monde.acteurAdmin);
    jeton = await ouvrir();
    await changerMotDePasse(compte.id, 'Provisoire-Solide-2026!', monde.acteurAdmin, { doitChanger: true });
    expect(await utilisateurDeSession(jeton, MAINTENANT)).toBeNull();
    expect((await echec(ouvrir())).code).toBe('identifiants');
    const nouveau = await connecter('essai@yallah.example', 'Provisoire-Solide-2026!', { ip: '10.0.0.6', maintenant: MAINTENANT });
    expect(nouveau.utilisateur.must_change_password).toBe(true);
  });

  it('refuse un mot de passe trop court', async () => {
    await expect(changerMotDePasse(monde.lecteur.id, 'court', monde.acteurAdmin)).rejects.toThrow(/12 caractères/);
  });

  it('garde toujours un administrateur actif', async () => {
    await expect(modifierUtilisateur(monde.admin.id, { role: 'lecteur' }, monde.acteurAdmin)).rejects.toThrow(/au moins un administrateur/);
    await expect(modifierUtilisateur(monde.admin.id, { actif: false }, monde.acteurAdmin)).rejects.toThrow();
    expect((await uneLigne<{ role_code: string; is_active: boolean }>(`SELECT role_code, is_active FROM users WHERE id = $1`, [monde.admin.id]))).toEqual({ role_code: 'administrateur', is_active: true });
  });
});

describe('droits par rôle', () => {
  it('le lecteur consulte les offres et le tableau de bord, rien d’autre', () => {
    expect(peut('lecteur', 'offres.lire')).toBe(true);
    expect(peut('lecteur', 'tableau.lire')).toBe(true);
    for (const droit of ['candidats.lire', 'employeurs.lire', 'placements.lire', 'offres.importer', 'offres.moderer', 'exports.creer', 'journal.lire'] as const) expect(peut('lecteur', droit)).toBe(false);
  });

  it('le courtier gère offres, candidats, employeurs et placements, pas l’administration', () => {
    for (const droit of ['offres.moderer', 'offres.importer', 'candidats.gerer', 'employeurs.gerer', 'placements.gerer'] as const) expect(peut('courtier', droit)).toBe(true);
    for (const droit of ['sources.gerer', 'collecte.lancer', 'utilisateurs.gerer', 'parametres.gerer', 'journal.lire', 'exports.creer'] as const) expect(peut('courtier', droit)).toBe(false);
  });

  it('un rôle inconnu ou absent n’a aucun droit', () => {
    expect(peut('directeur', 'offres.lire')).toBe(false);
    expect(peut(null, 'offres.lire')).toBe(false);
    expect(peut('__proto__', 'offres.lire')).toBe(false);
  });
});

describe('journal d’audit', () => {
  it('ne peut être ni modifié ni effacé, même par une requête SQL directe', async () => {
    const avant = (await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs`))!.n;
    expect(avant).toBeGreaterThan(0);
    await expect(executer(`UPDATE audit_logs SET summary = 'réécrit'`)).rejects.toThrow();
    await expect(executer(`DELETE FROM audit_logs`)).rejects.toThrow();
    expect((await uneLigne<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs`))!.n).toBe(avant);
    expect(await uneLigne(`SELECT 1 FROM audit_logs WHERE summary = 'réécrit'`)).toBeNull();
  });

  it('ne contient ni mot de passe ni adresse e-mail', async () => {
    const lignes = await requete<{ contenu: string }>(`SELECT summary || ' ' || changes::text AS contenu FROM audit_logs`);
    for (const ligne of lignes) {
      expect(ligne.contenu).not.toContain(MOT_DE_PASSE);
      expect(ligne.contenu).not.toContain('@yallah.example');
    }
  });
});

describe('paramètres', () => {
  it('accepte un entier saisi avec des espaces et refuse tout le reste', async () => {
    await definirParametre('salaires.seuil_eleve_mensuel', '10 000', monde.acteurAdmin);
    expect((await chargerParametres()).salaires.seuilEleveMensuel).toBe(10_000);
    for (const brut of ['12abc', '12.5', '2,5', '', '-8000', '4999', '200001']) {
      await expect(definirParametre('salaires.seuil_eleve_mensuel', brut, monde.acteurAdmin)).rejects.toThrow(/nombre entier entre/);
    }
    expect((await chargerParametres()).salaires.seuilEleveMensuel).toBe(10_000);
  });

  it('place le début de la recherche à minuit, heure du Maroc, entre le 1er janvier 2026 et aujourd’hui', async () => {
    const regler = (jour: string) => definirParametre('perimetre.dateMin', jour, monde.acteurAdmin, { maintenant: MAINTENANT });
    const debut = async () => new Date((await chargerParametres()).perimetre.dateMin).toISOString();
    await regler('2026-02-15');
    expect(await debut()).toBe('2026-02-14T23:00:00.000Z');
    // Pendant le ramadan 2026, le Maroc était à UTC+0 : minuit à Casablanca valait minuit UTC.
    await regler('2026-03-01');
    expect(await debut()).toBe('2026-03-01T00:00:00.000Z');
    // Depuis le 20 septembre 2026, le Maroc est à l'heure GMT toute l'année.
    await regler('2026-10-01');
    expect(await debut()).toBe('2026-10-01T00:00:00.000Z');
    await expect(regler('15/02/2026')).rejects.toThrow('Date invalide.');
    await expect(regler('2025-12-31')).rejects.toThrow(/avant le 1er janvier 2026/);
    // Ni demain ni plus tard : toutes les offres, y compris celles du jour, seraient écartées.
    await expect(regler('2026-11-11')).rejects.toThrow(/ne peut pas commencer dans le futur/);
    expect(await debut()).toBe('2026-10-01T00:00:00.000Z');
    // Aujourd'hui (le 10 novembre 2026 dans ces tests) est accepté : la recherche commence ce matin à 00 h 00.
    await regler('2026-11-10');
    expect(await debut()).toBe('2026-11-10T00:00:00.000Z');
    await regler('2026-01-01');
    expect(await debut()).toBe('2025-12-31T23:00:00.000Z');
  });

  it('refuse une clé inconnue et journalise chaque changement', async () => {
    await expect(definirParametre('inconnu.cle', '1', monde.acteurAdmin)).rejects.toThrow(/Paramètre inconnu/);
    await expect(definirParametre('__proto__', '1', monde.acteurAdmin)).rejects.toThrow(/Paramètre inconnu/);
    const trace = await uneLigne<{ changes: { avant: unknown; apres: unknown } }>(
      `SELECT changes FROM audit_logs WHERE action = 'parametre.modification' AND entity_id = 'salaires.seuil_eleve_mensuel' ORDER BY id DESC LIMIT 1`,
    );
    expect(trace!.changes).toMatchObject({ avant: 30_000, apres: 10_000 });
  });

  it('n’active la commission à la charge du travailleur qu’avec une justification écrite', async () => {
    await expect(definirParametre('commissions.travailleur_active', 'on', monde.acteurAdmin)).rejects.toThrow(/justification/);
    await expect(definirParametre('commissions.travailleur_active', 'on', monde.acteurAdmin, { justification: 'trop court' })).rejects.toThrow(/justification/);
    expect((await chargerParametres()).commissions.travailleurActive).toBe(false);
    await definirParametre('commissions.travailleur_active', 'on', monde.acteurAdmin, { justification: 'Avis écrit du conseil juridique, référence fictive de test.' });
    expect((await chargerParametres()).commissions.travailleurActive).toBe(true);
    await definirParametre('commissions.travailleur_active', '', monde.acteurAdmin);
    expect((await chargerParametres()).commissions.travailleurActive).toBe(false);
  });
});

describe('heure légale du Maroc côté base', () => {
  const lire = async (instant: Date): Promise<string> =>
    (await uneLigne<{ h: string }>(`SELECT to_char(ys_heure_maroc($1::timestamptz), 'YYYY-MM-DD HH24:MI:SS') AS h`, [instant.toISOString()]))!.h;

  it('revient à GMT le 20 septembre 2026, que la base des fuseaux du serveur soit ancienne ou à jour', async () => {
    expect(await lire(new Date('2026-07-10T12:00:00Z'))).toBe('2026-07-10 13:00:00');
    expect(await lire(new Date('2026-03-10T12:00:00Z'))).toBe('2026-03-10 12:00:00');
    expect(await lire(new Date(RETOUR_GMT_MS - 1000))).toBe('2026-09-20 01:59:59');
    expect(await lire(new Date(RETOUR_GMT_MS))).toBe('2026-09-20 01:00:00');
    expect(await lire(new Date('2026-11-10T12:00:00Z'))).toBe('2026-11-10 12:00:00');
    expect(await lire(new Date('2026-11-10T23:30:00Z'))).toBe('2026-11-10 23:30:00');
  });

  it('donne la même heure que l’application', async () => {
    for (const texte of ['2026-01-01T00:30:00Z', '2026-02-14T23:30:00Z', '2026-02-15T03:30:00Z', '2026-03-22T00:30:00Z', '2026-03-22T02:30:00Z', '2026-06-30T23:45:00Z', '2026-09-19T23:59:59Z', '2026-09-20T00:59:59Z', '2026-09-20T01:00:00Z', '2026-10-31T23:15:00Z', '2026-11-10T10:00:00Z']) {
      const instant = new Date(texte);
      expect(await lire(instant), texte).toBe(instantVersHorlogeMaroc(instant).toISOString().slice(0, 19).replace('T', ' '));
    }
  });

  it('numérote dans l’année en cours au Maroc', async () => {
    const annee = instantVersHorlogeMaroc(new Date()).getUTCFullYear();
    const reference = (await uneLigne<{ r: string }>(`SELECT ys_next_reference('ESSAI') AS r`))!.r;
    expect(reference).toBe(`YS-ESSAI-${annee}-0001`);
    await executer(`DELETE FROM counters WHERE scope = 'ESSAI'`);
  });
});

describe('reprise d’une source en pause', () => {
  it('lève la pause, remet les échecs à zéro et la collecte reprend', async () => {
    const FLUX = 'https://emplois.example/feed/';
    const attendre = async () => {};
    const sourceId = await creerSourceTest({ code: 'test-reprise' });
    const refus = fauxSite({ [FLUX]: { statut: 403 } });
    const premier = await executerCollecte(sourceId, { declencheur: 'planifie', maintenant: MAINTENANT, fetch: refus.fetchImpl, attendre, autoriserAdressesLocales: true });
    expect(premier.statut).toBe('echec');
    expect((await sourceParId(sourceId))!.paused_until).not.toBeNull();

    await reprendreSource(sourceId, monde.acteurAdmin);
    const reprise = await sourceParId(sourceId);
    expect(reprise!.paused_until).toBeNull();
    expect(reprise!.consecutive_failures).toBe(0);
    expect(await uneLigne(`SELECT 1 FROM audit_logs WHERE action = 'source.reprise' AND entity_id = $1`, [sourceId])).not.toBeNull();

    // La source n'est plus ignorée : la passe suivante interroge de nouveau le site.
    const ensuite = fauxSite({ [FLUX]: { statut: 403 } });
    const second = await executerCollecte(sourceId, { declencheur: 'planifie', maintenant: new Date(MAINTENANT.getTime() + 3_600_000), fetch: ensuite.fetchImpl, attendre, autoriserAdressesLocales: true });
    expect(second.statut).not.toBe('ignore');
    expect(ensuite.appels.length).toBeGreaterThan(0);
  });
});
