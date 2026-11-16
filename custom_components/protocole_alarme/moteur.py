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
from homeassistant.exceptions import TemplateError
from homeassistant.helpers.storage import Store
from homeassistant.helpers.template import Template
from homeassistant.helpers.translation import async_get_translations
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
    EVT_SURVEILLANCE,
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

# Message envoyé quand une vérification échoue (modifiable dans le panneau, même syntaxe)
MESSAGE_ECHEC_DEFAUT = {
    "fr": "⚠️ « {{ regle }} » : {{ entite }} est {{ etat_actuel }} au lieu de {{ etat_attendu }}.",
    "en": "⚠️ “{{ regle }}”: {{ entite }} is {{ etat_actuel }} instead of {{ etat_attendu }}.",
}


class Moteur:
    """Règles, journal et exécution."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.store: Store = Store(hass, FORMAT_STOCKAGE, f"{DOMAIN}.{entry.entry_id}")
        self.regles: list[dict] = []
        self.actif: bool = True
        self.editeurs: list[str] = []  # utilisateurs non administrateurs autorisés à modifier les règles
        self.journal: list[dict] = []
        self.dernier_mode: str | None = None
        self.derniere_execution: dict | None = None
        self.echec_verification: bool = False
        self._taches: dict[str, set[asyncio.Task]] = {EVT_ARMEMENT: set(), EVT_DESARMEMENT: set(), EVT_TEST: set()}
        self._desabonner = None
        self._desabonner_surveillance = None
        self._regles_en_cours: set[str] = set()

    # ------------------------------------------------------------------ cycle de vie

    @property
    def alarme(self) -> str | None:
        return self.entry.options.get(CONF_ALARME) or self.entry.data.get(CONF_ALARME)

    async def async_demarrer(self) -> None:
        donnees = await self.store.async_load() or {}
        self.regles = [r for r in donnees.get("regles", []) if isinstance(r, dict) and r.get("id")]
        self.actif = bool(donnees.get("actif", True))
        self.editeurs = [str(u) for u in donnees.get("editeurs", []) if u]
        self.journal = list(donnees.get("journal", []))[:JOURNAL_MAX]
        self.dernier_mode = donnees.get("dernier_mode")
        self.derniere_execution = donnees.get("derniere_execution")
        self.echec_verification = bool(donnees.get("echec_verification", False))
        if self.alarme:
            self._desabonner = async_track_state_change_event(self.hass, [self.alarme], self._alarme_changee)
        self._abonner_surveillance()

    async def async_arreter(self) -> None:
        if self._desabonner:
            self._desabonner()
            self._desabonner = None
        if self._desabonner_surveillance:
            self._desabonner_surveillance()
            self._desabonner_surveillance = None
        self._desabonner_surveillance = None
        self._regles_en_cours: set[str] = set()
        for taches in self._taches.values():
            for tache in list(taches):
                tache.cancel()
        await self.store.async_save(self._a_sauver())

    def _a_sauver(self) -> dict:
        return {
            "regles": self.regles,
            "actif": self.actif,
            "editeurs": self.editeurs,
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
        self.async_lancer(evenement, self.dernier_mode, Context(parent_id=event.context.id))

    @callback
    def async_lancer(self, evenement: str, mode: str | None, contexte: Context | None = None) -> None:
        """Annule les règles de l'événement inverse encore en cours, puis lance les règles concernées."""
        inverse = EVT_DESARMEMENT if evenement == EVT_ARMEMENT else EVT_ARMEMENT
        for tache in list(self._taches[inverse]):
            tache.cancel()
        for regle in self.regles:
            if R.concerne(regle, evenement, mode):
                self._demarrer_tache(copy.deepcopy(regle), evenement, mode, contexte)

    def _demarrer_tache(
        self, regle: dict, evenement: str, mode: str | None, contexte: Context | None = None, groupe: str | None = None
    ) -> None:
        """Lance une règle en tâche de fond. groupe : ensemble annulé par l'événement inverse."""
        tache = self.entry.async_create_background_task(
            self.hass, self._executer(regle, evenement, mode, contexte or Context()), f"{DOMAIN} {regle['nom']}"
        )
        ensemble = self._taches[groupe or evenement]
        ensemble.add(tache)
        tache.add_done_callback(ensemble.discard)
        if regle.get("id"):
            self._regles_en_cours.add(regle["id"])
            tache.add_done_callback(lambda _t, rid=regle["id"]: self._regles_en_cours.discard(rid))

    # ------------------------------------------------------------------ surveillance pendant l'armement

    @callback
    def _abonner_surveillance(self) -> None:
        """Suit les entités des conditions des règles « surveiller aussi pendant l'armement »."""
        if self._desabonner_surveillance:
            self._desabonner_surveillance()
            self._desabonner_surveillance = None
        entites = R.entites_surveillees(self.regles)
        if entites:
            self._desabonner_surveillance = async_track_state_change_event(
                self.hass, sorted(entites), self._entite_changee
            )

    @callback
    def _entite_changee(self, event: Event[EventStateChangedData]) -> None:
        if not self.actif:
            return
        etat_alarme = self._etat(self.alarme) if self.alarme else None
        if etat_alarme not in ETATS_ARMES:
            return
        entity_id = event.data["entity_id"]
        ancien = event.data["old_state"].state if event.data["old_state"] else None
        nouveau = event.data["new_state"].state if event.data["new_state"] else None
        for regle in self.regles:
            if (
                R.concerne(regle, EVT_ARMEMENT, etat_alarme)
                and R.declenchee_pendant(regle, entity_id, ancien, nouveau)
                and regle["id"] not in self._regles_en_cours
            ):
                self._demarrer_tache(
                    copy.deepcopy(regle), EVT_SURVEILLANCE, etat_alarme,
                    Context(parent_id=event.context.id), groupe=EVT_ARMEMENT,
                )

    # ------------------------------------------------------------------ exécution

    async def _executer(self, regle: dict, evenement: str, mode: str | None, contexte: Context) -> None:
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
            await script.async_run(run_variables=variables, context=contexte)
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
        cibles = R.services_notification(verif.get("notifiers") or [], verif.get("notifier"))
        if not cibles:
            return
        message = await self.async_message_echec(regle, verif, actuel)
        titre = NOM_APPAREIL
        for cible in cibles:
            try:
                if cible == "persistent_notification":
                    persistent_notification.async_create(self.hass, message, titre)
                else:
                    domaine, service = cible.split(".", 1)
                    await self.hass.services.async_call(
                        domaine, service, {"message": message, "title": titre}, blocking=True
                    )
            except (HomeAssistantError, ValueError, vol.Invalid) as err:
                _LOGGER.warning("Notification « %s » impossible : %s", cible, err)

    @property
    def langue(self) -> str:
        return "fr" if str(self.hass.config.language or "").startswith("fr") else "en"

    async def async_message_echec(self, regle: dict, verif: dict, actuel: str | None) -> str:
        """Message personnalisé (modèle Home Assistant) ou message par défaut dans la langue de HA."""
        etat = self.hass.states.get(verif["entity_id"])
        variables = {
            "regle": regle["nom"],
            "entite": etat.name if etat else verif["entity_id"],
            "etat_actuel": await self._lisible(verif["entity_id"], actuel),
            "etat_attendu": await self._lisible(verif["entity_id"], verif["etat"]),
            "evenement": "",
        }
        defaut = MESSAGE_ECHEC_DEFAUT[self.langue]
        for modele in (verif.get("message") or defaut, defaut):
            try:
                return str(Template(modele, self.hass).async_render(variables, parse_result=False)).strip()
            except TemplateError as err:
                _LOGGER.warning("Message de la règle « %s » invalide : %s", regle["nom"], err)
        return defaut

    async def _lisible(self, entity_id: str, valeur: str | None) -> str:
        """État traduit comme dans Home Assistant (ex. « Ouvert » pour une porte de garage)."""
        if valeur is None:
            valeur = "unavailable"
        domaine = entity_id.split(".", 1)[0]
        etat = self.hass.states.get(entity_id)
        classe = (etat.attributes.get("device_class") if etat else None) or "_"
        try:
            traductions = await async_get_translations(self.hass, self.hass.config.language, "entity_component", [domaine])
        except HomeAssistantError:
            traductions = {}
        for cle in (
            f"component.{domaine}.entity_component.{classe}.state.{valeur}",
            f"component.{domaine}.entity_component._.state.{valeur}",
        ):
            if cle in traductions:
                return traductions[cle].lower()
        return valeur

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

    def valider_message(self, regle: dict) -> None:
        message = (regle.get("verification") or {}).get("message")
        if message:
            try:
                Template(message, self.hass).ensure_valid()
            except TemplateError as err:
                raise vol.Invalid(f"message_invalide: {err}") from err

    async def async_enregistrer(self, brute: dict) -> dict:
        regle = R.normaliser(brute)
        self.valider_message(regle)
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

    async def async_importer(self, brutes: list[dict], remplacer: bool = False) -> list[dict]:
        """Ajoute (ou remplace par) une liste de règles. Tout est vérifié avant de modifier quoi que ce soit."""
        nouvelles: list[dict] = []
        for brute in brutes:
            if not isinstance(brute, dict):
                raise vol.Invalid("regle_invalide")
            # En ajout, chaque règle importée reçoit un nouvel identifiant (pas de collision)
            regle = R.normaliser({**brute, "id": None} if not remplacer else brute)
            self.valider_message(regle)
            await self.async_valider_sequence(regle)
            nouvelles.append(regle)
        ids = [r["id"] for r in nouvelles]
        if len(set(ids)) != len(ids):
            raise vol.Invalid("regle_invalide: identifiants en double")
        total = len(nouvelles) + (0 if remplacer else len(self.regles))
        if total > REGLES_MAX:
            raise vol.Invalid("trop_de_regles")
        self.regles = nouvelles if remplacer else [*self.regles, *nouvelles]
        await self._appliquer(True)
        return nouvelles

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

    def peut_modifier(self, utilisateur) -> bool:
        """Administrateur, ou utilisateur ajouté à la liste des éditeurs."""
        return bool(utilisateur and utilisateur.is_active and (utilisateur.is_admin or utilisateur.id in self.editeurs))

    async def async_changer_editeurs(self, editeurs: list[str]) -> None:
        self.editeurs = sorted(set(editeurs))
        await self._appliquer(False)

    async def async_changer_actif(self, actif: bool) -> None:
        self.actif = actif
        await self._appliquer(False)

    async def async_tester(self, brute: dict, contexte: Context | None = None) -> None:
        """Exécute une règle tout de suite, sans armer l'alarme. Les conditions restent vérifiées.

        Le contexte relie les actions à l'utilisateur qui a lancé le test (journal de bord).
        """
        regle = R.normaliser(brute)
        self.valider_message(regle)
        await self.async_valider_sequence(regle)
        self._demarrer_tache(regle, EVT_TEST, self.dernier_mode, contexte)

    async def _appliquer(self, recharger: bool) -> None:
        await self.store.async_save(self._a_sauver())
        self._signaler()
        self._abonner_surveillance()
        if recharger:
            # Les entités par règle (interrupteur, bouton) suivent la liste
            self.hass.config_entries.async_schedule_reload(self.entry.entry_id)

    def sequence_yaml(self, brute: dict) -> list[dict]:
        """Script équivalent à une règle simple, pour passer en mode avancé."""
        if brute.get("avance") and brute.get("sequence"):
            return R.normaliser(brute)["sequence"]
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
