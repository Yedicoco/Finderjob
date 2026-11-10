import type { Metadata } from 'next';
import { BoutonAction, BoutonEnvoi, Formulaire } from '@/composants/formulaire';
import { dateCourte, dateIso, dirhams, nombre } from '@/composants/format';
import { Badge, Carte, EnTetePage, Encart } from '@/composants/ui';
import { AVERTISSEMENT_COMMISSION_TRAVAILLEUR } from '@/domaine/commissions';
import { canauxDisponibles } from '@/serveur/alertes';
import { configIADepuisEnv } from '@/ia/extracteur';
import { chargerParametres, listerParametres, type LigneParametre } from '@/serveur/parametres';
import { exigerPermission } from '@/serveur/session-next';
import { definirParametreAction, executerTachesAction } from '../actions';

export const metadata: Metadata = { title: 'Paramètres' };

const GROUPES: { titre: string; aide: string; prefixe: string }[] = [
  { titre: 'Périmètre et durée de vie des offres', aide: 'Ces valeurs décident de ce qui est « actif », « expiré » ou « douteux ». Un changement s’applique immédiatement à toutes les offres.', prefixe: 'perimetre.|offres.' },
  { titre: 'Seuils de salaire', aide: 'Servent aux signaux de risque. Le plancher du travail domestique dépend du SMIG : mettez-le à jour à chaque revalorisation officielle.', prefixe: 'salaires.' },
  { titre: 'Candidats', aide: 'Durée de conservation d’une fiche sans activité avant anonymisation automatique (loi n° 09-08).', prefixe: 'candidats.' },
];

function LigneReglage({ ligne }: { ligne: LigneParametre }) {
  const { regle } = ligne;
  const defaut = regle.type === 'date' ? dateCourte(regle.defaut) : regle.type === 'entier' ? nombre(regle.defaut) : String(regle.defaut);
  // Un champ date n'accepte que « AAAA-MM-JJ » : on lui donne le jour de Casablanca, pas l'instant complet.
  const valeur = regle.type === 'date' ? dateIso(String(ligne.valeur)) : String(ligne.valeur);
  return (
    <li className="px-4 py-4 sm:px-5">
      <Formulaire action={definirParametreAction} className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end" messageEnBas>
        <input type="hidden" name="cle" value={ligne.cle} />
        <input type="hidden" name="type" value={ligne.regle.type} />
        <div>
          <label htmlFor={`p-${ligne.cle}`} className="font-semibold text-marine-900">
            {ligne.description}
          </label>
          <p className="text-[0.8rem] text-encre-douce">
            {regle.type === 'entier' ? `De ${nombre(regle.min)} à ${nombre(regle.max)}. ` : ''}
            Valeur d’origine : {defaut}. {ligne.personnalise ? <Badge ton="or">Modifié</Badge> : null}
          </p>
        </div>
        <input
          id={`p-${ligne.cle}`}
          className="champ"
          name="valeur"
          required
          type={ligne.regle.type === 'date' ? 'date' : 'text'}
          inputMode={ligne.regle.type === 'entier' ? 'numeric' : undefined}
          min={regle.type === 'date' ? dateIso(regle.defaut) : undefined}
          defaultValue={valeur}
        />
        <BoutonEnvoi variante="secondaire">Enregistrer</BoutonEnvoi>
      </Formulaire>
    </li>
  );
}

