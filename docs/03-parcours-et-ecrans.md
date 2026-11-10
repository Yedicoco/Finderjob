# 03 — Parcours et écrans

## Parcours type d'un courtier

1. **Ouvrir « À faire aujourd'hui ».** Cinq compteurs (offres à vérifier, relances employeurs, candidats
   suggérés, commissions à encaisser, notifications) puis les offres à traiter en priorité.
2. **Vérifier une offre.** La fiche indique pourquoi elle demande une vérification : date inconnue, lieu non
   confirmé, risque, doublon probable. Le courtier corrige ce qui manque, confirme, écarte ou archive. Une
   offre à risque élevé ne peut être validée qu'avec une note écrite. Une offre archivée parce qu'elle a été
   publiée avant le début de la recherche ne se rouvre pas à la main ; si sa date a été mal relevée, la
   corriger sur la fiche suffit à la reprendre.
3. **Ajouter une offre.** Coller le texte d'une annonce : l'outil montre un aperçu (métier, ville, salaire,
   date, risque) avant d'enregistrer. D'un site, seuls un extrait et le lien sont gardés ; d'un employeur, le
   texte complet.
4. **Enregistrer un candidat.** Le consentement est obligatoire et daté. Les coordonnées sont chiffrées.
5. **Enregistrer un employeur et son besoin.** Métier, ville, conditions, formule de frais.
6. **Rapprocher.** « Chercher des candidats » sur une offre ou un besoin ; « Chercher des postes » sur un
   candidat. Chaque suggestion affiche ses points forts et le détail « Pourquoi ce score ? ».
7. **Placer.** À l'enregistrement du placement, une case permet de créer la commission prévue par la
   formule du besoin. Le besoin passe à « pourvu » quand tous
   les postes le sont, et se rouvre si le placement est rompu.
8. **Encaisser.** La commission passe de « due » à « facturée » puis « encaissée » ; un reçu interne s'imprime.

## Les écrans

| Écran | Adresse | Pour qui |
| --- | --- | --- |
| À faire aujourd'hui | `/` | Tous |
| Offres : liste, recherche, filtres, onglets de statut | `/offres` | Tous |
| Fiche d'une offre | `/offres/…` | Tous (actions réservées aux courtiers) |
| Ajouter des offres : saisie ou fichier | `/import` | Courtier |
| Candidats, fiche, création | `/candidats` | Courtier |
| Employeurs, fiche, création | `/employeurs` | Courtier |
| Besoins, fiche | `/besoins` | Courtier |
| Placements, fiche | `/placements` | Courtier |
| Commissions et reçus | `/commissions` | Courtier |
| Alertes et notifications | `/alertes` | Tous |
| Tableau de bord | `/tableau-de-bord` | Tous (montants masqués au lecteur) |
| Sources et collecte | `/administration/sources` | Administrateur |
| Utilisateurs | `/administration/utilisateurs` | Administrateur |
| Paramètres, dont le début de la recherche | `/administration/parametres` | Administrateur |
| Journal d'audit | `/administration/journal` | Administrateur |
| Jeu de démonstration | `/administration/demonstration` | Administrateur |
| Mon compte | `/compte` | Tous |

## Principes d'interface

- **Dire pourquoi.** Un statut, un score ou un refus est toujours accompagné de sa raison.
- **Fonctionner sans JavaScript.** Les formulaires sont rendus par le serveur et restent utilisables si le
  script ne se charge pas ; JavaScript ajoute les confirmations et évite les rechargements.
- **Téléphone, tablette, ordinateur.** Menu repliable sous 1024 px ; aucun défilement horizontal de page
  de 360 à 1366 px (vérifié sur 30 pages).
- **Impression.** Les reçus et le tableau de bord s'impriment sans menu ni boutons.
- **Arabe.** Les textes arabes s'affichent de droite à gauche avec une police adaptée.
- **Charte.** Couleurs et polices reprises du site public de Yallah Services (marine, or, ivoire, vert).
- **Données fictives visibles.** Tout élément du jeu de démonstration porte l'étiquette « FICTIF », un
  bandeau le rappelle sur chaque page et un reçu fictif est barré de la mention « Spécimen ».
