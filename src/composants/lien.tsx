/**
 * Lien interne de l'application : `next/link` SANS préchargement.
 *
 * Par défaut, Next précharge en arrière-plan chaque lien visible à l'écran.
 * Ici toutes les pages sont dynamiques (elles dépendent de la session) : le
 * préchargement n'apporte rien et envoie des dizaines de requêtes par écran.
 * Surtout, l'ouverture d'une fiche candidat ou employeur est journalisée ; une
 * page ne doit donc jamais être demandée au serveur sans que la personne ait
 * réellement cliqué.
 */
import NextLink from 'next/link';
import type { ComponentProps } from 'react';

export default function Lien(proprietes: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...proprietes} />;
}
