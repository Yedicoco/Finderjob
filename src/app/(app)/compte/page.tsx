import type { Metadata } from 'next';
import { BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { dateHeure } from '@/composants/format';
import { Carte, Champ, Definition, Definitions, EnTetePage, Encart } from '@/composants/ui';
import { ROLES } from '@/domaine/referentiels';
import { canauxDisponibles, telephoneAlertes } from '@/serveur/alertes';
import { exigerSession } from '@/serveur/session-next';
import { changerMonMotDePasse, definirMonTelephone } from './actions';

export const metadata: Metadata = { title: 'Mon compte' };

export default async function PageCompte({ searchParams }: { searchParams: Promise<{ motif?: string }> }) {
  const session = await exigerSession({ autoriserMotDePasseProvisoire: true });
  const { motif } = await searchParams;
  const { utilisateur } = session;
  const provisoire = utilisateur.must_change_password;
  const [telephone, canaux] = await Promise.all([telephoneAlertes(utilisateur.id), Promise.resolve(canauxDisponibles())]);

  return (
    <>
      <EnTetePage surtitre="Mon compte" titre={utilisateur.full_name} />

      {provisoire ? (
        <Encart ton="attention" className="mb-5" titre="Choisissez votre mot de passe">
          Votre mot de passe actuel est provisoire. Remplacez-le pour accéder au reste de l’outil.
        </Encart>
      ) : motif === 'change' ? (
        <Encart ton="succes" className="mb-5" titre="Mot de passe changé">
          Vos autres sessions ont été fermées. Celle-ci reste ouverte.
        </Encart>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Carte titre="Mot de passe">
          <Formulaire action={changerMonMotDePasse} className="space-y-4">
            <Champ libelle={provisoire ? 'Mot de passe provisoire' : 'Mot de passe actuel'} obligatoire>
              <input className="champ" type="password" name="ancien" autoComplete="current-password" required />
            </Champ>
            <Champ libelle="Nouveau mot de passe" obligatoire aide="12 caractères au minimum. Une phrase de plusieurs mots est plus sûre et plus facile à retenir qu’un mot compliqué.">
              <input className="champ" type="password" name="nouveau" autoComplete="new-password" minLength={12} required />
            </Champ>
            <Champ libelle="Nouveau mot de passe (confirmation)" obligatoire>
              <input className="champ" type="password" name="confirmation" autoComplete="new-password" minLength={12} required />
            </Champ>
            <BoutonEnvoi>Changer le mot de passe</BoutonEnvoi>
          </Formulaire>
        </Carte>

        <div className="space-y-6">
          <Carte titre="Identité">
            <Definitions>
              <Definition terme="Adresse e-mail">{utilisateur.email}</Definition>
              <Definition terme="Rôle">{ROLES.libelle(utilisateur.role_code)}</Definition>
              <Definition terme="Dernière connexion">{dateHeure(utilisateur.last_login_at)}</Definition>
              <Definition terme="Compte créé le">{dateHeure(utilisateur.created_at)}</Definition>
            </Definitions>
            <p className="mt-4 text-[0.82rem] text-encre-douce">Le nom, l’adresse et le rôle sont gérés par un administrateur.</p>
          </Carte>

          {provisoire ? null : (
            <Carte titre="Numéro WhatsApp pour mes alertes">
              <Formulaire action={definirMonTelephone} className="space-y-3">
                <Champ libelle="Numéro (format international ou marocain)" aide="Sert uniquement à vous envoyer vos propres alertes. Il est chiffré en base. Laissez vide pour le supprimer.">
                  <input className="champ" type="tel" name="telephone" defaultValue={telephone ?? ''} placeholder="06 12 34 56 78" autoComplete="tel" inputMode="tel" />
                </Champ>
                <BoutonEnvoi variante="secondaire">Enregistrer</BoutonEnvoi>
              </Formulaire>
              {canaux.whatsapp ? null : (
                <Encart ton="info" className="mt-4">
                  Aucun fournisseur WhatsApp n’est configuré sur ce serveur : les alertes WhatsApp sont enregistrées avec le statut « simulé » et ne sont pas réellement envoyées.
                </Encart>
              )}
            </Carte>
          )}
        </div>
      </div>
    </>
  );
}
