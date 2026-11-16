"""Règles : catalogue des actions, vérification des données et traduction en script Home Assistant.

Ce module ne dépend pas de l'état de Home Assistant : il est testable seul.
"""

from __future__ import annotations

import copy
import uuid
from typing import Any

import voluptuous as vol

from .const import ETATS_ARMES, EVENEMENTS, LS_INDEX_MODE, LS_LIBELLES_MODE

TYPE_ENTITE = "entite"
TYPE_SIMULATEUR = "simulateur"
TYPE_NOTIFICATION = "notification"
TYPES_ACTION = [TYPE_ENTITE, TYPE_SIMULATEUR, TYPE_NOTIFICATION]

IMPULSION = "impulsion"

_ONOFF = {"allumer": ("turn_on", ()), "eteindre": ("turn_off", ())}
_ONOFF_IMPULSION = {**_ONOFF, IMPULSION: ("", ("duree",))}

# domaine → action → (service, paramètres réglables)
CATALOGUE: dict[str, dict[str, tuple[str, tuple[str, ...]]]] = {
    "cover": {
        "fermer": ("close_cover", ()),
        "ouvrir": ("open_cover", ()),
        "position": ("set_cover_position", ("position",)),
        "stop": ("stop_cover", ()),
    },
    "light": {"allumer": ("turn_on", ("luminosite",)), "eteindre": ("turn_off", ())},
    "switch": _ONOFF_IMPULSION,
    "input_boolean": _ONOFF_IMPULSION,
    "fan": _ONOFF,
    "siren": _ONOFF,
    "button": {"appuyer": ("press", ())},
    "input_button": {"appuyer": ("press", ())},
    "lock": {"verrouiller": ("lock", ()), "deverrouiller": ("unlock", ())},
    "climate": {
        "preset": ("set_preset_mode", ("preset",)),
        "temperature": ("set_temperature", ("temperature",)),
        "eteindre": ("turn_off", ()),
    },
    "media_player": {"eteindre": ("turn_off", ()), "pause": ("media_pause", ())},
    "scene": {"activer": ("turn_on", ())},
    "script": {"lancer": ("turn_on", ())},
    "automation": {
        "declencher": ("trigger", ()),
        "activer": ("turn_on", ()),
        "desactiver": ("turn_off", ()),
    },
    "select": {"choisir": ("select_option", ("option",))},
    "input_select": {"choisir": ("select_option", ("option",))},
    "valve": {"fermer": ("close_valve", ()), "ouvrir": ("open_valve", ())},
}

ACTIONS_SIMULATEUR = list(LS_INDEX_MODE)  # demarrer, auto, arreter

# paramètre → (validation, clé de données du service, obligatoire)
PARAMETRES: dict[str, tuple[Any, str | None, bool]] = {
    "position": (vol.All(vol.Coerce(int), vol.Range(min=0, max=100)), "position", True),
    "luminosite": (vol.All(vol.Coerce(int), vol.Range(min=1, max=100)), "brightness_pct", False),
    "preset": (vol.All(str, vol.Length(min=1)), "preset_mode", True),
    "temperature": (vol.All(vol.Coerce(float), vol.Range(min=0, max=40)), "temperature", True),
    "option": (vol.All(str, vol.Length(min=1)), "option", True),
    "duree": (vol.All(vol.Coerce(float), vol.Range(min=0.2, max=60)), None, True),
}

DUREE_IMPULSION_DEFAUT = 1.0


