(function () {
  'use strict';

  const CFG = window.APE_CONFIG || {};
  const CLE_BROUILLON = 'ape-enquete-brouillon-v1';
  const CLE_ENVOYE = 'ape-enquete-envoye-v1';
  const racine = document.getElementById('app');

  const etat = {
    cfg: null,
    etape: 0,            // 0 = classes des enfants, 1..N = un thème par page
    enfants: [''],
    reponses: {},        // id action -> choix
    propositions: {},    // id thème -> texte
    id: nouvelId(),
    erreur: '',
    manquants: [],       // ids (actions) ou indices d'enfants à signaler
    envoi: false,
    fini: false,
    dejaEnvoye: false
  };

  // ------------------------------------------------------------------ utilitaires

  function nouvelId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  const PROPS_DOM = ['checked', 'selected', 'value', 'disabled'];
  function h(tag, attrs, ...enfants) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (PROPS_DOM.includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    enfants.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c); });
    return el;
  }

  function stockage(action, cle, valeur) {
    try {
      if (action === 'get') return localStorage.getItem(cle);
      if (action === 'set') localStorage.setItem(cle, valeur);
      if (action === 'del') localStorage.removeItem(cle);
    } catch (_) { /* stockage indisponible (navigation privée…) : on continue sans */ }
    return null;
  }

  function urlApi() {
    // Surcharge ?api=… uniquement en local, pour tester sans toucher au vrai Google Sheet.
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const surcharge = new URLSearchParams(location.search).get('api');
    return local && surcharge ? surcharge : CFG.API_URL;
  }

  // ------------------------------------------------------------------ brouillon

  function sauver() {
    stockage('set', CLE_BROUILLON, JSON.stringify({
      id: etat.id, etape: etat.etape, enfants: etat.enfants,
      reponses: etat.reponses, propositions: etat.propositions
    }));
  }

  function restaurer() {
    etat.dejaEnvoye = stockage('get', CLE_ENVOYE) === '1';
    const brut = stockage('get', CLE_BROUILLON);
    if (!brut) return;
    try {
      const b = JSON.parse(brut);
      const idsActions = new Set(etat.cfg.themes.flatMap((t) => t.actions.map((a) => a.id)));
      const classes = new Set(etat.cfg.classes.map((c) => c.classe));
      if (typeof b.id === 'string') etat.id = b.id;
      if (Array.isArray(b.enfants) && b.enfants.length >= 1 && b.enfants.length <= etat.cfg.maxEnfants) {
        etat.enfants = b.enfants.map((c) => (classes.has(c) ? c : ''));
      }
      for (const [k, v] of Object.entries(b.reponses || {})) {
        if (idsActions.has(k) && etat.cfg.choix.includes(v)) etat.reponses[k] = v;
      }
      for (const [k, v] of Object.entries(b.propositions || {})) {
        if (typeof v === 'string') etat.propositions[k] = v;
      }
      if (Number.isInteger(b.etape)) etat.etape = Math.min(Math.max(b.etape, 0), etat.cfg.themes.length);
    } catch (_) { /* brouillon illisible : on repart de zéro */ }
  }

  // ------------------------------------------------------------------ chargement

  async function charger() {
    const url = urlApi();
    if (!url || url.includes('REMPLACER')) {
      racine.replaceChildren(h('p', { class: 'message erreur' },
        "Ce formulaire n'est pas encore relié à sa base de données (voir config.js)."));
      return;
    }
    racine.replaceChildren(h('p', { class: 'chargement' }, 'Chargement du questionnaire…'));
    try {
      const rep = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=config');
      const data = await rep.json();
      if (!data.ok) throw new Error(data.erreur || 'Réponse invalide');
      etat.cfg = data;
      restaurer();
      render();
    } catch (_) {
      racine.replaceChildren(
        h('p', { class: 'message erreur', role: 'alert' }, 'Impossible de charger le questionnaire pour le moment.'),
        h('button', { type: 'button', onclick: charger }, 'Réessayer')
      );
    }
  }

  // ------------------------------------------------------------------ rendu

  function render() {
    racine.replaceChildren();
    if (etat.fini) { racine.append(vueMerci()); return; }
    const total = etat.cfg.themes.length + 1;
    racine.append(vueProgression(total));
    if (etat.erreur) {
      racine.append(h('p', { class: 'message erreur', role: 'alert', id: 'msg-erreur' }, etat.erreur));
    }
    racine.append(etat.etape === 0 ? vueEnfants() : vueTheme(etat.cfg.themes[etat.etape - 1]));
    racine.append(vueNavigation(total));
  }

  function aller(n) {
    etat.etape = n;
    etat.erreur = '';
    etat.manquants = [];
    sauver();
    render();
    window.scrollTo(0, 0);
    racine.focus({ preventScroll: true });
  }

  function vueProgression(total) {
    const pct = Math.round((etat.etape / total) * 100);
    return h('div', { class: 'progression' },
      h('div', { class: 'progression-texte' },
        h('span', {}, `Page ${etat.etape + 1} sur ${total}`),
        h('span', {}, etat.etape === 0 ? 'Votre situation' : `Thème ${etat.etape} sur ${total - 1}`)),
      h('div', { class: 'barre', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
        h('span', { style: `width:${pct}%` })));
  }

  // --- Page 1 : classes des enfants

  function vueEnfants() {
    const c = etat.cfg;
    const niveaux = [...new Set(c.classes.map((x) => x.niveau))].sort((a, b) => b - a);
    const plusieurs = etat.enfants.length > 1;

    const lignes = etat.enfants.map((val, i) => {
      const sel = h('select', {
        id: 'enfant-' + i,
        onchange: (e) => {
          etat.enfants[i] = e.target.value;
          e.target.closest('.enfant').classList.remove('manquant');
          sauver();
        }
      },
        h('option', { value: '' }, 'Choisir la classe…'),
        niveaux.map((n) => h('optgroup', { label: n + 'e' },
          c.classes.filter((x) => x.niveau === n).map((x) => h('option', { value: x.classe }, x.classe)))));
      sel.value = val;
      return h('div', { class: 'enfant' + (etat.manquants.includes(i) ? ' manquant' : '') },
        h('div', {},
          h('label', { class: 'champ', for: 'enfant-' + i }, plusieurs ? `Classe de l'enfant ${i + 1}` : 'Classe de votre enfant'),
          sel),
        i > 0 ? h('button', { type: 'button', class: 'secondaire', onclick: () => {
          etat.enfants.splice(i, 1); etat.manquants = []; etat.erreur = ''; sauver(); render();
        } }, 'Retirer') : null);
    });

    return h('section', {},
      h('h2', {}, 'Avant de commencer'),
      h('p', { class: 'aide' },
        "Cette enquête recueille votre avis sur les actions pouvant être proposées aux élèves. "
        + 'Elle prend environ 5 minutes. Répondez une seule fois par foyer.'),
      etat.dejaEnvoye ? h('p', { class: 'message info' },
        'Une réponse a déjà été envoyée depuis cet appareil. Si c\'était pour votre foyer, inutile de recommencer.') : null,
      h('div', { class: 'carte' },
        lignes,
        etat.enfants.length < c.maxEnfants
          ? h('button', { type: 'button', class: 'lien', onclick: () => {
              etat.enfants.push(''); etat.manquants = []; etat.erreur = ''; sauver(); render();
              document.getElementById('enfant-' + (etat.enfants.length - 1)).focus();
            } }, '+ Ajouter un autre enfant scolarisé au collège')
          : null,
        h('p', { class: 'aide', style: 'margin:12px 0 0' },
          "Plusieurs enfants au collège ? Indiquez la classe de chacun : vous ne répondez qu'une fois au questionnaire.")));
  }

  // --- Pages thèmes

  function vueTheme(t) {
    const choix = etat.cfg.choix;
    const questions = t.actions.map((a) => {
      const manquant = etat.manquants.includes(a.id);
      return h('fieldset', { class: 'carte' + (manquant ? ' manquant' : ''), 'data-id': a.id },
        h('legend', {}, a.libelle),
        h('div', { class: 'choix' },
          choix.map((ch, i) => h('label', { class: 'pastille', 'data-c': i },
            h('input', {
              type: 'radio', name: a.id, value: ch, checked: etat.reponses[a.id] === ch,
              onchange: (e) => {
                etat.reponses[a.id] = ch;
                e.target.closest('fieldset').classList.remove('manquant');
                etat.manquants = etat.manquants.filter((m) => m !== a.id);
                const m = document.getElementById('msg-erreur');
                if (!etat.manquants.length) { if (m) m.remove(); etat.erreur = ''; }
                else if (m) { etat.erreur = texteManquantes(etat.manquants.length); m.textContent = etat.erreur; }
                sauver();
              }
            }),
            h('span', {}, ch)))));
    });

    const max = etat.cfg.maxChars || 600;
    let bloc = null;
    if (t.autres) {
      const compteur = h('div', { class: 'compteur' }, '');
      const maj = (n) => { compteur.textContent = `${n} / ${max}`; };
      const zone = h('textarea', {
        id: 'prop-' + t.autres.id, maxlength: max, rows: 3,
        oninput: (e) => { etat.propositions[t.autres.id] = e.target.value; maj(e.target.value.length); sauver(); }
      });
      zone.value = etat.propositions[t.autres.id] || '';
      maj(zone.value.length);
      bloc = h('div', { class: 'carte' },
        h('label', { class: 'champ', for: 'prop-' + t.autres.id }, 'Autres propositions (facultatif)'),
        zone, compteur);
    }

    return h('section', {},
      h('h2', {}, t.titre),
      h('p', { class: 'aide' }, 'Pour chaque action, indiquez si elle vous paraît : ' + etat.cfg.choix.join(', ') + '.'),
      questions, bloc);
  }

  // --- Navigation

  function vueNavigation(total) {
    const derniere = etat.etape === total - 1;
    return h('div', { class: 'actions' },
      etat.etape > 0
        ? h('button', { type: 'button', class: 'secondaire', disabled: etat.envoi, onclick: () => aller(etat.etape - 1) }, 'Précédent')
        : h('span', {}),
      h('button', { type: 'button', disabled: etat.envoi, onclick: suivant },
        derniere ? (etat.envoi ? 'Envoi en cours…' : 'Envoyer mes réponses') : 'Suivant'),
      // Champ piège anti-robots : invisible et hors tabulation.
      derniere ? h('div', { class: 'piege', 'aria-hidden': 'true' },
        h('input', { type: 'text', name: 'site', id: 'champ-site', tabindex: '-1', autocomplete: 'off' })) : null);
  }

  function suivant() {
    if (etat.envoi) return;
    const total = etat.cfg.themes.length + 1;
    if (!valider()) return;
    if (etat.etape === total - 1) envoyer(); else aller(etat.etape + 1);
  }

  function texteManquantes(n) {
    return `Il reste ${n} question${n > 1 ? 's' : ''} sans réponse sur cette page.`;
  }

  /** Vérifie la page courante ; en cas d'oubli, marque les éléments et revient sur le premier. */
  function valider() {
    if (etat.etape === 0) {
      etat.manquants = etat.enfants.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
      etat.erreur = etat.manquants.length ? 'Merci de choisir la classe de chaque enfant.' : '';
    } else {
      const t = etat.cfg.themes[etat.etape - 1];
      etat.manquants = t.actions.filter((a) => !etat.reponses[a.id]).map((a) => a.id);
      etat.erreur = etat.manquants.length ? texteManquantes(etat.manquants.length) : '';
    }
    if (!etat.manquants.length) return true;
    render();
    const premier = etat.etape === 0
      ? document.getElementById('enfant-' + etat.manquants[0])
      : document.querySelector(`fieldset[data-id="${etat.manquants[0]}"] input`);
    if (premier) { premier.scrollIntoView({ block: 'center' }); premier.focus({ preventScroll: true }); }
    return false;
  }

  // ------------------------------------------------------------------ envoi

  async function envoyer() {
    etat.envoi = true;
    etat.erreur = '';
    render();
    try {
      const reponses = {};
      etat.cfg.themes.forEach((t) => t.actions.forEach((a) => { reponses[a.id] = etat.reponses[a.id]; }));
      const piege = document.getElementById('champ-site');
      const rep = await fetch(urlApi(), {
        method: 'POST',
        // text/plain : requête « simple », pas de preflight CORS (Apps Script ne gère pas OPTIONS).
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          id: etat.id,
          enfants: etat.enfants,
          reponses,
          propositions: etat.propositions,
          site: piege ? piege.value : ''
        })
      });
      const data = await rep.json();
      if (!data.ok) throw new Error(data.erreur || 'Échec de l\'envoi.');
      stockage('del', CLE_BROUILLON);
      stockage('set', CLE_ENVOYE, '1');
      etat.fini = true;
    } catch (e) {
      etat.erreur = e instanceof TypeError
        ? 'Connexion impossible. Vos réponses sont conservées : réessayez dans un instant.'
        : (e.message || 'Une erreur est survenue.') + ' Vos réponses sont conservées : vous pouvez réessayer.';
    } finally {
      etat.envoi = false;
      render();
      if (etat.fini) { window.scrollTo(0, 0); racine.focus({ preventScroll: true }); }
    }
  }

  function vueMerci() {
    return h('section', { class: 'carte merci' },
      h('h2', {}, 'Merci pour votre participation !'),
      h('p', {}, 'Vos réponses ont bien été enregistrées. Elles aideront l\'équipe à choisir les actions les plus utiles.'),
      h('p', { class: 'aide' }, 'Vous pouvez fermer cette page.'));
  }

  // ------------------------------------------------------------------ démarrage

  if (CFG.ASSOCIATION) document.getElementById('asso').textContent = CFG.ASSOCIATION;
  if (CFG.TITRE) {
    document.getElementById('titre').textContent = CFG.TITRE;
    document.title = CFG.TITRE + (CFG.ASSOCIATION ? ' – ' + CFG.ASSOCIATION : '');
  }
  charger();
})();
