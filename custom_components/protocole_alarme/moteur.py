"""Moteur de Protocole Alarme : suit l'alarme et exécute les règles."""

from __future__ import annotations

import asyncio
import copy
import logging
from typing import Any

import voluptuous as vol
from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Context, Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_state_change_event
from homeassistant.helpers.script import Script, async_validate_actions_config
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import regles as R
from . import simulateur
from .const import (
    CONF_ALARME,
    DOMAIN,
    ETATS_ARMES,
    ETATS_AVANT_ARMEMENT,
    ETATS_AVANT_DESARMEMENT,
    EVT_ARMEMENT,
    EVT_DESARMEMENT,
    FORMAT_STOCKAGE,
    JOURNAL_MAX,
    NOM_APPAREIL,
    REGLES_MAX,
    RES_ANNULEE,
    RES_CONDITION,
    RES_ERREUR,
    RES_OK,
    RES_PAUSE,
    RES_VERIF_ECHEC,
    RES_VERIF_OK,
    SIGNAL_MAJ,
)

_LOGGER = logging.getLogger(__name__)

EVT_TEST = "test"

_ETATS_LISIBLES = {
    "fr": {
        "on": "activé", "off": "désactivé", "open": "ouvert", "closed": "fermé", "opening": "en ouverture",
        "closing": "en fermeture", "locked": "verrouillé", "unlocked": "déverrouillé", "home": "présent",
        "not_home": "absent", "unavailable": "indisponible", "unknown": "inconnu",
    },
    "en": {
        "on": "on", "off": "off", "open": "open", "closed": "closed", "opening": "opening",
        "closing": "closing", "locked": "locked", "unlocked": "unlocked", "home": "home",
        "not_home": "away", "unavailable": "unavailable", "unknown": "unknown",
    },
}
_CLASSES_OUVERTURE = {"door", "garage_door", "window", "opening"}


