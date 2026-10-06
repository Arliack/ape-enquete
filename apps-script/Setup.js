/**
 * Publication du questionnaire et mise en place des onglets. Peut être relancé à volonté tant que
 * les questions ne changent pas après l'arrivée de réponses.
 * Menu : « Enquête APE > Publier le questionnaire / mettre à jour les onglets ».
 */

var COULEUR_ENTETE = '#1f4e79';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Enquête APE')
    .addItem('Publier le questionnaire / mettre à jour les onglets', 'installer')
    .addSeparator()
    .addItem('Réparer les titres de colonnes (sans toucher aux réponses)', 'synchroniserEntetes')
    .addToUi();
}

/**
 * Séparateur d'arguments attendu par setFormula : « , » en locale anglaise, « ; » en locale
 * française (où la virgule est le séparateur décimal). Détecté par un test dans le classeur.
 * Les formules ci-dessous sont écrites avec des virgules puis converties par loc_().
 */
var SEP_ARG = ',';

function detecterSeparateur_(ss) {
  var cell = ss.getSheetByName(ONGLETS.RESULTATS).getRange('N1');
  try {
    cell.setFormula('=IF(1=1,1,2)');
    SpreadsheetApp.flush();
    SEP_ARG = (cell.getValue() === 1) ? ',' : ';';
  } finally {
    cell.clearContent();
  }
}

/** Convertit les virgules hors guillemets d'une formule vers le séparateur de la locale. */
function loc_(f) {
  if (SEP_ARG === ',' || typeof f !== 'string' || f.charAt(0) !== '=') return f;
  var out = '';
  var dansTexte = false;
  for (var i = 0; i < f.length; i++) {
    var ch = f.charAt(i);
    if (ch === '"') dansTexte = !dansTexte;
    out += (ch === ',' && !dansTexte) ? ';' : ch;
  }
  return out;
}

/**
 * Publie le questionnaire : lit les thèmes et actions de l'onglet « Résultats » (colonnes A et B),
 * les fige pour le formulaire, puis reconstruit les onglets qui en dépendent.
 * Rien n'est enregistré si le contrôle de « Réponses » échoue (réponses déjà reçues et questions changées).
 */
function installer() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  detecterSeparateur_(ss);
  preparerClasses_(ss);

  var lu = lireQuestionnaireDepuisResultats_(ss);
  QUESTIONNAIRE_EN_COURS_ = lu.themes;
  try {
    preparerReponses_(ss);    // peut refuser : on n'a encore rien publié
    PropertiesService.getScriptProperties().setProperty(CLE_QUESTIONNAIRE, JSON.stringify(lu.themes));

    preparerAutres_(ss);
    preparerResultats_(ss, lu.lignes);
    preparerStats_(ss);
    SpreadsheetApp.flush();
  } finally {
    QUESTIONNAIRE_EN_COURS_ = null;
  }

  var nbQuestions = lu.themes.reduce(function (n, t) { return n + t.actions.length; }, 0);
  alerte_('Questionnaire publié : ' + nbQuestions + ' questions notées dans ' + lu.themes.length
    + ' thèmes. Le formulaire en ligne est à jour. Les statistiques se mettent à jour à chaque réponse.');
}

/** Deux questionnaires sont-ils les mêmes (thèmes, libellés, champs texte), à la casse et aux apostrophes près ? */
function memeQuestionnaire_(a, b) {
  if (a.length !== b.length) return false;
  return a.every(function (t, i) {
    var u = b[i];
    return norm_(t.titre) === norm_(u.titre) && !!t.autres === !!u.autres
      && t.actions.length === u.actions.length
      && t.actions.every(function (x, j) { return norm_(x.libelle) === norm_(u.actions[j].libelle); });
  });
}

/**
 * Réparation : réécrit les titres de « Réponses » et les formules de « Résultats » d'après le
 * questionnaire PUBLIÉ, c'est-à-dire celui du formulaire, donc celui qui a servi à enregistrer les réponses.
 * Aucune réponse n'est modifiée. Refuse si l'onglet Résultats décrit un autre questionnaire.
 */
function synchroniserEntetes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  detecterSeparateur_(ss);
  var publie = getQuestionnaire_();
  var lu = lireQuestionnaireDepuisResultats_(ss);
  if (!memeQuestionnaire_(lu.themes, publie)) {
    throw new Error("L'onglet « " + ONGLETS.RESULTATS + " » ne décrit pas le même questionnaire que le formulaire en ligne. "
      + "Remettez-le comme dans le formulaire pour réparer, ou sauvegardez les réponses avant de publier une nouvelle version.");
  }
  preparerReponses_(ss, true);
  preparerResultats_(ss, lu.lignes);
  SpreadsheetApp.flush();
  alerte_('Titres de colonnes et formules réparés. Aucune réponse n\'a été modifiée.');
}

