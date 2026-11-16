"""Lien avec Lights Simulator : présence, entité de mode et double pilotage."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.loader import async_get_custom_components

from .const import LS_DOMAINE, LS_LIEN_CONFIG, LS_LIEN_DEPOT, LS_LIEN_HACS

_LOGGER = logging.getLogger(__name__)

ABSENT = "absent"
NON_CONFIGURE = "non_configure"
PRET = "pret"


def entite_mode(hass: HomeAssistant) -> str | None:
    """Sélecteur « Mode » de Lights Simulator (Arrêt / Auto / Forcé)."""
    registre = er.async_get(hass)
    for entree in registre.entities.values():
        if entree.platform == LS_DOMAINE and entree.domain == "select" and str(entree.unique_id).endswith("_mode"):
            return entree.entity_id
    return None


def options_mode(hass: HomeAssistant, entity_id: str | None) -> list | None:
    etat = hass.states.get(entity_id) if entity_id else None
    return list(etat.attributes.get("options") or []) if etat else None


def double_pilotage(hass: HomeAssistant) -> bool:
    """Lights Simulator suit déjà l'alarme lui-même (mode Auto, déclenché par l'alarme) ?"""
    try:
        moteur = next(iter((hass.data.get(LS_DOMAINE) or {}).values()), None)
        reglages = getattr(moteur, "reglages", None) or {}
        return getattr(moteur, "mode", None) == "auto" and reglages.get("declencheur") in ("alarme", "les_deux")
    except Exception:  # noqa: BLE001 — lecture prudente des données internes d'une autre intégration
        return False


async def async_etat(hass: HomeAssistant) -> dict:
    """Où en est Lights Simulator : absent, installé mais pas configuré, ou prêt."""
    entrees = [
        e for e in hass.config_entries.async_entries(LS_DOMAINE) if e.state is ConfigEntryState.LOADED
    ]
    entite = entite_mode(hass) if entrees else None
    if entrees and entite:
        statut = PRET
    else:
        try:
            installe = LS_DOMAINE in await async_get_custom_components(hass)
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Liste des intégrations personnalisées indisponible : %s", err)
            installe = False
        statut = NON_CONFIGURE if installe else ABSENT
    return {
        "statut": statut,
        "entite": entite,
        "double_pilotage": statut == PRET and double_pilotage(hass),
        "hacs": "hacs" in hass.config.components,
        "lien_hacs": LS_LIEN_HACS,
        "lien_depot": LS_LIEN_DEPOT,
        "lien_config": LS_LIEN_CONFIG,
    }