export default async function PageParametres() {
  await exigerPermission('parametres.gerer');
  const [lignes, parametres] = await Promise.all([listerParametres(), chargerParametres()]);
  const canaux = canauxDisponibles();
  const ia = configIADepuisEnv();
  const travailleur = lignes.find((ligne) => ligne.cle === 'commissions.travailleur_active')!;
  const { premium, serenite } = parametres.commissions.formules;

  return (
    <>
      <EnTetePage surtitre="Administration" titre="Paramètres">
        <p>Les réglages qui pilotent les statuts, les signaux de risque et la conformité. Chaque changement est consigné dans le journal d’audit.</p>
      </EnTetePage>

      <div className="space-y-6">
        {GROUPES.map((groupe) => {
          const prefixes = groupe.prefixe.split('|');
          const duGroupe = lignes.filter((ligne) => prefixes.some((prefixe) => ligne.cle.startsWith(prefixe)));
          return (
            <Carte key={groupe.titre} titre={groupe.titre} sansMarge>
              <p className="px-4 pt-1 pb-2 text-[0.86rem] text-encre-douce sm:px-5">{groupe.aide}</p>
              <ul className="divide-y divide-sable-200 border-t border-sable-200">
                {duGroupe.map((ligne) => (
                  <LigneReglage key={ligne.cle} ligne={ligne} />
                ))}
              </ul>
            </Carte>
          );
        })}

        <Carte titre="Commission à la charge du travailleur">
          <Encart ton="danger" className="mb-4" titre={travailleur.valeur ? 'Actuellement AUTORISÉE' : 'Actuellement désactivée (recommandé)'}>
            {AVERTISSEMENT_COMMISSION_TRAVAILLEUR}
          </Encart>
          <p className="mb-3 text-[0.88rem] text-encre-douce">
            Tant que ce réglage est désactivé, l’outil refuse toute commission dont le payeur est le travailleur — y compris par un envoi direct au serveur. S’il est activé, chaque commission de ce type exige en plus un accusé de lecture et une justification écrite, et reste signalée dans le tableau de bord.
          </p>
          <Formulaire action={definirParametreAction} className="space-y-3" confirmer={travailleur.valeur ? undefined : 'Autoriser la saisie de commissions à la charge du travailleur ? Cette décision sera consignée à votre nom dans le journal d’audit.'}>
            <input type="hidden" name="cle" value="commissions.travailleur_active" />
            <input type="hidden" name="type" value="booleen" />
            {travailleur.valeur ? (
              <BoutonEnvoi variante="primaire">Désactiver la commission côté travailleur</BoutonEnvoi>
            ) : (
              <>
                <input type="hidden" name="valeur" value="on" />
                <label className="block text-[0.88rem] font-semibold text-marine-900" htmlFor="justification-travailleur">
                  Justification (20 caractères au moins) : avis juridique obtenu, auteur, date
                </label>
                <textarea id="justification-travailleur" className="champ" name="justification" rows={2} minLength={20} maxLength={2000} required />
                <BoutonEnvoi variante="danger">Autoriser malgré l’avertissement</BoutonEnvoi>
              </>
            )}
          </Formulaire>
        </Carte>

        <div className="grid gap-6 xl:grid-cols-2">
          <Carte titre="Formules de placement">
            <dl className="space-y-2 text-[0.9rem]">
              {[premium, serenite].map((formule) => (
                <div key={formule.libelle} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-sable-100 pb-2">
                  <dt className="font-semibold text-marine-900">{formule.libelle}</dt>
                  <dd>
                    {dirhams(formule.montant)} · remplacement garanti {formule.remplacementMois} mois
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[0.8rem] text-encre-douce">Montants repris du site Yallah Services (payés par l’employeur). Ils sont fixés dans le code (<code>src/domaine/parametres.ts</code>) pour rester alignés sur l’offre publiée ; un montant « sur mesure » se saisit besoin par besoin.</p>
          </Carte>

          <Carte titre="Services externes">
            <ul className="space-y-2 text-[0.9rem]">
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>Envoi d’e-mails</span>
                <Badge ton={canaux.email ? 'vert' : 'neutre'}>{canaux.email ? 'Configuré' : 'Non configuré — envois simulés'}</Badge>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>WhatsApp Business</span>
                <Badge ton={canaux.whatsapp ? 'vert' : 'neutre'}>{canaux.whatsapp ? 'Configuré' : 'Non configuré — envois simulés'}</Badge>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>Complément par modèle de langage</span>
                <Badge ton={ia ? 'vert' : 'neutre'}>{ia ? `Configuré (${ia.modele})` : 'Non configuré — règles seules'}</Badge>
              </li>
            </ul>
            <p className="mt-3 text-[0.8rem] text-encre-douce">Ces services se configurent par variables d’environnement sur le serveur (voir <code>.env.example</code>), jamais depuis cet écran : aucune clé n’est stockée en base.</p>
          </Carte>
        </div>

        <Carte titre="Tâches de fond">
          <p className="mb-3 text-[0.88rem] text-encre-douce">
            Le worker (<code>npm run worker</code>) traite en continu les alertes, les rappels de relance et la maintenance (statuts figés, scores, anonymisation des fiches arrivées en fin de conservation). Ce bouton exécute un passage tout de suite, par exemple si le worker est arrêté. Il ne lance aucune collecte.
          </p>
          <BoutonAction action={executerTachesAction} taille="normal" icone="horloge">
            Exécuter un passage maintenant
          </BoutonAction>
        </Carte>
      </div>
    </>
  );
}