class Moteur:
    """Règles, journal et exécution."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.store: Store = Store(hass, FORMAT_STOCKAGE, f"{DOMAIN}.{entry.entry_id}")
        self.regles: list[dict] = []
        self.actif: bool = True
        self.journal: list[dict] = []
        self.dernier_mode: str | None = None
        self.derniere_execution: dict | None = None
        self.echec_verification: bool = False
        self._taches: dict[str, set[asyncio.Task]] = {EVT_ARMEMENT: set(), EVT_DESARMEMENT: set(), EVT_TEST: set()}
        self._desabonner = None

    # ------------------------------------------------------------------ cycle de vie

    @property
    def alarme(self) -> str | None:
        return self.entry.options.get(CONF_ALARME) or self.entry.data.get(CONF_ALARME)

    async def async_demarrer(self) -> None:
        donnees = await self.store.async_load() or {}
        self.regles = [r for r in donnees.get("regles", []) if isinstance(r, dict) and r.get("id")]
        self.actif = bool(donnees.get("actif", True))
        self.journal = list(donnees.get("journal", []))[:JOURNAL_MAX]
        self.dernier_mode = donnees.get("dernier_mode")
        self.derniere_execution = donnees.get("derniere_execution")
        self.echec_verification = bool(donnees.get("echec_verification", False))
        if self.alarme:
            self._desabonner = async_track_state_change_event(self.hass, [self.alarme], self._alarme_changee)

    async def async_arreter(self) -> None:
        if self._desabonner:
            self._desabonner()
            self._desabonner = None
        for taches in self._taches.values():
            for tache in list(taches):
                tache.cancel()
        await self.store.async_save(self._a_sauver())

    def _a_sauver(self) -> dict:
        return {
            "regles": self.regles,
            "actif": self.actif,
            "journal": self.journal,
            "dernier_mode": self.dernier_mode,
            "derniere_execution": self.derniere_execution,
            "echec_verification": self.echec_verification,
        }

    @callback
    def _sauver(self) -> None:
        self.store.async_delay_save(self._a_sauver, 1)

    @callback
    def _signaler(self) -> None:
        async_dispatcher_send(self.hass, SIGNAL_MAJ.format(self.entry.entry_id))

    # ------------------------------------------------------------------ alarme

    @callback
    def _alarme_changee(self, event: Event[EventStateChangedData]) -> None:
        ancien = event.data["old_state"].state if event.data["old_state"] else None
        nouveau = event.data["new_state"].state if event.data["new_state"] else None
        evenement = evenement_alarme(ancien, nouveau)
        if evenement is None:
            return
        if evenement == EVT_ARMEMENT:
            self.dernier_mode = nouveau
            self._sauver()
        if not self.actif:
            self._noter(None, evenement, RES_PAUSE, "")
            return
        self.async_lancer(evenement, self.dernier_mode)

    @callback
    def async_lancer(self, evenement: str, mode: str | None) -> None:
        """Annule les règles de l'événement inverse encore en cours, puis lance les règles concernées."""
        inverse = EVT_DESARMEMENT if evenement == EVT_ARMEMENT else EVT_ARMEMENT
        for tache in list(self._taches[inverse]):
            tache.cancel()
        for regle in self.regles:
            if R.concerne(regle, evenement, mode):
                self._demarrer_tache(copy.deepcopy(regle), evenement, mode)

    def _demarrer_tache(self, regle: dict, evenement: str, mode: str | None) -> None:
        tache = self.entry.async_create_background_task(
            self.hass, self._executer(regle, evenement, mode), f"{DOMAIN} {regle['nom']}"
        )
        self._taches[evenement].add(tache)
        tache.add_done_callback(self._taches[evenement].discard)

    # ------------------------------------------------------------------ exécution

    async def _executer(self, regle: dict, evenement: str, mode: str | None) -> None:
        ok, detail = R.conditions_remplies(regle, self._etat)
        if not ok:
            self._noter(regle, evenement, RES_CONDITION, detail)
            return
        script: Script | None = None
        try:
            entite_ls = simulateur.entite_mode(self.hass)
            etapes = R.sequence_complete(regle, entite_ls, simulateur.options_mode(self.hass, entite_ls))
            etapes = await async_validate_actions_config(self.hass, cv.SCRIPT_SCHEMA(etapes))
            script = Script(
                self.hass, etapes, f"{NOM_APPAREIL} : {regle['nom']}", DOMAIN,
                script_mode="parallel", max_runs=10, logger=_LOGGER,
            )
            variables = {"regle": regle["nom"], "evenement": evenement, "mode_alarme": mode}
            await script.async_run(run_variables=variables, context=Context())
        except asyncio.CancelledError:
            if script is not None:
                await script.async_stop()
            self._noter(regle, evenement, RES_ANNULEE, "")
            raise
        except R.ErreurRegle as err:
            self._noter(regle, evenement, RES_ERREUR, err.code)
            return
        except (vol.Invalid, HomeAssistantError, ValueError) as err:
            _LOGGER.warning("Règle « %s » : %s", regle["nom"], err)
            self._noter(regle, evenement, RES_ERREUR, str(err))
            return
        self._noter(regle, evenement, RES_OK, "")
        await self._verifier(regle, evenement)

    async def _verifier(self, regle: dict, evenement: str) -> None:
        verif = regle.get("verification") or {}
        if not verif.get("active"):
            return
        await self._attendre(int(verif.get("delai_s") or 0))
        actuel = self._etat(verif["entity_id"])
        if actuel == verif["etat"]:
            self.echec_verification = False
            self._noter(regle, evenement, RES_VERIF_OK, "")
            return
        self.echec_verification = True
        self._noter(regle, evenement, RES_VERIF_ECHEC, f"{verif['entity_id']} = {actuel}")
        await self._prevenir(regle, verif, actuel)

    async def _attendre(self, secondes: int) -> None:
        """Pause annulable, sur l'horloge de Home Assistant."""
        if secondes <= 0:
            return
        fin: asyncio.Future = self.hass.loop.create_future()

        @callback
        def _fini(_now) -> None:
            if not fin.done():
                fin.set_result(None)

        desabonner = async_call_later(self.hass, secondes, _fini)
        try:
            await fin
        finally:
            desabonner()

    async def _prevenir(self, regle: dict, verif: dict, actuel: str | None) -> None:
        cible = verif.get("notifier")
        if not cible:
            return
        message = verif.get("message") or self._message_echec(regle, verif, actuel)
        titre = NOM_APPAREIL
        try:
            if cible == "persistent_notification":
                persistent_notification.async_create(self.hass, message, titre)
            else:
                domaine, service = cible.split(".", 1)
                await self.hass.services.async_call(domaine, service, {"message": message, "title": titre}, blocking=True)
        except (HomeAssistantError, ValueError, vol.Invalid) as err:
            _LOGGER.warning("Notification « %s » impossible : %s", cible, err)

    def _message_echec(self, regle: dict, verif: dict, actuel: str | None) -> str:
        langue = "fr" if str(self.hass.config.language or "").startswith("fr") else "en"
        etat = self.hass.states.get(verif["entity_id"])
        nom = etat.name if etat else verif["entity_id"]
        attendu = self._lisible(verif["entity_id"], verif["etat"], langue)
        obtenu = self._lisible(verif["entity_id"], actuel, langue)
        if langue == "fr":
            return f"⚠️ « {regle['nom']} » : {nom} est {obtenu} au lieu de {attendu}."
        return f"⚠️ “{regle['nom']}”: {nom} is {obtenu} instead of {attendu}."

    def _lisible(self, entity_id: str, valeur: str | None, langue: str) -> str:
        etat = self.hass.states.get(entity_id)
        if entity_id.startswith("binary_sensor.") and etat and etat.attributes.get("device_class") in _CLASSES_OUVERTURE:
            valeur = {"on": "open", "off": "closed"}.get(valeur or "", valeur)
        return _ETATS_LISIBLES[langue].get(valeur or "unknown", valeur or "?")

    def _etat(self, entity_id: str) -> str | None:
        etat = self.hass.states.get(entity_id)
        return etat.state if etat else None

    # ------------------------------------------------------------------ journal

    @callback
    def _noter(self, regle: dict | None, evenement: str, resultat: str, detail: str) -> None:
        entree = {
            "date": dt_util.utcnow().isoformat(),
            "regle": regle["nom"] if regle else None,
            "regle_id": regle["id"] if regle else None,
            "evenement": evenement,
            "resultat": resultat,
            "detail": detail,
        }
        self.journal.insert(0, entree)
        del self.journal[JOURNAL_MAX:]
        if regle and resultat in (RES_OK, RES_ERREUR, RES_CONDITION):
            self.derniere_execution = entree
        self._sauver()
        self._signaler()

    async def async_vider_journal(self) -> None:
        self.journal = []
        self.echec_verification = False
        self._sauver()
        self._signaler()

    # ------------------------------------------------------------------ règles

    def regle(self, regle_id: str) -> dict | None:
        return next((r for r in self.regles if r["id"] == regle_id), None)

    async def async_valider_sequence(self, regle: dict) -> None:
        """Vérifie que Home Assistant accepte le script de la règle (mode avancé surtout)."""
        if not regle.get("avance"):
            return
        try:
            await async_validate_actions_config(self.hass, cv.SCRIPT_SCHEMA(regle["sequence"]))
        except (vol.Invalid, HomeAssistantError) as err:
            raise vol.Invalid(f"sequence_invalide: {err}") from err

    async def async_enregistrer(self, brute: dict) -> dict:
        regle = R.normaliser(brute)
        await self.async_valider_sequence(regle)
        existante = self.regle(regle["id"])
        recharger = existante is None or existante["nom"] != regle["nom"]
        if existante is None:
            if len(self.regles) >= REGLES_MAX:
                raise vol.Invalid("trop_de_regles")
            self.regles.append(regle)
        else:
            self.regles[self.regles.index(existante)] = regle
        await self._appliquer(recharger)
        return regle

    async def async_supprimer(self, regle_id: str) -> None:
        self.regles = [r for r in self.regles if r["id"] != regle_id]
        await self._appliquer(True)

    async def async_dupliquer(self, regle_id: str, suffixe: str) -> dict | None:
        source = self.regle(regle_id)
        if source is None:
            return None
        copie = copy.deepcopy(source)
        copie["id"] = None
        copie["nom"] = f"{source['nom']} {suffixe}"[:80]
        return await self.async_enregistrer(copie)

    async def async_activer(self, regle_id: str, actif: bool) -> None:
        regle = self.regle(regle_id)
        if regle is not None:
            regle["actif"] = actif
            await self._appliquer(False)

    async def async_changer_actif(self, actif: bool) -> None:
        self.actif = actif
        await self._appliquer(False)

    async def async_tester(self, brute: dict) -> None:
        """Exécute une règle tout de suite, sans armer l'alarme. Les conditions restent vérifiées."""
        regle = R.normaliser(brute)
        await self.async_valider_sequence(regle)
        self._demarrer_tache(regle, EVT_TEST, self.dernier_mode)

    async def _appliquer(self, recharger: bool) -> None:
        await self.store.async_save(self._a_sauver())
        self._signaler()
        if recharger:
            # Les entités par règle (interrupteur, bouton) suivent la liste
            self.hass.config_entries.async_schedule_reload(self.entry.entry_id)

    def sequence_yaml(self, brute: dict) -> list[dict]:
        """Script équivalent à une règle simple, pour passer en mode avancé."""
        regle = R.normaliser({**brute, "avance": False})
        entite_ls = simulateur.entite_mode(self.hass) or "select.lights_simulator_mode"
        return R.sequence_simple(regle, entite_ls, simulateur.options_mode(self.hass, entite_ls))

    def instantane(self) -> dict[str, Any]:
        etat = self.hass.states.get(self.alarme) if self.alarme else None
        return {
            "alarme": self.alarme,
            "etat_alarme": etat.state if etat else None,
            "actif": self.actif,
            "dernier_mode": self.dernier_mode,
            "derniere_execution": self.derniere_execution,
            "echec_verification": self.echec_verification,
            "en_cours": sum(len(t) for t in self._taches.values()),
        }


def evenement_alarme(ancien: str | None, nouveau: str | None) -> str | None:
    """Armement, désarmement ou rien, d'après le changement d'état de l'alarme.

    Le redémarrage de Home Assistant (ancien état absent ou inconnu) ne déclenche rien.
    """
    if nouveau in ETATS_ARMES and ancien in ETATS_AVANT_ARMEMENT:
        return EVT_ARMEMENT
    if nouveau == "disarmed" and ancien in ETATS_AVANT_DESARMEMENT:
        return EVT_DESARMEMENT
    return None
