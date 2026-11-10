/**
 * Export CSV des offres (administrateur). Les coordonnées des annonces ne sont
 * jamais exportées ; les fiches fictives non plus. Chaque export est journalisé.
 */
import type { NextRequest } from 'next/server';
import { dateIso } from '@/composants/format';
import { versCsv } from '@/domaine/csv';
import { nomVille, villeParCode } from '@/domaine/geographie';
import { CONTRATS, LOGEMENT, MOTIFS_STATUT, PERIODES_SALAIRE, STATUTS_OFFRE, TEMPS_TRAVAIL, TYPES_EMPLOYEUR } from '@/domaine/referentiels';
import { METIERS, SECTEURS, libelleMetier, libelleSecteur } from '@/domaine/taxonomie';
import { STATUTS_FILTRE, exporterOffres, type FiltresOffres } from '@/serveur/offres';
import { sessionCourante } from '@/serveur/session-next';

export const dynamic = 'force-dynamic';

const ENTETES = [
  'Référence', 'Statut', 'Motif du statut', 'Titre', 'Métier', 'Secteur', 'Employeur', 'Type d’employeur', 'Ville', 'Quartier', 'Contrat', 'Rythme', 'Logement',
  'Salaire min (DH)', 'Salaire max (DH)', 'Période', 'Postes', 'Urgent', 'Recrutement en nombre', 'Publiée le', 'Expire le', 'Repérée le', 'Dernière vérification',
  'Pertinence', 'Risque', 'Chances de placement', 'À vérifier', 'Source', 'Lien de l’annonce',
];

export async function GET(requete: NextRequest): Promise<Response> {
  const session = await sessionCourante();
  if (!session) return new Response('Connexion requise.', { status: 401 });
  if (session.utilisateur.must_change_password || !session.peut('exports.creer')) return new Response('Votre rôle ne permet pas cet export.', { status: 403 });

  const p = requete.nextUrl.searchParams;
  const statut = p.get('statut') ?? '';
  const filtres: FiltresOffres = {
    statut: (STATUTS_FILTRE as readonly string[]).includes(statut) ? (statut as FiltresOffres['statut']) : 'tous',
    secteur: SECTEURS.some((secteur) => secteur.code === p.get('secteur')) ? p.get('secteur')! : undefined,
    metier: METIERS.some((metier) => metier.code === p.get('metier')) ? p.get('metier')! : undefined,
    ville: villeParCode(p.get('ville') ?? '') ? p.get('ville')! : undefined,
  };
  const { offres } = await exporterOffres(filtres, session.acteur);
  const lignes = offres.map((o) => [
    o.reference, STATUTS_OFFRE.libelle(o.effective_status), o.effective_reason === 'aucun' ? '' : MOTIFS_STATUT.libelle(o.effective_reason), o.title,
    o.metier ? libelleMetier(o.metier) : '', o.sector_code ? libelleSecteur(o.sector_code) : '', o.employer_name, o.employer_type_guess ? TYPES_EMPLOYEUR.libelle(o.employer_type_guess) : '',
    o.city_code ? nomVille(o.city_code) : o.city_label, o.district, CONTRATS.libelle(o.contract_type), TEMPS_TRAVAIL.libelle(o.work_time), o.housing ? LOGEMENT.libelle(o.housing) : '',
    o.salary_min, o.salary_max, o.salary_period ? PERIODES_SALAIRE.libelle(o.salary_period) : '', o.headcount, o.is_urgent, o.is_bulk_hiring,
    // Jours exprimés à l'heure de Casablanca (une annonce parue à 0 h 30 n'est pas datée de la veille).
    dateIso(o.published_at), dateIso(o.expires_at), dateIso(o.first_seen_at), dateIso(o.last_checked_at),
    o.relevance_score, o.risk_score, o.placement_score, o.requires_human_review, o.source_name, o.source_url,
  ]);
  const jour = new Date().toISOString().slice(0, 10);
  return new Response(versCsv(ENTETES, lignes), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="yallah-offres-${jour}.csv"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
