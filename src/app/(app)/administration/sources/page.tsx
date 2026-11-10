import type { Metadata } from 'next';
import { BoutonAction, BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { accord, dateCourte, dateHeure, nombre, pluriel } from '@/composants/format';
import { Badge, Carte, Champ, Definition, Definitions, EnTetePage, Encart, LienExterne, Selection, Tableau, type Ton } from '@/composants/ui';
import { MODES_COLLECTE, STATUTS_AUTORISATION, STATUTS_EXECUTION, TYPES_SOURCE } from '@/domaine/referentiels';
import { exigerPermission } from '@/serveur/session-next';
import { listerExecutions, listerSources, obstaclesActivation, rejetsRecents } from '@/serveur/sources';
import { basculerSourceAction, lancerCollecteAction, modifierSourceAction, reprendreSourceAction } from '../actions';

export const metadata: Metadata = { title: 'Sources' };

const TON_EXECUTION: Record<string, Ton> = { succes: 'vert', partiel: 'ambre', echec: 'rouge', en_cours: 'marine', ignore: 'neutre' };
const TON_AUTORISATION: Record<string, Ton> = { non_requise: 'vert', accordee: 'vert', demandee: 'ambre', non_demandee: 'neutre', refusee: 'rouge' };
const MOTIFS_REJET: Record<string, string> = {
  hors_maroc: 'Hors du Maroc', hors_taxonomie: 'Hors des trois secteurs', contenu_vide: 'Annonce vide', robots_interdit: 'Interdite par robots.txt', erreur_extraction: 'Lecture impossible', doublon_exact: 'Copie exacte',
};
const DECLENCHEURS: Record<string, string> = { planifie: 'Planifiée', manuel: 'Lancée à la main', import: 'Import' };

export default async function PageSources() {
  const session = await exigerPermission('sources.gerer');
  const [sources, executions, rejets] = await Promise.all([listerSources(), listerExecutions(15), rejetsRecents(20)]);
  const maintenant = new Date();
  const automatisees = sources.filter((source) => source.kind === 'rss' || source.kind === 'sitemap' || source.kind === 'api');
  const actives = automatisees.filter((source) => source.is_active).length;

  return (
    <>
      <EnTetePage surtitre="Administration" titre="Sources d’offres">
        <p>D’où viennent les offres, et à quelles conditions. Une source automatisée ne peut être activée que si sa base juridique, la date de lecture de ses conditions et son autorisation sont consignées ici.</p>
      </EnTetePage>

      <Encart ton={actives > 0 ? 'attention' : 'info'} className="mb-5" titre={actives > 0 ? `${pluriel(actives, 'source')} ${accord(actives, 'automatisée')} ${accord(actives, 'active')}` : 'Aucune collecte automatique n’est active'}>
        {actives > 0
          ? 'Le worker interroge ces sites à la fréquence indiquée, en respectant robots.txt et le délai entre requêtes. Désactivez une source dès que son éditeur le demande.'
          : 'À l’installation, toutes les sources externes sont désactivées : l’outil fonctionne avec les annonces saisies par les courtiers, les annonces confiées par les employeurs et les fichiers importés. Les constats ci-dessous décrivent ce qui a été lu sur chaque site le 10 novembre 2026 ; ils ne remplacent ni votre relecture des conditions, ni un avis juridique.'}{' '}
        Modèle de demande d’autorisation : <code className="rounded bg-white/70 px-1">docs/modeles/demande-autorisation.md</code>.
      </Encart>

      <div className="space-y-5">
        {sources.map((source) => {
          const automatisee = source.kind === 'rss' || source.kind === 'sitemap' || source.kind === 'api';
          const obstacles = obstaclesActivation(source);
          const enPause = source.paused_until !== null && new Date(source.paused_until) > maintenant;
          return (
            <Carte
              key={source.id}
              titre={source.name}
              actions={
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge>{TYPES_SOURCE.libelle(source.kind)}</Badge>
                  {enPause ? <Badge ton="ambre">En pause jusqu’au {dateHeure(source.paused_until)}</Badge> : null}
                  {automatisee ? (
                    <Badge ton={source.is_active ? 'vert' : 'neutre'}>{source.is_active ? 'Collecte automatique active' : 'Collecte automatique désactivée'}</Badge>
                  ) : (
                    <Badge ton={source.collection_mode === 'desactive' ? 'neutre' : 'vert'}>{source.collection_mode === 'desactive' ? 'Désactivée' : 'Active'}</Badge>
                  )}
                </span>
              }
            >
              <Definitions colonnes="sm:grid-cols-2 lg:grid-cols-4">
                <Definition terme="Ce qui est conservé">{MODES_COLLECTE.libelle(source.collection_mode)}</Definition>
                <Definition terme="Autorisation">
                  <Badge ton={TON_AUTORISATION[source.permission_status] ?? 'neutre'}>{STATUTS_AUTORISATION.libelle(source.permission_status)}</Badge>
                  {source.permission_reference ? <span className="mt-1 block text-[0.8rem] text-encre-douce">{source.permission_reference}</span> : null}
                </Definition>
                <Definition terme="Offres enregistrées">{nombre(source.nb_offres)}</Definition>
                <Definition terme="Dernière collecte">{source.last_run_at ? dateHeure(source.last_run_at) : automatisee ? 'Jamais' : 'Sans objet'}</Definition>
              </Definitions>

              <dl className="mt-4 space-y-2.5 border-t border-sable-200 pt-4 text-[0.88rem]">
                <div>
                  <dt className="font-semibold text-marine-900">Base juridique</dt>
                  <dd className="text-encre-douce">{source.legal_basis ?? <span className="font-semibold text-ambre-800">Non consignée</span>}</dd>
                </div>
                {source.terms_summary || source.terms_url ? (
                  <div>
                    <dt className="font-semibold text-marine-900">
                      Conditions d’utilisation{' '}
                      <span className="font-normal text-encre-douce">— {source.terms_checked_at ? `lues par Yallah Services le ${dateCourte(source.terms_checked_at)}` : 'lecture par Yallah Services non consignée'}</span>
                    </dt>
                    <dd className="text-encre-douce">
                      {source.terms_summary}{' '}
                      {source.terms_url ? <LienExterne href={source.terms_url}>Lire les conditions</LienExterne> : null}
                    </dd>
                  </div>
                ) : null}
                {source.robots_summary ? (
                  <div>
                    <dt className="font-semibold text-marine-900">
                      robots.txt{source.robots_checked_at ? <span className="font-normal text-encre-douce"> — relu le {dateCourte(source.robots_checked_at)}</span> : null}
                    </dt>
                    <dd className="text-encre-douce">{source.robots_summary}</dd>
                  </div>
                ) : null}
                {source.notes ? (
                  <div>
                    <dt className="font-semibold text-marine-900">Notes</dt>
                    <dd className="whitespace-pre-line text-encre-douce">{source.notes}</dd>
                  </div>
                ) : null}
                {source.feed_url ? (
                  <div>
                    <dt className="font-semibold text-marine-900">Adresse interrogée</dt>
                    <dd className="break-all text-encre-douce">
                      {source.feed_url} · au plus {pluriel(source.max_requests_per_run, 'requête')} par passe, {source.min_delay_ms / 1000} s entre deux requêtes, toutes les {Math.round(source.frequency_minutes / 60)} h
                    </dd>
                  </div>
                ) : null}
              </dl>

              {automatisee && !source.is_active && obstacles.length > 0 ? (
                <Encart ton="attention" className="mt-4" titre="Ce qui manque pour pouvoir l’activer">
                  <ul className="list-disc space-y-0.5 pl-5">
                    {obstacles.map((obstacle) => (
                      <li key={obstacle}>{obstacle}</li>
                    ))}
                  </ul>
                </Encart>
              ) : null}

              {automatisee ? (
                <div className="hors-impression mt-4 flex flex-wrap items-start gap-2 border-t border-sable-200 pt-4">
                  {source.is_active ? (
                    <BoutonAction action={basculerSourceAction} champs={{ id: source.id, activer: '0' }} variante="danger" confirmer={`Désactiver « ${source.name} » ? Plus aucune requête ne lui sera envoyée.`}>
                      Désactiver
                    </BoutonAction>
                  ) : obstacles.length === 0 ? (
                    <BoutonAction action={basculerSourceAction} champs={{ id: source.id, activer: '1' }} variante="primaire" confirmer={`Activer la collecte automatique de « ${source.name} » ? Vous confirmez avoir lu ses conditions d’utilisation et être autorisé à la consulter ainsi.`}>
                      Activer la collecte
                    </BoutonAction>
                  ) : null}
                  {source.is_active && session.peut('collecte.lancer') && source.kind !== 'api' ? (
                    <BoutonAction action={lancerCollecteAction} champs={{ id: source.id }} icone="radar">
                      Collecter maintenant
                    </BoutonAction>
                  ) : null}
                  {enPause ? (
                    <BoutonAction action={reprendreSourceAction} champs={{ id: source.id }} confirmer="Lever la pause ? Elle a été posée après des erreurs ou à la demande du site : vérifiez d’abord la cause.">
                      Lever la pause
                    </BoutonAction>
                  ) : null}
                </div>
              ) : null}

              <details className="hors-impression mt-4 rounded-lg border border-sable-200 bg-sable-50 px-3 py-2">
                <summary className="cursor-pointer text-[0.88rem] font-semibold text-marine-800">Modifier la conformité et les réglages</summary>
                <Formulaire action={modifierSourceAction} className="mt-3 space-y-4">
                  <input type="hidden" name="id" value={source.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Champ libelle="Base juridique" className="sm:col-span-2" aide="Pourquoi Yallah Services peut consulter et conserver ces informations (10 caractères au moins).">
                      <textarea className="champ" name="baseJuridique" rows={2} maxLength={2000} defaultValue={source.legal_basis ?? ''} />
                    </Champ>
                    <Champ libelle="Adresse des conditions d’utilisation">
                      <input className="champ" type="url" name="adresseConditions" defaultValue={source.terms_url ?? ''} />
                    </Champ>
                    <Champ libelle="Autorisation de l’éditeur">
                      <Selection name="autorisation" defaultValue={source.permission_status} options={STATUTS_AUTORISATION.options} />
                    </Champ>
                    <Champ libelle="Ce que disent les conditions (résumé)" className="sm:col-span-2">
                      <textarea className="champ" name="resumeConditions" rows={2} maxLength={2000} defaultValue={source.terms_summary ?? ''} />
                    </Champ>
                    <Champ libelle="Référence de l’autorisation" aide="Date, interlocuteur, e-mail ou contrat. Obligatoire si « accordée »." className="sm:col-span-2">
                      <input className="champ" name="referenceAutorisation" maxLength={500} defaultValue={source.permission_reference ?? ''} />
                    </Champ>
                    <label className="flex items-start gap-2 text-[0.88rem] font-medium text-marine-900 sm:col-span-2">
                      <input type="checkbox" name="conditionsLues" className="mt-0.5 size-4 accent-marine-900" />
                      <span>
                        J’ai lu moi-même les conditions d’utilisation de ce site aujourd’hui
                        <span className="block text-[0.8rem] font-normal text-encre-douce">Consigne la date du jour et votre nom dans le journal d’audit.</span>
                      </span>
                    </label>
                    <Champ libelle="Ce qui est conservé">
                      <Selection name="mode" defaultValue={source.collection_mode} options={automatisee ? MODES_COLLECTE.options : MODES_COLLECTE.options.filter((option) => option.valeur === source.collection_mode || (option.valeur !== 'index_liens' && option.valeur !== 'extrait'))} />
                    </Champ>
                    <Champ libelle="Longueur maximale de l’extrait (caractères)">
                      <input className="champ" name="extraitMax" inputMode="numeric" defaultValue={source.max_excerpt_chars} />
                    </Champ>
                    {automatisee ? (
                      <>
                        <Champ libelle="Adresse du flux ou du sitemap" className="sm:col-span-2">
                          <input className="champ" type="url" name="adresseFlux" defaultValue={source.feed_url ?? ''} />
                        </Champ>
                        <Champ libelle="Délai entre deux requêtes (secondes)" aide="De 1 à 120.">
                          <input className="champ" name="delaiSecondes" inputMode="decimal" defaultValue={source.min_delay_ms / 1000} />
                        </Champ>
                        <Champ libelle="Requêtes au plus par passe" aide="De 1 à 500.">
                          <input className="champ" name="maxRequetes" inputMode="numeric" defaultValue={source.max_requests_per_run} />
                        </Champ>
                        <Champ libelle="Fréquence (heures)" aide="De 1 à 168.">
                          <input className="champ" name="frequenceHeures" inputMode="decimal" defaultValue={source.frequency_minutes / 60} />
                        </Champ>
                      </>
                    ) : null}
                    <Champ libelle="Fiabilité de la source (0 à 100)" aide="Entre dans le score de pertinence.">
                      <input className="champ" name="fiabilite" inputMode="numeric" defaultValue={source.reliability_score} />
                    </Champ>
                  </div>
                  <div className="space-y-1.5 text-[0.88rem]">
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="conserverContacts" defaultChecked={source.store_contacts} className="mt-0.5 size-4 accent-marine-900" />
                      <span>Conserver le téléphone et l’e-mail présents dans l’annonce (chiffrés){automatisee ? ' — exige une autorisation écrite accordée' : ''}</span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="autoriserIA" defaultChecked={source.allow_ai_processing} className="mt-0.5 size-4 accent-marine-900" />
                      <span>Autoriser le complément par modèle de langage (seulement si un fournisseur est configuré et si le site ne s’y oppose pas)</span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="garderNonClassees" defaultChecked={source.keep_unclassified} className="mt-0.5 size-4 accent-marine-900" />
                      <span>Garder, pour vérification, les annonces dont le métier n’est pas reconnu</span>
                    </label>
                  </div>
                  <Champ libelle="Notes">
                    <textarea className="champ" name="notes" rows={2} maxLength={4000} defaultValue={source.notes ?? ''} />
                  </Champ>
                  <BoutonEnvoi variante="secondaire">Enregistrer</BoutonEnvoi>
                </Formulaire>
              </details>
            </Carte>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Carte titre="Dernières collectes" sansMarge>
          {executions.length > 0 ? (
            <Tableau entetes={['Source', 'Résultat', 'Requêtes', 'Nouvelles', 'Mises à jour', 'Écartées']}>
              {executions.map((execution) => (
                <tr key={execution.id}>
                  <td>
                    <span className="font-semibold text-marine-900">{execution.source_name}</span>
                    <span className="block text-[0.78rem] text-encre-douce">
                      {dateHeure(execution.started_at)} · {DECLENCHEURS[execution.trigger_kind] ?? execution.trigger_kind}
                    </span>
                  </td>
                  <td>
                    <Badge ton={TON_EXECUTION[execution.status] ?? 'neutre'}>{STATUTS_EXECUTION.libelle(execution.status)}</Badge>
                    {execution.message ? <span className="mt-0.5 block max-w-72 text-[0.76rem] text-encre-douce">{execution.message}</span> : null}
                  </td>
                  <td className="tabular-nums">
                    {execution.http_requests}
                    {execution.robots_blocked_count ? <span className="block text-[0.76rem] text-encre-douce">{pluriel(execution.robots_blocked_count, 'refusée')} par robots.txt</span> : null}
                  </td>
                  <td className="tabular-nums">{execution.new_count}</td>
                  <td className="tabular-nums">{execution.updated_count}</td>
                  <td className="tabular-nums">{execution.rejected_count + execution.duplicate_count}</td>
                </tr>
              ))}
            </Tableau>
          ) : (
            <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Aucune collecte ni aucun import de fichier pour l’instant.</p>
          )}
        </Carte>

        <Carte titre="Annonces écartées récemment" sansMarge>
          {rejets.length > 0 ? (
            <Tableau entetes={['Annonce', 'Source', 'Motif']}>
              {rejets.map((rejet) => (
                <tr key={rejet.id}>
                  <td>
                    <span dir="auto">{rejet.title ?? '(sans titre)'}</span>
                    <span className="block text-[0.78rem] text-encre-douce">{dateHeure(rejet.created_at)}</span>
                  </td>
                  <td>{rejet.source_name}</td>
                  <td>
                    {MOTIFS_REJET[rejet.reason] ?? rejet.reason}
                    {rejet.detail ? <span className="block max-w-64 text-[0.76rem] text-encre-douce">{rejet.detail}</span> : null}
                  </td>
                </tr>
              ))}
            </Tableau>
          ) : (
            <p className="px-5 py-6 text-[0.9rem] text-encre-douce">Aucune annonce écartée.</p>
          )}
        </Carte>
      </div>
    </>
  );
}
