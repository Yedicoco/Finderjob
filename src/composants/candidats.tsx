/** Formulaire de fiche candidat (création et modification) et éléments d'affichage. */
import { COMPETENCE_PERMIS } from '@/domaine/appariement';
import { VILLES } from '@/domaine/geographie';
import { CANAUX_CONSENTEMENT, COMPETENCES, DOCUMENTS_CANDIDAT, LANGUES, LOGEMENT, PERIODES_SALAIRE, STATUTS_CANDIDAT, TEMPS_TRAVAIL } from '@/domaine/referentiels';
import { METIERS, SECTEURS } from '@/domaine/taxonomie';
import type { CandidatDetail } from '@/serveur/candidats';
import { dateIso, pluriel } from './format';
import { OPTIONS_VILLES, SelectionMetier } from './options';
import { Badge, Cases, Champ, Selection, type Ton } from './ui';

const TON_STATUT: Record<string, Ton> = { nouveau: 'or', contacte: 'marine', entretien: 'marine', propose: 'marine', place: 'vert', refuse: 'neutre', indisponible: 'neutre' };

export function StatutCandidat({ statut }: { statut: string }) {
  return <Badge ton={TON_STATUT[statut] ?? 'neutre'}>{STATUTS_CANDIDAT.libelle(statut)}</Badge>;
}

