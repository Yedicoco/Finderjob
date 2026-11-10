'use client';

/**
 * Formulaire relié à une Server Action.
 *
 * - affiche l'erreur ou la confirmation renvoyée par le serveur ;
 * - conserve la saisie en cas d'erreur (l'envoi est fait par transition, sans
 *   la remise à zéro automatique des formulaires React) ;
 * - reste utilisable avant le chargement du JavaScript (attribut action).
 */
import { createContext, useActionState, useContext, useEffect, useRef, startTransition, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import type { EtatAction } from '@/serveur/etat-action';
import { Icone, type NomIcone } from './icones';
import { classesBouton, cx } from './ui';

const EnCours = createContext(false);

type Action = (etat: EtatAction, donnees: FormData) => Promise<EtatAction>;

export function Formulaire({
  action,
  children,
  className,
  confirmer,
  viderApresSucces = false,
  messageEnBas = false,
  ...reste
}: Omit<ComponentProps<'form'>, 'action' | 'onSubmit'> & { action: Action; confirmer?: string; viderApresSucces?: boolean; messageEnBas?: boolean }) {
  const [etat, envoyer, enCours] = useActionState(action, null);
  const formulaire = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (etat?.message && viderApresSucces) formulaire.current?.reset();
  }, [etat, viderApresSucces]);

  function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (enCours) return;
    if (confirmer && !window.confirm(confirmer)) return;
    const declencheur = (evenement.nativeEvent as SubmitEvent).submitter;
    const donnees = new FormData(evenement.currentTarget, declencheur instanceof HTMLElement ? declencheur : undefined);
    startTransition(() => envoyer(donnees));
  }

  const retour = etat?.erreur ? (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-rouge-100 bg-rouge-50 px-3 py-2 text-[0.88rem] font-medium text-rouge-700">
      <Icone nom="attention" className="mt-0.5 size-4" />
      <span>{etat.erreur}</span>
    </p>
  ) : etat?.message ? (
    <p role="status" className="flex items-start gap-2 rounded-lg border border-vert-100 bg-vert-50 px-3 py-2 text-[0.88rem] font-medium text-vert-800">
      <Icone nom="coche" className="mt-0.5 size-4" />
      <span>{etat.message}</span>
    </p>
  ) : null;

  return (
    <form ref={formulaire} action={envoyer} onSubmit={soumettre} className={className} aria-busy={enCours} {...reste}>
      <EnCours.Provider value={enCours}>
        {!messageEnBas && retour ? <div className="mb-3">{retour}</div> : null}
        {children}
        {messageEnBas && retour ? <div className="mt-3">{retour}</div> : null}
      </EnCours.Provider>
    </form>
  );
}

export function BoutonEnvoi({
  children,
  variante = 'primaire',
  taille = 'normal',
  icone,
  enCours: libelleEnCours,
  className,
  ...reste
}: Omit<ComponentProps<'button'>, 'type'> & { variante?: Parameters<typeof classesBouton>[0]; taille?: Parameters<typeof classesBouton>[1]; icone?: NomIcone; enCours?: ReactNode }) {
  const enCours = useContext(EnCours);
  return (
    <button type="submit" disabled={enCours || reste.disabled} className={cx(classesBouton(variante, taille), className)} {...reste}>
      {icone ? <Icone nom={icone} className="size-4" /> : null}
      {enCours ? (libelleEnCours ?? 'Un instant…') : children}
    </button>
  );
}

/** Bouton seul qui déclenche une action (vérifier, archiver, retenir…). */
export function BoutonAction({
  action,
  champs,
  children,
  confirmer,
  variante = 'secondaire',
  taille = 'petit',
  icone,
  className,
}: {
  action: Action;
  champs?: Record<string, string>;
  children: ReactNode;
  confirmer?: string;
  variante?: Parameters<typeof classesBouton>[0];
  taille?: Parameters<typeof classesBouton>[1];
  icone?: NomIcone;
  className?: string;
}) {
  return (
    <Formulaire action={action} confirmer={confirmer} className={cx('inline-flex flex-col items-start gap-1', className)} messageEnBas>
      {Object.entries(champs ?? {}).map(([nom, valeur]) => (
        <input key={nom} type="hidden" name={nom} value={valeur} />
      ))}
      <BoutonEnvoi variante={variante} taille={taille} icone={icone}>
        {children}
      </BoutonEnvoi>
    </Formulaire>
  );
}
