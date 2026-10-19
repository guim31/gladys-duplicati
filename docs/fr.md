# Duplicati

[Duplicati](https://duplicati.com/) sauvegarde vos fichiers, chiffrés, vers un
disque, un NAS ou un stockage en ligne. Cette intégration amène les tâches de
sauvegarde d'un serveur Duplicati dans Gladys : chaque tâche devient un
appareil avec son état, sa dernière sauvegarde réussie, la taille à la
destination et les erreurs de sa dernière exécution. Des scènes peuvent réagir
quand **n'importe quelle** sauvegarde réussit, échoue ou est en retard (pas de
réussite depuis trop longtemps), un widget du tableau de bord liste d'abord les
sauvegardes en échec, et une scène peut lancer une sauvegarde.

Testée contre un vrai Duplicati 2.4 (image Docker `duplicati/duplicati`) : une
sauvegarde qui réussit, une avec avertissements, une qui échoue après la
suppression de sa destination, et une sauvegarde lancée depuis l'intégration.
Pas encore testée sur un vrai Gladys : vos retours sont bienvenus sur
[les issues](https://github.com/guim31/gladys-duplicati/issues).

## Ce qu'il faut

- Gladys Assistant 5.1.0 ou plus récent.
- Duplicati **2.1 ou plus récent** (son interface web, sur le port 8200 par
  défaut), joignable depuis la machine de Gladys. Duplicati 2.0 et antérieurs
  ont une autre API et ne sont pas pris en charge.
- Le mot de passe de l'interface web de Duplicati. Duplicati 2.1 la protège
  toujours : définissez-le dans les paramètres de Duplicati, ou avec la variable
  `DUPLICATI__WEBSERVICE_PASSWORD` de son image Docker.

L'intégration lit Duplicati toutes les 5 minutes par défaut (toutes les 30
secondes pendant une sauvegarde) : quelques requêtes légères sur votre réseau.

## Mise en route

### 1. Repérer l'adresse de Duplicati

Ouvrez l'interface de Duplicati dans un navigateur et notez son adresse, par
exemple `http://192.168.1.2:8200`. Si Duplicati n'écoute que sa propre machine
(`localhost`), autorisez les autres machines du réseau : option
`--webservice-interface=any` (déjà le cas dans l'image Docker), et ajoutez le
nom ou l'adresse utilisé par Gladys à `--webservice-allowed-hostnames` si vous
le joignez par un nom.

### 2. Configurer l'intégration

Dans Gladys, **Intégrations → Duplicati → Configuration** :

- **Adresse de Duplicati** : l'adresse notée plus haut. Une adresse seule
  (`192.168.1.2`) utilise le port 8200 ; une adresse copiée du navigateur
  convient aussi.
- **Mot de passe** : le mot de passe de l'interface de Duplicati.
- **Intervalle de rafraîchissement** : 1, 5 (par défaut) ou 15 minutes.
- **En retard après** : quand une sauvegarde sans réussite passe en retard.
  _Automatique_ (par défaut) suit la planification de chaque sauvegarde : sa
  période, plus les jours qu'elle saute, plus un quart de la période (une heure
  au moins), soit 30 heures pour une sauvegarde quotidienne. Une sauvegarde sans
  planification n'est alors jamais en retard. Ou un délai fixe, de 12 heures à
  une semaine, pour toutes les sauvegardes.
- **Autoriser le lancement des sauvegardes** : permet à l'action de scène
  « Lancer une sauvegarde » de fonctionner. Désactivez-le si personne ne doit
  lancer de sauvegarde depuis Gladys.
- **Langue des noms** : langue des noms des fonctionnalités, des états et des
  résultats de scène.

**Tester la connexion** lit Duplicati et résume : le nombre de sauvegardes, en
échec et en retard.

### 3. Ajouter les sauvegardes

Dans l'onglet **Découverte**, ajoutez les sauvegardes à suivre, et l'appareil
« Duplicati » pour le serveur. Les déclencheurs de scène fonctionnent pour toutes
les sauvegardes, ajoutées ou non.

## Les appareils

Chaque tâche de sauvegarde :

| Fonctionnalité                          | Valeur                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| État                                    | OK, Avec avertissements, En échec, En retard, En cours ou Jamais lancée |
| Dernière sauvegarde réussie             | jour/mois heures:minutes, « - » s'il n'y en a pas                       |
| Heures depuis la dernière réussite      | en heures                                                               |
| Durée de la dernière exécution          | en secondes                                                             |
| Taille de la destination                | les fichiers à la destination, en Mo                                    |
| Versions                                | versions de sauvegarde conservées à la destination                      |
| Erreurs de la dernière exécution        | nombre d'erreurs                                                        |
| Avertissements de la dernière exécution | nombre d'avertissements                                                 |
| En cours                                | 1 pendant que cette sauvegarde tourne                                   |
| Prochaine exécution planifiée           | jour/mois heures:minutes, « - » sans planification                      |

