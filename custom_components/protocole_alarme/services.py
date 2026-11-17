"""Services d'administration : exporter et importer les règles.

Réservés aux administrateurs (les automatisations et scripts de Home Assistant,
qui n'ont pas d'utilisateur, peuvent aussi les appeler).
"""

from __future__ import annotations

import copy

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.service import async_register_admin_service

from .const import DOMAIN, REGLES_MAX, VERSION

SERVICE_EXPORTER = "exporter_regles"
SERVICE_IMPORTER = "importer_regles"

SCHEMA_IMPORTER = vol.Schema(
    {
        vol.Required("regles"): vol.All([dict], vol.Length(min=1, max=REGLES_MAX)),
        vol.Optional("remplacer", default=False): bool,
        vol.Optional("types"): vol.All([dict], vol.Length(max=30)),
    }
)


def _moteur(hass: HomeAssistant):
    moteur = next(iter((hass.data.get(DOMAIN) or {}).values()), None)
    if moteur is None:
        raise ServiceValidationError("Protocole Alarme n'est pas configuré")
    return moteur


@callback
def async_enregistrer_services(hass: HomeAssistant) -> None:
    """Enregistre les services (une fois par démarrage)."""
    if hass.services.has_service(DOMAIN, SERVICE_EXPORTER):
        return

    async def exporter(call: ServiceCall) -> ServiceResponse:
        moteur = _moteur(hass)
        return {"version": VERSION, "types": copy.deepcopy(moteur.types), "regles": copy.deepcopy(moteur.regles)}

    async def importer(call: ServiceCall) -> ServiceResponse:
        moteur = _moteur(hass)
        try:
            nouvelles = await moteur.async_importer(call.data["regles"], call.data["remplacer"], call.data.get("types"))
        except vol.Invalid as err:
            raise ServiceValidationError(f"Règle refusée : {err.msg if hasattr(err, 'msg') else err}") from err
        return {"importees": len(nouvelles), "regles": [{"id": r["id"], "nom": r["nom"]} for r in nouvelles]}

    async_register_admin_service(
        hass, DOMAIN, SERVICE_EXPORTER, exporter, vol.Schema({}), supports_response=SupportsResponse.ONLY
    )
    async_register_admin_service(
        hass, DOMAIN, SERVICE_IMPORTER, importer, SCHEMA_IMPORTER, supports_response=SupportsResponse.OPTIONAL
    )
