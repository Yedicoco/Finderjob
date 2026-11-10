# 09 — Classification, scores, doublons et rapprochement

Tous les calculs sont **déterministes et explicables** : même entrée, même résultat, et chaque score
s'affiche avec le détail de ses points. Les scores aident à trier ; aucune décision n'est prise à la place
du courtier. Les seuils cités sont les valeurs par défaut, réglables dans Administration › Paramètres.

Code : `src/domaine/`. Les pondérations sont des choix de conception à ajuster avec l'usage, pas des
valeurs mesurées.

## 1. Classer une annonce dans un métier

Dictionnaire pondéré de 42 métiers répartis en 3 secteurs (`classification.ts`, `taxonomie.ts`), en
français, arabe et anglais.

- Une expression forte dans le titre vaut 10 points, dans le corps 3 ; une expression faible vaut moins et
  ne compte que sans expression forte au même endroit.
- Le contexte ajuste : « ménage » avec « villa » renforce ; « gouvernante » avec « hôtel » bascule vers
  l'hôtellerie.
- Les expressions d'exclusion écartent les faux amis : « chauffeur poids lourd » n'est pas un chauffeur de
  maison, « médecine esthétique » n'est pas un poste d'esthéticienne.
- Confiance = 100 × (1 − e^(−points / 12)). **En dessous de 35, l'annonce n'est pas classée** : une source
  automatisée l'écarte, une saisie manuelle la soumet au courtier.

## 2. Statut d'une offre

| Situation | Statut | Vérification humaine |
| --- | --- | --- |
| Date de publication inconnue ou incohérente | Douteuse | Oui |
| Publiée avant le 1er janvier 2026 | Archivée (hors périmètre) | Non |
| Doublon d'une autre offre | Archivée, rattachée à l'offre principale | Non |
| Lieu non confirmé au Maroc | Douteuse | Oui |
| Risque élevé | Douteuse | Oui, avec note écrite |
| Date limite dépassée, ou publiée depuis plus de 45 jours sans date limite | Expirée | Non |
| Sinon | Active | Seulement si la ville manque, si le métier n'a pas pu être classé ou si un critère discriminatoire est repéré |

Le statut affiché est recalculé à chaque lecture : une offre active expire d'elle-même, et redevient
« douteuse » si elle n'a pas été revérifiée depuis 21 jours. **Sans date connue, une offre n'est jamais
active.**

## 3. Score de risque (0 à 100)

Somme des signaux détectés, plafonnée à 100. Niveaux : faible sous 25, modéré de 25 à 49, **élevé à partir
de 50**.

| Signal | Points |
| --- | --- |
| L'annonce vise une personne de moins de 18 ans | 70 |
| L'annonce demande de l'argent au candidat (frais, caution, avance) | 60 |
| Formulation typique d'une arnaque ou d'une activité illicite | 60 |
| Salaire inférieur au minimum légal de référence | 35 |
| Critère possiblement discriminatoire | 25 |
| Salaire anormalement bas | 25 |
| Salaire anormalement élevé pour ce type de poste | 20 |
| Salaire en devise étrangère | 15 |
| Date de publication inconnue | 15 |
| Ville non précisée | 10 |
| Employeur non identifié | 10 |

Les négations sont reconnues : « aucun frais », « sans caution » ne déclenchent rien. Ce score attire
l'attention, il ne prouve rien.

## 4. Scores d'une offre (0 à 100)

**Fraîcheur.** 100 le jour de la publication, divisée par deux tous les 10 jours ; 0 si l'offre est expirée
ou non datée.

**Qualité** = complétude (80 points) + fiabilité de la source (20 points).

| Élément | Points | Élément | Points |
| --- | --- | --- | --- |
| Description (selon la longueur) | 15 | Date exacte (approximative : 5) | 10 |
| Ville | 15 | Lien ou contact | 10 |
| Salaire affiché | 15 | Quartier | 5 |
| Employeur nommé | 10 | Expérience précisée | 5 |
| Type de contrat | 10 | Rythme précisé | 5 |

**Pertinence pour Yallah Services.**

| Critère | Maximum | Règle |
| --- | --- | --- |
| Métier | 45 | Priorité du métier × confiance du classement |
| Zone | 25 | Zone Yallah de phase 1 : 25 ; phase 2 : 20 ; phase 3 : 15 ; ville candidate : 10 ; autre ville du Maroc : 5 ; ville non précisée : 0 |
| Employeur | 10 | Famille, particulier, riad : 10 ; résidence : 9 ; hôtel, spa, salon : 8 ; entreprise : 5 ; inconnu : 3 |
| Urgence et volume | 10 | Recrutement urgent : 5 ; plusieurs postes : 5 |
| Contrat | 5 | CDI : 5 ; CDD : 4 ; saisonnier, intérim, journalier : 3 ; stage : 0 |
| Salaire | 5 | Affiché : 5 ; affiché mais anormal : 2 |