L'appareil « Duplicati », pour le serveur :

- **Sauvegarde en cours** : 1 ou 0 ;
- **Progression** : en % ;
- **Sauvegarde actuelle** : son nom, « - » s'il n'y en a pas ;
- **Sauvegardes en échec** et **Sauvegardes en retard** : combien.

Une sauvegarde « réussit » quand Duplicati la termine, avec ou sans
avertissements : une version est créée. Elle « échoue » quand elle se termine en
erreur (destination injoignable, fichiers manquants sur le stockage…). L'état
montre d'abord ce qui demande votre attention : une sauvegarde en échec affiche
« En échec » même si elle est aussi en retard.

## Tableau de bord

Le widget **Duplicati** montre le nombre de sauvegardes en échec, en retard et
OK, puis une ligne par sauvegarde : en échec d'abord, puis en retard, en cours,
avec avertissements, jamais lancées, OK, avec la dernière réussite (ou la
progression de celle en cours). Toutes les sauvegardes par défaut, ou celles
choisies dans ses réglages. Le bouton **Actualiser** relit Duplicati.

## Scènes

### Déclencheurs

- **Une sauvegarde réussit** : une sauvegarde se termine, avec ou sans
  avertissements. Informations : nom de la sauvegarde, durée (minutes),
  avertissements, versions, taille de la destination.
- **Une sauvegarde échoue** : une sauvegarde se termine en erreur. Le filtre
  **Résultat** choisit les erreurs, les avertissements, ou les deux (vide).
  Informations : nom de la sauvegarde, première erreur ou avertissement,
  erreurs, avertissements.
- **Une sauvegarde est en retard** : une sauvegarde n'a pas réussi depuis plus
  longtemps que le délai « En retard après ». Une fois par dépassement, de
  nouveau après une nouvelle réussite. Informations : nom de la sauvegarde,
  heures depuis la dernière réussite, dernière réussite.

Chaque déclencheur peut se limiter à certaines sauvegardes (vide : toutes).

### Actions

- **État d'une sauvegarde** : lit l'état d'une sauvegarde pour les actions
  suivantes : en échec, en retard, l'état en toutes lettres, le nom, la dernière
  réussite, les heures depuis la dernière réussite (-1 s'il n'y en a pas), et une
  phrase toute prête (« Photos : En échec, dernière réussite 18/10 02:05. »).
- **Lancer une sauvegarde** : lance une sauvegarde maintenant. Duplicati la met
  en file si une autre tourne. Refusée quand « Autoriser le lancement des
  sauvegardes » est désactivé.

### Idées de scènes

- **Une sauvegarde échoue** → envoyer un message avec le nom de la sauvegarde
  et sa première erreur, choisis dans les informations du déclencheur.
- **Une sauvegarde est en retard** → prévenir avec le nom de la sauvegarde et
  les heures depuis sa dernière réussite.
- Chaque dimanche à 10 h → **État d'une sauvegarde** → envoyer la phrase ; ou
  lancer la sauvegarde des photos quand vous quittez la maison, avec **Lancer
  une sauvegarde**.

## Dépannage

- **« Duplicati ne répond pas »** : vérifiez l'adresse et le port depuis la
  machine de Gladys, et que Duplicati écoute le réseau
  (`--webservice-interface=any`).
- **« mot de passe refusé par Duplicati »** : saisissez de nouveau le mot de
  passe de l'interface. Duplicati peut aussi refuser un nom d'hôte qu'il ne
  connaît pas : ajoutez-le à `--webservice-allowed-hostnames`.
- **« aucun Duplicati 2.1 ou plus récent à cette adresse »** : l'adresse pointe
  vers autre chose, ou vers Duplicati 2.0 (mettez-le à jour).
- **« certificat refusé »** : un certificat auto-signé ; utilisez l'adresse en
  `http://` sur votre réseau.
- **Une sauvegarde ne passe jamais en retard** : en _Automatique_, une
  sauvegarde sans planification ne peut pas être en retard ; choisissez un délai
  fixe. Une sauvegarde qui n'a jamais réussi n'est pas en retard non plus : elle affiche En échec ou Jamais lancée.
- Pour en voir plus, passez la variable `LOG_LEVEL` de l'intégration à `debug`.

## Limites

- Un seul serveur Duplicati par intégration.
- Duplicati 2.1 ou plus récent uniquement.
- Les résultats viennent du journal de chaque sauvegarde tenu par Duplicati :
  une sauvegarde dont la base locale a été supprimée ne montre que ce que dit
  son résumé.
- L'intégration ne restaure, ne répare ni ne modifie de sauvegarde : elle les
  surveille, et les lance si c'est autorisé.
- Non affiliée à Duplicati. Signalez un problème ou une idée sur
  [les issues](https://github.com/guim31/gladys-duplicati/issues).
