"""Base commune des entités de Protocole Alarme."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, NOM_APPAREIL, PANEL_URL, SIGNAL_MAJ, VERSION
from .moteur import Moteur


class EntiteProtocole(Entity):
    """Entité rattachée à l'appareil « Protocole Alarme », mise à jour par le moteur."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, moteur: Moteur, cle: str) -> None:
        self.moteur = moteur
        self._attr_unique_id = f"{moteur.entry.entry_id}_{cle}"
        self._attr_translation_key = cle
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, moteur.entry.entry_id)},
            name=NOM_APPAREIL,
            manufacturer="akoonet",
            model="Alarm protocol",
            sw_version=VERSION,
            configuration_url=f"homeassistant://{PANEL_URL}",
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, SIGNAL_MAJ.format(self.moteur.entry.entry_id), self.async_write_ha_state
            )
        )


class EntiteRegle(EntiteProtocole):
    """Entité propre à une règle : son nom apparaît dans le nom de l'entité."""

    def __init__(self, moteur: Moteur, regle: dict, cle: str) -> None:
        super().__init__(moteur, cle)
        self.regle_id = regle["id"]
        self._attr_unique_id = f"{moteur.entry.entry_id}_regle_{regle['id']}_{cle}"
        self._attr_translation_placeholders = {"nom": regle["nom"]}

    @property
    def regle(self) -> dict | None:
        return self.moteur.regle(self.regle_id)

    @property
    def available(self) -> bool:
        return self.regle is not None
