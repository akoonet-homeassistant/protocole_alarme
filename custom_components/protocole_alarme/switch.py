"""Interrupteurs : protocole actif et une règle active par règle."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import EntiteProtocole, EntiteRegle


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, ajouter: AddEntitiesCallback) -> None:
    moteur = hass.data[DOMAIN][entry.entry_id]
    ajouter([ProtocoleActif(moteur), *(RegleActive(moteur, r) for r in moteur.regles)])


class ProtocoleActif(EntiteProtocole, SwitchEntity):
    """Coupé : plus aucune règle ne s'exécute (le journal le note)."""

    _attr_icon = "mdi:shield-home"

    def __init__(self, moteur) -> None:
        super().__init__(moteur, "actif")

    @property
    def is_on(self) -> bool:
        return self.moteur.actif

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.moteur.async_changer_actif(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.moteur.async_changer_actif(False)


class RegleActive(EntiteRegle, SwitchEntity):
    """Active ou désactive une règle."""

    _attr_icon = "mdi:format-list-checks"

    def __init__(self, moteur, regle: dict) -> None:
        super().__init__(moteur, regle, "regle")

    @property
    def is_on(self) -> bool:
        return bool((self.regle or {}).get("actif"))

    @property
    def extra_state_attributes(self) -> dict:
        regle = self.regle or {}
        return {"evenement": regle.get("evenement"), "modes": regle.get("modes", [])}

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.moteur.async_activer(self.regle_id, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.moteur.async_activer(self.regle_id, False)
