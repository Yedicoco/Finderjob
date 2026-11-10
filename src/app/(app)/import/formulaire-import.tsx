'use client';

import Link from '@/composants/lien';
import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icone } from '@/composants/icones';
import { classesBouton, cx, type Option } from '@/composants/ui';
import { analyserOuImporter, importerFichierAction } from './actions';
import type { ApercuVue, ResultatImportVue } from './types';

const TONS = {
  succes: 'border-vert-100 bg-vert-50 text-vert-800',
  attention: 'border-ambre-100 bg-ambre-50 text-ambre-800',
  erreur: 'border-rouge-100 bg-rouge-50 text-rouge-700',
} as const;

function Message({ ton, titre, children }: { ton: keyof typeof TONS; titre: string; children?: ReactNode }) {
  return (
    <div role={ton === 'erreur' ? 'alert' : 'status'} className={cx('rounded-xl border px-4 py-3 text-[0.9rem]', TONS[ton])}>
      <p className="flex items-start gap-2 font-bold">
        <Icone nom={ton === 'succes' ? 'coche' : 'attention'} className="mt-0.5 size-4 shrink-0" />
        <span>{titre}</span>
      </p>
      {children ? <div className="mt-1 pl-6 text-marine-900">{children}</div> : null}
    </div>
  );
}

function Resultat({ resultat }: { resultat: ResultatImportVue }) {
  return (
    <Message ton={resultat.ton} titre={resultat.titre}>
      <p>{resultat.detail}</p>
      {resultat.lien ? (
        <p className="mt-1.5">
          <Link href={resultat.lien.href} className="font-semibold text-marine-800 underline decoration-or-500 decoration-2 underline-offset-3">
            {resultat.lien.libelle}
          </Link>
        </p>
      ) : null}
    </Message>
  );
}

