# Enquête APE – responsables légaux

Formulaire en ligne (une page par thème) qui alimente le Google Sheet
`enquete_responsables_legaux`.

```
parents ──▶ docs/ (GitHub Pages) ──▶ apps-script/ (web app) ──▶ Google Sheet
```

## Onglets du Google Sheet

| Onglet | Contenu | Alimenté par |
|---|---|---|
| **Réponses** | 1 ligne = 1 foyer : horodatage, ID, nb d'enfants, classe de chaque enfant (jusqu'à 4), puis une colonne par question | le formulaire |
| **Résultats** | % par choix, total arrondi, Incontournable + Intéressante, avis dominant | formules (se met à jour seul) |
| **Stats répondants** | foyers et enfants par niveau (6e, 5e, 4e, 3e) et par classe + graphique | formules |
| **Autres propositions** | les textes libres, un par ligne, avec thème et classes | le formulaire |
| **Classes** | liste des classes proposées dans le formulaire | l'APE (à éditer) |

Plusieurs enfants : le foyer répond **une fois** et indique la classe de chacun. Un foyer est compté
une seule fois par classe et par niveau, même si deux enfants sont dans la même classe.
Un foyer avec un 6e et un 4e apparaît dans chacun des deux niveaux (le total des niveaux peut donc
dépasser le nombre de réponses).

## Mise en place

### 1. Backend (Apps Script, lié au Sheet)

Dans le Sheet : **Extensions > Apps Script**, puis copier `apps-script/*.js` et `appsscript.json`
(ou `clasp create --type sheets --parentId <ID_DU_SHEET>` depuis `apps-script/`, puis **restaurer
`appsscript.json`** : `clasp create` l'écrase avec un fichier par défaut sans bloc `webapp`).

1. Recharger le Sheet : le menu **Enquête APE** apparaît.
2. **Enquête APE > Initialiser / mettre à jour les onglets** (autoriser le script la 1re fois).
3. Onglet **Classes** : vérifier la liste des classes (modifiable à tout moment, puis relancer l'étape 2).
4. **Déployer > Nouveau déploiement > Application web** : exécuter en tant que *Moi*, accès *Tout le monde*.
   Copier l'URL se terminant par `/exec`.

### 2. Front (GitHub Pages)

1. Coller l'URL `/exec` dans `docs/config.js` (`API_URL`).
2. Pousser sur GitHub, puis **Settings > Pages > Deploy from a branch > `main` / `/docs`**.

## Mettre à jour le backend plus tard

Après un `clasp push` (ou une modification dans l'éditeur), l'URL `/exec` existante **ne sert pas le
nouveau code toute seule** : faire **Déployer > Gérer les déploiements > Modifier > Nouvelle version**
(ou `clasp create-version` puis `clasp deploy -i <deploymentId>`). Ne pas créer un nouveau déploiement,
sinon l'URL change et `docs/config.js` doit être mis à jour.

## Modifier le questionnaire

Les thèmes/actions sont définis dans `apps-script/Config.js` (`THEMES_SOURCE`). Le formulaire les lit
au chargement, donc rien à changer côté front. Les lignes de l'onglet **Résultats** doivent suivre le
même ordre : `installer()` s'arrête avec un message précis si une ligne ne correspond pas. Ne changer
le questionnaire qu'avant l'ouverture : les colonnes de **Réponses** en dépendent.

## Tester en local sans toucher au Sheet

Depuis `localhost`, `index.html?api=<URL>` remplace `API_URL` (ignoré partout ailleurs).

## Sécurité

- Les réponses sont validées côté serveur (choix, classes, longueur) ; le front n'est pas digne de confiance.
- Un texte libre commençant par `=`, `+`, `-` ou `@` est préfixé d'une apostrophe pour ne jamais
  s'exécuter comme formule dans le Sheet.
- Un champ piège invisible écarte les robots simples ; l'ID de réponse (UUID) rend l'envoi idempotent
  (un renvoi après coupure réseau ne crée pas de doublon).
- L'enquête est anonyme : aucun nom ni e-mail n'est collecté. Rien n'empêche techniquement un foyer
  de répondre deux fois depuis deux appareils.
