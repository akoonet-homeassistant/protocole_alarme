// Protocole Alarme — panneau latéral : règles (assistant en 3 étapes), entités, journal, réglages.

const VERSION_URL = new URL(import.meta.url).search;
const { TEXTES, MODES, ACTIONS, ACTIONS_DOMAINE, DOMAINES, ETATS } = await import(`./i18n.js${VERSION_URL}`);

const DOMAINE = "protocole_alarme";
const ORDRE_MODES = ["armed_away", "armed_night", "armed_home", "armed_vacation", "armed_custom_bypass"];
const ONGLETS = ["regles", "entites", "journal", "reglages"];

const ICONES = {
  cover: "mdi:window-shutter", light: "mdi:lightbulb", switch: "mdi:toggle-switch", input_boolean: "mdi:toggle-switch-outline",
  fan: "mdi:fan", siren: "mdi:bullhorn", button: "mdi:gesture-tap-button", input_button: "mdi:gesture-tap-button",
  lock: "mdi:lock", climate: "mdi:thermostat", media_player: "mdi:cast", scene: "mdi:palette", script: "mdi:script-text",
  automation: "mdi:robot", select: "mdi:format-list-bulleted", input_select: "mdi:format-list-bulleted", valve: "mdi:valve",
  binary_sensor: "mdi:checkbox-blank-circle-outline", sensor: "mdi:eye", person: "mdi:account", device_tracker: "mdi:map-marker",
  simulateur: "mdi:home-lightbulb", notification: "mdi:bell-ring", alarm_control_panel: "mdi:shield-home",
};
const COULEURS = {
  cover: "bleu", light: "jaune", switch: "gris", input_boolean: "gris", lock: "vert", climate: "orange", binary_sensor: "orange",
  simulateur: "jaune", notification: "violet", scene: "violet", script: "violet", automation: "violet",
};
const ICONE_EVENEMENT = { armement: "mdi:lock", desarmement: "mdi:lock-open-variant", test: "mdi:play" };

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const CLE_STATUT = { absent: "non_installe", non_configure: "non_configure", pret: "pret" };
const domaineDe = (entityId) => String(entityId || "").split(".")[0];
const copie = (o) => JSON.parse(JSON.stringify(o));

class ProtocoleAlarmePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._onglet = "regles";
    this._evenement = "armement";
    this._vue = "liste"; // liste | modeles | assistant
    this._etape = 1;
    this._brouillon = null;
    this._siCond = false;
    this._yaml = "";
    this._selecteur = null;
    this._confirmer = null;
    this._message = null;
    this._erreur = null;
    this._d = null;
  }

  // ------------------------------------------------------------------ Home Assistant

  set hass(hass) {
    const premier = !this._hass;
    this._hass = hass;
    if (premier) this._charger();
    else if (this._vue === "liste" && !this._selecteur && Date.now() - (this._dernierDessin || 0) > 5000) this._dessiner();
  }
  set narrow(v) { this._narrow = v; }
  set panel(v) { this._panel = v; }

  connectedCallback() {
    if (!this._ecoute) {
      this.shadowRoot.addEventListener("click", (e) => this._clic(e));
      this.shadowRoot.addEventListener("change", (e) => this._changement(e));
      this.shadowRoot.addEventListener("input", (e) => this._saisie(e));
      this._ecoute = true;
    }
    this._minuterie = setInterval(() => this._charger(true), 15000);
    this._dessiner();
  }
  disconnectedCallback() { clearInterval(this._minuterie); }

  get _langue() {
    const l = (this._hass?.locale?.language || this._hass?.language || "en").toLowerCase();
    return l.startsWith("fr") ? "fr" : "en";
  }
  t(cle, vars = {}) {
    let texte = TEXTES[this._langue][cle] ?? TEXTES.en[cle] ?? cle;
    for (const [k, v] of Object.entries(vars)) texte = texte.replaceAll(`{${k}}`, v);
    return texte;
  }
  get _admin() { return this._d ? this._d.admin : !!this._hass?.user?.is_admin; }

  _ws(type, extra = {}) { return this._hass.callWS({ type: `${DOMAINE}/${type}`, ...extra }); }

  async _charger(silencieux = false) {
    if (!this._hass) return;
    try {
      this._d = await this._ws("etat");
      this._erreur = null;
    } catch (err) {
      this._erreur = err.message || String(err);
    }
    if (silencieux && this._vue !== "liste") return;
    const actif = this.shadowRoot.activeElement;
    if (silencieux && actif && ["INPUT", "SELECT", "TEXTAREA"].includes(actif.tagName)) return;
    this._dessiner();
  }

  _annoncer(texte, erreur = false) {
    this._message = { texte, erreur };
    this._dessiner();
    clearTimeout(this._minuterieMessage);
    this._minuterieMessage = setTimeout(() => { this._message = null; this._dessiner(); }, erreur ? 7000 : 3500);
  }
  _texteErreur(err) {
    const brut = err?.message || String(err);
    const code = brut.split(":")[0];
    return TEXTES[this._langue][`err.${code}`] ? this.t(`err.${code}`) : brut;
  }

  // ------------------------------------------------------------------ libellés

  _nomEntite(entityId) {
    const s = this._hass?.states?.[entityId];
    return s?.attributes?.friendly_name || entityId || "";
  }
  _etatLisible(entityId, etat) {
    const s = this._hass?.states?.[entityId];
    if (s && typeof this._hass.formatEntityState === "function") {
      try { return this._hass.formatEntityState(s, etat); } catch (e) { /* ancien frontend */ }
    }
    return ETATS[this._langue][etat] ?? etat;
  }
  _libelleAction(action) {
    const cle = action.type === "entite" ? `${domaineDe(action.entity_id)}.${action.action}` : "";
    return ACTIONS_DOMAINE[this._langue][cle] || ACTIONS[this._langue][action.action] || action.action;
  }
  _nomService(s) {
    if (!s) return "";
    if (s === "persistent_notification") return "Home Assistant";
    return s.replace("notify.", "").replace("mobile_app_", "").replaceAll("_", " ");
  }
  _libelleMode(m) { return MODES[this._langue][m] || m; }
  _nombre(v) { return String(v).replace(".", this._langue === "fr" ? "," : "."); }

  _cible(action) {
    if (action.type === "simulateur") return this.t("simulateur");
    if (action.type === "notification") return esc(this._nomService(action.service));
    return action.entity_id ? this._nomEntite(action.entity_id) : `<em>${this.t("choisir_entite_manquante")}</em>`;
  }
  _detailParams(action) {
    const p = action.params || {};
    const morceaux = [];
    if (action.action === "impulsion") morceaux.push(`${this._nombre(p.duree ?? 1)} s`);
    if (p.position !== undefined && action.action === "position") morceaux.push(`${p.position} %`);
    if (p.luminosite) morceaux.push(`${p.luminosite} %`);
    if (p.preset) morceaux.push(esc(p.preset));
    if (p.temperature !== undefined && action.action === "temperature") morceaux.push(`${this._nombre(p.temperature)} °`);
    if (p.option) morceaux.push(esc(p.option));
    return morceaux.length ? ` (${morceaux.join(", ")})` : "";
  }
  _phrase(regle) {
    const conds = (regle.conditions || []).map(
      (c) => `<b>${esc(this._nomEntite(c.entity_id))}</b> ${this.t("est")} <i>${esc(this._etatLisible(c.entity_id, c.etat))}</i>`
    );
    const debut = conds.length ? `${this.t("si")} ${conds.join(` ${this.t("et")} `)}` : this.t("toujours");
    const actions = regle.avance
      ? this.t("script_avance", { n: (regle.sequence || []).length })
      : (regle.actions || []).map((a) => `<b>${esc(this._libelleAction(a))}</b> ${a.type === "entite" ? esc(this._cible(a)) : this._cible(a)}${this._detailParams(a)}`).join(", ");
    return `${debut} → ${actions}`;
  }
  _modesTexte(regle) {
    const modes = regle.modes || [];
    return modes.length ? modes.map((m) => this._libelleMode(m)).join(" · ") : this.t("tous_modes");
  }

  // ------------------------------------------------------------------ événements

  async _clic(e) {
    const cible = e.target.closest("[data-a]");
    if (!cible || cible.disabled) return;
    const d = cible.dataset;
    const i = d.i !== undefined ? Number(d.i) : null;
    const b = this._brouillon;
    try {
      switch (d.a) {
        case "menu":
          this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
          return;
        case "onglet": this._onglet = d.v; this._vue = "liste"; break;
        case "evenement": this._evenement = d.v; break;
        case "actif": await this._ws("actif", { actif: !this._d.instantane.actif }); await this._charger(); return;
        case "activer": await this._ws("activer", { id: d.id, actif: d.v !== "1" }); await this._charger(); return;
        case "tester": await this._ws("tester", { regle: this._regle(d.id) }); this._annoncer(this.t("teste")); return;
        case "dupliquer": await this._ws("dupliquer", { id: d.id, suffixe: this.t("copie") }); await this._attendreRechargement(); return;
        case "supprimer":
          if (this._confirmer !== d.id) { this._confirmer = d.id; break; }
          this._confirmer = null;
          await this._ws("supprimer", { id: d.id });
          this._annoncer(this.t("supprime"));
          await this._attendreRechargement();
          return;
        case "nouvelle": this._ouvrirAssistant(this._regleVide()); return;
        case "modifier": this._ouvrirAssistant(copie(this._regle(d.id))); return;
        case "modeles": this._vue = "modeles"; break;
        case "modele": this._ouvrirAssistant(this._modele(d.v)); return;
        case "fermer-assistant": this._vue = "liste"; this._brouillon = null; this._selecteur = null; break;
        case "etape": await this._allerEtape(Number(d.v)); return;
        case "moment": b.evenement = d.v; break;
        case "mode": b.modes = b.modes.includes(d.v) ? b.modes.filter((m) => m !== d.v) : [...b.modes, d.v]; break;
        case "si": this._siCond = d.v === "1"; if (this._siCond && !b.conditions.length) this._ouvrirSelecteur("condition", null); break;
        case "ajouter-condition": this._ouvrirSelecteur("condition", null); return;
        case "changer-condition": this._ouvrirSelecteur("condition", i); return;
        case "etat-condition": b.conditions[i].etat = d.v; break;
        case "retirer-condition": b.conditions.splice(i, 1); if (!b.conditions.length) this._siCond = false; break;
        case "ajouter-action": this._ouvrirSelecteur("action", null); return;
        case "changer-action": this._ouvrirSelecteur("action", i); return;
        case "choix-action": b.actions[i].action = d.v; this._paramsParDefaut(b.actions[i]); break;
        case "retirer-action": b.actions.splice(i, 1); break;
        case "verif": b.verification.active = !b.verification.active; this._completerVerif(); break;
        case "verif-entite": this._ouvrirSelecteur("verif", null); return;
        case "verif-etat": b.verification.etat = d.v; break;
        case "delai": b.delai_s = Math.max(0, Math.min(3600, (b.delai_s || 0) + Number(d.v))); break;
        case "choisir": this._choisir(d.v); return;
        case "fermer-selecteur": this._selecteur = null; break;
        case "domaine-filtre": this._selecteur.domaine = this._selecteur.domaine === d.v ? null : d.v; break;
        case "tester-brouillon": await this._ws("tester", { regle: await this._brouillonPret() }); this._annoncer(this.t("teste")); return;
        case "enregistrer": await this._enregistrer(); return;
        case "avance": await this._passerAvance(); return;
        case "simple": b.avance = false; b.sequence = []; this._yaml = ""; break;
        case "vider-journal": await this._ws("vider_journal"); await this._charger(); return;
        case "plus-info":
          this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: d.id }, bubbles: true, composed: true }));
          return;
        default: return;
      }
      this._dessiner();
    } catch (err) {
      this._annoncer(this._texteErreur(err), true);
    }
  }

  _saisie(e) {
    const c = e.target;
    const b = this._brouillon;
    if (!c.dataset.f) return;
    const i = c.dataset.i !== undefined ? Number(c.dataset.i) : null;
    switch (c.dataset.f) {
      case "nom": b.nom = c.value; break;
      case "recherche": this._selecteur.recherche = c.value; this._dessinerListe(); break;
      case "yaml": this._yaml = c.value; break;
      case "message": b.actions[i].params.message = c.value; break;
      case "titre": b.actions[i].params.titre = c.value; break;
      case "verif-message": b.verification.message = c.value; break;
      case "param": {
        const action = b.actions[i];
        action.params[c.dataset.p] = c.type === "range" || c.type === "number" ? Number(c.value) : c.value;
        const sortie = this.shadowRoot.getElementById(`val-${i}-${c.dataset.p}`);
        if (sortie) sortie.textContent = this._valeurParam(c.dataset.p, action.params[c.dataset.p]);
        break;
      }
      default: break;
    }
  }

  _changement(e) {
    const c = e.target;
    const b = this._brouillon;
    if (!c.dataset.f) return;
    const i = c.dataset.i !== undefined ? Number(c.dataset.i) : null;
    switch (c.dataset.f) {
      case "service": b.actions[i].service = c.value; break;
      case "param-select": b.actions[i].params[c.dataset.p] = c.value === "" ? undefined : c.value; break;
      case "etat-libre": b.conditions[i].etat = c.value.trim(); break;
      case "verif-delai": b.verification.delai_s = Math.max(0, Number(c.value) || 0); break;
      case "verif-notifier": b.verification.notifier = c.value || null; break;
      case "verif-etat-libre": b.verification.etat = c.value.trim(); break;
      default: return;
    }
    this._dessiner();
  }

  async _attendreRechargement() {
    // Ajouter ou supprimer une règle recharge l'intégration (entités par règle)
    await new Promise((r) => setTimeout(r, 1200));
    await this._charger();
  }

  // ------------------------------------------------------------------ règles et brouillon

  _regle(id) { return (this._d?.regles || []).find((r) => r.id === id); }

  _regleVide(evenement = this._evenement) {
    return {
      nom: "", actif: true, evenement, modes: [], conditions: [], actions: [], delai_s: 0,
      verification: { active: false, delai_s: 45, entity_id: null, etat: null, notifier: this._notifParDefaut(), message: null },
      avance: false, sequence: [],
    };
  }
  _notifParDefaut() {
    const liste = this._d?.notifications || [];
    return liste.find((s) => s.startsWith("notify.mobile_app")) || liste[0] || "persistent_notification";
  }

  _modele(cle) {
    const r = this._regleVide("armement");
    const nom = this.t(`m_${cle}`);
    const action = (domaine, act, params = {}) => ({ type: "entite", entity_id: "", action: act, params, _domaine: domaine });
    switch (cle) {
      case "garage":
        Object.assign(r, { nom: this.t("m_garage").split(" s")[0], modes: ["armed_away", "armed_night"] });
        r.nom = this._langue === "fr" ? "Fermer le garage" : "Close the garage";
        r.conditions = [{ entity_id: "", etat: "on", _domaine: "binary_sensor" }];
        r.actions = [action("switch", "impulsion", { duree: 1 })];
        r.verification = { ...r.verification, active: true, delai_s: 45, etat: "off" };
        break;
      case "volet":
        r.nom = this._langue === "fr" ? "Volet si fenêtre ouverte" : "Shutter if window open";
        r.conditions = [{ entity_id: "", etat: "on", _domaine: "binary_sensor" }];
        r.actions = [action("cover", "fermer")];
        break;
      case "simu":
        r.nom = this.t("simulateur");
        r.modes = ["armed_away", "armed_vacation"];
        r.actions = [{ type: "simulateur", action: "demarrer", params: {} }];
        break;
      case "simu_stop":
        r.evenement = "desarmement";
        r.nom = this._langue === "fr" ? "Arrêt du simulateur" : "Simulator off";
        r.actions = [{ type: "simulateur", action: "arreter", params: {} }];
        break;
      case "lumiere":
        r.nom = this._langue === "fr" ? "Lumière de l'entrée" : "Hallway light";
        r.actions = [action("light", "allumer")];
        break;
      case "notif":
        r.evenement = "desarmement";
        r.nom = nom;
        r.actions = [{ type: "notification", service: this._notifParDefaut(), action: "envoyer", params: { message: this.t("notif_defaut"), titre: "" } }];
        break;
      default: break;
    }
    return r;
  }

  _ouvrirAssistant(regle) {
    if (!regle.verification) regle.verification = this._regleVide().verification;
    if (!regle.verification.notifier && regle.verification.notifier !== null) regle.verification.notifier = this._notifParDefaut();
    this._brouillon = regle;
    this._siCond = (regle.conditions || []).length > 0;
    this._yaml = "";
    this._etape = 1;
    this._vue = "assistant";
    this._selecteur = null;
    this._dessiner();
    if (regle.avance) this._chargerYamlExistant();
  }

  async _chargerYamlExistant() {
    // Règle avancée existante : on réaffiche son script tel qu'enregistré
    this._yaml = this._versYaml(this._brouillon.sequence);
    this._dessiner();
  }

  _versYaml(sequence) {
    // Affichage approximatif (JSON indenté accepté par le lecteur YAML) pour les règles déjà avancées
    return JSON.stringify(sequence, null, 2);
  }

  _brouillonNettoye() {
    const b = copie(this._brouillon);
    if (!this._siCond) b.conditions = [];
    b.conditions = b.conditions.map(({ entity_id, etat }) => ({ entity_id, etat }));
    b.actions = b.actions.map(({ _domaine, ...a }) => a);
    if (!b.verification?.active) b.verification = { ...b.verification, active: false };
    return b;
  }

  async _brouillonPret() {
    const b = this._brouillonNettoye();
    if (b.avance) {
      const res = await this._ws("depuis_yaml", { yaml: this._yaml });
      b.sequence = res.sequence;
      this._brouillon.sequence = res.sequence;
    }
    return b;
  }

  async _allerEtape(etape) {
    const b = this._brouillon;
    if (etape > this._etape) {
      if (this._etape === 1 && !b.nom.trim()) { this._annoncer(this.t("err.texte_requis"), true); return; }
      if (this._etape === 2 && this._siCond && b.conditions.some((c) => !c.entity_id || !c.etat)) { this._annoncer(this.t("err.entite_invalide"), true); return; }
      if (this._etape === 3) {
        try {
          await this._brouillonPret();
        } catch (err) { this._annoncer(this._texteErreur(err), true); return; }
        if (!b.avance && !b.actions.length) { this._annoncer(this.t("err.action_requise"), true); return; }
        if (!b.avance && b.actions.some((a) => a.type === "entite" && !a.entity_id)) { this._annoncer(this.t("err.entite_invalide"), true); return; }
        if (b.verification.active && (!b.verification.entity_id || !b.verification.etat)) { this._annoncer(this.t("err.verification_incomplete"), true); return; }
      }
    }
    this._etape = etape;
    this._dessiner();
  }

  async _enregistrer() {
    try {
      const regle = await this._brouillonPret();
      await this._ws("enregistrer", { regle });
      this._vue = "liste";
      this._evenement = regle.evenement;
      this._brouillon = null;
      this._annoncer(this.t("enregistre"));
      await this._attendreRechargement();
    } catch (err) {
      this._annoncer(this._texteErreur(err), true);
    }
  }

  async _passerAvance() {
    const b = this._brouillonNettoye();
    const res = await this._ws("vers_yaml", { regle: { ...b, avance: false } });
    this._brouillon.avance = true;
    this._yaml = res.yaml;
    this._etape = 3;
    this._dessiner();
  }

  _paramsParDefaut(action) {
    const s = this._hass.states[action.entity_id];
    const p = {};
    if (action.action === "impulsion") p.duree = action.params?.duree ?? 1;
    if (action.action === "position") p.position = 0;
    if (action.action === "preset") p.preset = s?.attributes?.preset_modes?.[0] || "";
    if (action.action === "temperature") p.temperature = 17;
    if (action.action === "choisir") p.option = s?.attributes?.options?.[0] || "";
    action.params = p;
  }

  _completerVerif() {
    const v = this._brouillon.verification;
    if (v.active && !v.entity_id && this._brouillon.conditions[0]?.entity_id) {
      v.entity_id = this._brouillon.conditions[0].entity_id;
      v.etat = v.etat || this._etatsPossibles(v.entity_id).find((e) => e !== this._brouillon.conditions[0].etat) || null;
    }
  }

  _etatsPossibles(entityId) {
    const s = this._hass?.states?.[entityId];
    const d = domaineDe(entityId);
    const parDomaine = {
      binary_sensor: ["on", "off"], switch: ["on", "off"], light: ["on", "off"], input_boolean: ["on", "off"],
      fan: ["on", "off"], siren: ["on", "off"], automation: ["on", "off"],
      cover: ["open", "closed"], valve: ["open", "closed"], lock: ["locked", "unlocked"],
      person: ["home", "not_home"], device_tracker: ["home", "not_home"],
      media_player: ["playing", "paused", "idle", "off"],
    };
    if (parDomaine[d]) return parDomaine[d];
    if (d === "climate") return s?.attributes?.hvac_modes || [];
    if (["select", "input_select"].includes(d)) return s?.attributes?.options || [];
    return s ? [s.state] : [];
  }

  // ------------------------------------------------------------------ sélecteur d'entité

  _ouvrirSelecteur(cible, index) {
    let domaine = null;
    const b = this._brouillon;
    if (cible === "condition" && index !== null) domaine = b.conditions[index]?._domaine || null;
    if (cible === "action" && index !== null) domaine = b.actions[index]?._domaine || null;
    this._selecteur = { cible, index, recherche: "", domaine };
    this._dessiner();
    setTimeout(() => this.shadowRoot.getElementById("recherche")?.focus(), 50);
  }

  _entitesFiltrees() {
    const sel = this._selecteur;
    const catalogue = this._d?.catalogue || {};
    const terme = (sel.recherche || "").toLowerCase().trim();
    return Object.values(this._hass.states)
      .filter((s) => {
        const d = domaineDe(s.entity_id);
        if (sel.cible === "action" && !catalogue[d]) return false;
        if (s.entity_id.startsWith(`switch.${DOMAINE}`) || s.entity_id.startsWith(`button.${DOMAINE}`)) return false;
        if (sel.cible === "action" && s.entity_id === this._d?.simulateur?.entite) return false;
        if (sel.domaine && d !== sel.domaine) return false;
        if (!terme) return true;
        return `${s.attributes.friendly_name || ""} ${s.entity_id}`.toLowerCase().includes(terme);
      })
      .sort((a, b) => (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id))
      .slice(0, 150);
  }

  _choisir(valeur) {
    const sel = this._selecteur;
    const b = this._brouillon;
    if (sel.cible === "condition") {
      const etats = this._etatsPossibles(valeur);
      const ancienne = sel.index !== null ? b.conditions[sel.index] : null;
      const etat = ancienne && etats.includes(ancienne.etat) ? ancienne.etat : etats[0] || "";
      const cond = { entity_id: valeur, etat };
      if (sel.index === null) b.conditions.push(cond); else b.conditions[sel.index] = cond;
      this._siCond = true;
    } else if (sel.cible === "verif") {
      b.verification.entity_id = valeur;
      const etats = this._etatsPossibles(valeur);
      if (!etats.includes(b.verification.etat)) b.verification.etat = etats[0] || null;
    } else {
      let action;
      if (valeur === "@simulateur") action = { type: "simulateur", action: "demarrer", params: {} };
      else if (valeur === "@notification") action = { type: "notification", service: this._notifParDefaut(), action: "envoyer", params: { message: this.t("notif_defaut"), titre: "" } };
      else {
        const actions = Object.keys(this._d.catalogue[domaineDe(valeur)] || {});
        const ancienne = sel.index !== null ? b.actions[sel.index] : null;
        const voulue = ancienne && actions.includes(ancienne.action) ? ancienne.action : actions[0];
        action = { type: "entite", entity_id: valeur, action: voulue, params: { ...(ancienne?.params || {}) } };
        this._paramsParDefaut(action);
        if (ancienne?.params?.duree && action.action === "impulsion") action.params.duree = ancienne.params.duree;
      }
      if (sel.index === null) b.actions.push(action); else b.actions[sel.index] = action;
    }
    this._selecteur = null;
    this._completerVerif();
    this._dessiner();
  }

  // ------------------------------------------------------------------ dessin

  _dessiner() {
    if (!this.shadowRoot) return;
    this._dernierDessin = Date.now();
    const d = this._d;
    let contenu;
    if (this._erreur && !d) contenu = `<div class="carte"><p>${esc(this._erreur)}</p></div>`;
    else if (!d) contenu = `<div class="carte"><p>…</p></div>`;
    else if (this._vue === "assistant") contenu = this._assistant();
    else if (this._vue === "modeles") contenu = this._modeles();
    else contenu = { regles: () => this._regles(), entites: () => this._entites(), journal: () => this._journal(), reglages: () => this._reglages() }[this._onglet]();

    const inst = d?.instantane;
    const etatAlarme = inst?.etat_alarme;
    const pastille = d
      ? `<span class="pastille ${etatAlarme && etatAlarme.startsWith("armed") ? "armee" : etatAlarme === "triggered" ? "alerte" : ""}">
           <span class="point"></span>${esc(etatAlarme ? this._etatLisible(inst.alarme, etatAlarme) : this.t("alarme_absente"))}</span>`
      : "";
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <header>
        <div class="ligne-titre">
          ${this._narrow ? `<button type="button" class="icone-btn" data-a="menu" aria-label="Menu"><ha-icon icon="mdi:menu"></ha-icon></button>` : ""}
          <ha-icon icon="mdi:shield-home" class="logo"></ha-icon>
          <h1>${this.t("titre")}</h1>
          ${pastille}
        </div>
        ${this._vue === "assistant" ? "" : `<nav aria-label="${this.t("titre")}">${ONGLETS.map((o) => `<button type="button" class="onglet ${o === this._onglet ? "on" : ""}" aria-current="${o === this._onglet ? "page" : "false"}" data-a="onglet" data-v="${o}">${this.t(`onglet_${o}`)}</button>`).join("")}</nav>`}
      </header>
      ${this._message ? `<div class="message ${this._message.erreur ? "erreur" : ""}" role="status">${esc(this._message.texte)}</div>` : ""}
      <main>${contenu}</main>
      ${this._selecteur ? this._selecteurHtml() : ""}`;
  }

  _dessinerListe() {
    const liste = this.shadowRoot.getElementById("liste-entites");
    if (liste) liste.innerHTML = this._lignesEntites();
  }

  _interrupteur(on, attrs, label) {
    return `<button type="button" class="sw ${on ? "on" : ""}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${attrs} ${this._admin ? "" : "disabled"}><span></span></button>`;
  }
  _pastilleIcone(domaine) {
    return `<span class="ic ${COULEURS[domaine] || "gris"}"><ha-icon icon="${ICONES[domaine] || "mdi:shape"}"></ha-icon></span>`;
  }

  // ---- onglet Règles

  _regles() {
    const d = this._d;
    const toutes = d.regles || [];
    const liste = toutes.filter((r) => r.evenement === this._evenement);
    const nb = (ev) => toutes.filter((r) => r.evenement === ev).length;
    const ls = d.simulateur;
    const utiliseLs = toutes.some((r) => r.actif && (r.actions || []).some((a) => a.type === "simulateur"));
    const avert = [];
    if (!this._admin) avert.push(`<div class="bandeau">${this.t("lecture_seule")}</div>`);
    if (!d.instantane.actif) avert.push(`<div class="bandeau orange">${this.t("protocole_pause")}</div>`);
    if (utiliseLs && ls.double_pilotage) avert.push(`<div class="bandeau orange">${this.t("ls_double")}</div>`);
    if (utiliseLs && ls.statut !== "pret") avert.push(`<div class="bandeau orange">${this.t("err.simulateur_absent")}</div>`);
    const cartes = liste.map((r) => this._carteRegle(r)).join("") || `<div class="carte vide">${this.t("aucune_regle")}</div>`;
    return `
      ${avert.join("")}
      <div class="seg" role="tablist">
        ${["armement", "desarmement"].map((ev) => `<button type="button" role="tab" aria-selected="${ev === this._evenement}" class="${ev === this._evenement ? "on" : ""}" data-a="evenement" data-v="${ev}">
          <ha-icon icon="${ICONE_EVENEMENT[ev]}"></ha-icon>${this.t(ev)} (${nb(ev)})</button>`).join("")}
      </div>
      <div class="pile">${cartes}</div>
      ${this._admin ? `<div class="boutons-bas">
        <button type="button" class="btn primaire grand" data-a="nouvelle"><ha-icon icon="mdi:plus"></ha-icon>${this.t("ajouter_regle")}</button>
        <button type="button" class="btn grand" data-a="modeles"><ha-icon icon="mdi:view-grid-outline"></ha-icon>${this.t("partir_modele")}</button>
      </div>` : ""}`;
  }

  _carteRegle(r) {
    const premiere = (r.actions || [])[0];
    const dom = r.avance ? "script" : premiere?.type === "entite" ? domaineDe(premiere.entity_id) : premiere?.type || "script";
    const verif = r.verification?.active ? `<div class="meta"><ha-icon icon="mdi:check-decagram-outline"></ha-icon>${this.t("verif_apres", { s: r.verification.delai_s })}</div>` : "";
    const delai = r.delai_s ? `<div class="meta"><ha-icon icon="mdi:timer-outline"></ha-icon>${this.t("delai_avant")} : ${r.delai_s} s</div>` : "";
    const confirmer = this._confirmer === r.id;
    return `
      <article class="carte regle ${r.actif ? "" : "eteinte"}">
        <div class="tete">
          ${this._pastilleIcone(dom)}
          <div class="noms"><div class="nom">${esc(r.nom)}</div><div class="sous">${esc(this._modesTexte(r))}</div></div>
          ${this._interrupteur(r.actif, `data-a="activer" data-id="${r.id}" data-v="${r.actif ? 1 : 0}"`, r.nom)}
        </div>
        <div class="phrase">${this._phrase(r)}</div>
        ${verif}${delai}
        ${this._admin ? `<div class="actions-carte">
          <button type="button" class="lien" data-a="tester" data-id="${r.id}"><ha-icon icon="mdi:play"></ha-icon>${this.t("tester")}</button>
          <button type="button" class="lien" data-a="modifier" data-id="${r.id}"><ha-icon icon="mdi:pencil"></ha-icon>${this.t("modifier")}</button>
          <span class="espace"></span>
          <button type="button" class="icone-btn bleu" data-a="dupliquer" data-id="${r.id}" aria-label="${this.t("dupliquer")}" title="${this.t("dupliquer")}"><ha-icon icon="mdi:content-copy"></ha-icon></button>
          ${confirmer
            ? `<button type="button" class="lien danger" data-a="supprimer" data-id="${r.id}"><ha-icon icon="mdi:delete-outline"></ha-icon>${this.t("confirmer")}</button>`
            : `<button type="button" class="icone-btn danger" data-a="supprimer" data-id="${r.id}" aria-label="${this.t("supprimer")}" title="${this.t("supprimer")}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>`}
        </div>` : ""}
      </article>`;
  }

  _modeles() {
    const liste = [["garage", "garage-variant"], ["volet", "window-shutter"], ["simu", "home-lightbulb"], ["simu_stop", "home-lightbulb-outline"], ["lumiere", "lightbulb-on"], ["notif", "bell-ring"]];
    return `
      <div class="entete-vue"><button type="button" class="icone-btn" data-a="onglet" data-v="regles" aria-label="${this.t("retour")}"><ha-icon icon="mdi:arrow-left"></ha-icon></button><h2>${this.t("modeles")}</h2></div>
      <p class="sous">${this.t("modeles_desc")}</p>
      <div class="grille-modeles">
        ${liste.map(([cle, icone]) => `<button type="button" class="carte modele" data-a="modele" data-v="${cle}">
          <span class="ic bleu"><ha-icon icon="mdi:${icone}"></ha-icon></span>
          <span><span class="nom">${this.t(`m_${cle}`)}</span><span class="sous">${this.t(`m_${cle}_d`)}</span></span></button>`).join("")}
      </div>`;
  }

  // ---- assistant

  _assistant() {
    const b = this._brouillon;
    const etapes = [["etape_quand", 1], ["etape_si", 2], ["etape_alors", 3]];
    const corps = { 1: () => this._etape1(), 2: () => this._etape2(), 3: () => this._etape3(), 4: () => this._etape4() }[this._etape]();
    return `
      <div class="assistant">
        <div class="entete-vue">
          <button type="button" class="icone-btn" data-a="fermer-assistant" aria-label="${this.t("annuler")}"><ha-icon icon="mdi:close"></ha-icon></button>
          <h2>${esc(b.nom || this.t("nouvelle_regle"))}</h2>
        </div>
        <ol class="progression">
          ${etapes.map(([cle, n]) => `<li class="${n < this._etape ? "fait" : n === this._etape ? "en-cours" : ""}"><span class="barre"></span>${n} · ${this.t(cle)}</li>`).join("")}
        </ol>
        <div class="corps">${corps}</div>
        <div class="pied">
          ${this._etape === 1
            ? `<button type="button" class="btn grand" data-a="fermer-assistant">${this.t("annuler")}</button>`
            : `<button type="button" class="btn grand" data-a="etape" data-v="${this._etape - 1}">${this.t("precedent")}</button>`}
          ${this._etape < 4
            ? `<button type="button" class="btn primaire grand" data-a="etape" data-v="${this._etape + 1}">${this.t("suivant")}</button>`
            : `<button type="button" class="btn primaire grand" data-a="enregistrer"><ha-icon icon="mdi:check"></ha-icon>${this.t("enregistrer")}</button>`}
        </div>
      </div>`;
  }

  _etape1() {
    const b = this._brouillon;
    const option = (ev, icone, couleur, titre, desc) => `
      <button type="button" class="option grande ${b.evenement === ev ? "on" : ""}" aria-pressed="${b.evenement === ev}" data-a="moment" data-v="${ev}">
        <span class="ic ${couleur}"><ha-icon icon="${icone}"></ha-icon></span>
        <span class="nom">${this.t(titre)}</span><span class="sous">${this.t(desc)}</span>
        <span class="coche"></span>
      </button>`;
    return `
      <label class="champ"><span>${this.t("nom_regle")}</span>
        <input type="text" data-f="nom" value="${esc(b.nom)}" maxlength="80"></label>
      <h3 class="titre-etape">${this.t("quand_titre")}</h3>
      <div class="deux">
        ${option("armement", "mdi:lock", "orange", "a_larmement", "quand_active")}
        ${option("desarmement", "mdi:lock-open-variant", "vert", "au_desarmement", "quand_coupe")}
      </div>
      <h4>${this.t("pour_modes")}</h4>
      <p class="sous">${this.t("aucun_coche")}</p>
      <div class="chips">
        ${ORDRE_MODES.filter((m) => (this._d.modes || ORDRE_MODES).includes(m)).map((m) => `<button type="button" class="chip ${b.modes.includes(m) ? "on" : ""}" aria-pressed="${b.modes.includes(m)}" data-a="mode" data-v="${m}">${b.modes.includes(m) ? '<ha-icon icon="mdi:check"></ha-icon>' : ""}${this._libelleMode(m)}</button>`).join("")}
      </div>`;
  }

  _boutonEntite(entityId, attrs, domaineIndice) {
    if (!entityId) {
      return `<button type="button" class="entite-btn vide" ${attrs}>${this._pastilleIcone(domaineIndice || "sensor")}
        <span class="noms"><span class="nom">${this.t("choisir_entite")}</span>${domaineIndice ? `<span class="sous">${esc(DOMAINES[this._langue][domaineIndice] || domaineIndice)}</span>` : ""}</span>
        <ha-icon icon="mdi:chevron-right"></ha-icon></button>`;
    }
    const s = this._hass.states[entityId];
    return `<button type="button" class="entite-btn" ${attrs}>${this._pastilleIcone(domaineDe(entityId))}
      <span class="noms"><span class="nom">${esc(this._nomEntite(entityId))}</span>
      <span class="sous">${esc(entityId)}${s ? ` · ${esc(this._etatLisible(entityId, s.state))}` : ""}</span></span>
      <ha-icon icon="mdi:chevron-right"></ha-icon></button>`;
  }

  _choixEtats(entityId, valeur, action, i, champLibre) {
    if (!entityId) return "";
    const etats = this._etatsPossibles(entityId);
    const chips = etats.map((e) => `<button type="button" class="chip ${e === valeur ? "on" : ""}" aria-pressed="${e === valeur}" data-a="${action}" data-i="${i}" data-v="${esc(e)}">${esc(this._etatLisible(entityId, e))}</button>`).join("");
    const libre = !etats.length || (valeur && !etats.includes(valeur))
      ? `<label class="champ court"><span>${this.t("autre_etat")}</span><input type="text" data-f="${champLibre}" data-i="${i}" value="${esc(valeur || "")}"></label>` : "";
    return `<div class="chips">${chips}</div>${libre}`;
  }

  _etape2() {
    const b = this._brouillon;
    const conds = b.conditions.map((c, i) => `
      <div class="carte bloc">
        <div class="tete-bloc"><span class="etiquette">${this.t("entite")}</span>
          ${b.conditions.length > 1 || true ? `<button type="button" class="icone-btn" data-a="retirer-condition" data-i="${i}" aria-label="${this.t("retirer")}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>` : ""}</div>
        ${this._boutonEntite(c.entity_id, `data-a="changer-condition" data-i="${i}"`, c._domaine)}
        ${c.entity_id ? `<span class="etiquette">${this.t("etat_attendu")}</span>${this._choixEtats(c.entity_id, c.etat, "etat-condition", i, "etat-libre")}<p class="sous">${this.t("etats_entite")}</p>` : ""}
      </div>`).join("");
    return `
      <h3 class="titre-etape">${this.t("si_titre")} <span class="sous">${this.t("facultatif")}</span></h3>
      <button type="button" class="option ${!this._siCond ? "on" : ""}" aria-pressed="${!this._siCond}" data-a="si" data-v="0"><span class="rond"></span>
        <span class="noms"><span class="nom">${this.t("toujours")}</span><span class="sous">${this.t("toujours_desc")}</span></span></button>
      <button type="button" class="option ${this._siCond ? "on" : ""}" aria-pressed="${this._siCond}" data-a="si" data-v="1"><span class="rond"></span>
        <span class="noms"><span class="nom">${this.t("seulement_si")}</span><span class="sous">${this.t("seulement_si_desc")}</span></span></button>
      ${this._siCond ? `${conds}<button type="button" class="btn pointille" data-a="ajouter-condition"><ha-icon icon="mdi:plus"></ha-icon>${this.t("ajouter_condition")}</button>` : ""}`;
  }

  _valeurParam(p, v) {
    if (p === "duree") return `${this._nombre(v ?? 1)} s`;
    if (p === "position" || p === "luminosite") return v ? `${v} %` : this.t("luminosite_inchangee");
    return String(v ?? "");
  }

  _params(action, i) {
    const s = this._hass.states[action.entity_id];
    const p = action.params || {};
    const curseur = (nom, min, max, pas, valeur, libelle) => `
      <div class="reglage">
        <div class="ligne"><label for="p-${i}-${nom}">${this.t(libelle)}</label><output id="val-${i}-${nom}">${this._valeurParam(nom, valeur)}</output></div>
        <input id="p-${i}-${nom}" type="range" min="${min}" max="${max}" step="${pas}" value="${valeur ?? min}" data-f="param" data-p="${nom}" data-i="${i}">
      </div>`;
    const liste = (nom, options, libelle, vide) => `
      <label class="champ"><span>${this.t(libelle)}</span><select data-f="param-select" data-p="${nom}" data-i="${i}">
        ${vide ? `<option value="">${this.t("luminosite_inchangee")}</option>` : ""}
        ${options.map((o) => `<option value="${esc(o)}" ${String(p[nom]) === String(o) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
    switch (action.action) {
      case "impulsion": return curseur("duree", 0.5, 10, 0.5, p.duree ?? 1, "duree_impulsion");
      case "position": return curseur("position", 0, 100, 5, p.position ?? 0, "position");
      case "allumer": return action.entity_id.startsWith("light.") ? curseur("luminosite", 0, 100, 5, p.luminosite ?? 0, "luminosite") : "";
      case "preset": return liste("preset", s?.attributes?.preset_modes || [], "preset");
      case "temperature": return `<label class="champ court"><span>${this.t("temperature")}</span><input type="number" min="5" max="35" step="0.5" value="${p.temperature ?? 17}" data-f="param" data-p="temperature" data-i="${i}"></label>`;
      case "choisir": return liste("option", s?.attributes?.options || [], "option");
      default: return "";
    }
  }

  _carteAction(a, i) {
    const tete = `<div class="tete-bloc"><span class="etiquette">${this.t("action_n", { n: i + 1 })}</span>
      <button type="button" class="icone-btn" data-a="retirer-action" data-i="${i}" aria-label="${this.t("retirer")}"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`;
    if (a.type === "simulateur") {
      const ls = this._d.simulateur;
      return `<div class="carte bloc">${tete}
        <button type="button" class="entite-btn" data-a="changer-action" data-i="${i}">${this._pastilleIcone("simulateur")}
          <span class="noms"><span class="nom">${this.t("simulateur")}</span><span class="sous">Lights Simulator · ${this.t(CLE_STATUT[ls.statut])}</span></span><ha-icon icon="mdi:chevron-right"></ha-icon></button>
        ${ls.statut !== "pret" ? this._carteLs(true) : ""}
        <div class="chips">${["demarrer", "auto", "arreter"].map((x) => `<button type="button" class="chip ${a.action === x ? "on" : ""}" aria-pressed="${a.action === x}" data-a="choix-action" data-i="${i}" data-v="${x}">${ACTIONS[this._langue][x]}</button>`).join("")}</div>
        ${ls.double_pilotage ? `<p class="avert">${this.t("ls_double")}</p>` : ""}
      </div>`;
    }
    if (a.type === "notification") {
      const services = this._d.notifications || [];
      return `<div class="carte bloc">${tete}
        <label class="champ"><span>${this.t("service_notif")}</span><select data-f="service" data-i="${i}">
          ${services.map((s) => `<option value="${esc(s)}" ${s === a.service ? "selected" : ""}>${esc(this._nomService(s))}</option>`).join("")}</select></label>
        <label class="champ"><span>${this.t("titre_notif")}</span><input type="text" data-f="titre" data-i="${i}" value="${esc(a.params.titre || "")}"></label>
        <label class="champ"><span>${this.t("message")}</span><textarea rows="2" data-f="message" data-i="${i}">${esc(a.params.message || "")}</textarea></label>
      </div>`;
    }
    const actions = Object.keys(this._d.catalogue[domaineDe(a.entity_id)] || {});
    const choix = a.entity_id
      ? `<div class="chips">${actions.map((x) => `<button type="button" class="chip ${a.action === x ? "on" : ""}" aria-pressed="${a.action === x}" data-a="choix-action" data-i="${i}" data-v="${x}">${esc(this._libelleAction({ ...a, action: x }))}</button>`).join("")}</div>${this._params(a, i)}`
      : "";
    return `<div class="carte bloc">${tete}${this._boutonEntite(a.entity_id, `data-a="changer-action" data-i="${i}"`, a._domaine)}${choix}</div>`;
  }

  _etape3() {
    const b = this._brouillon;
    const v = b.verification;
    if (b.avance) {
      return `
        <h3 class="titre-etape">${this.t("alors_titre")}</h3>
        <div class="carte bloc">
          <span class="etiquette">${this.t("avance_titre")}</span>
          <textarea class="code" rows="14" spellcheck="false" data-f="yaml" aria-label="${this.t("avance_titre")}">${esc(this._yaml)}</textarea>
          <p class="sous">${esc(this.t("avance_note"))}</p>
          <button type="button" class="lien" data-a="simple"><ha-icon icon="mdi:undo"></ha-icon>${this.t("mode_simple")}</button>
          <p class="sous">${this.t("mode_simple_note")}</p>
        </div>
        ${this._carteDelai()}`;
    }
    const services = this._d.notifications || [];
    const verif = `
      <div class="carte bloc">
        <div class="tete"><span class="ic vert"><ha-icon icon="mdi:check-decagram-outline"></ha-icon></span>
          <span class="noms"><span class="nom">${this.t("verifier_resultat")}</span></span>
          ${this._interrupteur(v.active, `data-a="verif"`, this.t("verifier_resultat"))}</div>
        ${v.active ? `
          <div class="phrase-verif">
            <label class="champ court"><span>${this.t("apres")} (s)</span><input type="number" min="0" max="3600" value="${v.delai_s}" data-f="verif-delai"></label>
            ${this._boutonEntite(v.entity_id, `data-a="verif-entite"`)}
            ${v.entity_id ? `<span class="etiquette">${this.t("doit_etre")}</span>${this._choixEtats(v.entity_id, v.etat, "verif-etat", 0, "verif-etat-libre")}` : ""}
            <label class="champ"><span>${this.t("sinon_prevenir")}</span><select data-f="verif-notifier">
              <option value="" ${!v.notifier ? "selected" : ""}>${this.t("personne")}</option>
              ${services.map((s) => `<option value="${esc(s)}" ${s === v.notifier ? "selected" : ""}>${esc(this._nomService(s))}</option>`).join("")}</select></label>
          </div>
          <p class="sous">${this.t("verif_note")}</p>` : ""}
      </div>`;
    return `
      <h3 class="titre-etape">${this.t("alors_titre")}</h3>
      ${b.actions.map((a, i) => this._carteAction(a, i)).join("")}
      <button type="button" class="btn pointille" data-a="ajouter-action"><ha-icon icon="mdi:plus"></ha-icon>${this.t("ajouter_action")}</button>
      ${verif}
      ${this._carteDelai()}`;
  }

  _carteDelai() {
    const b = this._brouillon;
    return `<div class="carte ligne-delai"><ha-icon icon="mdi:timer-outline"></ha-icon><span class="nom">${this.t("delai_avant")}</span>
      <button type="button" class="icone-btn" data-a="delai" data-v="-10" aria-label="-10 s">−</button>
      <span class="valeur">${b.delai_s || 0} s</span>
      <button type="button" class="icone-btn" data-a="delai" data-v="10" aria-label="+10 s">+</button></div>`;
  }

  _etape4() {
    const b = this._brouillon;
    const v = b.verification;
    const premiere = b.actions[0];
    const dom = b.avance ? "script" : premiere?.type === "entite" ? domaineDe(premiere.entity_id) : premiere?.type;
    const ligne = (cle, texte) => `<div class="recap-ligne"><span class="etiquette">${cle}</span><span>${texte}</span></div>`;
    const actions = b.avance
      ? this.t("script_avance", { n: (b.sequence || []).length })
      : b.actions.map((a) => `<b>${esc(this._libelleAction(a))}</b> ${a.type === "entite" ? esc(this._cible(a)) : this._cible(a)}${this._detailParams(a)}`).join("<br>");
    const conds = this._siCond && b.conditions.length
      ? b.conditions.map((c) => `<b>${esc(this._nomEntite(c.entity_id))}</b> ${this.t("est")} <i>${esc(this._etatLisible(c.entity_id, c.etat))}</i>`).join(`<br>${this.t("et")} `)
      : this.t("toujours");
    return `
      <div class="carte recap">
        <div class="tete">${this._pastilleIcone(dom || "script")}<span class="nom grand">${esc(b.nom)}</span></div>
        ${ligne(this.t("etape_quand").toUpperCase(), `${this.t(b.evenement === "armement" ? "a_larmement" : "au_desarmement")} · <b>${esc(this._modesTexte(b))}</b>`)}
        ${ligne(this.t("etape_si").toUpperCase(), conds)}
        ${ligne(this.t("etape_alors").toUpperCase(), actions + (b.delai_s ? `<br><span class="sous">${this.t("delai_avant")} : ${b.delai_s} s</span>` : ""))}
        ${v.active ? ligne(this.t("verifier_resultat").split(" ")[0].toUpperCase(), `${this.t("apres")} ${v.delai_s} s, <b>${esc(this._nomEntite(v.entity_id))}</b> ${this.t("doit_etre")} <i>${esc(this._etatLisible(v.entity_id, v.etat))}</i>${v.notifier ? `, ${this.t("sinon_prevenir")} ${esc(this._nomService(v.notifier))}` : ""}`) : ""}
      </div>
      <button type="button" class="btn grand contour" data-a="tester-brouillon"><ha-icon icon="mdi:play"></ha-icon>${this.t("tester_maintenant")}</button>
      <p class="sous centre">${this.t("tester_note")}</p>
      ${b.avance ? "" : `<button type="button" class="lien centre" data-a="avance"><ha-icon icon="mdi:code-braces"></ha-icon>${this.t("mode_avance")}</button>`}`;
  }

  // ---- sélecteur d'entité (feuille)

  _carteLs(compacte = false) {
    const ls = this._d.simulateur;
    if (ls.statut === "pret") return "";
    const bouton = ls.statut === "absent"
      ? `<a class="btn primaire grand" href="${esc(ls.hacs ? ls.lien_hacs : ls.lien_depot)}" target="_blank" rel="noopener"><ha-icon icon="mdi:download"></ha-icon>${this.t(ls.hacs ? "ls_installer" : "ls_sans_hacs")}</a>`
      : `<a class="btn primaire grand" href="${esc(ls.lien_config)}" target="_blank" rel="noopener"><ha-icon icon="mdi:cog"></ha-icon>${this.t("ls_configurer")}</a>`;
    const note = ls.statut === "absent" ? this.t("ls_installer_note") : this.t("ls_configurer_note");
    return `<div class="carte ls ${compacte ? "compacte" : ""}">
      ${compacte ? "" : `<div class="tete">${this._pastilleIcone("simulateur")}<span class="noms"><span class="nom">${this.t("simulateur")}</span>
        <span class="badge">${this.t(CLE_STATUT[ls.statut])}</span></span></div><p>${this.t("ls_desc")}</p>`}
      ${bouton}
      <p class="sous"><ha-icon icon="mdi:information-outline"></ha-icon> ${note}</p></div>`;
  }

  _lignesEntites() {
    const entites = this._entitesFiltrees();
    if (!entites.length) return `<p class="sous centre">${this.t("aucune_entite")}</p>`;
    return entites.map((s) => `
      <button type="button" class="ligne-entite" data-a="choisir" data-v="${esc(s.entity_id)}">
        ${this._pastilleIcone(domaineDe(s.entity_id))}
        <span class="noms"><span class="nom">${esc(s.attributes.friendly_name || s.entity_id)}</span>
        <span class="sous">${esc(s.entity_id)} · ${esc(this._etatLisible(s.entity_id, s.state))}</span></span></button>`).join("");
  }

  _selecteurHtml() {
    const sel = this._selecteur;
    const action = sel.cible === "action";
    const catalogue = this._d.catalogue || {};
    const presents = new Set(Object.keys(this._hass.states).map(domaineDe));
    const domaines = (action ? Object.keys(catalogue) : ["binary_sensor", "cover", "lock", "light", "switch", "person", "climate", "sensor"]).filter((d) => presents.has(d));
    const ls = this._d.simulateur;
    const speciaux = action && sel.index === null || (action && ["simulateur", "notification"].includes(this._brouillon.actions[sel.index]?.type))
      ? `
        ${ls.statut === "pret"
          ? `<button type="button" class="ligne-entite speciale" data-a="choisir" data-v="@simulateur">${this._pastilleIcone("simulateur")}<span class="noms"><span class="nom">${this.t("simulateur")}</span><span class="sous">Lights Simulator · ${esc(ls.entite)}</span></span></button>`
          : this._carteLs()}
        <button type="button" class="ligne-entite speciale" data-a="choisir" data-v="@notification">${this._pastilleIcone("notification")}<span class="noms"><span class="nom">${this.t("notification")}</span><span class="sous">${this.t("notification_desc")}</span></span></button>`
      : "";
    return `
      <div class="voile" role="dialog" aria-modal="true" aria-label="${this.t(action ? "que_piloter" : "quelle_entite")}">
        <div class="feuille">
          <div class="entete-vue">
            <button type="button" class="icone-btn" data-a="fermer-selecteur" aria-label="${this.t("annuler")}"><ha-icon icon="mdi:close"></ha-icon></button>
            <h2>${this.t(action ? "que_piloter" : "quelle_entite")}</h2>
          </div>
          <label class="recherche"><ha-icon icon="mdi:magnify"></ha-icon>
            <input id="recherche" type="search" placeholder="${this.t("rechercher")}" aria-label="${this.t("rechercher")}" data-f="recherche" value="${esc(sel.recherche)}"></label>
          <div class="chips defile-h">${domaines.map((d) => `<button type="button" class="chip petit ${sel.domaine === d ? "on" : ""}" aria-pressed="${sel.domaine === d}" data-a="domaine-filtre" data-v="${d}">${esc(DOMAINES[this._langue][d] || d)}</button>`).join("")}</div>
          <div class="defile-v">
            ${speciaux}
            <div id="liste-entites">${this._lignesEntites()}</div>
          </div>
        </div>
      </div>`;
  }

  // ---- autres onglets

  _entites() {
    const lignes = (this._d.entites || []).map((e) => `<li class="entree">
      <div class="ligne-j"><button type="button" class="lien sans-marge" data-a="plus-info" data-id="${esc(e.entity_id)}">${esc(e.nom)}</button>
        <span class="valeur-etat">${esc(this._etatAffiche(e))}</span></div>
      <div class="sous">${esc(e.entity_id)}</div></li>`).join("");
    return `<div class="carte">
      <h2>${this.t("entites_titre")}</h2><p class="sous">${this.t("entites_desc")}</p>
      <ul class="journal">${lignes}</ul></div>`;
  }
  _etatAffiche(e) {
    const s = this._hass.states[e.entity_id];
    if (!s) return e.etat ?? "—";
    if (s.attributes.device_class === "timestamp" && s.state && !["unknown", "unavailable"].includes(s.state)) {
      try { return new Date(s.state).toLocaleString(this._langue === "fr" ? "fr-FR" : "en-GB", { dateStyle: "short", timeStyle: "short" }); } catch (err) { return s.state; }
    }
    return this._etatLisible(e.entity_id, s.state);
  }

  _journal() {
    const j = this._d.journal || [];
    const date = (iso) => { try { return new Date(iso).toLocaleString(this._langue === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch (e) { return iso; } };
    const classe = { ok: "vert", verif_ok: "vert", condition: "gris", pause: "gris", annulee: "gris", erreur: "rouge", verif_echec: "rouge" };
    const detail = (x) => {
      if (!x) return "";
      const m = /^([a-z_]+\.[\w]+) = (.*)$/.exec(x);
      if (m) return `${this._nomEntite(m[1])}${this._langue === "fr" ? " : " : ": "}${this._etatLisible(m[1], m[2])}`;
      const code = x.split(":")[0];
      return TEXTES[this._langue][`err.${code}`] ? this.t(`err.${code}`) : x;
    };
    const lignes = j.map((x) => `<li class="entree">
      <div class="ligne-j"><span class="nom">${esc(x.regle || "—")}</span><span class="tag ${classe[x.resultat] || "gris"}">${esc(this.t(`res_${x.resultat}`))}</span></div>
      <div class="sous"><ha-icon class="petite" icon="${ICONE_EVENEMENT[x.evenement] || "mdi:help"}"></ha-icon> ${esc(this.t(x.evenement))} · ${esc(date(x.date))}</div>
      ${x.detail ? `<div class="sous detail">${esc(detail(x.detail))}</div>` : ""}</li>`).join("");
    return `<div class="carte">
      <div class="entete-carte"><h2>${this.t("onglet_journal")}</h2>
        ${this._admin && j.length ? `<button type="button" class="btn" data-a="vider-journal">${this.t("vider_journal")}</button>` : ""}</div>
      ${j.length ? `<ul class="journal">${lignes}</ul>` : `<p class="sous">${this.t("journal_vide")}</p>`}</div>`;
  }

  _reglages() {
    const d = this._d;
    const inst = d.instantane;
    const ls = d.simulateur;
    return `<div class="grille">
      <div class="carte">
        <h2>${this.t("reglages_alarme")}</h2>
        <div class="tete">${this._pastilleIcone("alarm_control_panel")}<span class="noms"><span class="nom">${esc(this._nomEntite(inst.alarme))}</span>
          <span class="sous">${esc(inst.alarme || "—")} · ${esc(inst.etat_alarme ? this._etatLisible(inst.alarme, inst.etat_alarme) : this.t("alarme_absente"))}</span></span></div>
        <div class="ligne-reglage"><span>${this.t("protocole_actif")}</span>${this._interrupteur(inst.actif, `data-a="actif"`, this.t("protocole_actif"))}</div>
        ${this._admin ? `<a class="lien" href="/config/integrations/integration/${DOMAINE}"><ha-icon icon="mdi:cog"></ha-icon>${this.t("changer_alarme")}</a>` : ""}
      </div>
      ${ls.statut !== "pret" ? this._carteLs() : `<div class="carte">
        <h2>${this.t("reglages_ls")}</h2>
        ${ls.statut === "pret"
          ? `<div class="tete">${this._pastilleIcone("simulateur")}<span class="noms"><span class="nom">Lights Simulator</span><span class="sous">${this.t("ls_entite")} : ${esc(ls.entite)}</span></span><span class="badge vert">${this.t("pret")}</span></div>
             ${ls.double_pilotage ? `<p class="avert">${this.t("ls_double")}</p>` : ""}`
          : ""}
      </div>`}
      <div class="carte"><h2>${this.t("version")}</h2><p class="sous">Protocole Alarme ${esc(d.version)}</p></div>
    </div>`;
  }
}

const STYLE = `
  :host { display: block; min-height: 100vh; background: var(--primary-background-color, #f4f5f7); color: var(--primary-text-color, #1c1c1e);
    font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif); --bleu: var(--primary-color, #0b6bcb); --carte: var(--card-background-color, #fff);
    --trait: var(--divider-color, #e3e6ea); --gris: var(--secondary-text-color, #5f6368); }
  * { box-sizing: border-box; }
  ha-icon { --mdc-icon-size: 20px; }
  header { background: var(--app-header-background-color, var(--bleu)); color: var(--app-header-text-color, #fff); padding: 8px 16px 0; }
  .ligne-titre { display: flex; align-items: center; gap: 10px; min-height: 52px; max-width: 980px; margin: 0 auto; }
  .ligne-titre .logo { --mdc-icon-size: 26px; }
  h1 { margin: 0; font-size: 21px; font-weight: 500; flex: 1; }
  .pastille { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,.18); border-radius: 999px; padding: 6px 12px; font-size: 13px; font-weight: 500; white-space: nowrap; }
  .pastille .point { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .pastille.armee { background: #fff1e0; color: #8a4204; } .pastille.alerte { background: #fde7e9; color: #9b1c1c; }
  nav { display: flex; gap: 2px; overflow-x: auto; max-width: 980px; margin: 4px auto 0; }
  .onglet { border: 0; background: none; padding: 12px 14px; font: inherit; font-size: 14px; font-weight: 500; color: inherit; opacity: .8; border-bottom: 3px solid transparent; cursor: pointer; min-height: 48px; white-space: nowrap; }
  .onglet.on { opacity: 1; border-bottom-color: currentColor; }
  main { max-width: 980px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .message { max-width: 948px; margin: 12px auto 0; padding: 10px 16px; border-radius: 10px; background: #e3f0fb; color: #0b4f96; font-size: 14px; }
  .message.erreur { background: #fde7e9; color: #9b1c1c; }
  .bandeau { padding: 10px 14px; border-radius: 10px; background: #e3f0fb; color: #0b4f96; font-size: 14px; }
  .bandeau.orange, .avert { background: #fff1e0; color: #7a3a04; } .avert { padding: 10px 12px; border-radius: 10px; font-size: 13px; margin: 8px 0 0; }
  .carte { background: var(--carte); border-radius: var(--ha-card-border-radius, 14px); border: 1px solid var(--trait); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .carte.vide { color: var(--gris); text-align: center; padding: 28px 16px; }
  .pile { display: flex; flex-direction: column; gap: 12px; }
  .grille { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 12px; align-items: start; }
  h2 { margin: 0; font-size: 18px; font-weight: 500; } h3.titre-etape { margin: 4px 0 0; font-size: 20px; font-weight: 700; } h4 { margin: 8px 0 0; font-size: 16px; font-weight: 500; }
  .sous { color: var(--gris); font-size: 13px; margin: 0; } .centre { text-align: center; justify-content: center; }
  .seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; background: var(--secondary-background-color, #e8eaed); border-radius: 12px; padding: 4px; }
  .seg button { min-height: 44px; border: 0; border-radius: 9px; background: transparent; color: inherit; font: inherit; font-size: 14px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; }
  .seg button.on { background: var(--carte); color: var(--bleu); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
  .tete { display: flex; align-items: center; gap: 12px; } .noms { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; text-align: left; }
  .nom { font-size: 16px; font-weight: 500; } .nom.grand { font-size: 19px; font-weight: 700; }
  .ic { width: 40px; height: 40px; flex: none; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; }
  .ic.gris { background: #eef0f3; color: #3c4043; } .ic.bleu { background: #e6f0fb; color: #0b4f96; } .ic.jaune { background: #fff6d6; color: #7a5a00; }
  .ic.orange { background: #fff1e0; color: #9a4a06; } .ic.vert { background: #e3f4ea; color: #1d6b3a; } .ic.violet { background: #f3e8fb; color: #6b2e9a; }
  .regle.eteinte { opacity: .62; }
  .phrase { font-size: 14px; line-height: 1.5; background: var(--secondary-background-color, #f4f5f7); border-radius: 10px; padding: 10px 12px; }
  .meta { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--gris); } .meta ha-icon { --mdc-icon-size: 16px; }
  .actions-carte { display: flex; flex-wrap: wrap; gap: 4px; border-top: 1px solid var(--trait); padding-top: 4px; }
  .lien { min-height: 44px; border: 0; background: transparent; color: var(--bleu); font: inherit; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; cursor: pointer; text-decoration: none; }
  .lien ha-icon { --mdc-icon-size: 18px; } .lien.danger, .icone-btn.danger { color: var(--error-color, #b3261e); } .icone-btn.bleu { color: var(--bleu); } .espace { flex: 1; } .lien.sans-marge { padding: 0; min-height: 0; text-align: left; }
  .sw { width: 48px; height: 44px; border: 0; background: transparent; padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; flex: none; }
  .sw span { width: 44px; height: 26px; border-radius: 13px; background: #b9bec6; position: relative; display: block; }
  .sw span::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left .15s; }
  .sw.on span { background: var(--bleu); } .sw.on span::after { left: 21px; } .sw:disabled { cursor: default; opacity: .6; }
  .btn { min-height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid #c9ced6; background: var(--carte); color: var(--primary-text-color, #1c1c1e); font: inherit; font-size: 15px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; text-decoration: none; }
  .btn.grand { min-height: 50px; width: 100%; } .btn.primaire { background: var(--bleu); border-color: var(--bleu); color: #fff; }
  .btn.contour { border-color: var(--bleu); color: var(--bleu); } .btn.pointille { border: 1px dashed #9aa3ae; background: transparent; color: var(--bleu); min-height: 48px; }
  .boutons-bas { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 10px; }
  .icone-btn { width: 44px; height: 44px; border: 0; background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center; border-radius: 22px; cursor: pointer; font-size: 20px; flex: none; }
  .entete-vue { display: flex; align-items: center; gap: 4px; } .entete-vue h2 { flex: 1; }
  .grille-modeles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 10px; }
  .modele { flex-direction: row; align-items: center; text-align: left; cursor: pointer; font: inherit; color: inherit; min-height: 72px; }
  .modele > span:last-child { display: flex; flex-direction: column; gap: 2px; }
  .assistant { display: flex; flex-direction: column; gap: 14px; max-width: 620px; width: 100%; margin: 0 auto; }
  .progression { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .progression li { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--gris); }
  .progression .barre { height: 4px; border-radius: 2px; background: #d6dae0; } .progression .fait .barre, .progression .en-cours .barre { background: var(--bleu); }
  .progression .en-cours { color: var(--bleu); font-weight: 700; }
  .corps { display: flex; flex-direction: column; gap: 12px; }
  .pied { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; position: sticky; bottom: 0; padding: 12px 0; background: var(--primary-background-color, #f4f5f7); }
  .champ { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 500; color: var(--gris); }
  .champ.court { max-width: 200px; }
  input[type=text], input[type=number], input[type=search], select, textarea { min-height: 48px; border: 1px solid #c9ced6; border-radius: 12px; padding: 0 14px; font: inherit; font-size: 16px; background: var(--carte); color: var(--primary-text-color, #1c1c1e); width: 100%; }
  textarea { padding: 10px 14px; resize: vertical; } textarea.code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; line-height: 1.45; }
  .deux { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .option { position: relative; display: flex; align-items: center; gap: 12px; text-align: left; width: 100%; padding: 14px; border-radius: 14px; border: 1px solid #d6dae0; background: var(--carte); color: inherit; font: inherit; cursor: pointer; }
  .option.on { border: 2px solid var(--bleu); background: color-mix(in srgb, var(--bleu) 9%, var(--carte)); padding: 13px; }
  .option.grande { flex-direction: column; align-items: flex-start; gap: 8px; min-height: 150px; padding: 16px 14px; } .option.grande.on { padding: 15px 13px; }
  .option .coche { position: absolute; top: 14px; right: 14px; width: 20px; height: 20px; border-radius: 50%; border: 2px solid #9aa3ae; }
  .option.on .coche { border: 6px solid var(--bleu); }
  .option .rond { width: 20px; height: 20px; flex: none; border-radius: 50%; border: 2px solid #9aa3ae; } .option.on .rond { border: 6px solid var(--bleu); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid #d6dae0; background: var(--carte); color: inherit; font: inherit; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .chip ha-icon { --mdc-icon-size: 16px; } .chip.on { border: 2px solid var(--bleu); background: color-mix(in srgb, var(--bleu) 9%, var(--carte)); color: var(--bleu); padding: 0 15px; }
  .chip.petit { min-height: 36px; font-size: 13px; padding: 0 12px; } .chip.petit.on { padding: 0 11px; }
  .carte.bloc { gap: 12px; } .tete-bloc { display: flex; align-items: center; justify-content: space-between; margin: -6px -6px -4px 0; }
  .etiquette { font-size: 12px; font-weight: 700; color: var(--gris); letter-spacing: .04em; text-transform: uppercase; }
  .entite-btn { min-height: 60px; border: 1px solid #c9ced6; border-radius: 12px; background: var(--carte); padding: 8px 12px; display: flex; align-items: center; gap: 12px; color: inherit; font: inherit; cursor: pointer; width: 100%; }
  .entite-btn .ic { width: 36px; height: 36px; border-radius: 10px; } .entite-btn.vide { border-style: dashed; color: var(--bleu); }
  .reglage { background: var(--secondary-background-color, #f4f5f7); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
  .reglage .ligne { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; font-weight: 500; }
  .reglage output { font-weight: 700; color: var(--bleu); } input[type=range] { width: 100%; height: 32px; accent-color: var(--bleu); margin: 0; }
  .phrase-verif { display: flex; flex-direction: column; gap: 10px; }
  .ligne-delai { flex-direction: row; align-items: center; gap: 10px; padding: 6px 12px 6px 16px; } .ligne-delai .nom { flex: 1; font-size: 15px; font-weight: 400; }
  .ligne-delai .valeur { min-width: 52px; text-align: center; font-weight: 500; } .ligne-delai .icone-btn { color: var(--bleu); font-size: 22px; }
  .recap-ligne { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 10px; align-items: baseline; font-size: 15px; line-height: 1.5; padding-top: 12px; border-top: 1px solid var(--trait); }
  .voile { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; justify-content: center; align-items: flex-end; z-index: 10; }
  @media (min-width: 700px) { .voile { align-items: center; } .feuille { border-radius: 18px !important; } }
  .feuille { width: min(620px, 100%); max-height: 92vh; background: var(--primary-background-color, #f4f5f7); border-radius: 18px 18px 0 0; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
  .recherche { display: flex; align-items: center; gap: 8px; border: 1px solid #c9ced6; border-radius: 12px; padding: 0 12px; background: var(--carte); }
  .recherche input { border: 0; padding: 0; min-height: 46px; } .recherche input:focus { outline: none; }
  .defile-h { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; } .defile-v { overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  #liste-entites { display: flex; flex-direction: column; background: var(--carte); border-radius: 14px; border: 1px solid var(--trait); }
  .ligne-entite { min-height: 60px; border: 0; border-bottom: 1px solid var(--trait); background: transparent; padding: 8px 14px; display: flex; align-items: center; gap: 12px; color: inherit; font: inherit; cursor: pointer; width: 100%; text-align: left; }
  .ligne-entite .ic { width: 36px; height: 36px; border-radius: 10px; } .ligne-entite.speciale { background: var(--carte); border: 1px solid var(--trait); border-radius: 14px; }
  .ls { border: 2px solid #e0a23a; } .ls.compacte { border: 0; padding: 0; } .ls p { margin: 0; font-size: 14px; line-height: 1.5; }
  .badge { align-self: flex-start; font-size: 12px; font-weight: 700; color: #7a4b00; background: #fff1d6; border-radius: 999px; padding: 3px 10px; }
  .badge.vert { color: #1d6b3a; background: #e3f4ea; align-self: center; }
  .ls .sous { display: flex; gap: 6px; align-items: flex-start; } .ls .sous ha-icon { --mdc-icon-size: 16px; flex: none; }
  .entete-carte { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  .defile { overflow-x: auto; } table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th { text-align: left; font-weight: 500; color: var(--gris); font-size: 13px; padding: 10px 8px; border-bottom: 1px solid var(--trait); }
  td { padding: 10px 8px; border-bottom: 1px solid var(--trait); vertical-align: top; } .nowrap { white-space: nowrap; }
  .ent { display: block; font-size: 12px; color: var(--gris); margin-top: 2px; } ha-icon.petite { --mdc-icon-size: 16px; color: var(--gris); }
  .tag { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .tag.vert { background: #e3f4ea; color: #1d6b3a; } .tag.rouge { background: #fde7e9; color: #9b1c1c; } .tag.gris { background: #eef0f3; color: #3c4043; }
  .journal { list-style: none; margin: 0; padding: 0; } .entree { padding: 10px 0; border-top: 1px solid var(--trait); display: flex; flex-direction: column; gap: 4px; }
  .ligne-j { display: flex; justify-content: space-between; align-items: center; gap: 10px; } .ligne-j .nom { font-size: 15px; } .detail { font-style: italic; } .valeur-etat { font-size: 14px; white-space: nowrap; }
  .sous ha-icon.petite { vertical-align: -3px; }
  .ligne-reglage { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 15px; border-top: 1px solid var(--trait); padding-top: 6px; }
  @media (max-width: 420px) { .deux { gap: 8px; } .recap-ligne { grid-template-columns: 76px minmax(0, 1fr); } }
`;

customElements.define("protocole-alarme-panel", ProtocoleAlarmePanel);
