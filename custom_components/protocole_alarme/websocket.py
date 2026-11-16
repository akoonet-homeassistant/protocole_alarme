"""Commandes websocket utilisées par le panneau.

La lecture est ouverte à tous les utilisateurs ; les modifications et les tests
sont réservés aux administrateurs (une règle peut piloter n'importe quel appareil).
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol
import yaml
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from . import regles as R
from . import simulateur
from .const import DOMAIN, ETATS_ARMES, VERSION
from .moteur import Moteur


def _moteur(hass: HomeAssistant) -> Moteur | None:
    return next(iter((hass.data.get(DOMAIN) or {}).values()), None)


def _services_notification(hass: HomeAssistant) -> list[str]:
    services = [f"notify.{nom}" for nom in sorted(hass.services.async_services_for_domain("notify"))]
    services = [s for s in services if s != "notify.send_message"]
    return ["persistent_notification", *services]


async def _etat_complet(hass: HomeAssistant, moteur: Moteur, admin: bool) -> dict[str, Any]:
    registre = er.async_get(hass)
    entites = []
    for entree in er.async_entries_for_config_entry(registre, moteur.entry.entry_id):
        etat = hass.states.get(entree.entity_id)
        entites.append({
            "entity_id": entree.entity_id,
            "nom": etat.name if etat else (entree.name or entree.original_name),
            "etat": etat.state if etat else None,
            "cle": entree.translation_key,
        })
    return {
        "version": VERSION,
        "admin": admin,
        "regles": moteur.regles,
        "instantane": moteur.instantane(),
        "journal": moteur.journal,
        "entites": sorted(entites, key=lambda e: e["entity_id"]),
        "simulateur": await simulateur.async_etat(hass),
        "notifications": _services_notification(hass),
        "catalogue": R.catalogue_public(),
        "modes": ETATS_ARMES,
    }


def _erreur(connection, msg, err: Exception) -> None:
    connection.send_error(msg["id"], "regle_invalide", str(err.msg if isinstance(err, vol.Invalid) else err))


@callback
def async_enregistrer(hass: HomeAssistant) -> None:
    for commande in (
        ws_etat, ws_enregistrer, ws_supprimer, ws_dupliquer, ws_activer, ws_tester, ws_actif,
        ws_vider_journal, ws_vers_yaml, ws_depuis_yaml,
    ):
        websocket_api.async_register_command(hass, commande)


def _avec_moteur(fonction):
    """Renvoie une erreur propre si l'intégration n'est pas chargée."""

    async def enveloppe(hass: HomeAssistant, connection, msg: dict) -> None:
        moteur = _moteur(hass)
        if moteur is None:
            connection.send_error(msg["id"], "non_configure", "Protocole Alarme n'est pas configuré")
            return
        await fonction(hass, connection, msg, moteur)

    return enveloppe


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/etat"})
@websocket_api.async_response
@_avec_moteur
async def ws_etat(hass, connection, msg, moteur: Moteur) -> None:
    connection.send_result(msg["id"], await _etat_complet(hass, moteur, connection.user.is_admin))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/enregistrer", vol.Required("regle"): dict})
@websocket_api.require_admin
@websocket_api.async_response
@_avec_moteur
async def ws_enregistrer(hass, connection, msg, moteur: Moteur) -> None:
    try:
        regle = await moteur.async_enregistrer(msg["regle"])
    except vol.Invalid as err:
        _erreur(connection, msg, err)
        return
    connection.send_result(msg["id"], {"regle": regle})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/supprimer", vol.Required("regle_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
@_avec_moteur
async def ws_supprimer(hass, connection, msg, moteur: Moteur) -> None:
    await moteur.async_supprimer(msg["regle_id"])
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/dupliquer", vol.Required("regle_id"): str, vol.Optional("suffixe", default="(copie)"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
@_avec_moteur
async def ws_dupliquer(hass, connection, msg, moteur: Moteur) -> None:
    try:
        regle = await moteur.async_dupliquer(msg["regle_id"], msg["suffixe"][:20])
    except vol.Invalid as err:
        _erreur(connection, msg, err)
        return
    connection.send_result(msg["id"], {"regle": regle})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/activer", vol.Required("regle_id"): str, vol.Required("actif"): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
@_avec_moteur
async def ws_activer(hass, connection, msg, moteur: Moteur) -> None:
    await moteur.async_activer(msg["regle_id"], msg["actif"])
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/tester", vol.Required("regle"): dict})
@websocket_api.require_admin
@websocket_api.async_response
@_avec_moteur
async def ws_tester(hass, connection, msg, moteur: Moteur) -> None:
    """Teste une règle enregistrée ou le brouillon de l'assistant."""
    try:
        await moteur.async_tester(msg["regle"])
    except vol.Invalid as err:
        _erreur(connection, msg, err)
        return
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/actif", vol.Required("actif"): bool})
@websocket_api.require_admin
@websocket_api.async_response
@_avec_moteur
async def ws_actif(hass, connection, msg, moteur: Moteur) -> None:
    await moteur.async_changer_actif(msg["actif"])
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/vider_journal"})
@websocket_api.require_admin
@websocket_api.async_response
@_avec_moteur
async def ws_vider_journal(hass, connection, msg, moteur: Moteur) -> None:
    await moteur.async_vider_journal()
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/vers_yaml", vol.Required("regle"): dict})
@websocket_api.require_admin
@websocket_api.async_response
@_avec_moteur
async def ws_vers_yaml(hass, connection, msg, moteur: Moteur) -> None:
    """Actions d'une règle simple en YAML de script, pour le mode avancé."""
    try:
        sequence = moteur.sequence_yaml(msg["regle"])
    except (vol.Invalid, R.ErreurRegle) as err:
        _erreur(connection, msg, err)
        return
    texte = yaml.safe_dump(sequence, allow_unicode=True, sort_keys=False, default_flow_style=False)
    connection.send_result(msg["id"], {"yaml": texte})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/depuis_yaml", vol.Required("yaml"): str})
@websocket_api.require_admin
@websocket_api.async_response
@_avec_moteur
async def ws_depuis_yaml(hass, connection, msg, moteur: Moteur) -> None:
    """Lit et vérifie le YAML saisi en mode avancé."""
    try:
        sequence = yaml.safe_load(msg["yaml"]) or []
    except yaml.YAMLError as err:
        connection.send_error(msg["id"], "yaml_invalide", str(err))
        return
    if isinstance(sequence, dict):
        sequence = [sequence]
    if not isinstance(sequence, list) or not all(isinstance(e, dict) for e in sequence):
        connection.send_error(msg["id"], "yaml_invalide", "sequence_requise")
        return
    try:
        await moteur.async_valider_sequence({"avance": True, "sequence": sequence})
    except vol.Invalid as err:
        _erreur(connection, msg, err)
        return
    connection.send_result(msg["id"], {"sequence": sequence})
