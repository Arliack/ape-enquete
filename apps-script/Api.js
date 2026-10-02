/**
 * API publique appelée par le formulaire hébergé sur GitHub Pages.
 *   GET  ?action=config → questionnaire, choix, classes
 *   POST (corps JSON, Content-Type text/plain pour éviter le preflight CORS) → enregistre une réponse
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'config';
  try {
    if (action === 'config') {
      return json_({
        ok: true,
        themes: getQuestionnaire_(),
        choix: CHOIX,
        classes: lireClasses_(),
        maxEnfants: MAX_ENFANTS,
        maxChars: MAX_CHARS_PROPOSITION
      });
    }
    return json_({ ok: false, erreur: 'Action inconnue.' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, erreur: 'Erreur serveur.' });
  }
}

function doPost(e) {
  try {
    var brut = e && e.postData && e.postData.contents;
    if (!brut || brut.length > 20000) return json_({ ok: false, erreur: 'Requête invalide.' });

    var payload;
    try { payload = JSON.parse(brut); } catch (_) { return json_({ ok: false, erreur: 'Requête invalide.' }); }

    // Champ piège : invisible pour un humain, rempli par les robots → on fait semblant d'accepter.
    if (payload && payload.site) return json_({ ok: true });

    var v = validerReponse_(payload, getQuestionnaire_(), lireClasses_());
    if (!v.ok) return json_({ ok: false, erreur: v.erreur });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var doublon = enregistrerReponse_(v.reponse);
      return json_({ ok: true, doublon: doublon });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, erreur: 'Erreur serveur, merci de réessayer dans un instant.' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Valide et normalise le corps de la requête. Fonction pure (pas d'accès au Sheet).
 * Retourne { ok:true, reponse } ou { ok:false, erreur }.
 */
function validerReponse_(payload, themes, classes) {
  var KO = function (msg) { return { ok: false, erreur: msg }; };
  var a = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  if (!payload || typeof payload !== 'object') return KO('Requête invalide.');

  var id = payload.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) return KO('Identifiant de réponse invalide.');

  // Enfants : 1 à MAX_ENFANTS classes, toutes présentes dans l'onglet « Classes ».
  var enfantsBruts = payload.enfants;
  if (!Array.isArray(enfantsBruts) || enfantsBruts.length < 1 || enfantsBruts.length > MAX_ENFANTS) {
    return KO('Indiquez la classe de 1 à ' + MAX_ENFANTS + ' enfant(s).');
  }
  var parClasse = {};
  classes.forEach(function (c) { parClasse[c.classe] = c.niveau; });
  var enfants = [];
  for (var i = 0; i < enfantsBruts.length; i++) {
    var cl = enfantsBruts[i];
    if (typeof cl !== 'string' || !a(parClasse, cl)) return KO('Classe inconnue pour l\'enfant ' + (i + 1) + '.');
    enfants.push({ classe: cl, niveau: parClasse[cl] });
  }

  // Notes : toutes les actions doivent avoir un choix valide.
  var rep = payload.reponses;
  if (!rep || typeof rep !== 'object' || Array.isArray(rep)) return KO('Réponses manquantes.');
  var choix = {};
  var manquantes = 0;
  themes.forEach(function (t) {
    t.actions.forEach(function (act) {
      var val = a(rep, act.id) ? rep[act.id] : null;
      if (CHOIX.indexOf(val) === -1) manquantes++; else choix[act.id] = val;
    });
  });
  if (manquantes > 0) return KO(manquantes + ' question(s) sans réponse valide.');

  // Textes libres : facultatifs, tronqués, neutralisés contre l'injection de formule.
  var props = (payload.propositions && typeof payload.propositions === 'object') ? payload.propositions : {};
  var textes = {};
  themes.forEach(function (t) {
    if (!t.autres || !a(props, t.autres.id)) return;
    var txt = props[t.autres.id];
    if (typeof txt !== 'string') return;
    txt = txt.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_PROPOSITION);
    if (txt) textes[t.autres.id] = neutraliserFormule_(txt);
  });

  return { ok: true, reponse: { id: id, enfants: enfants, choix: choix, textes: textes } };
}

/** Un texte commençant par = + - @ serait interprété comme une formule par Google Sheets. */
function neutraliserFormule_(txt) {
  return /^[=+\-@]/.test(txt) ? "'" + txt : txt;
}

/**
 * Ajoute une ligne dans « Réponses » (et une ligne par proposition dans « Autres propositions »).
 * À appeler sous verrou. Idempotent sur l'ID : un renvoi après timeout ne crée pas de doublon.
 * @return {boolean} true si la réponse existait déjà.
 */
function enregistrerReponse_(r) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ONGLETS.REPONSES);
  if (!sh) throw new Error("Onglet « " + ONGLETS.REPONSES + " » introuvable : lancer Enquête APE > Initialiser.");

  var last = sh.getLastRow();
  if (last > 1) {
    var ids = sh.getRange(2, 2, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (ids[i][0] === r.id) return true;
  }

  var maintenant = new Date();
  var classes = [];
  var niveaux = [];
  r.enfants.forEach(function (e) {
    if (classes.indexOf(e.classe) === -1) classes.push(e.classe);
    if (niveaux.indexOf(e.niveau) === -1) niveaux.push(e.niveau);
  });
  var listeClasses = '|' + classes.join('|') + '|';
  var listeNiveaux = '|' + niveaux.join('|') + '|';

  var ligne = [maintenant, r.id, r.enfants.length];
  for (var k = 0; k < MAX_ENFANTS; k++) ligne.push(r.enfants[k] ? r.enfants[k].classe : '');
  ligne.push(listeClasses, listeNiveaux);

  var cols = getColonnesQuestionnaire_();
  cols.forEach(function (c) {
    ligne.push(c.type === 'choix' ? (r.choix[c.id] || '') : (r.textes[c.id] || ''));
  });

  sh.getRange(last + 1, 1, 1, ligne.length).setValues([ligne]);

  var autres = ss.getSheetByName(ONGLETS.AUTRES);
  if (autres) {
    var lignesAutres = cols
      .filter(function (c) { return c.type === 'texte' && r.textes[c.id]; })
      .map(function (c) { return [maintenant, r.id, c.theme, r.textes[c.id], listeClasses]; });
    if (lignesAutres.length) {
      autres.getRange(autres.getLastRow() + 1, 1, lignesAutres.length, 5).setValues(lignesAutres);
    }
  }
  return false;
}