La pertinence est **divisée par deux** si le risque est élevé.

**Indice de placement** = pertinence 30 % + fraîcheur 25 % + vivier de candidats 20 % + qualité 15 % +
joignabilité 10 %. Le vivier compte les candidats disponibles sur ce métier et cette ville (3 ou plus : le
maximum). C'est une **estimation de priorité, pas une probabilité** : aucun historique de placements ne l'a
calibrée.

## 5. Doublons

1. **Empreinte exacte** : mêmes mots significatifs du titre, même employeur, même ville.
2. **Similarité** de 0 à 1 : titre 45 %, employeur 20 %, ville 15 %, date 10 %, métier 10 %.
   - à partir de **0,82** : rattachement automatique à l'offre principale ;
   - de **0,65 à 0,82** : doublon probable, signalé au courtier qui décide ;
   - sans employeur commun, plafonné à 0,80 sauf si les deux textes sont très proches.
3. **Deux langues** : une annonce en français et sa version arabe se reconnaissent par le métier,
   l'employeur, la ville et des dates proches.

La comparaison se limite aux offres des 30 derniers jours. Un courtier peut toujours dissocier deux offres
rattachées à tort.

## 6. Rapprochement candidat-poste (0 à 100)

| Critère | Maximum | Règle |
| --- | --- | --- |
| Métier | 35 | Métier principal identique : 35 ; métier pratiqué : 30 ; métier proche : 20 ; même secteur : 10 |
| Lieu | 20 | Habite la ville : 20 ; accepte d'y travailler : 16 ; poste logé, que le candidat ne refuse pas : 12 ; même région : 8 |
| Disponibilité | 10 | Immédiate : 10 ; sous 15 jours : 7 (3 si le poste est urgent) ; sous 30 jours : 4 |
| Expérience | 10 | Au moins l'expérience demandée : 10 ; un an de moins : 6 |
| Langues | 8 | Part des langues demandées que le candidat parle |
| Salaire | 7 | Salaire offert au moins égal aux prétentions : 7 ; écart de moins de 10 % : 5 |
| Logement et rythme | 5 | Logement compatible : 3 ; rythme compatible : 2 |
| Permis et compétences | 5 | Permis : 3 ; compétences demandées : 2 |

### Quand le poste ne demande rien, ou que l'information manque

Un critère sans exigence ne donne pas le maximum : il donne une note **neutre**, pour qu'un candidat qui
répond à une exigence réelle passe devant celui pour qui rien n'a pu être vérifié.

| Situation | Affichage |
| --- | --- |
| Le poste n'exige aucune langue | « Langues 6 / 8 — Aucune langue exigée » |
| Salaire du poste non affiché, ou prétentions du candidat inconnues | Salaire 4 / 7 |
| Expérience non exigée et non renseignée pour le candidat | Expérience 5 / 10 |
| Ville du poste non précisée | Lieu 5 / 20 |

Autres règles :

- **Arabe et darija** sont équivalents : une annonce qui demande l'arabe est satisfaite par la darija.
- **Le permis de conduire n'est compté qu'une fois.** Il est demandé si la case du besoin est cochée ou si
  l'annonce le mentionne ; il est détenu si la case de la fiche candidat est cochée. Il vaut alors 3 points
  et n'entre pas dans le décompte « N/M compétences demandées ». Quand le poste ne le demande pas, ces
  3 points sont acquis à tous.

### Bloquants

Aucune proposition n'est possible si : le consentement du candidat est absent ou retiré ; le candidat est
déjà placé, indisponible ou écarté ; l'offre est inactive ou non vérifiée. Un candidat et un poste dont l'un
est fictif et l'autre réel ne peuvent pas être placés ensemble.

### Suggestions

Un candidat est **suggéré** si son score atteint 50, s'il fait le métier (identique, pratiqué ou proche) et
s'il peut travailler sur place. Sans cette règle, les critères secondaires suffiraient à faire remonter un
chauffeur de Tanger pour un poste de femme de ménage à Casablanca.

### Ce qui n'entre jamais dans le score

L'âge, le nom, l'origine, la religion, la situation familiale, la photo. Ces informations ne sont pas
transmises à la fonction de rapprochement.

## 7. Commissions

- **Forfait** : le montant de la formule (Premium 1 000 DH, Sérénité 500 DH) ou un montant sur mesure.
- **Pourcentage** : base × taux, arrondi au centime.
- Statuts : due, facturée, encaissée, annulée. Une annulation exige un motif.
- La **période de remplacement** court à partir du début du placement : 6 mois en Premium, 2 mois en Sérénité.
- Les montants fictifs du jeu de démonstration ne sont jamais additionnés aux montants réels.
