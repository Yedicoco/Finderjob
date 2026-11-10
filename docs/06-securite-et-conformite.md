# 06 — Sécurité et conformité

Ce document décrit ce que l'outil met en œuvre. Il ne constitue pas un avis juridique.

## Accès

- **Connexion obligatoire** sur toutes les pages ; trois rôles (lecteur, courtier, administrateur). Les
  droits sont vérifiés côté serveur à chaque page et à chaque action, pas seulement dans le menu.
- **Mots de passe** : 12 caractères au minimum, empreinte scrypt. Un mot de passe provisoire doit être changé
  à la première connexion.
- **Sessions** côté serveur, 12 heures par défaut : le cookie porte un jeton aléatoire, la base n'en garde
  que l'empreinte. Changer un rôle, désactiver un compte ou changer un mot de passe ferme les sessions du
  compte.
- **Tentatives de connexion** : 8 par quart d'heure pour un même compte et une même adresse. La réponse est
  identique que le compte existe ou non.
- **Dernier administrateur** : il ne peut être ni rétrogradé ni désactivé ; nul ne peut désactiver son
  propre compte.

## Protections du navigateur

- Politique de sécurité du contenu avec nonce, sans script ni style tiers ; polices auto-hébergées.
- Cookie de session `HttpOnly`, `SameSite=Lax`, et `Secure` dès que l'outil est servi en HTTPS.
- Affichage dans une iframe refusé (sauf mode de prévisualisation, à ne jamais activer en production).
- Formulaires : origine vérifiée par le serveur ; une requête venue d'un autre site est refusée.
- Aucune donnée personnelle dans les adresses, les journaux techniques ou le journal d'audit.

## Données personnelles (loi n° 09-08)

| Principe | Mise en œuvre |
| --- | --- |
| Consentement | Une fiche candidat ne peut pas être créée sans accord : canal, date et version du texte sont enregistrés. |
| Minimisation | L'âge déclaré, facultatif, sert uniquement à refuser les mineurs ; il n'entre dans aucun score. Origine, religion, situation familiale ne sont pas demandées. |
| Confidentialité | Coordonnées chiffrées ; fiches réservées aux courtiers ; chaque consultation est journalisée. |
| Conservation limitée | Anonymisation par le worker 12 mois après la dernière activité (réglable), signalée 30 jours avant au tableau de bord. |
| Droit d'effacement | Bouton « anonymiser » sur la fiche, avec motif ; action irréversible et journalisée. |
| Ne pas contacter | Un employeur marqué « ne pas contacter » n'apparaît plus dans les relances. |
| Traçabilité | Journal d'audit : qui, quoi, quand, sur quelle référence. |

Restent à la charge de Yallah Services : les formalités auprès de la CNDP, le texte de consentement remis
aux candidats, la désignation d'un responsable et la procédure de réponse aux demandes d'accès.

## Collecte

Voir [08-plan-de-collecte.md](08-plan-de-collecte.md). En résumé : rien n'est collecté automatiquement tant
qu'un administrateur n'a pas consigné le droit de le faire ; le client de collecte s'identifie, respecte
`robots.txt`, espace ses requêtes et s'arrête au premier refus.

## Offres à risque

Une annonce qui demande de l'argent au candidat, vise un mineur, contient des critères discriminatoires ou
annonce un salaire inférieur au minimum de référence est signalée ; au-delà d'un seuil elle devient
« douteuse » et ne peut être validée qu'avec une note écrite du courtier. La fiche de l'offre affiche chaque
signal détecté et l'extrait de l'annonce qui l'a déclenché.

## Commissions

Par défaut, seule une commission à la charge de l'employeur peut être saisie. Voir le point 1 de
[01-analyse-et-hypotheses.md](01-analyse-et-hypotheses.md).

## Journal d'audit

Enregistre notamment : connexions réussies et refusées, consultation d'une fiche candidat, affichage d'un
contact, création et modification des fiches, vérification et archivage des offres, changements de statut des
placements et commissions, modification d'une source ou d'un paramètre, exports, chargement et suppression
du jeu de démonstration. La base refuse toute modification ou suppression de ses lignes.

## Vérifier une installation

`npm run verifier` liste les points bloquants et les points d'attention : clé de chiffrement, sources actives
et ancienneté de la lecture de leurs conditions, commission travailleur, fiches au-delà de la durée de
conservation, offres actives hors périmètre, jeu de démonstration chargé, mots de passe provisoires.
