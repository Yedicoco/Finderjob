# 01 — Analyse de la demande et hypothèses

## Ce qui est demandé

Un outil interne pour Yallah Services, intermédiaire de placement à Casablanca, qui :

1. **repère** les offres d'emploi publiées au Maroc depuis le début de la recherche (une date réglable, au
   plus tôt le 1er janvier 2026) dans ses trois secteurs (personnel de maison, beauté et bien-être,
   conciergerie et hospitalité) ;
2. **qualifie** chaque offre : d'où elle vient, quand elle a été publiée, si elle est encore valable, si elle
   présente un risque, si elle existe déjà ;
3. **aide à placer** : candidats, employeurs, besoins, rapprochements, placements, commissions ;
4. le fait **dans le respect** des sites d'où viennent les offres et des personnes dont les données sont
   enregistrées.

## Hypothèses retenues

| Sujet | Hypothèse | Où la modifier |
| --- | --- | --- |
| Utilisateurs | Une petite équipe : administrateur, courtiers, lecteurs. Pas d'accès candidat ni employeur. | Rôles dans `src/serveur/auth.ts` |
| Langue | Interface en français ; annonces lues en français, arabe et anglais. | — |
| Périmètre | Maroc uniquement ; offres publiées à partir du début de la recherche : **lundi 9 novembre 2026** (semaine en cours, à la demande de Yallah Services le 10 novembre 2026). Date fixe, qui n'avance pas d'elle-même ; un administrateur la déplace entre le 1er janvier 2026 (plancher du cahier des charges) et le jour même. | Administration › Paramètres |
| Validité d'une offre | 45 jours après publication, sauf date limite écrite dans l'annonce. | Paramètre « durée de validité » |
| Heure | Toutes les dates sont lues et affichées à l'heure légale du Maroc : GMT (UTC+0) toute l'année depuis le 20 septembre 2026 ; auparavant UTC+1, et UTC+0 pendant le ramadan. | `src/domaine/fuseau.ts` |
| Formules | Premium 1 000 DH (remplacement 6 mois) et Sérénité 500 DH (2 mois), reprises du dépôt du site public. | `src/domaine/parametres.ts` |
| Conservation | Fiches candidats anonymisées 12 mois après la dernière activité. | Paramètre « conservation » |
| Hébergement | Une application Node.js et une base PostgreSQL. | [04](04-architecture-technique.md) |

## Points qui demandent une décision de Yallah Services

Ces points ne sont pas des détails techniques : l'outil les signale mais ne peut pas les trancher.

### 1. Commission à la charge du travailleur

L'article 480 du Code du travail (loi n° 65-99) interdit aux agences de recrutement privées de percevoir des
frais des demandeurs d'emploi, et le site public de Yallah Services promet « aucun frais » aux candidats.
L'outil sait enregistrer une commission payée par un travailleur, mais **cette saisie est désactivée**. Pour
l'activer, un administrateur doit écrire une justification ; chaque commission de ce type exige ensuite un
accusé de lecture nominatif, s'affiche en rouge et remonte au tableau de bord.
**À faire valider par un conseil juridique avant toute activation.**

### 2. Collecte automatique sur les sites d'emploi

Aucun des six sites du catalogue n'a donné d'autorisation, et deux l'interdisent explicitement dans les
textes lus. Tout est donc désactivé. Le détail et la marche à suivre sont dans [08](08-plan-de-collecte.md).

### 3. Données personnelles (loi n° 09-08)

L'outil enregistre des données de candidats et de contacts d'employeurs. Il applique le consentement
obligatoire, le chiffrement, la journalisation des consultations et l'anonymisation. Les formalités auprès
de la CNDP (déclaration ou autorisation du traitement) restent à accomplir par Yallah Services.

### 4. Reçus

Les reçus imprimés sont des justificatifs internes. Ils ne portent ni ICE, ni identifiant fiscal, ni numéro de
registre du commerce, que l'outil ne connaît pas : ils ne remplacent pas une facture.

### 5. Salaire minimum de référence

Le SMIG utilisé pour signaler un salaire anormalement bas (17,92 DH de l'heure, soit 3 422,72 DH par mois) a
été relevé le 10 novembre 2026 dans trois sources secondaires concordantes, **pas dans le Bulletin officiel**.
À confirmer ; le seuil se règle dans Administration › Paramètres.

## Ce que l'outil ne fait pas

- Il ne publie aucune offre et n'envoie aucune proposition à un employeur de lui-même.
- Il ne contourne aucune protection d'un site (connexion, CAPTCHA, blocage) et n'exécute pas de JavaScript
  distant.
- Il ne décide pas à la place du courtier : les scores sont des aides, expliquées ligne à ligne.
- Il n'utilise ni l'âge, ni l'origine, ni le nom, ni la situation familiale pour classer les candidats.
