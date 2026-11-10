import type { Metadata } from 'next';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { dateCourte, dateHeure } from '@/composants/format';
import { Badge, Carte, Champ, EnTetePage, Selection } from '@/composants/ui';
import { ROLES } from '@/domaine/referentiels';
import { listerUtilisateurs } from '@/serveur/auth';
import { exigerPermission } from '@/serveur/session-next';
import { creerUtilisateurAction, modifierUtilisateurAction, reinitialiserMotDePasseAction } from '../actions';

export const metadata: Metadata = { title: 'Utilisateurs' };

const DROITS: Record<string, string> = {
  administrateur: 'Tout, y compris les sources, les comptes, les paramètres, le journal d’audit et les exports.',
  courtier: 'Offres (vérification, import), candidats, employeurs, besoins, placements, commissions, alertes.',
  lecteur: 'Consultation des offres et du tableau de bord, alertes personnelles. Aucun accès aux candidats ni aux employeurs.',
};

export default async function PageUtilisateurs() {
  const session = await exigerPermission('utilisateurs.gerer');
  const utilisateurs = await listerUtilisateurs();

  return (
    <>
      <EnTetePage surtitre="Administration" titre="Utilisateurs">
        <p>Qui peut se connecter, et avec quels droits. Un compte ne se supprime pas (l’historique reste lisible) : il se désactive.</p>
      </EnTetePage>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Carte titre={`Comptes (${utilisateurs.length})`} sansMarge>
          <ul className="divide-y divide-sable-200">
            {utilisateurs.map((utilisateur) => {
              const moi = utilisateur.id === session.utilisateur.id;
              return (
                <li key={utilisateur.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-marine-900">
                        {utilisateur.full_name} {moi ? <span className="font-normal text-encre-douce">(vous)</span> : null}
                      </p>
                      <p className="text-[0.86rem] break-all text-encre-douce">{utilisateur.email}</p>
                      <p className="mt-0.5 text-[0.78rem] text-encre-douce">
                        Créé le {dateCourte(utilisateur.created_at)} · {utilisateur.last_login_at ? `dernière connexion le ${dateHeure(utilisateur.last_login_at)}` : 'jamais connecté'}
                      </p>
                    </div>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge ton={utilisateur.role_code === 'administrateur' ? 'marine' : 'neutre'}>{ROLES.libelle(utilisateur.role_code)}</Badge>
                      {utilisateur.must_change_password ? <Badge ton="ambre">Mot de passe provisoire</Badge> : null}
                      <Badge ton={utilisateur.is_active ? 'vert' : 'rouge'}>{utilisateur.is_active ? 'Actif' : 'Désactivé'}</Badge>
                    </span>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[0.86rem] font-semibold text-marine-800">Modifier</summary>
                    <div className="mt-3 grid gap-4 lg:grid-cols-2">
                      <Formulaire action={modifierUtilisateurAction} className="space-y-2 rounded-lg border border-sable-200 bg-sable-50 p-3" messageEnBas>
                        <input type="hidden" name="id" value={utilisateur.id} />
                        <Champ libelle="Rôle">
                          <Selection name="role" defaultValue={utilisateur.role_code} options={ROLES.options} />
                        </Champ>
                        <Champ libelle="Accès">
                          <Selection
                            name="actif"
                            defaultValue={utilisateur.is_active ? '1' : '0'}
                            options={[
                              { valeur: '1', libelle: 'Actif — peut se connecter' },
                              { valeur: '0', libelle: 'Désactivé — ne peut plus se connecter' },
                            ]}
                          />
                        </Champ>
                        <BoutonEnvoi variante="secondaire" taille="petit">
                          Enregistrer
                        </BoutonEnvoi>
                        <p className="text-[0.76rem] text-encre-douce">Changer le rôle ou désactiver le compte ferme ses sessions en cours.</p>
                      </Formulaire>
                      {moi ? (
                        <p className="rounded-lg border border-sable-200 bg-sable-50 p-3 text-[0.84rem] text-encre-douce">Votre mot de passe se change dans « Mon compte ».</p>
                      ) : (
                        <Formulaire action={reinitialiserMotDePasseAction} className="space-y-2 rounded-lg border border-sable-200 bg-sable-50 p-3" messageEnBas viderApresSucces confirmer={`Remplacer le mot de passe de ${utilisateur.full_name} ? La personne sera déconnectée.`}>
                          <input type="hidden" name="id" value={utilisateur.id} />
                          <Champ libelle="Nouveau mot de passe provisoire" aide="12 caractères au moins. À transmettre de vive voix ; il devra être changé à la connexion.">
                            <input className="champ" type="text" name="motDePasse" required minLength={12} maxLength={200} autoComplete="off" spellCheck={false} />
                          </Champ>
                          <BoutonEnvoi variante="secondaire" taille="petit">
                            Réinitialiser le mot de passe
                          </BoutonEnvoi>
                        </Formulaire>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </Carte>

        <div className="space-y-6">
          <Carte titre="Nouveau compte">
            <Formulaire action={creerUtilisateurAction} className="space-y-3" viderApresSucces>
              <Champ libelle="Nom complet" obligatoire>
                <input className="champ" name="nom" required minLength={2} maxLength={120} autoComplete="off" />
              </Champ>
              <Champ libelle="Adresse e-mail" obligatoire aide="Sert d’identifiant de connexion.">
                <input className="champ" type="email" name="email" required maxLength={254} autoComplete="off" />
              </Champ>
              <Champ libelle="Rôle" obligatoire>
                <Selection name="role" defaultValue="courtier" options={ROLES.options} />
              </Champ>
              <Champ libelle="Mot de passe provisoire" obligatoire aide="12 caractères au moins. La personne devra le changer à sa première connexion.">
                <input className="champ" type="text" name="motDePasse" required minLength={12} maxLength={200} autoComplete="off" spellCheck={false} />
              </Champ>
              <BoutonEnvoi icone="plus">Créer le compte</BoutonEnvoi>
            </Formulaire>
          </Carte>

          <Carte titre="Ce que permet chaque rôle">
            <dl className="space-y-3 text-[0.88rem]">
              {ROLES.options.map((role) => (
                <div key={role.valeur}>
                  <dt className="font-semibold text-marine-900">{role.libelle}</dt>
                  <dd className="text-encre-douce">{DROITS[role.valeur]}</dd>
                </div>
              ))}
            </dl>
          </Carte>
        </div>
      </div>
    </>
  );
}
