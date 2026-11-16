"""Assistant d'installation de Protocole Alarme."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import CONF_ALARME, CONF_BARRE_LATERALE, DOMAIN, NOM_APPAREIL


def _schema(alarme: str | None, barre: bool | None = None) -> vol.Schema:
    champs: dict[Any, Any] = {
        vol.Required(CONF_ALARME, default=alarme or vol.UNDEFINED): selector.EntitySelector(
            selector.EntitySelectorConfig(domain="alarm_control_panel")
        ),
    }
    if barre is not None:
        champs[vol.Required(CONF_BARRE_LATERALE, default=barre)] = selector.BooleanSelector()
    return vol.Schema(champs)


class ProtocoleAlarmeConfigFlow(ConfigFlow, domain=DOMAIN):
    """Une seule instance : on choisit l'alarme à suivre."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> ProtocoleAlarmeOptionsFlow:
        return ProtocoleAlarmeOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(
                title=NOM_APPAREIL,
                data={},
                options={CONF_ALARME: user_input[CONF_ALARME], CONF_BARRE_LATERALE: True},
            )
        alarmes = self.hass.states.async_entity_ids("alarm_control_panel")
        return self.async_show_form(
            step_id="user", data_schema=_schema(alarmes[0] if len(alarmes) == 1 else None)
        )


class ProtocoleAlarmeOptionsFlow(OptionsFlow):
    """Bouton « Configurer » : alarme suivie et affichage dans la barre latérale.

    Les règles se gèrent dans le panneau Protocole Alarme.
    """

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        options = self.config_entry.options
        if user_input is not None:
            return self.async_create_entry(data={**options, **user_input})
        return self.async_show_form(
            step_id="init",
            data_schema=_schema(options.get(CONF_ALARME), bool(options.get(CONF_BARRE_LATERALE, True))),
        )