/**
 * Lit l'onglet « Résultats » : colonne A = thème (cellules fusionnées ou répétées), colonne B = action.
 * Une ligne « Autres propositions » (texte libre) est reconnue à son libellé. Les lignes vides sont ignorées.
 * @return {{themes: Array, lignes: Object}} questionnaire avec identifiants, et ligne de chaque id.
 */
function lireQuestionnaireDepuisResultats_(ss) {
  var sh = ss.getSheetByName(ONGLETS.RESULTATS);
  if (!sh) throw new Error("Onglet « " + ONGLETS.RESULTATS + " » introuvable.");
  var n = sh.getLastRow() - 1;
  if (n < 1) throw new Error("L'onglet « " + ONGLETS.RESULTATS + " » ne contient aucune question.");

  var vals = sh.getRange(2, 1, n, 2).getValues();
  var sources = [];       // { titre, actions[], autres, rowsActions[], rowAutres }
  var courant = null;
  vals.forEach(function (r, i) {
    var row = i + 2;
    var theme = String(r[0]).trim();
    var libelle = String(r[1]).trim();
    if (theme !== '' && (!courant || theme !== courant.titre)) {
      courant = { titre: theme, actions: [], autres: false, rowsActions: [], rowAutres: null };
      sources.push(courant);
    }
    if (libelle === '') return;
    if (!courant) throw new Error('Onglet Résultats, ligne ' + row + ' : aucun thème indiqué en colonne A.');
    if (norm_(libelle).indexOf('autres propositions') === 0) {
      if (courant.autres) throw new Error('Onglet Résultats, ligne ' + row + ' : deux lignes « Autres propositions » dans le thème « ' + courant.titre + ' ».');
      courant.autres = true;
      courant.rowAutres = row;
    } else {
      courant.actions.push(libelle);
      courant.rowsActions.push(row);
    }
  });

  if (!sources.length) throw new Error("Aucun thème trouvé dans l'onglet « " + ONGLETS.RESULTATS + " ».");
  sources.forEach(function (s) {
    if (!s.actions.length) throw new Error('Le thème « ' + s.titre + ' » ne contient aucune action à noter.');
  });

  var themes = construireQuestionnaire_(sources);
  if (JSON.stringify(themes).length > 8000) throw new Error('Questionnaire trop long pour être enregistré (8 000 caractères max).');

  var lignes = {};
  themes.forEach(function (t, i) {
    t.actions.forEach(function (a, j) { lignes[a.id] = sources[i].rowsActions[j]; });
    if (t.autres) lignes[t.autres.id] = sources[i].rowAutres;
  });
  return { themes: themes, lignes: lignes };
}

function alerte_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (_) { console.log(msg); }
}

function obtenirOnglet_(ss, nom) {
  return ss.getSheetByName(nom) || ss.insertSheet(nom);
}

function styleEntete_(range) {
  range.setFontWeight('bold').setFontColor('#ffffff').setBackground(COULEUR_ENTETE)
    .setWrap(true).setVerticalAlignment('middle');
}

// ---------------------------------------------------------------- Classes

function preparerClasses_(ss) {
  var existait = !!ss.getSheetByName(ONGLETS.CLASSES);
  var sh = obtenirOnglet_(ss, ONGLETS.CLASSES);
  if (existait && sh.getLastRow() > 1) return;   // ne jamais écraser une liste saisie par l'APE

  sh.getRange(1, 1, 1, 2).setValues([['Niveau', 'Classe']]);
  styleEntete_(sh.getRange(1, 1, 1, 2));
  var classes = { 6: 'ABCD', 5: 'ABC', 4: 'ABCD', 3: 'ABC' };
  var lignes = [];
  [6, 5, 4, 3].forEach(function (niveau) {
    classes[niveau].split('').forEach(function (lettre) { lignes.push([niveau, niveau + lettre]); });
  });
  sh.getRange(2, 1, lignes.length, 2).setValues(lignes);
  sh.getRange(1, 4).setValue(
    'Une classe par ligne. Après toute modification, relancer '
    + '« Enquête APE > Publier le questionnaire / mettre à jour les onglets » pour mettre à jour les statistiques.'
  ).setFontStyle('italic').setWrap(false);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 70);
  sh.setColumnWidth(2, 90);
}

// ---------------------------------------------------------------- Réponses

