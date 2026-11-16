"""Capteurs : dernière exécution et nombre de règles actives."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .entity import EntiteProtocole


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, ajouter: AddEntitiesCallback) -> None:
    moteur = hass.data[DOMAIN][entry.entry_id]
    ajouter([DerniereExecution(moteur), ReglesActives(moteur)])


class DerniereExecution(EntiteProtocole, SensorEntity):
    """Date de la dernière règle exécutée, avec la règle et le résultat en attributs."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:history"

    def __init__(self, moteur) -> None:
        super().__init__(moteur, "derniere_execution")

    @property
    def native_value(self) -> datetime | None:
        derniere = self.moteur.derniere_execution
        return dt_util.parse_datetime(derniere["date"]) if derniere else None

    @property
    def extra_state_attributes(self) -> dict:
        derniere = self.moteur.derniere_execution or {}
        return {
            "regle": derniere.get("regle"),
            "evenement": derniere.get("evenement"),
            "resultat": derniere.get("resultat"),
            "detail": derniere.get("detail"),
        }


class ReglesActives(EntiteProtocole, SensorEntity):
    """Nombre de règles actives (armement et désarmement)."""

    _attr_icon = "mdi:format-list-checks"

    def __init__(self, moteur) -> None:
        super().__init__(moteur, "regles_actives")

    @property
    def native_value(self) -> int:
        return sum(1 for r in self.moteur.regles if r.get("actif"))

    @property
    def extra_state_attributes(self) -> dict:
        actives = [r for r in self.moteur.regles if r.get("actif")]
        return {
            "armement": sum(1 for r in actives if r["evenement"] == "armement"),
            "desarmement": sum(1 for r in actives if r["evenement"] == "desarmement"),
        }
