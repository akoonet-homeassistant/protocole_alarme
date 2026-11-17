"""Protocole Alarme : actions automatiques à l'armement et au désarmement de l'alarme."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from . import websocket
from .services import async_enregistrer_services
from .const import DOMAIN, FORMAT_STOCKAGE, STATIC_URL, VERSION
from .moteur import Moteur
from .panneau import async_installer_panneau, async_retirer_panneau

PLATFORMS = [Platform.BINARY_SENSOR, Platform.BUTTON, Platform.SENSOR, Platform.SWITCH]
CLE_FRONTEND = f"{DOMAIN}_frontend"


async def _preparer_frontend(hass: HomeAssistant) -> None:
    """Fichiers du panneau et commandes websocket (une seule fois par démarrage de HA)."""
    if hass.data.get(CLE_FRONTEND):
        return
    dossier = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(dossier), False)])
    # Carte du tableau de bord : chargée sur toutes les pages, sans ressource Lovelace à ajouter
    add_extra_js_url(hass, f"{STATIC_URL}/protocole-alarme-card.js?v={VERSION}")
    websocket.async_enregistrer(hass)
    async_enregistrer_services(hass)
    hass.data[CLE_FRONTEND] = True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Démarre le suivi de l'alarme."""
    await _preparer_frontend(hass)
    moteur = Moteur(hass, entry)
    await moteur.async_demarrer()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = moteur

    await async_installer_panneau(hass, entry)
    entry.async_on_unload(entry.add_update_listener(_options_modifiees))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def _options_modifiees(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Alarme ou barre latérale changées dans « Configurer » : on recharge."""
    hass.config_entries.async_schedule_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        moteur: Moteur = hass.data[DOMAIN].pop(entry.entry_id)
        await moteur.async_arreter()
        # Le panneau reste enregistré : un rechargement (ajout ou suppression de règle) ne doit pas
        # le retirer puis le recréer, ce qui laisse un panneau ouvert bloqué sur « … ».
        # Il est retiré quand l'intégration est supprimée.
    return ok


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Suppression de l'intégration : retire le panneau et efface les règles enregistrées."""
    async_retirer_panneau(hass)
    await Store(hass, FORMAT_STOCKAGE, f"{DOMAIN}.{entry.entry_id}").async_remove()