function Section({ titre, aide, children }: { titre: string; aide?: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-sable-200 bg-white p-4 shadow-carte sm:p-5">
      <legend className="titre px-1 text-[1.15rem] text-marine-900">{titre}</legend>
      {aide ? <p className="mb-3 text-[0.84rem] text-encre-douce">{aide}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

export function ChampsCandidat({ candidat, versionConsentement, conservationMois }: { candidat?: CandidatDetail; versionConsentement: string; conservationMois: number }) {
  const autresMetiers = candidat ? candidat.metiers.filter((code) => code !== candidat.metier) : [];
  return (
    <div className="space-y-5">
      <Section titre="Identité" aide="Le nom, le téléphone, l’e-mail et les notes sont chiffrés en base. Chaque consultation de la fiche est journalisée.">
        <Champ libelle="Nom complet" obligatoire>
          <input className="champ" name="nom" defaultValue={candidat?.nom ?? ''} required minLength={2} maxLength={120} autoComplete="off" dir="auto" />
        </Champ>
        <Champ libelle="Téléphone" aide="Format marocain ou international.">
          <input className="champ" name="telephone" type="tel" inputMode="tel" defaultValue={candidat?.telephone ?? ''} autoComplete="off" placeholder="06 12 34 56 78" />
        </Champ>
        <Champ libelle="E-mail">
          <input className="champ" name="email" type="email" defaultValue={candidat?.email ?? ''} autoComplete="off" />
        </Champ>
        <Champ libelle="Âge déclaré" aide="Facultatif. Sert uniquement à vérifier la majorité (18 ans) ; il n’entre dans aucun score.">
          <input className="champ" name="ageDeclare" inputMode="numeric" defaultValue={candidat?.declared_age ?? ''} />
        </Champ>
        <label className="flex items-center gap-2 self-end pb-2 text-[0.9rem] font-medium text-marine-900">
          <input type="checkbox" name="whatsappOptIn" defaultChecked={candidat?.whatsapp_opt_in ?? false} className="size-4 accent-marine-900" />
          Accepte d’être contacté(e) par WhatsApp
        </label>
      </Section>

      {candidat ? (
        <input type="hidden" name="consentementCanal" value={candidat.consent_channel} />
      ) : (
        <Section titre="Consentement" aide={`Obligatoire (loi n° 09-08). Version du texte de consentement : ${versionConsentement}. La fiche est conservée ${conservationMois} mois après la dernière activité, puis anonymisée.`}>
          <label className="flex items-start gap-2.5 rounded-lg border border-or-300 bg-or-50 px-3 py-2.5 text-[0.9rem] font-medium text-marine-900 sm:col-span-2 lg:col-span-3">
            <input type="checkbox" name="consentementDonne" required className="mt-0.5 size-4 accent-marine-900" />
            <span>
              La personne a donné son accord pour que Yallah Services enregistre ses informations et les transmette à des employeurs dans le cadre de sa recherche d’emploi. <span className="text-rouge-600">*</span>
            </span>
          </label>
          <Champ libelle="Accord recueilli par" obligatoire>
            <Selection name="consentementCanal" options={CANAUX_CONSENTEMENT.options} defaultValue="formulaire" />
          </Champ>
          <Champ libelle="Date de l’accord" aide="Aujourd’hui si vide.">
            <input className="champ" type="date" name="consentementDate" max={dateIso(new Date())} />
          </Champ>
        </Section>
      )}

      <Section titre="Métier et lieu">
        <Champ libelle="Métier principal" obligatoire>
          <SelectionMetier name="metierPrincipal" defaultValue={candidat?.metier ?? ''} vide="Choisir…" required />
        </Champ>
        <Champ libelle="Ville de résidence">
          <Selection name="ville" defaultValue={candidat?.city_code ?? ''} vide="Non précisée" options={OPTIONS_VILLES} />
        </Champ>
        <Champ libelle="Quartier">
          <input className="champ" name="quartier" defaultValue={candidat?.district ?? ''} maxLength={80} dir="auto" />
        </Champ>
        <details className="rounded-lg border border-sable-200 bg-sable-50 px-3 py-2 sm:col-span-2 lg:col-span-3" open={autresMetiers.length > 0}>
          <summary className="cursor-pointer text-[0.88rem] font-semibold text-marine-800">Autres métiers acceptés (4 au plus){autresMetiers.length ? ` — ${pluriel(autresMetiers.length, 'coché')}` : ''}</summary>
          <div className="mt-3 space-y-3">
            {SECTEURS.map((secteur) => (
              <div key={secteur.code}>
                <p className="mb-1 text-[0.76rem] font-bold tracking-wide text-encre-douce uppercase">{secteur.libelle.fr}</p>
                <Cases nom="metiers" selection={autresMetiers} options={METIERS.filter((metier) => metier.secteur === secteur.code).map((metier) => ({ valeur: metier.code, libelle: metier.libelle.fr }))} />
              </div>
            ))}
          </div>
        </details>
        <details className="rounded-lg border border-sable-200 bg-sable-50 px-3 py-2 sm:col-span-2 lg:col-span-3" open={(candidat?.accepted_city_codes.length ?? 0) > 0}>
          <summary className="cursor-pointer text-[0.88rem] font-semibold text-marine-800">Autres villes où la personne accepte de travailler{candidat?.accepted_city_codes.length ? ` — ${pluriel(candidat.accepted_city_codes.length, 'cochée')}` : ''}</summary>
          <div className="mt-3">
            <Cases nom="villesAcceptees" selection={candidat?.accepted_city_codes ?? []} colonnes="sm:grid-cols-3 lg:grid-cols-4" options={[...VILLES].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((ville) => ({ valeur: ville.code, libelle: ville.nom }))} />
          </div>
        </details>
      </Section>

      <Section titre="Expérience et conditions">
        <Champ libelle="Années d’expérience">
          <input className="champ" name="experienceAnnees" inputMode="decimal" defaultValue={candidat?.experience_years ?? ''} />
        </Champ>
        <Champ libelle="Disponible à partir du" aide="Vide = disponible dès maintenant.">
          <input className="champ" type="date" name="disponibleLe" defaultValue={dateIso(candidat?.available_from)} />
        </Champ>
        <Champ libelle="Logement">
          <Selection name="logement" defaultValue={candidat?.housing_preference ?? 'indifferent'} options={LOGEMENT.options} />
        </Champ>
        <Champ libelle="Salaire souhaité (DH)">
          <input className="champ" name="salaireAttendu" inputMode="decimal" defaultValue={candidat?.expected_salary ?? ''} />
        </Champ>
        <Champ libelle="Période">
          <Selection name="periodeSalaire" defaultValue={candidat?.salary_period ?? 'mois'} options={PERIODES_SALAIRE.options} />
        </Champ>
        <Champ libelle="Jours par semaine">
          <input className="champ" name="joursParSemaine" inputMode="numeric" defaultValue={candidat?.days_per_week ?? ''} placeholder="1 à 7" />
        </Champ>
        <Champ libelle="Rythmes acceptés" className="sm:col-span-2">
          <Cases nom="rythmes" selection={candidat?.work_times ?? []} colonnes="sm:grid-cols-4" options={TEMPS_TRAVAIL.options.filter((option) => option.valeur !== 'non_precise')} />
        </Champ>
        <label className="flex items-center gap-2 self-end pb-2 text-[0.9rem] font-medium text-marine-900">
          <input type="checkbox" name="permis" defaultChecked={Boolean(candidat?.driving_license || candidat?.competences.includes(COMPETENCE_PERMIS))} className="size-4 accent-marine-900" />
          Permis de conduire
        </label>
        <Champ libelle="Langues parlées" className="sm:col-span-2 lg:col-span-3">
          <Cases nom="langues" selection={candidat?.languages ?? []} colonnes="sm:grid-cols-4" options={LANGUES.options} />
        </Champ>
        <Champ libelle="Compétences" className="sm:col-span-2 lg:col-span-3">
          <Cases nom="competences" selection={candidat?.competences ?? []} colonnes="sm:grid-cols-3 lg:grid-cols-4" options={COMPETENCES.filter((competence) => competence.code !== COMPETENCE_PERMIS).map((competence) => ({ valeur: competence.code, libelle: competence.fr }))} />
        </Champ>
        <Champ libelle="Documents présentés" className="sm:col-span-2 lg:col-span-3">
          <Cases nom="documents" selection={candidat?.documents ?? []} colonnes="sm:grid-cols-3" options={DOCUMENTS_CANDIDAT.options} />
        </Champ>
      </Section>

      <Section titre="Présentation et notes">
        <Champ libelle="Présentation (transmissible à un employeur)" className="sm:col-span-2 lg:col-span-3" aide="Parcours professionnel en quelques lignes. N’y inscrivez ni origine, ni religion, ni état de santé, ni situation familiale.">
          <textarea className="champ" name="resume" rows={3} maxLength={1000} defaultValue={candidat?.summary ?? ''} dir="auto" />
        </Champ>
        <Champ libelle="Notes internes (chiffrées)" className="sm:col-span-2 lg:col-span-3">
          <textarea className="champ" name="notes" rows={3} maxLength={4000} defaultValue={candidat?.notes ?? ''} dir="auto" />
        </Champ>
      </Section>
    </div>
  );
}
