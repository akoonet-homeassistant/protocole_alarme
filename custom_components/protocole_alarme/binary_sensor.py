"""Capteur binaire : une vérification a échoué."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import EntiteProtocole


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, ajouter: AddEntitiesCallback) -> None:
    ajouter([EchecVerification(hass.data[DOMAIN][entry.entry_id])])


class EchecVerification(EntiteProtocole, BinarySensorEntity):
    """Allumé quand la dernière vérification a échoué (ex. garage resté ouvert).

    Repasse à « OK » à la vérification réussie suivante ou quand on vide le journal.
    """

    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, moteur) -> None:
        super().__init__(moteur, "echec_verification")

    @property
    def is_on(self) -> bool:
        return self.moteur.echec_verification