function Apercu({ apercu }: { apercu: ApercuVue }) {
  const offre = apercu.offre;
  return (
    <section aria-label="Ce que l’outil a compris" className="rounded-xl border border-marine-100 bg-white shadow-carte">
      <header className="border-b border-sable-200 px-4 py-3 sm:px-5">
        <p className="text-[0.72rem] font-bold tracking-[0.12em] text-or-700 uppercase">Aperçu — rien n’est encore enregistré</p>
        <h3 className="titre mt-0.5 text-[1.35rem] text-marine-900" dir="auto">
          {offre?.titre ?? 'Annonce non retenue'}
        </h3>
        <p className="mt-1 text-[0.82rem] text-encre-douce">
          Source : <strong className="text-marine-900">{apercu.source}</strong>. {apercu.noteSource}
        </p>
      </header>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        {apercu.rejet ? (
          <Message ton="erreur" titre={apercu.rejet.titre}>
            <p>{apercu.rejet.detail}. Cette annonce ne sera pas enregistrée.</p>
          </Message>
        ) : null}
        {apercu.dejaConnue ? (
          <Message ton="attention" titre={`Cette annonce est déjà enregistrée (${apercu.dejaConnue.reference})`}>
            <p>
              L’enregistrer de nouveau mettra à jour la fiche existante.{' '}
              <Link href={`/offres/${apercu.dejaConnue.id}`} className="font-semibold underline">
                Ouvrir la fiche
              </Link>
            </p>
          </Message>
        ) : null}
        {offre ? (
          <>
            <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {offre.lignes.map((ligne) => (
                <div key={ligne.terme}>
                  <dt className="text-[0.72rem] font-semibold tracking-wide text-encre-douce uppercase">{ligne.terme}</dt>
                  <dd className={cx('text-[0.93rem]', ligne.alerte ? 'font-semibold text-ambre-800' : 'text-marine-900')} dir="auto">
                    {ligne.alerte ? 'Attention — ' : ''}
                    {ligne.valeur}
                  </dd>
                </div>
              ))}
            </dl>
            <div className={cx('rounded-lg border px-3 py-2.5 text-[0.9rem]', offre.actif ? TONS.succes : TONS.attention)}>
              <p className="font-bold">Statut prévu : {offre.statut}</p>
              {offre.explication ? <p className="mt-0.5 text-marine-900">{offre.explication}</p> : null}
            </div>
            <div className="grid gap-4 text-[0.88rem] sm:grid-cols-2">
              <div>
                <p className="font-semibold text-marine-900">
                  Risque : {offre.risque.score} / 100 — {offre.risque.niveau === 'eleve' ? 'élevé' : offre.risque.niveau === 'modere' ? 'modéré' : 'faible'}
                </p>
                {offre.risque.signaux.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-encre-douce">
                    {offre.risque.signaux.map((signal) => (
                      <li key={signal}>{signal}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-encre-douce">Aucun signal relevé par les règles automatiques.</p>
                )}
              </div>
              <div>
                <p className="font-semibold text-marine-900">Pertinence pour Yallah Services : {offre.pertinence} / 100</p>
                {offre.doublons.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {offre.doublons.map((doublon) => (
                      <li key={doublon.id} className="text-ambre-800">
                        {doublon.certain ? 'Doublon de ' : 'Ressemble à '}
                        <Link href={`/offres/${doublon.id}`} className="font-semibold underline">
                          {doublon.reference}
                        </Link>{' '}
                        ({doublon.score} %) <span dir="auto">— {doublon.titre}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-encre-douce">Aucune offre ressemblante en base.</p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

export function FormulaireImport({ villes, typesEmployeur, origineInitiale }: { villes: Option[]; typesEmployeur: Option[]; origineInitiale: 'site' | 'employeur' }) {
  const [etat, envoyer, enCours] = useActionState(analyserOuImporter, null);
  const [origine, setOrigine] = useState<'site' | 'employeur'>(origineInitiale);
  const [intention, setIntention] = useState<'apercu' | 'enregistrer'>('apercu');
  const formulaire = useRef<HTMLFormElement>(null);
  const retour = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!etat) return;
    // Après un enregistrement réussi, le formulaire est vidé pour l'annonce suivante.
    if (etat.resultat && etat.resultat.ton !== 'erreur') formulaire.current?.reset();
    retour.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [etat]);

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enCours) return;
    const declencheur = (evenement.nativeEvent as SubmitEvent).submitter;
    const donnees = new FormData(evenement.currentTarget, declencheur instanceof HTMLElement ? declencheur : undefined);
    setIntention(donnees.get('intention') === 'enregistrer' ? 'enregistrer' : 'apercu');
    startTransition(() => envoyer(donnees));
  }

  const etiquette = 'mb-1 block text-[0.86rem] font-semibold text-marine-900';
  const aide = 'mt-1 text-[0.78rem] text-encre-douce';

  return (
    <form ref={formulaire} action={envoyer} onSubmit={soumettre} aria-busy={enCours} className="space-y-5">
      <fieldset>
        <legend className={etiquette}>D’où vient cette annonce ?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['site', 'Je l’ai lue sur un site ou un réseau', 'Site d’emploi, Facebook, groupe WhatsApp… Un extrait et le lien sont conservés.'],
              ['employeur', 'Un employeur nous l’a confiée', 'Demande reçue directement : texte complet et coordonnées conservés.'],
            ] as const
          ).map(([valeur, titre, detail]) => (
            <label key={valeur} className={cx('flex cursor-pointer gap-3 rounded-xl border px-3.5 py-3', origine === valeur ? 'border-marine-700 bg-marine-50 ring-1 ring-marine-700' : 'border-sable-300 bg-white hover:border-marine-300')}>
              <input type="radio" name="origine" value={valeur} checked={origine === valeur} onChange={() => setOrigine(valeur)} className="mt-1 size-4 accent-marine-800" />
              <span>
                <span className="block font-semibold text-marine-900">{titre}</span>
                <span className="block text-[0.82rem] text-encre-douce">{detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="import-texte" className={etiquette}>
          Texte de l’annonce <span className="text-rouge-600">*</span>
        </label>
        <textarea id="import-texte" name="texte" rows={9} required minLength={20} maxLength={20000} dir="auto" className="champ font-[inherit] leading-relaxed" placeholder="Collez ici le texte tel qu’il est écrit dans l’annonce (français, arabe ou anglais)." />
        <p className={aide}>Le métier, la ville, le salaire, le contrat et les signaux de risque sont repérés automatiquement. Vous pourrez tout corriger sur la fiche.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="import-url" className={etiquette}>
            Lien vers l’annonce {origine === 'site' ? <span className="font-normal text-encre-douce">(recommandé)</span> : <span className="font-normal text-encre-douce">(s’il existe)</span>}
          </label>
          <input id="import-url" name="url" type="url" inputMode="url" className="champ" placeholder="https://…" />
          <p className={aide}>Aucune requête n’est envoyée au site : le lien sert à retrouver l’annonce et à repérer les doublons.</p>
        </div>
        <div>
          <label htmlFor="import-date" className={etiquette}>
            Date de publication
          </label>
          <input id="import-date" name="datePublication" type="date" min="2025-01-01" className="champ" />
          <p className={aide}>Celle qui est écrite sur l’annonce. Laissez vide si elle n’y figure pas : l’outil ne met jamais la date du jour à la place.</p>
        </div>
      </div>

      <details className="rounded-xl border border-sable-200 bg-sable-50 px-4 py-3">
        <summary className="cursor-pointer text-[0.9rem] font-semibold text-marine-800">Préciser d’autres informations (facultatif)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <label htmlFor="import-titre" className={etiquette}>
              Titre du poste
            </label>
            <input id="import-titre" name="titre" maxLength={300} dir="auto" className="champ" placeholder="Sinon, la première ligne du texte sert de titre" />
          </div>
          <div>
            <label htmlFor="import-ville" className={etiquette}>
              Ville
            </label>
            <select id="import-ville" name="ville" className="champ" defaultValue="">
              <option value="">Détecter dans le texte</option>
              {villes.map((ville) => (
                <option key={ville.valeur} value={ville.libelle}>
                  {ville.libelle}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="import-employeur" className={etiquette}>
              Employeur
            </label>
            <input id="import-employeur" name="employeur" maxLength={200} dir="auto" className="champ" />
          </div>
          <div>
            <label htmlFor="import-type" className={etiquette}>
              Type d’employeur
            </label>
            <select id="import-type" name="typeEmployeur" className="champ" defaultValue="">
              <option value="">Détecter dans le texte</option>
              {typesEmployeur.map((type) => (
                <option key={type.valeur} value={type.valeur}>
                  {type.libelle}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="import-salaire-min" className={etiquette}>
              Salaire minimum (DH)
            </label>
            <input id="import-salaire-min" name="salaireMin" inputMode="decimal" className="champ" />
          </div>
          <div>
            <label htmlFor="import-salaire-max" className={etiquette}>
              Salaire maximum (DH)
            </label>
            <input id="import-salaire-max" name="salaireMax" inputMode="decimal" className="champ" />
          </div>
          <div>
            <label htmlFor="import-periode" className={etiquette}>
              Période
            </label>
            <select id="import-periode" name="periodeSalaire" className="champ" defaultValue="mois">
              <option value="mois">par mois</option>
              <option value="semaine">par semaine</option>
              <option value="jour">par jour</option>
              <option value="heure">par heure</option>
            </select>
          </div>
          <div>
            <label htmlFor="import-expiration" className={etiquette}>
              Date limite de candidature
            </label>
            <input id="import-expiration" name="dateExpiration" type="date" className="champ" />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-[0.9rem] font-medium text-marine-900">
            <input type="checkbox" name="urgent" className="size-4 accent-marine-800" /> Recrutement urgent
          </label>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="intention" value="apercu" disabled={enCours} className={classesBouton('secondaire')}>
          <Icone nom="recherche" className="size-4" />
          {enCours && intention === 'apercu' ? 'Analyse…' : 'Analyser sans enregistrer'}
        </button>
        <button type="submit" name="intention" value="enregistrer" disabled={enCours} className={classesBouton('primaire')}>
          <Icone nom="coche" className="size-4" />
          {enCours && intention === 'enregistrer' ? 'Enregistrement…' : 'Enregistrer l’offre'}
        </button>
      </div>

      <div ref={retour} className="scroll-mt-24 space-y-4" aria-live="polite">
        {etat?.erreur ? <Message ton="erreur" titre={etat.erreur} /> : null}
        {etat?.resultat ? <Resultat resultat={etat.resultat} /> : null}
        {etat?.apercu ? <Apercu apercu={etat.apercu} /> : null}
      </div>
    </form>
  );
}

export function FormulaireFichier() {
  const [etat, envoyer, enCours] = useActionState(importerFichierAction, null);
  const formulaire = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (etat?.bilan && etat.bilan.ton !== 'erreur') formulaire.current?.reset();
  }, [etat]);

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enCours) return;
    const donnees = new FormData(evenement.currentTarget);
    startTransition(() => envoyer(donnees));
  }

  return (
    <form ref={formulaire} action={envoyer} onSubmit={soumettre} aria-busy={enCours} className="space-y-3">
      <div>
        <label htmlFor="import-fichier" className="mb-1 block text-[0.86rem] font-semibold text-marine-900">
          Fichier CSV ou JSON (2 Mo au plus)
        </label>
        <input id="import-fichier" name="fichier" type="file" accept=".csv,.json,text/csv,application/json" required className="block w-full text-[0.88rem] file:mr-3 file:rounded-lg file:border-0 file:bg-marine-900 file:px-3.5 file:py-2 file:font-semibold file:text-white hover:file:bg-marine-800" />
      </div>
      <button type="submit" disabled={enCours} className={classesBouton('secondaire')}>
        <Icone nom="importer" className="size-4" />
        {enCours ? 'Import en cours…' : 'Importer le fichier'}
      </button>
      <div aria-live="polite" className="space-y-2">
        {etat?.erreur ? <Message ton="erreur" titre={etat.erreur} /> : null}
        {etat?.bilan ? (
          <Message ton={etat.bilan.ton} titre={etat.bilan.message}>
            {etat.bilan.lignes.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-[0.84rem]">
                {etat.bilan.lignes.map((ligne) => (
                  <li key={ligne}>{ligne}</li>
                ))}
              </ul>
            ) : null}
          </Message>
        ) : null}
      </div>
    </form>
  );
}
