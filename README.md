# Protocole Alarme

<img src="custom_components/protocole_alarme/brand/logo.png" alt="Protocole Alarme" width="300">

🇫🇷 [Français](#français) · 🇬🇧 [English](#english)

[![Release](https://img.shields.io/github/v/release/akoonet-homeassistant/protocole_alarme)](https://github.com/akoonet-homeassistant/protocole_alarme/releases)
[![License](https://img.shields.io/github/license/akoonet-homeassistant/protocole_alarme)](LICENSE)
[![HACS](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)

![Protocole Alarme](docs/screenshots/regles.png)

## Français

Protocole Alarme lance des actions quand vous **armez** ou **désarmez** votre alarme Home Assistant. Vous choisissez entité par entité ce qui doit se passer, sans écrire d'automatisation :

- si une fenêtre est ouverte, fermer le volet de la pièce ;
- si la porte du garage est ouverte, envoyer une impulsion au moteur, puis vérifier qu'elle s'est bien fermée ;
- allumer une lumière, passer le chauffage en éco, démarrer le simulateur de présence ;
- au désarmement, arrêter le simulateur, allumer l'entrée, envoyer une notification…

### Fonctionnalités

- **Assistant en 3 étapes** : *Quand* (armement ou désarmement, modes d'alarme), *Si* (conditions facultatives sur l'état d'entités), *Alors* (actions), puis un récapitulatif lisible.
- **Actions paramétrables selon le type d'entité** : volets (ouvrir, fermer, position), lumières (allumer avec luminosité, éteindre), interrupteurs (allumer, éteindre, **impulsion** de durée réglable), serrures, chauffage (préréglage, température), médias, scènes, scripts, automatisations, listes, vannes, boutons et notifications.
- **Vérification du résultat** : après un délai, contrôle qu'une entité est dans l'état attendu (ex. garage fermé) ; sinon notification et capteur « Échec de vérification ». Pas de nouvel essai automatique.
- **Délai avant exécution** par règle.
- **Annulation** : désarmer l'alarme interrompt les règles d'armement encore en cours (délai, impulsion, vérification), et inversement.
- **Redémarrage de Home Assistant** : ne déclenche aucune règle.
- **Simulateur de présence** : pilote [Lights Simulator](https://github.com/akoonet-homeassistant/lights_simulator) (Démarrer, Repasser en Auto, Arrêter). S'il n'est pas installé, le panneau propose de l'installer par HACS ; s'il suit déjà l'alarme lui-même, un avertissement signale le double pilotage.
- **Modèles** pour démarrer en deux clics (garage, volet, simulateur, lumière, notification).
- **Mode avancé** : une règle peut être modifiée en YAML (syntaxe des actions de script Home Assistant), avec les variables `regle`, `evenement` et `mode_alarme`.
- **Bouton Tester** : exécute une règle sans armer l'alarme (les conditions restent vérifiées).
- **Journal** des 50 dernières exécutions.
- **Panneau latéral** « Protocole Alarme » consultable par tous ; création, modification et test réservés aux administrateurs.
- **Interface en français et en anglais**, selon la langue de l'utilisateur.

### Installation

#### Par HACS (dépôt personnalisé)

[![Ouvrir dans HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=akoonet-homeassistant&repository=protocole_alarme&category=integration)

1. Dans HACS, ajoutez `https://github.com/akoonet-homeassistant/protocole_alarme` comme dépôt personnalisé (catégorie *Intégration*), ou utilisez le bouton ci-dessus.
2. Installez **Protocole Alarme**, puis redémarrez Home Assistant.
3. *Paramètres → Appareils et services → Ajouter une intégration* → **Protocole Alarme**, puis choisissez l'alarme à suivre.

#### Manuelle

Copiez `custom_components/protocole_alarme` dans le dossier `custom_components` de votre configuration, redémarrez, puis ajoutez l'intégration.

### Utilisation

Ouvrez le panneau **Protocole Alarme** dans la barre latérale.

| Onglet | Contenu |
|---|---|
| Règles | Règles d'armement et de désarmement, activation, test, modification, duplication, suppression ; ajout par l'assistant ou à partir d'un modèle |
| Entités | Les entités créées, avec leur état |
| Journal | Les dernières exécutions : règle, moment, résultat, détail |
| Réglages | Alarme suivie, protocole actif ou en pause, état de Lights Simulator |

Le bouton **Configurer** de l'intégration permet de changer d'alarme et d'afficher ou masquer le panneau dans la barre latérale. Masqué, il reste accessible à l'adresse `/protocole-alarme`.

**Quand une règle s'exécute-t-elle ?** À l'armement, quand l'alarme passe de *désarmée* ou *en cours d'armement* à un état *armée* (absent, nuit, présent, vacances, personnalisé). Au désarmement, quand elle repasse à *désarmée* depuis un état armé, en attente ou déclenché. Pour le désarmement, le filtre de modes porte sur le mode dans lequel l'alarme était armée.

### Captures d'écran

| | |
|---|---|
| **Règles** — armement et désarmement<br>![Règles](docs/screenshots/regles.png) | **Modèles** — points de départ<br>![Modèles](docs/screenshots/modeles.png) |
| **Étape 1 — Quand ?**<br>![Quand](docs/screenshots/etape1.png) | **Étape 2 — Si…**<br>![Si](docs/screenshots/etape2.png) |
| **Étape 3 — Alors…** — impulsion et vérification<br>![Alors](docs/screenshots/etape3.png) | **Récapitulatif**<br>![Récapitulatif](docs/screenshots/recap.png) |
| **Choix de l'action** — Lights Simulator non installé<br>![Sélecteur](docs/screenshots/selecteur_simulateur.png) | **Mode avancé** — YAML<br>![Avancé](docs/screenshots/avance.png) |
| **Journal**<br>![Journal](docs/screenshots/journal.png) | **Entités**<br>![Entités](docs/screenshots/entites.png) |

*Captures réalisées sur une installation de démonstration : toutes les entités sont fictives.*

### Entités

| Entité | Rôle |
|---|---|
| `switch.protocole_alarme_protocole_actif` | Coupé : plus aucune règle ne s'exécute (le journal le note) |
| `switch.protocole_alarme_regle_<nom>` | Une par règle : règle active ou non |
| `button.protocole_alarme_tester_<nom>` | Une par règle : exécute la règle tout de suite |
| `sensor.protocole_alarme_derniere_execution` | Date de la dernière règle exécutée ; attributs `regle`, `evenement`, `resultat`, `detail` |
| `sensor.protocole_alarme_regles_actives` | Nombre de règles actives ; attributs `armement`, `desarmement` |
| `binary_sensor.protocole_alarme_echec_de_verification` | Problème quand la dernière vérification a échoué |

Les identifiants exacts dépendent de la langue de Home Assistant au moment de l'installation.

### Limites

- Une seule alarme suivie.
- Les conditions comparent l'état exact d'une entité (pas de seuil numérique) ; pour des cas plus complexes, utilisez le mode avancé.
- Lights Simulator est piloté par son sélecteur « Mode » ; il doit être installé et configuré séparément.

---

## English

Protocole Alarme runs actions when you **arm** or **disarm** your Home Assistant alarm. You choose, entity by entity, what should happen, without writing automations:

- if a window is open, close that room's shutter;
- if the garage door is open, send a pulse to the motor, then check it actually closed;
- turn on a light, set the heating to eco, start the presence simulator;
- when disarmed, stop the simulator, turn on the hallway light, send a notification…

### Features

- **3-step wizard**: *When* (arming or disarming, alarm modes), *If* (optional conditions on entity states), *Then* (actions), followed by a readable summary.
- **Actions with settings by entity type**: covers (open, close, position), lights (turn on with brightness, turn off), switches (on, off, **pulse** with adjustable length), locks, climate (preset, temperature), media, scenes, scripts, automations, selects, valves, buttons and notifications.
- **Result check**: after a delay, checks an entity is in the expected state (e.g. garage closed); otherwise a notification and a “Check failed” sensor. No automatic retry.
- **Delay before running** per rule.
- **Cancellation**: disarming stops arming rules still in progress (delay, pulse, check), and the other way round.
- **Home Assistant restart**: never triggers a rule.
- **Presence simulator**: drives [Lights Simulator](https://github.com/akoonet-homeassistant/lights_simulator) (Start, Back to Auto, Stop). If it is not installed, the panel offers to install it through HACS; if it already follows the alarm by itself, a warning flags the double control.
- **Templates** to get started in two clicks (garage, shutter, simulator, light, notification).
- **Advanced mode**: a rule can be edited in YAML (Home Assistant script action syntax), with the `regle`, `evenement` and `mode_alarme` variables.
- **Test button**: runs a rule without arming the alarm (conditions are still checked).
- **Log** of the last 50 runs.
- **Sidebar panel** “Protocole Alarme” readable by everyone; creating, editing and testing are reserved to administrators.
- **French and English interface**, following the user's language.

### Installation

#### Through HACS (custom repository)

[![Open in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=akoonet-homeassistant&repository=protocole_alarme&category=integration)

1. In HACS, add `https://github.com/akoonet-homeassistant/protocole_alarme` as a custom repository (*Integration* category), or use the button above.
2. Install **Protocole Alarme**, then restart Home Assistant.
3. *Settings → Devices & services → Add integration* → **Protocole Alarme**, then choose the alarm to follow.

#### Manual

Copy `custom_components/protocole_alarme` into the `custom_components` folder of your configuration, restart, then add the integration.

### Usage

Open the **Protocole Alarme** panel in the sidebar.

| Tab | Content |
|---|---|
| Rules | Arming and disarming rules, enable, test, edit, duplicate, delete; add with the wizard or from a template |
| Entities | The created entities with their state |
| Log | Latest runs: rule, moment, result, detail |
| Settings | Followed alarm, protocol enabled or paused, Lights Simulator status |

The integration's **Configure** button changes the alarm and shows or hides the panel in the sidebar. When hidden, it stays reachable at `/protocole-alarme`.

**When does a rule run?** On arming, when the alarm goes from *disarmed* or *arming* to an *armed* state (away, night, home, vacation, custom). On disarming, when it goes back to *disarmed* from an armed, pending or triggered state. For disarming rules, the mode filter applies to the mode the alarm was armed in.

### Screenshots

The screenshots above (French interface) show every screen; the interface switches to English automatically for English-speaking users. *All entities are fictional.*

### Entities

| Entity | Role |
|---|---|
| `switch.protocole_alarme_protocol_enabled` | Off: no rule runs any more (noted in the log) |
| `switch.protocole_alarme_rule_<name>` | One per rule: rule enabled or not |
| `button.protocole_alarme_test_<name>` | One per rule: runs the rule right away |
| `sensor.protocole_alarme_last_run` | Date of the last rule run; attributes `regle`, `evenement`, `resultat`, `detail` |
| `sensor.protocole_alarme_active_rules` | Number of active rules; attributes `armement`, `desarmement` |
| `binary_sensor.protocole_alarme_check_failed` | Problem when the last check failed |

Exact entity IDs depend on Home Assistant's language at installation time.

### Limitations

- A single alarm is followed.
- Conditions compare an entity's exact state (no numeric threshold); use advanced mode for more complex cases.
- Lights Simulator is driven through its “Mode” select; it must be installed and set up separately.

## Licence / License

MIT
