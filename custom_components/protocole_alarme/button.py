"""Boutons : tester une règle sans armer l'alarme."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import EntiteRegle


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, ajouter: AddEntitiesCallback) -> None:
    moteur = hass.data[DOMAIN][entry.entry_id]
    ajouter([TesterRegle(moteur, r) for r in moteur.regles])


class TesterRegle(EntiteRegle, ButtonEntity):
    """Exécute la règle tout de suite (les conditions restent vérifiées)."""

    _attr_icon = "mdi:play-circle-outline"

    def __init__(self, moteur, regle: dict) -> None:
        super().__init__(moteur, regle, "tester")

    async def async_press(self) -> None:
        if self.regle is not None:
            await self.moteur.async_tester(self.regle, self._context)
