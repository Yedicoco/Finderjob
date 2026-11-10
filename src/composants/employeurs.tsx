/** Formulaires et éléments d'affichage des employeurs et de leurs besoins. */
import { BASES_CONTACT, CONTRATS, LANGUES, LOGEMENT, PERIODES_SALAIRE, STATUTS_BESOIN, STATUTS_EMPLOYEUR, TEMPS_TRAVAIL, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import type { Parametres } from '@/domaine/parametres';
import type { BesoinListe, EmployeurDetail } from '@/serveur/employeurs';
import { dateIso, dirhams } from './format';
import { OPTIONS_VILLES, SelectionMetier } from './options';
import { Badge, Cases, Champ, Selection, type Ton } from './ui';

const TON_EMPLOYEUR: Record<string, Ton> = { prospect: 'neutre', a_contacter: 'or', contacte: 'marine', besoin_qualifie: 'marine', candidats_proposes: 'marine', placement_realise: 'vert', cloture: 'neutre' };
const TON_BESOIN: Record<string, Ton> = { ouvert: 'or', en_cours: 'marine', pourvu: 'vert', annule: 'neutre' };

export function StatutEmployeur({ statut }: { statut: string }) {
  return <Badge ton={TON_EMPLOYEUR[statut] ?? 'neutre'}>{STATUTS_EMPLOYEUR.libelle(statut)}</Badge>;
}

export function StatutBesoin({ statut }: { statut: string }) {
  return <Badge ton={TON_BESOIN[statut] ?? 'neutre'}>{STATUTS_BESOIN.libelle(statut)}</Badge>;
}

export const libelleFormule = (formule: string | null, montant: number | null, parametres: Parametres): string => {
  if (!formule) return 'Aucune formule choisie';
  if (formule === 'sur_mesure') return `Sur mesure${montant !== null ? ` — ${dirhams(montant)}` : ''}`;
  const f = parametres.commissions.formules[formule as 'premium' | 'serenite'];
  return f ? `${f.libelle} — ${dirhams(montant ?? f.montant)}, remplacement ${f.remplacementMois} mois` : formule;
};

function Section({ titre, aide, children }: { titre: string; aide?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-sable-200 bg-white p-4 shadow-carte sm:p-5">
      <legend className="titre px-1 text-[1.15rem] text-marine-900">{titre}</legend>
      {aide ? <p className="mb-3 text-[0.84rem] text-encre-douce">{aide}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

export function ChampsEmployeur({ employeur }: { employeur?: EmployeurDetail }) {
  return (
    <div className="space-y-5">
      <Section titre="L’employeur">
        <Champ libelle="Type" obligatoire>
          <Selection name="type" defaultValue={employeur?.employer_type ?? 'famille'} options={TYPES_EMPLOYEUR.options} />
        </Champ>
        <Champ libelle="Nom" obligatoire aide="Nom de la famille, de l’établissement ou de la société." className="sm:col-span-1 lg:col-span-2">
          <input className="champ" name="nom" defaultValue={employeur?.name ?? ''} required minLength={2} maxLength={160} dir="auto" autoComplete="off" />
        </Champ>
        <Champ libelle="Ville">
          <Selection name="ville" defaultValue={employeur?.city_code ?? ''} vide="Non précisée" options={OPTIONS_VILLES} />
        </Champ>
        <Champ libelle="Quartier">
          <input className="champ" name="quartier" defaultValue={employeur?.district ?? ''} maxLength={80} dir="auto" />
        </Champ>
        <Champ libelle="Adresse">
          <input className="champ" name="adresse" defaultValue={employeur?.adresse ?? ''} maxLength={300} dir="auto" autoComplete="off" />
        </Champ>
      </Section>

      <Section titre="Contact" aide="Les coordonnées sont chiffrées en base. Pour une famille ou un particulier, la loi n° 09-08 impose de savoir comment elles ont été obtenues.">
        <Champ libelle="Personne à contacter">
          <input className="champ" name="contact" defaultValue={employeur?.contact ?? ''} maxLength={120} dir="auto" autoComplete="off" />
        </Champ>
        <Champ libelle="Téléphone">
          <input className="champ" name="telephone" type="tel" inputMode="tel" defaultValue={employeur?.telephone ?? ''} autoComplete="off" />
        </Champ>
        <Champ libelle="E-mail">
          <input className="champ" name="email" type="email" defaultValue={employeur?.email ?? ''} autoComplete="off" />
        </Champ>
        <Champ libelle="Comment ces coordonnées ont été obtenues" className="sm:col-span-2">
          <Selection name="baseContact" defaultValue={employeur?.contact_basis ?? 'non_renseignee'} options={BASES_CONTACT.options} />
        </Champ>
        <Champ libelle="Prochaine relance">
          <input className="champ" type="date" name="prochaineRelance" defaultValue={dateIso(employeur?.next_follow_up_at)} />
        </Champ>
        <label className="flex items-start gap-2.5 rounded-lg border border-sable-300 bg-sable-50 px-3 py-2.5 text-[0.9rem] font-medium text-marine-900 sm:col-span-2 lg:col-span-3">
          <input type="checkbox" name="nePasContacter" defaultChecked={employeur?.do_not_contact ?? false} className="mt-0.5 size-4 accent-marine-900" />
          <span>
            Ne plus contacter cet employeur
            <span className="block text-[0.8rem] font-normal text-encre-douce">À cocher s’il le demande. Plus aucun appel, message ou e-mail ne pourra être enregistré — seulement des notes internes.</span>
          </span>
        </label>
      </Section>

      <Section titre="Notes">
        <Champ libelle="Notes internes" className="sm:col-span-2 lg:col-span-3">
          <textarea className="champ" name="notes" rows={3} maxLength={4000} defaultValue={employeur?.notes ?? ''} dir="auto" />
        </Champ>
      </Section>
    </div>
  );
}

export function ChampsBesoin({ besoin, parametres }: { besoin?: BesoinListe; parametres: Parametres }) {
  const { premium, serenite } = parametres.commissions.formules;
  return (
    <div className="space-y-5">
      <Section titre="Le poste">
        <Champ libelle="Intitulé" obligatoire className="sm:col-span-2">
          <input className="champ" name="titre" defaultValue={besoin?.title ?? ''} required minLength={3} maxLength={160} dir="auto" placeholder="Ex. : Nounou à demeure pour deux enfants" />
        </Champ>
        <Champ libelle="Métier" aide="Indispensable pour proposer des candidats.">
          <SelectionMetier name="metier" defaultValue={besoin?.metier ?? ''} vide="Choisir…" />
        </Champ>
        <Champ libelle="Nombre de postes">
          <input className="champ" name="postes" inputMode="numeric" defaultValue={besoin?.headcount ?? 1} />
        </Champ>
        <Champ libelle="Ville">
          <Selection name="ville" defaultValue={besoin?.city_code ?? ''} vide="Non précisée" options={OPTIONS_VILLES} />
        </Champ>
        <Champ libelle="Quartier">
          <input className="champ" name="quartier" defaultValue={besoin?.district ?? ''} maxLength={80} dir="auto" />
        </Champ>
        <Champ libelle="Début souhaité">
          <input className="champ" type="date" name="debut" defaultValue={dateIso(besoin?.start_date)} />
        </Champ>
        <label className="flex items-center gap-2 self-end pb-2 text-[0.9rem] font-medium text-marine-900">
          <input type="checkbox" name="urgent" defaultChecked={besoin?.is_urgent ?? false} className="size-4 accent-marine-900" /> Besoin urgent
        </label>
      </Section>

      <Section titre="Conditions proposées">
        <Champ libelle="Contrat">
          <Selection name="contrat" defaultValue={besoin?.contract_type ?? 'non_precise'} options={CONTRATS.options} />
        </Champ>
        <Champ libelle="Rythme">
          <Selection name="temps" defaultValue={besoin?.work_time ?? 'non_precise'} options={TEMPS_TRAVAIL.options} />
        </Champ>
        <Champ libelle="Logement">
          <Selection name="logement" defaultValue={besoin?.housing ?? ''} vide="Non précisé" options={LOGEMENT.options.filter((option) => option.valeur !== 'indifferent')} />
        </Champ>
        <Champ libelle="Salaire minimum (DH)">
          <input className="champ" name="salaireMin" inputMode="decimal" defaultValue={besoin?.salary_min ?? ''} />
        </Champ>
        <Champ libelle="Salaire maximum (DH)">
          <input className="champ" name="salaireMax" inputMode="decimal" defaultValue={besoin?.salary_max ?? ''} />
        </Champ>
        <Champ libelle="Période">
          <Selection name="periodeSalaire" defaultValue={besoin?.salary_period ?? 'mois'} options={PERIODES_SALAIRE.options} />
        </Champ>
      </Section>

      <Section titre="Profil recherché" aide="N’enregistrez que des exigences professionnelles. Un critère d’origine, de religion, d’âge ou de situation familiale ne peut ni être saisi ni servir à trier les candidats.">
        <Champ libelle="Expérience minimale (années)">
          <input className="champ" name="experienceMin" inputMode="decimal" defaultValue={besoin?.experience_min_years ?? ''} />
        </Champ>
        <Champ libelle="Permis de conduire">
          <Selection
            name="permis"
            defaultValue={besoin?.driving_license === true ? 'oui' : besoin?.driving_license === false ? 'non' : ''}
            vide="Sans importance"
            options={[
              { valeur: 'oui', libelle: 'Exigé' },
              { valeur: 'non', libelle: 'Non exigé' },
            ]}
          />
        </Champ>
        <Champ libelle="Langues demandées" className="sm:col-span-2 lg:col-span-3">
          <Cases nom="langues" selection={besoin?.languages ?? []} colonnes="sm:grid-cols-4" options={LANGUES.options} />
        </Champ>
        <Champ libelle="Autres exigences professionnelles" className="sm:col-span-2 lg:col-span-3">
          <textarea className="champ" name="exigences" rows={2} maxLength={2000} defaultValue={besoin?.requirements ?? ''} dir="auto" />
        </Champ>
      </Section>

      <Section titre="Frais de placement" aide="Payés par l’employeur. Aucun frais n’est demandé au candidat.">
        <Champ libelle="Formule" className="sm:col-span-2">
          <Selection
            name="formule"
            defaultValue={besoin?.fee_plan ?? ''}
            vide="À définir plus tard"
            options={[
              { valeur: 'premium', libelle: `${premium.libelle} — ${dirhams(premium.montant)}, remplacement ${premium.remplacementMois} mois` },
              { valeur: 'serenite', libelle: `${serenite.libelle} — ${dirhams(serenite.montant)}, remplacement ${serenite.remplacementMois} mois` },
              { valeur: 'sur_mesure', libelle: 'Sur mesure (montant ci-contre)' },
            ]}
          />
        </Champ>
        <Champ libelle="Montant sur mesure (DH)" aide="Ignoré pour Premium et Sérénité.">
          <input className="champ" name="montantFrais" inputMode="decimal" defaultValue={besoin?.fee_plan === 'sur_mesure' ? (besoin.fee_amount ?? '') : ''} />
        </Champ>
        <Champ libelle="Notes internes" className="sm:col-span-2 lg:col-span-3">
          <textarea className="champ" name="notes" rows={2} maxLength={2000} defaultValue={besoin?.notes ?? ''} dir="auto" />
        </Champ>
      </Section>
    </div>
  );
}