function preparerReponses_(ss, sansGarde) {
  var sh = obtenirOnglet_(ss, ONGLETS.REPONSES);
  var entetes = ENTETES_FIXES.concat(getColonnesQuestionnaire_().map(function (c) { return c.entete; }));

  // Questionnaire modifié ? Sans réponse on peut reconstruire l'en-tête ; avec des réponses on refuse,
  // car les colonnes seraient décalées et les anciennes données deviendraient fausses.
  var largeur = sh.getLastColumn();
  var actuels = largeur > 0 ? sh.getRange(1, 1, 1, largeur).getValues()[0] : [];
  var identique = actuels.length === entetes.length && entetes.every(function (e, i) { return actuels[i] === e; });
  var vide = actuels.every(function (v) { return v === ''; });
  if (!identique && !vide) {
    if (sh.getLastRow() > 1 && !sansGarde) {
      throw new Error("Le questionnaire a changé alors que l'onglet « " + ONGLETS.REPONSES
        + " » contient déjà des réponses : les colonnes seraient décalées. "
        + "Sauvegardez ou supprimez ces réponses (lignes 2 et suivantes), puis relancez.");
    }
    sh.getRange(1, 1, 1, Math.max(largeur, entetes.length)).clearContent();
  }

  var r = sh.getRange(1, 1, 1, entetes.length);
  r.setValues([entetes]);
  styleEntete_(r);
  sh.setRowHeight(1, 120);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  sh.setColumnWidths(1, entetes.length, 130);
  sh.setColumnWidth(1, 150);
  sh.getRange('A2:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sh.getRange('B2:B').setNumberFormat('@');   // ID en texte : jamais converti en nombre
  sh.getRange('H2:I').setNumberFormat('@');   // listes « |6A|4C| »
}

function preparerAutres_(ss) {
  var sh = obtenirOnglet_(ss, ONGLETS.AUTRES);
  var entetes = ['Horodatage', 'ID réponse', 'Thème', 'Proposition', 'Classes (liste)'];
  var r = sh.getRange(1, 1, 1, entetes.length);
  r.setValues([entetes]);
  styleEntete_(r);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 150);
  sh.setColumnWidth(2, 120);
  sh.setColumnWidth(3, 260);
  sh.setColumnWidth(4, 520);
  sh.setColumnWidth(5, 120);
  sh.getRange('A2:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sh.getRange('D2:D').setWrap(true);
}

// ---------------------------------------------------------------- Résultats

function norm_(s) {
  return String(s).replace(/[‘’ ]/g, function (c) { return c === ' ' ? ' ' : "'"; })
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Remplit C:I de l'onglet « Résultats » avec des formules vivantes.
 * @param {Object} lignes ligne de l'onglet pour chaque id de question (voir lireQuestionnaireDepuisResultats_).
 */
function preparerResultats_(ss, lignes) {
  var sh = ss.getSheetByName(ONGLETS.RESULTATS);
  if (!sh) throw new Error("Onglet « " + ONGLETS.RESULTATS + " » introuvable.");

  var offset = ENTETES_FIXES.length;               // 1re colonne du questionnaire = offset + 1
  var rep = "'" + ONGLETS.REPONSES + "'!";
  getColonnesQuestionnaire_().forEach(function (c, i) {
    var row = lignes[c.id];
    var L = lettreColonne_(offset + i + 1);
    var rng = rep + L + '2:' + L;
    var n = 'COUNTA(' + rng + ')';
    var zone = sh.getRange(row, 3, 1, 7);

    if (c.type === 'texte') {
      zone.setFormulas([[
        loc_('=' + n + '&" proposition(s) – voir l\'onglet « ' + ONGLETS.AUTRES + ' »"'),
        '', '', '', '', '', ''
      ]]);
      sh.getRange(row, 3).setHorizontalAlignment('left');
      return;
    }

    var pct = function (choix) {
      return '=IF(' + n + '=0,"",ROUND(COUNTIF(' + rng + ',"' + choix + '")/' + n + '*100,0))';
    };
    var plage = 'C' + row + ':F' + row;
    zone.setFormulas([[
      pct(CHOIX[0]), pct(CHOIX[1]), pct(CHOIX[2]), pct(CHOIX[3]),
      '=IF(' + n + '=0,"",SUM(' + plage + '))',
      '=IF(' + n + '=0,"",C' + row + '+D' + row + ')',
      '=IF(' + n + '=0,"",IF(COUNTIF(' + plage + ',MAX(' + plage + '))>1,"Égalité",'
        + 'INDEX($C$1:$F$1,MATCH(MAX(' + plage + '),' + plage + ',0))))'
    ].map(loc_)]);
    zone.setHorizontalAlignment('center');
    sh.getRange(row, 3, 1, 6).setNumberFormat('0"%"');   // pourcentages entiers
  });

  sh.getRange('K1').setValue('Nombre de réponses').setFontWeight('bold');
  sh.getRange('L1').setFormula(loc_("=COUNTA(" + rep + "A2:A)"));
}

// ---------------------------------------------------------------- Stats par classe / niveau

/**
 * Statistiques des répondants. Une famille est comptée une seule fois par classe et par niveau,
 * même si deux enfants sont dans la même classe (grâce aux colonnes « liste » dédupliquées).
 */
function preparerStats_(ss) {
  var sh = obtenirOnglet_(ss, ONGLETS.STATS);
  sh.clear();
  sh.getCharts().forEach(function (ch) { sh.removeChart(ch); });

  var classes = lireClasses_();
  var niveaux = [];
  classes.forEach(function (c) { if (niveaux.indexOf(c.niveau) === -1) niveaux.push(c.niveau); });
  niveaux.sort(function (a, b) { return b - a; });   // 6, 5, 4, 3

  var rep = "'" + ONGLETS.REPONSES + "'!";
  var debutClasses = 5 + niveaux.length + 4;         // 1re ligne du tableau par classe
  var finClasses = debutClasses + classes.length - 1;

  sh.getRange('A1').setValue('Statistiques des répondants').setFontSize(14).setFontWeight('bold');
  sh.getRange('A2:B3').setValues([
    ['Réponses reçues (foyers)', ''],
    ['Enfants représentés', '']
  ]);
  sh.getRange('B2').setFormula(loc_('=COUNTA(' + rep + 'A2:A)'));
  sh.getRange('B3').setFormula(loc_('=SUM(' + rep + 'C2:C)'));
  sh.getRange('A2:A3').setFontWeight('bold');

  // Tableau 1 : par niveau
  var r1 = 5;
  sh.getRange(r1, 1, 1, 4).setValues([['Niveau', 'Foyers répondants', 'Enfants', '% des foyers répondants']]);
  styleEntete_(sh.getRange(r1, 1, 1, 4));
  niveaux.forEach(function (niv, i) {
    var r = r1 + 1 + i;
    sh.getRange(r, 1).setValue(niv);
    sh.getRange(r, 2).setFormula(loc_('=COUNTIF(' + rep + '$I$2:$I,"*|"&A' + r + '&"|*")'));
    sh.getRange(r, 3).setFormula(loc_('=SUMIF($A$' + debutClasses + ':$A$' + finClasses + ',A' + r
      + ',$D$' + debutClasses + ':$D$' + finClasses + ')'));
    sh.getRange(r, 4).setFormula(loc_('=IF($B$2=0,"",B' + r + '/$B$2)')).setNumberFormat('0%');
  });
  var noteRow = r1 + niveaux.length + 1;
  sh.getRange(noteRow, 1).setValue(
    'Un foyer ayant des enfants dans plusieurs niveaux (ou classes) est compté dans chacun d\'eux : '
    + 'les lignes ne s\'additionnent donc pas forcément au total des réponses.'
  ).setFontStyle('italic').setFontColor('#666666');

  // Tableau 2 : par classe
  sh.getRange(debutClasses - 1, 1, 1, 5)
    .setValues([['Niveau', 'Classe', 'Foyers répondants', 'Enfants', '% des foyers répondants']]);
  styleEntete_(sh.getRange(debutClasses - 1, 1, 1, 5));
  var lignes = classes.map(function (c, i) {
    var r = debutClasses + i;
    return [
      loc_('=COUNTIF(' + rep + '$H$2:$H,"*|"&B' + r + '&"|*")'),
      loc_('=COUNTIF(' + rep + '$D$2:$G,B' + r + ')'),
      loc_('=IF($B$2=0,"",C' + r + '/$B$2)')
    ];
  });
  if (lignes.length) {
    // Niveau et classe sont des valeurs ; seules les 3 colonnes de droite sont des formules.
    sh.getRange(debutClasses, 1, classes.length, 2)
      .setValues(classes.map(function (c) { return [c.niveau, c.classe]; }));
    sh.getRange(debutClasses, 3, lignes.length, 3).setFormulas(lignes);
    sh.getRange(debutClasses, 5, lignes.length, 1).setNumberFormat('0%');
  }

  sh.setColumnWidth(1, 200);
  sh.setColumnWidths(2, 4, 150);
  sh.getRange(1, 1, finClasses, 5).setHorizontalAlignment('left');
  sh.getRange(r1, 2, niveaux.length + 1, 3).setHorizontalAlignment('center');
  if (lignes.length) sh.getRange(debutClasses, 3, lignes.length, 3).setHorizontalAlignment('center');

  // Graphique : foyers répondants par classe (non bloquant en cas d'échec)
  try {
    if (lignes.length) {
      sh.insertChart(sh.newChart()
        .setChartType(Charts.ChartType.COLUMN)
        .addRange(sh.getRange(debutClasses, 2, lignes.length, 2))
        .setNumHeaders(0)
        .setOption('title', 'Foyers répondants par classe')
        .setOption('legend', { position: 'none' })
        .setPosition(r1, 7, 0, 0)
        .build());
    }
  } catch (err) {
    console.warn('Graphique non créé : ' + err);
  }
}
