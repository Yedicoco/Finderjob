import type { Metadata } from 'next';
import Link from '@/composants/lien';
import { BoutonAction, BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { accord, dateHeure, ilYA, pluriel } from '@/composants/format';
import { OPTIONS_SECTEURS, OPTIONS_VILLES, SelectionMetier } from '@/composants/options';
import { Badge, Carte, Champ, EnTetePage, Encart, Selection, type Ton } from '@/composants/ui';
import { CANAUX_ALERTE, CONTRATS, FREQUENCES_ALERTE } from '@/domaine/referentiels';
import { canauxDisponibles, listerAlertes, listerNotifications, telephoneAlertes } from '@/serveur/alertes';
import { exigerPermission } from '@/serveur/session-next';
import { basculerAlerteAction, creerAlerteAction, marquerLuesAction, supprimerAlerteAction } from './actions';

export const metadata: Metadata = { title: 'Alertes' };

const TYPES: Record<string, string> = {
  nouvelle_offre: 'Nouvelle offre', offre_modifiee: 'Offre modifiée', offre_urgente: 'Offre urgente', recrutement_massif: 'Recrutement en nombre', recruteur_recurrent: 'Recruteur régulier',
  resume: 'Résumé', relance: 'Relance employeur',
};
const STATUTS_ENVOI: Record<string, { libelle: string; ton: Ton }> = {
  envoye: { libelle: 'Envoyé', ton: 'vert' },
  simule: { libelle: 'Simulé (non envoyé)', ton: 'ambre' },
  echec: { libelle: 'Échec', ton: 'rouge' },
  en_attente: { libelle: 'En attente', ton: 'neutre' },
};

export default async function PageAlertes() {
  const session = await exigerPermission('alertes.gerer');
  const { utilisateur } = session;
  const [alertes, notifications, envois, telephone] = await Promise.all([
    listerAlertes(utilisateur.id),
    listerNotifications(utilisateur.id, { limite: 60 }),
    listerNotifications(utilisateur.id, { canal: 'externe', limite: 15 }),
    telephoneAlertes(utilisateur.id),
  ]);
  const canaux = canauxDisponibles();
  const nonLues = notifications.filter((notification) => !notification.read_at).length;
  const maintenant = new Date();

  const lienNotification = (notification: (typeof notifications)[number]): string | null => {
    if (notification.job_offer_id) return `/offres/${notification.job_offer_id}`;
    const employeur = notification.payload?.employeur;
    if (typeof employeur === 'string') return `/employeurs/${employeur}`;
    return null;
  };

  return (
    <>
      <EnTetePage surtitre="Suivi" titre="Alertes">
        <p>Soyez prévenu quand une offre active correspond à vos critères. Une alerte ne signale que les offres arrivées après sa création, jamais une offre expirée, douteuse ou fictive.</p>
      </EnTetePage>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Carte
            titre={`Notifications${nonLues ? ` — ${nonLues} non ${accord(nonLues, 'lue')}` : ''}`}
            sansMarge
            actions={
              nonLues > 0 ? (
                <BoutonAction action={marquerLuesAction} icone="coche">
                  Tout marquer comme lu
                </BoutonAction>
              ) : null
            }
          >
            {notifications.length > 0 ? (
              <ul className="divide-y divide-sable-100">
                {notifications.map((notification) => {
                  const lien = lienNotification(notification);
                  return (
                    <li key={notification.id} className={notification.read_at ? 'px-4 py-3 sm:px-5' : 'border-l-4 border-or-500 bg-or-50/60 px-4 py-3 sm:px-5'}>
                      <p className="flex flex-wrap items-center gap-x-2 text-[0.78rem] text-encre-douce">
                        <Badge ton={notification.read_at ? 'neutre' : 'or'}>{TYPES[notification.kind] ?? notification.kind}</Badge>
                        <span title={dateHeure(notification.created_at)}>{ilYA(notification.created_at, maintenant)}</span>
                        {notification.read_at ? null : <span className="font-semibold text-or-700">· non lue</span>}
                      </p>
                      <p className="mt-1 font-semibold text-marine-900" dir="auto">
                        {lien ? (
                          <Link href={lien} className="underline decoration-or-500 decoration-2 underline-offset-3">
                            {notification.title}
                          </Link>
                        ) : (
                          notification.title
                        )}
                      </p>
                      <p className="mt-0.5 text-[0.88rem] whitespace-pre-line text-encre-douce" dir="auto">
                        {notification.body}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Aucune notification pour l’instant. Elles arrivent ici dès qu’une alerte trouve une offre, ou qu’une relance employeur arrive à échéance.</p>
            )}
          </Carte>

          {envois.length > 0 ? (
            <Carte titre="Envois par e-mail et WhatsApp" sansMarge>
              <ul className="divide-y divide-sable-100 text-[0.88rem]">
                {envois.map((envoi) => {
                  const statut = STATUTS_ENVOI[envoi.status] ?? { libelle: envoi.status, ton: 'neutre' as Ton };
                  return (
                    <li key={envoi.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
                      <span className="min-w-0">
                        <strong className="text-marine-900">{CANAUX_ALERTE.libelle(envoi.channel)}</strong> — <span dir="auto">{envoi.title}</span>
                        <span className="block text-[0.78rem] text-encre-douce">{dateHeure(envoi.created_at)}</span>
                      </span>
                      <Badge ton={statut.ton}>{statut.libelle}</Badge>
                    </li>
                  );
                })}
              </ul>
            </Carte>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Carte titre={`Mes alertes (${alertes.length})`} sansMarge>
            {alertes.length > 0 ? (
              <ul className="divide-y divide-sable-100">
                {alertes.map((alerte) => (
                  <li key={alerte.id} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-marine-900">
                          {alerte.name} {alerte.is_active ? null : <Badge>En pause</Badge>}
                        </p>
                        <p className="text-[0.86rem] text-encre-douce">{alerte.resume}</p>
                        <p className="mt-0.5 text-[0.78rem] text-encre-douce">
                          {FREQUENCES_ALERTE.libelle(alerte.frequency)} · {alerte.channels.map((canal) => CANAUX_ALERTE.libelle(canal)).join(', ')} · {pluriel(alerte.notifications, 'offre')} {accord(alerte.notifications, 'signalée')}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <BoutonAction action={basculerAlerteAction} champs={{ id: alerte.id, active: alerte.is_active ? '0' : '1' }}>
                          {alerte.is_active ? 'Mettre en pause' : 'Réactiver'}
                        </BoutonAction>
                        <BoutonAction action={supprimerAlerteAction} champs={{ id: alerte.id }} variante="danger" confirmer={`Supprimer l’alerte « ${alerte.name} » ? Ses notifications et l’historique de ses envois seront supprimés aussi. Pour la suspendre sans rien perdre, utilisez « Mettre en pause ».`}>
                          Supprimer
                        </BoutonAction>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Vous n’avez encore aucune alerte.</p>
            )}
          </Carte>

          <Carte titre="Nouvelle alerte">
            <Formulaire action={creerAlerteAction} className="space-y-4" viderApresSucces>
              <Champ libelle="Nom de l’alerte" obligatoire>
                <input className="champ" name="nom" required minLength={2} maxLength={80} placeholder="Ex. : Nounous à Casablanca" />
              </Champ>
              <div className="grid gap-3 sm:grid-cols-2">
                <Champ libelle="Métier">
                  <SelectionMetier name="metier" defaultValue="" vide="Tous" />
                </Champ>
                <Champ libelle="Secteur">
                  <Selection name="secteur" defaultValue="" vide="Tous" options={OPTIONS_SECTEURS} />
                </Champ>
                <Champ libelle="Ville">
                  <Selection name="ville" defaultValue="" vide="Toutes" options={OPTIONS_VILLES} />
                </Champ>
                <Champ libelle="Contrat">
                  <Selection name="contrat" defaultValue="" vide="Tous" options={CONTRATS.options.filter((option) => option.valeur !== 'non_precise')} />
                </Champ>
                <Champ libelle="Mot ou expression" aide="Cherché dans le titre et les mots-clés.">
                  <input className="champ" name="texte" maxLength={120} dir="auto" />
                </Champ>
                <Champ libelle="Salaire mensuel minimum (DH)">
                  <input className="champ" name="salaireMin" inputMode="numeric" />
                </Champ>
                <Champ libelle="Pertinence minimale (1 à 100)" aide="Vide = toutes les offres correspondantes.">
                  <input className="champ" name="pertinenceMin" inputMode="numeric" />
                </Champ>
                <div className="space-y-1.5 self-end pb-1 text-[0.9rem]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="urgentSeulement" className="size-4 accent-marine-900" /> Offres urgentes seulement
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="massifSeulement" className="size-4 accent-marine-900" /> Recrutements en nombre seulement
                  </label>
                </div>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-[0.86rem] font-semibold text-marine-900">Me prévenir par</legend>
                <div className="space-y-1.5 text-[0.9rem]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="canaux" value="interne" defaultChecked className="size-4 accent-marine-900" /> Notification dans l’outil
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="canaux" value="email" className="size-4 accent-marine-900" /> E-mail à {utilisateur.email}
                    {canaux.email ? null : <span className="text-[0.8rem] text-ambre-800">— simulé : aucun fournisseur configuré</span>}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="canaux" value="whatsapp" className="size-4 accent-marine-900" /> WhatsApp {telephone ? `au ${telephone}` : ''}
                    {!telephone ? (
                      <span className="text-[0.8rem] text-ambre-800">
                        — indiquez d’abord votre numéro dans{' '}
                        <Link href="/compte" className="font-semibold underline">
                          Mon compte
                        </Link>
                      </span>
                    ) : canaux.whatsapp ? null : (
                      <span className="text-[0.8rem] text-ambre-800">— simulé : aucun fournisseur configuré</span>
                    )}
                  </label>
                </div>
              </fieldset>
              <Champ libelle="Fréquence">
                <Selection name="frequence" defaultValue="quotidien" options={FREQUENCES_ALERTE.options} />
              </Champ>
              <BoutonEnvoi icone="alertes">Créer l’alerte</BoutonEnvoi>
            </Formulaire>
          </Carte>

          {!canaux.email || !canaux.whatsapp ? (
            <Encart ton="info" titre="Envois externes">
              {!canaux.email && !canaux.whatsapp ? 'Aucun fournisseur d’e-mail ni de WhatsApp Business n’est configuré sur ce serveur.' : !canaux.email ? 'Aucun fournisseur d’e-mail n’est configuré sur ce serveur.' : 'WhatsApp Business n’est pas configuré sur ce serveur.'} Les messages correspondants sont enregistrés avec le statut « simulé » et ne partent pas. Les notifications dans l’outil fonctionnent normalement.
            </Encart>
          ) : null}
        </div>
      </div>
    </>
  );
}
