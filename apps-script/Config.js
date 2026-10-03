/**
 * Configuration de l'enquête APE (responsables légaux).
 *
 * Le questionnaire est défini ICI, une seule fois : le formulaire (GitHub Pages)
 * le charge via `?action=config`, et les onglets du Google Sheet sont construits
 * à partir de lui (voir Setup.js).
 */

var ONGLETS = {
  REPONSES: 'Réponses',
  RESULTATS: 'Résultats',
  STATS: 'Stats répondants',
  AUTRES: 'Autres propositions',
  CLASSES: 'Classes'
};

var CHOIX = ['Incontournable', 'Intéressante', 'Négligeable', 'Inutile'];
var MAX_ENFANTS = 4;
var MAX_CHARS_PROPOSITION = 600;

/** Colonnes fixes de l'onglet « Réponses », avant les colonnes du questionnaire. */
var ENTETES_FIXES = [
  'Horodatage', 'ID réponse', 'Nb enfants',
  'Enfant 1', 'Enfant 2', 'Enfant 3', 'Enfant 4',
  'Classes (liste)', 'Niveaux (liste)'
];

/** Libellé de la ligne « texte libre » dans l'onglet Résultats. */
var LIBELLE_AUTRES = 'Autres propositions :';

var THEMES_SOURCE = [
  {
    titre: 'SANTÉ – RYTHMES DE VIE',
    autres: true,
    actions: [
      'Action sur le sommeil',
      "Action sur l'usage abusif des écrans",
      'Action sur les conduites addictives',
      "Action sur l'alimentation",
      'Action sur la santé mentale'
    ]
  },
  {
    titre: 'SANTÉ – VIE AFFECTIVE ET SEXUALITÉ',
    autres: true,
    actions: [
      'Action sur le consentement',
      'Action sur la découverte des règles',
      "Action sur ce qu'est la puberté",
      'Action sur les moyens de contraception',
      'Action stop aux discriminations',
      'Action sur le sexisme'
    ]
  },
  {
    titre: 'CITOYENNETÉ – VIVRE ENSEMBLE',
    autres: true,
    actions: [
      'Programme lutte contre le harcèlement',
      'Action sur les réseaux sociaux',
      "Action sur l'éducation aux médias",
      "Action sur l'égalité des sexes"
    ]
  },
  {
    titre: 'CITOYENNETÉ – SÉCURITÉ ROUTIÈRE',
    autres: true,
    actions: [
      'Action trottinette',
      'Action sécurité dans et aux abords des transports en commun',
      'Action vélo',
      'Action 2 roues motorisé',
      'Action consommations excessives et ses conséquences sur la conduite'
    ]
  },
  {
    titre: 'CITOYENNETÉ – PREMIERS SECOURS',
    autres: false,
    actions: [
      'Gestes qui sauvent GQS',
      'Prévention et Secours Civiques PSC'
    ]
  },
  {
    titre: 'ENVIRONNEMENT',
    autres: true,
    actions: [
      "Action autour de l'empreinte carbone",
      "Action autour de l'eau",
      'Action du recyclage'
    ]
  }
];

/** Questionnaire avec identifiants stables (t1a1 = thème 1, action 1 ; t1p = propositions du thème 1). */
function getQuestionnaire_() {
  return THEMES_SOURCE.map(function (t, i) {
    var tid = 't' + (i + 1);
    return {
      id: tid,
      titre: t.titre,
      actions: t.actions.map(function (libelle, j) {
        return { id: tid + 'a' + (j + 1), libelle: libelle };
      }),
      autres: t.autres ? { id: tid + 'p', libelle: 'Autres propositions' } : null
    };
  });
}

/**
 * Colonnes du questionnaire dans l'onglet « Réponses », dans l'ordre exact de
 * l'onglet « Résultats » : les actions du thème puis, si prévu, les propositions.
 */
function getColonnesQuestionnaire_() {
  var cols = [];
  getQuestionnaire_().forEach(function (t) {
    t.actions.forEach(function (a) {
      cols.push({ id: a.id, type: 'choix', theme: t.titre, libelle: a.libelle,
                  entete: t.titre + ' › ' + a.libelle });
    });
    if (t.autres) {
      cols.push({ id: t.autres.id, type: 'texte', theme: t.titre, libelle: LIBELLE_AUTRES,
                  entete: t.titre + ' › Autres propositions' });
    }
  });
  return cols;
}

/** Lit la liste des classes dans l'onglet « Classes » (modifiable par l'APE sans redéployer). */
function lireClasses_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONGLETS.CLASSES);
  if (!sh) throw new Error("Onglet « " + ONGLETS.CLASSES + " » introuvable : lancer Enquête APE > Initialiser.");
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 2).getValues()
    .map(function (r) { return { niveau: parseInt(String(r[0]), 10), classe: String(r[1]).trim() }; })
    .filter(function (c) { return !isNaN(c.niveau) && c.classe !== ''; });
}

/** Numéro de colonne (1-based) → lettre(s) : 1 → A, 27 → AA. */
function lettreColonne_(n) {
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