class ErreurRegle(Exception):
    """Règle impossible à exécuter ; le code est traduit par le panneau."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def catalogue_public() -> dict[str, dict[str, list[str]]]:
    """Catalogue envoyé au panneau : domaine → action → paramètres."""
    return {
        domaine: {action: list(params) for action, (_service, params) in actions.items()}
        for domaine, actions in CATALOGUE.items()
    }


def _domaine(entity_id: str) -> str:
    return entity_id.split(".", 1)[0]


def _entity_id(valeur: Any) -> str:
    valeur = str(valeur or "").strip().lower()
    if "." not in valeur or valeur.startswith(".") or valeur.endswith(".") or " " in valeur:
        raise vol.Invalid("entite_invalide")
    return valeur


def _texte(longueur_max: int, obligatoire: bool = True):
    def valider(valeur: Any) -> str:
        texte = str(valeur if valeur is not None else "").strip()
        if obligatoire and not texte:
            raise vol.Invalid("texte_requis")
        return texte[:longueur_max]

    return valider


def _secondes(maximum: int):
    return vol.All(vol.Coerce(int), vol.Range(min=0, max=maximum))


SCHEMA_CONDITION = vol.Schema(
    {vol.Required("entity_id"): _entity_id, vol.Required("etat"): _texte(100)},
    extra=vol.REMOVE_EXTRA,
)

SCHEMA_VERIFICATION = vol.Schema(
    {
        vol.Optional("active", default=False): bool,
        vol.Optional("delai_s", default=45): _secondes(3600),
        vol.Optional("entity_id"): vol.Any(None, _entity_id),
        vol.Optional("etat"): vol.Any(None, _texte(100, obligatoire=False)),
        vol.Optional("notifier"): vol.Any(None, _texte(120, obligatoire=False)),
        vol.Optional("message"): vol.Any(None, _texte(500, obligatoire=False)),
    },
    extra=vol.REMOVE_EXTRA,
)

SCHEMA_REGLE = vol.Schema(
    {
        vol.Optional("id"): vol.Any(None, _texte(32, obligatoire=False)),
        vol.Required("nom"): _texte(80),
        vol.Optional("actif", default=True): bool,
        vol.Required("evenement"): vol.In(EVENEMENTS),
        vol.Optional("modes", default=list): [vol.In(ETATS_ARMES)],
        vol.Optional("conditions", default=list): [SCHEMA_CONDITION],
        vol.Optional("actions", default=list): [dict],
        vol.Optional("delai_s", default=0): _secondes(3600),
        vol.Optional("verification", default=None): vol.Any(None, SCHEMA_VERIFICATION),
        vol.Optional("avance", default=False): bool,
        vol.Optional("sequence", default=list): [dict],
    },
    extra=vol.REMOVE_EXTRA,
)


def normaliser_action(brute: dict) -> dict:
    """Vérifie une action du mode simple et ne garde que les paramètres utiles."""
    if not isinstance(brute, dict):
        raise vol.Invalid("action_invalide")
    type_action = brute.get("type", TYPE_ENTITE)
    nom_action = str(brute.get("action") or "")
    params_bruts = brute.get("params") or {}
    if not isinstance(params_bruts, dict):
        raise vol.Invalid("action_invalide")

    if type_action == TYPE_SIMULATEUR:
        if nom_action not in ACTIONS_SIMULATEUR:
            raise vol.Invalid("action_inconnue")
        return {"type": TYPE_SIMULATEUR, "action": nom_action, "params": {}}

    if type_action == TYPE_NOTIFICATION:
        service = _texte(120)(brute.get("service"))
        if service != "persistent_notification" and not service.startswith("notify."):
            raise vol.Invalid("notification_invalide")
        return {
            "type": TYPE_NOTIFICATION,
            "service": service,
            "action": "envoyer",
            "params": {
                "message": _texte(500)(params_bruts.get("message")),
                "titre": _texte(120, obligatoire=False)(params_bruts.get("titre")),
            },
        }

    if type_action != TYPE_ENTITE:
        raise vol.Invalid("action_invalide")
    entity_id = _entity_id(brute.get("entity_id"))
    actions = CATALOGUE.get(_domaine(entity_id))
    if actions is None:
        raise vol.Invalid("domaine_non_gere")
    if nom_action not in actions:
        raise vol.Invalid("action_inconnue")
    params: dict[str, Any] = {}
    for nom_param in actions[nom_action][1]:
        valider, _cle, obligatoire = PARAMETRES[nom_param]
        valeur = params_bruts.get(nom_param)
        if valeur in (None, ""):
            if nom_param == "duree":
                params[nom_param] = DUREE_IMPULSION_DEFAUT
            elif obligatoire:
                raise vol.Invalid("parametre_requis")
            continue
        try:
            params[nom_param] = valider(valeur)
        except vol.Invalid as err:
            raise vol.Invalid("parametre_invalide") from err
    return {"type": TYPE_ENTITE, "entity_id": entity_id, "action": nom_action, "params": params}


def normaliser(brute: dict) -> dict:
    """Vérifie une règle envoyée par le panneau. Lève vol.Invalid avec un code."""
    try:
        regle = SCHEMA_REGLE(copy.deepcopy(brute))
    except vol.MultipleInvalid as err:
        premiere = err.errors[0]
        raise vol.Invalid(str(premiere.msg if premiere.msg in _CODES else "regle_invalide")) from err
    regle["id"] = regle.get("id") or uuid.uuid4().hex[:8]
    regle["modes"] = [m for m in ETATS_ARMES if m in set(regle["modes"])]
    regle["actions"] = [normaliser_action(a) for a in regle["actions"]]
    if regle["avance"]:
        if not regle["sequence"]:
            raise vol.Invalid("sequence_requise")
    else:
        regle["sequence"] = []
        if not regle["actions"]:
            raise vol.Invalid("action_requise")
    verif = regle["verification"]
    if verif and verif["active"] and not (verif.get("entity_id") and verif.get("etat")):
        raise vol.Invalid("verification_incomplete")
    return regle


_CODES = {"texte_requis", "entite_invalide", "action_invalide", "action_inconnue"}


def sequence_simple(regle: dict, entite_ls: str | None = None, options_ls: list | None = None) -> list[dict]:
    """Traduit les actions du mode simple en étapes de script Home Assistant."""
    etapes: list[dict] = []
    for action in regle["actions"]:
        etapes.extend(_etapes_action(action, entite_ls, options_ls))
    return etapes


def sequence_complete(regle: dict, entite_ls: str | None = None, options_ls: list | None = None) -> list[dict]:
    """Script complet de la règle : délai éventuel puis actions (simples ou avancées)."""
    etapes: list[dict] = []
    if regle.get("delai_s"):
        etapes.append({"delay": {"seconds": int(regle["delai_s"])}})
    if regle.get("avance"):
        etapes.extend(copy.deepcopy(regle["sequence"]))
    else:
        etapes.extend(sequence_simple(regle, entite_ls, options_ls))
    return etapes


def _etapes_action(action: dict, entite_ls: str | None, options_ls: list | None) -> list[dict]:
    type_action = action["type"]
    if type_action == TYPE_SIMULATEUR:
        if not entite_ls:
            raise ErreurRegle("simulateur_absent")
        index = LS_INDEX_MODE[action["action"]]
        option = options_ls[index] if options_ls and len(options_ls) > index else LS_LIBELLES_MODE[action["action"]]
        return [_appel("select.select_option", entite_ls, {"option": option})]

    if type_action == TYPE_NOTIFICATION:
        params = action["params"]
        donnees = {"message": params["message"]}
        if params.get("titre"):
            donnees["title"] = params["titre"]
        service = "persistent_notification.create" if action["service"] == "persistent_notification" else action["service"]
        return [{"action": service, "data": donnees, "continue_on_error": True}]

    entity_id = action["entity_id"]
    domaine = _domaine(entity_id)
    if action["action"] == IMPULSION:
        duree = float(action["params"].get("duree", DUREE_IMPULSION_DEFAUT))
        return [
            _appel(f"{domaine}.turn_on", entity_id),
            {"delay": {"milliseconds": int(round(duree * 1000))}},
            _appel(f"{domaine}.turn_off", entity_id),
        ]
    service, noms_params = CATALOGUE[domaine][action["action"]]
    donnees = {}
    for nom_param in noms_params:
        if nom_param in action["params"]:
            donnees[PARAMETRES[nom_param][1]] = action["params"][nom_param]
    return [_appel(f"{domaine}.{service}", entity_id, donnees)]


def _appel(service: str, entity_id: str, donnees: dict | None = None) -> dict:
    etape: dict[str, Any] = {"action": service, "target": {"entity_id": entity_id}, "continue_on_error": True}
    if donnees:
        etape["data"] = donnees
    return etape


def concerne(regle: dict, evenement: str, mode: str | None) -> bool:
    """La règle doit-elle s'exécuter pour cet événement et ce mode d'alarme ?"""
    if not regle.get("actif", True) or regle.get("evenement") != evenement:
        return False
    modes = regle.get("modes") or []
    return not modes or mode in modes


def conditions_remplies(regle: dict, lire_etat) -> tuple[bool, str]:
    """Toutes les conditions sont-elles remplies ? lire_etat(entity_id) → état ou None.

    Renvoie aussi la première condition non remplie (« entité : état actuel »).
    """
    for condition in regle.get("conditions") or []:
        actuel = lire_etat(condition["entity_id"])
        if actuel != condition["etat"]:
            return False, f"{condition['entity_id']} = {actuel}"
    return True, ""
