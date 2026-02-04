# Documentation complète d’OpenTUI

Cette documentation regroupe l’ensemble des pages disponibles sur le site d’OpenTUI. Elle est organisée par sections : guide de démarrage, concepts de base, bindings pour frameworks, et composants. Les exemples de code sont conservés tels quels pour faciliter leur utilisation dans vos projets.

## Sommaire

- [Guide de démarrage](#guide-de-démarrage)
- [Concepts de base](#concepts-de-base)
  - [Renderer](#renderer)
  - [Système de layout](#système-de-layout)
  - [Constructs](#constructs)
  - [Renderables](#renderables)
  - [Renderables vs Constructs](#renderables-vs-constructs)
- [Bindings pour frameworks](#bindings-pour-frameworks)
  - [React](#react)
  - [Solid.js](#solidjs)
- [Composants](#composants)
  - [Text](#text)
  - [Box](#box)
  - [Input](#input)
  - [Select](#select)
  - [Textarea](#textarea)
  - [ScrollBox](#scrollbox)
  - [ScrollBar](#scrollbar)
  - [Slider](#slider)
  - [Code](#code)
  - [Diff](#diff)
  - [Markdown](#markdown)
  - [ASCIIFont](#asciifont)
  - [TabSelect](#tabselect)
  - [FrameBuffer](#framebuffer)

---

## Guide de démarrage

### Titre : Getting started

OpenTUI est une bibliothèque TypeScript destinée à la création d’interfaces utilisateur en terminal. Cette section explique comment installer les dépendances nécessaires et créer un premier programme.

#### Installation

OpenTUI nécessite [Bun](https://bun.sh) comme environnement d’exécution. Pour initialiser un projet et installer la bibliothèque :

```bash
mkdir my-tui && cd my-tui
bun init -y
bun add @opentui/core
````

#### Hello world

Créer le fichier `index.ts` :

```typescript
import { createCliRenderer, Text } from "@opentui/core"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
})

renderer.root.add(
  Text({
    content: "Hello, OpenTUI!",
    fg: "#00FF00",
  }),
)
```

Exécuter le programme :

```bash
bun index.ts
```

Vous devriez voir le texte vert s’afficher. Appuyez sur `Ctrl+C` pour quitter.

#### Composition de composants

Les composants se composent naturellement. Voici un panneau avec bordure et contenu :

```typescript
import { createCliRenderer, Box, Text } from "@opentui/core"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
})

renderer.root.add(
  Box(
    { borderStyle: "rounded", padding: 1, flexDirection: "column", gap: 1 },
    Text({ content: "Welcome", fg: "#FFFF00" }),
    Text({ content: "Press Ctrl+C to exit" }),
  ),
)
```

`Box` et `Text` sont des fonctions qui créent des VNodes : le premier argument correspond aux propriétés et les arguments suivants aux enfants.

#### Et après ?

Pour aller plus loin :

* **Concepts de base :** [Renderer](#renderer), [Système de layout](#système-de-layout), [Constructs](#constructs).
* **Composants :** [Text](#text), [Box](#box), [Input](#input), [Select](#select).
* **Bindings :** [React](#react), [Solid.js](#solidjs).

---

## Concepts de base

Les concepts de base d’OpenTUI décrivent l’architecture sous-jacente : le moteur de rendu (`CliRenderer`), le système de layout basé sur Yoga/Flexbox, l’API déclarative via les `constructs`, et les classes de base appelées `renderables`.

### Renderer

Le **`CliRenderer`** gère la sortie terminal, les événements d’entrée et la boucle de rendu. On crée une instance via la fonction asynchrone `createCliRenderer` :

```typescript
import { createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
})
```

Cette fonction charge la librairie native, configure le terminal (souris et clavier) et renvoie une instance initialisée.

#### Options de configuration

| Option                | Type             | Valeur par défaut | Description                              |
| --------------------- | ---------------- | ----------------- | ---------------------------------------- |
| `exitOnCtrlC`         | `boolean`        | `true`            | Quitter l’application sur `Ctrl+C`       |
| `targetFps`           | `number`         | `30`              | Fréquence de rendu en FPS                |
| `maxFps`              | `number`         | `60`              | FPS maximum pour les re-rendus immédiats |
| `useMouse`            | `boolean`        | `true`            | Activer le suivi de la souris            |
| `autoFocus`           | `boolean`        | `true`            | Focus automatique sur clic gauche        |
| `enableMouseMovement` | `boolean`        | `true`            | Suivre les mouvements de souris          |
| `useAlternateScreen`  | `boolean`        | `true`            | Utiliser le tampon d’écran alternatif    |
| `backgroundColor`     | `ColorInput`     | `transparent`     | Couleur de fond par défaut               |
| `consoleOptions`      | `ConsoleOptions` | -                 | Options pour la console intégrée         |
| `openConsoleOnError`  | `boolean`        | `true`            | Ouvrir la console en cas d’erreur (dev)  |

#### Composant racine

Chaque renderer possède une propriété `root`, un `RootRenderable` qui remplit toute la surface du terminal. On y ajoute les composants enfants :

```typescript
import { Box, Text } from "@opentui/core"

renderer.root.add(
  Box({ width: 40, height: 10, borderStyle: "rounded" }, Text({ content: "Hello, OpenTUI!" })),
)
```

#### Modes de rendu

Le renderer offre plusieurs modes :

* **Automatique :** par défaut, il ne re-renderise que lorsque l’arbre de composants change.
* **Continu :** en appelant `start()`, la boucle tourne en continu au FPS cible ; `stop()` arrête cette boucle.
* **Live rendering :** appelez `requestLive()` pour activer le rendu continu pour des animations. La méthode `dropLive()` stoppe la demande. Plusieurs composants peuvent demander le live ; le renderer reste actif tant que des demandes persistent.
* **Pause/Suspend :** `pause()` suspend le rendu tout en conservant l’état, `resume()` le reprend ; `suspend()` désactive en plus la souris et les entrées brutes.

#### Propriétés clés

| Propriété                  | Type                 | Description                          |
| -------------------------- | -------------------- | ------------------------------------ |
| `root`                     | `RootRenderable`     | Racine de l’arbre                    |
| `width`, `height`          | `number`             | Dimensions actuelles du rendu        |
| `console`                  | `TerminalConsole`    | Console intégrée                     |
| `keyInput`                 | `KeyHandler`         | Gestionnaire de clavier              |
| `isRunning`                | `boolean`            | Indique si la boucle tourne          |
| `isDestroyed`              | `boolean`            | Indique si le renderer a été détruit |
| `currentFocusedRenderable` | `Renderable \| null` | Composant actuellement en focus      |

#### Événements

Le renderer émet des événements :

```typescript
// Redimensionnement du terminal
renderer.on("resize", (width, height) => {
  console.log(`Terminal size: ${width}x${height}`)
})

// Destruction du renderer
renderer.on("destroy", () => {
  console.log("Renderer destroyed")
})

// Sélection de texte terminée
renderer.on("selection", (selection) => {
  console.log("Selected text:", selection.getSelectedText())
})
```

#### Contrôle du curseur

Le renderer permet de positionner et de styliser le curseur :

```typescript
// Positionner le curseur et l’afficher
renderer.setCursorPosition(10, 5, true)

// Style du curseur
renderer.setCursorStyle("block", true) // Bloc clignotant
renderer.setCursorStyle("underline", false) // Souligné fixe
renderer.setCursorStyle("line", true) // Ligne clignotante

// Couleur du curseur
renderer.setCursorColor(RGBA.fromHex("#FF0000"))
```

#### Gestion des entrées

On peut ajouter des gestionnaires d’entrée personnalisés :

```typescript
renderer.addInputHandler((sequence) => {
  if (sequence === "\x1b[A") {
    // Flèche vers le haut — traitée et consommée
    return true
  }
  return false // Laisser les autres gestionnaires traiter
})
```

Utilisez `prependInputHandler()` pour ajouter un handler avant ceux intégrés.

#### Debug overlay

Activez l’overlay de debug pour afficher FPS, mémoire et autres :

```typescript
renderer.toggleDebugOverlay()

// Ou configurez-le
import { DebugOverlayCorner } from "@opentui/core"

renderer.configureDebugOverlay({
  enabled: true,
  corner: DebugOverlayCorner.topRight,
})
```

#### Nettoyage

Il est recommandé de toujours détruire le renderer en fin d’utilisation pour restaurer l’état du terminal :

```typescript
renderer.destroy()
```

#### Variables d’environnement

| Variable                    | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `OTUI_USE_ALTERNATE_SCREEN` | Override de l’utilisation du tampon alternatif        |
| `OTUI_SHOW_STATS`           | Afficher l’overlay de debug au démarrage              |
| `OTUI_DEBUG`                | Activer la capture des entrées pour debug             |
| `OTUI_NO_NATIVE_RENDER`     | Désactiver le rendu natif (debug)                     |
| `OTUI_DUMP_CAPTURES`        | Sauvegarder la sortie capturée lors de la destruction |
| `OTUI_OVERRIDE_STDOUT`      | Rediriger le flux stdout                              |
| `OTUI_USE_CONSOLE`          | Activer/désactiver la console intégrée                |
| `SHOW_CONSOLE`              | Afficher la console au démarrage                      |

### Système de layout

Le moteur Yoga/Flexbox permet des interfaces adaptables et réactives. Les propriétés flexbox standard sont disponibles.

#### Flexbox de base

Un conteneur en flex doit être créé via `BoxRenderable` ou `Box`. Par exemple :

```typescript
import { BoxRenderable, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const container = new BoxRenderable(renderer, {
  id: "container",
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  height: 10,
})

const leftPanel = new BoxRenderable(renderer, {
  id: "left",
  flexGrow: 1,
  justifyContent: "center",
  alignItems: "center",
})

const rightPanel = new BoxRenderable(renderer, {
  id: "right",
  flexGrow: 1,
})

container.add(leftPanel, rightPanel)
renderer.root.add(container)
```

Dans cet exemple, deux panneaux se répartissent l’espace disponible. Les propriétés `flexGrow`, `flexShrink`, `flexBasis` fonctionnent comme en CSS.

#### Propriétés principales

Le tableau liste les propriétés :

| Propriété           | Type                                                | Description                          |
| ------------------- | --------------------------------------------------- | ------------------------------------ |
| `width`, `height`   | `number`, `string`                                  | Dimensions fixes, pourcentages, auto |
| `flexDirection`     | `"row"` | `"column"`                                | Orientation des enfants              |
| `justifyContent`    | `"flex-start"`, `"center"`, `"space-between"`, etc. | Alignement horizontal ou vertical    |
| `alignItems`        | `"flex-start"`, `"center"`, `"stretch"`, etc.       | Alignement transversal               |
| `flexWrap`          | `boolean`                                           | Autoriser le retour à la ligne       |
| `padding`, `margin` | `number` ou objet { top, right, bottom, left }      | Espacement intérieur/extérieur       |
| `gap`               | `number`                                            | Espace entre les enfants             |
| `position`          | `"relative"` | `"absolute"`                         | Positionnement                       |

#### Positionnement et absolu

En `position: "absolute"`, on peut spécifier `left`, `top`, `right`, `bottom` en valeurs absolues ou pourcentages. Cela permet de créer des overlays.

#### Utiliser les constructs

Les constructs fournissent une API déclarative. Le conteneur `Box` est disponible :

```typescript
import { Box, Text } from "@opentui/core"

renderer.root.add(
  Box(
    {
      id: "container",
      flexDirection: "row",
    },
    Text({ content: "Gauche" }),
    Text({ content: "Droite" }),
  ),
)
```

Ici, `Box` est une fonction qui retourne un VNode.

#### Mise en page réactive

En écoutant l’événement `resize` du renderer, on peut ajuster dynamiquement la layout, par exemple en changeant la direction de flex selon la largeur du terminal.

### Constructs

Les **constructs** sont des fonctions qui créent des VNodes. Ils constituent l’API déclarative d’OpenTUI.

#### Utilisation

Un construct s’utilise comme une fonction :

```typescript
import { Box, Text } from "@opentui/core"

const vnode = Box({ id: "card", padding: 1 }, Text({ content: "Hello" }))
renderer.root.add(vnode)
```

Le premier argument est un objet de propriétés, suivi des enfants.

#### Constructs disponibles

* `Box` : conteneur flex avec bordures optionnelles.
* `Text` : affichage de texte stylé et sélectable.
* `Input` : champ de saisie mono‑ligne.
* `Textarea` : champ de saisie multi‑ligne.
* `Select` : liste verticale avec navigation clavier.
* `TabSelect` : sélection horizontale d’onglets.
* `ScrollBox` : conteneur scrollable.
* `ScrollBar` : barre de défilement indépendante.
* `Slider` : curseur linéaire (horizontal ou vertical).
* `ASCIIFont` : texte en police ASCII.
* `Code` : affichage de code avec surlignage.
* `Diff` : affichage de diff unifié ou séparé.
* `Markdown` : affichage de markdown avec syntaxe.
* `FrameBuffer` : surface de rendu bas niveau.

#### Délégation et composition

Le VNode retourné expose des méthodes de chaîne (e.g. `.width(50).height(20)`) qui délèguent aux enfants. La fonction `delegate()` permet de mapper des appels sur un sous‑composant par ID.

#### Composants personnalisés

On peut définir ses propres constructs :

```typescript
function Card(props, ...children) {
  return Box(
    {
      padding: 1,
      borderStyle: "rounded",
      ...props,
    },
    ...children,
  )
}
```

Cela permet de factoriser des styles communs et de composer des UI complexes.

#### Mixage des APIs

Les constructs et les renderables peuvent être mixés : un VNode peut ajouter un objet renderable et vice versa. Cela offre flexibilité et possibilités avancées.

### Renderables

Les **renderables** sont des classes représentant des éléments affichables et interactifs. Ils fournissent une API impérative.

#### Arbre de renderables

Chaque renderable possède une liste d’enfants. On peut naviguer et manipuler l’arbre avec `add()`, `remove()`, `findById()`, etc.

#### Liste des renderables disponibles

* `BoxRenderable`, `TextRenderable`
* `InputRenderable`, `TextareaRenderable`
* `SelectRenderable`, `TabSelectRenderable`
* `ScrollBoxRenderable`, `ScrollBarRenderable`
* `SliderRenderable`
* `CodeRenderable`, `DiffRenderable`, `MarkdownRenderable`
* `ASCIIFontRenderable`
* `FrameBufferRenderable`

#### Propriétés et layout

Les renderables supportent les mêmes propriétés de layout que les constructs (`width`, `height`, `flexDirection`, etc.). On peut aussi spécifier une taille absolue en pixels.

#### Focus et navigation

`requestFocus()` et `releaseFocus()` gèrent le focus clavier. Les renderables émettent des événements `focus` et `blur`.

#### Handling d’événements

On peut écouter les clics (`click`), les survols (`mouseover`, `mouseout`), le clavier (`keypress`, `keydown`, `keyup`) et la sélection (`selection-start`, `selection-end`).

#### Visibilité et z-index

Les properties `visible`, `opacity`, `zIndex` permettent de cacher un élément, ajuster sa transparence et son ordre de dessin.

#### Rendu live et animations

La méthode `onUpdate(deltaMs)` est appelée à chaque frame en mode live (`requestLive()`), permettant d’animer des propriétés.

#### Translation

Les offsets `translateX` et `translateY` appliquent un décalage global.

#### Rendering tamponné

Avec `useBufferedRendering()`, un renderable peut dessiner dans un tampon intermédiaire pour optimiser les re‑rendus.

#### Lifecycle et destruction

Override `onDestroy()` pour libérer des ressources. Les méthodes `destroy()` et `destroyRecursively()` suppriment l’élément et ses enfants.

### Renderables vs Constructs

Cette section compare les APIs. Les constructs sont déclaratifs, immuables et permettent une composition semblable à JSX. Les renderables sont impératifs, modulaires et offrent un contrôle direct sur le cycle de vie.

#### Exemples comparés

* **Construct API :**

```typescript
renderer.root.add(
  Box(
    { id: "counter", padding: 1 },
    Text({ id: "label", content: "Count: 0" }),
    Button({ id: "inc", label: "+" }),
  ),
)
```

* **Renderable API :**

```typescript
const counter = new BoxRenderable(renderer, { id: "counter", padding: 1 })
const label = new TextRenderable(renderer, { id: "label", content: "Count: 0" })
const incBtn = new ButtonRenderable(renderer, { id: "inc", label: "+" })
counter.add(label, incBtn)
renderer.root.add(counter)
```

#### Délégation d’API

La fonction `delegate(vnodeId, targetId)` permet à un VNode de déléguer ses méthodes/propriétés à un descendant, donnant un comportement hybride entre declaratif et impératif.

#### Quand choisir l’un ou l’autre ?

* **Constructs :** préférables pour des hiérarchies statiques, de la composition et des mises à jour simples.
* **Renderables :** utiles pour manipuler dynamiquement l’arbre, gérer le focus, accéder aux méthodes de bas niveau (ex. scrollbar).

---

## Bindings pour frameworks

OpenTUI propose des bindings pour React et Solid afin de profiter de leur écosystème et de la syntaxe JSX.

### React

#### Installation

Installez `@opentui/react` :

```bash
bun add @opentui/react
```

Configurez TypeScript pour compiler vers ESNext et activer JSX. Utilisez `React.Fragment` comme élément JSX.

#### Démarrage rapide

```typescript
import { createCliRenderer } from "@opentui/core"
import { RendererProvider, Text, Box } from "@opentui/react"

async function main() {
  const renderer = await createCliRenderer()

  function App() {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Text content="Hello React" />
        <Text content="OpenTUI" fg="#00FF00" />
      </Box>
    )
  }

  return (
    <RendererProvider renderer={renderer}>
      <App />
    </RendererProvider>
  )
}

main()
```

#### API et composants

Les composants React reflètent les constructs : `<Text>`, `<Box>`, `<Input>`, `<Textarea>`, `<Select>`, `<TabSelect>`, `<ScrollBox>`, `<ScrollBar>`, `<Slider>`, `<Code>`, `<Diff>`, `<Markdown>`, `<ASCIIFont>`, `<FrameBuffer>`. Les propriétés sont identiques à celles des constructs.

#### Hooks et utilitaires

* `useRenderer()`, `useKeyboard()`, `onResize()`, `usePaste()`, `useSelectionHandler()`, `useTimeline()` exposent des API internes.
* `extend()` permet d’étendre un composant existant.
* `useComponentCatalogue()` retourne la liste des composants disponibles.

#### Exemple de formulaire

```typescript
function LoginForm() {
  const [username, setUsername] = useState("")
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text content="Username:" />
      <Input value={username} onChange={setUsername} />
      <Button label="Submit" />
    </Box>
  )
}
```

#### Développement et production

Pour la production, compilez avec Bun/ESBuild et exécutez le fichier généré. Utilisez les DevTools React pour inspecter les composants.

### Solid.js

#### Installation et configuration

Installez `@opentui/solid` via Bun. Configurez TypeScript pour Solid avec JSX transform.

#### Utilisation de `render`

La fonction `render(<App />, renderer)` monte votre application Solid dans le renderer.

#### API et composants【927344343353878†L?】 (non disponible ici)

Comme pour React, tous les composants constructs sont disponibles en JSX. Des hooks analogues sont fournis (`useRenderer`, `onResize`, etc.).

#### Test et build

Le module `testRender()` permet de tester l’UI en renvoyant le contenu sous forme de chaînes. Utilisez `bun build` pour la production.

#### Différences principales

Solid utilise un modèle de réactivité fine-grained, ce qui peut entraîner des performances supérieures sur des mises à jour ciblées.

---

## Composants

### Text

Le composant **Text** affiche du texte stylé et peut être interactif (sélection). On peut aussi utiliser le littéral de gabarit `t` pour styler des segments individuellement.

#### API Renderable/Construct

```typescript
import { Text, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

renderer.root.add(
  Text({
    id: "message",
    content: "Welcome to OpenTUI",
    fg: "#FFFFFF",
    bg: "blue",
    bold: true,
  }),
)
```

#### Sélection et raccourcis

Définissez `selectable: true` pour activer la sélection. Utilisez `selectionBg` et `selectionFg` pour la couleur de sélection. Les raccourcis `Ctrl+A` (tout sélectionner), `Ctrl+C` (copier) sont gérés par défaut.

#### Propriétés principales

| Propriété                     | Type                             | Description                  |
| ----------------------------- | -------------------------------- | ---------------------------- |
| `content`                     | `string`                         | Texte à afficher             |
| `fg`, `bg`                    | `ColorInput`                     | Couleurs du texte et du fond |
| `bold`, `italic`, `underline` | `boolean`                        | Styles typographiques        |
| `selectable`                  | `boolean`                        | Autoriser la sélection       |
| `wrapMode`                    | `"nowrap"` | `"word"` | `"char"` | Mode d’enroulement           |
| `maxWidth`                    | `number`                         | Largeur maximale             |

#### Exemple : barre de statut

Un exemple combine un `Box` avec trois `Text` alignés (`justifyContent: "space-between"`) pour créer une barre de statut en bas de l’écran.

### Box

Le composant **Box** est un conteneur pouvant afficher des bordures. Il sert à structurer l’interface et peut contenir n’importe quel composant.

#### API Renderable/Construct

```typescript
import { Box, Text, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

renderer.root.add(
  Box(
    {
      id: "panel",
      width: 40,
      height: 10,
      borderStyle: "round",
      borderColor: "cyan",
      padding: 1,
      flexDirection: "column",
      gap: 1,
    },
    Text({ content: "Title", fg: "yellow" }),
    Text({ content: "Description" }),
  ),
)
```

#### Styles et bordures

Les valeurs de `borderStyle` : `"line"`, `"double"`, `"round"`, `"bold"`. `borderColor` colore la bordure ; `title` et `titleAlignment` ajoutent un titre centré ou aligné.

#### Propriétés principales

| Propriété        | Type                            | Description              |
| ---------------- | ------------------------------- | ------------------------ |
| `borderStyle`    | `string`                        | Style de bordure         |
| `borderColor`    | `ColorInput`                    | Couleur de bordure       |
| `padding`        | `number` | `object`             | Espacement interne       |
| `gap`            | `number`                        | Espace entre les enfants |
| `title`          | `string`                        | Texte de titre           |
| `titleAlignment` | `"left"`, `"center"`, `"right"` | Position du titre        |

#### Exemple de carte

Une carte stylisée combine un `Box` avec un titre et du contenu, ainsi que des couleurs pour le fond et le texte.

### Input

Le composant **Input** est un champ de saisie mono‑ligne avec un curseur et des événements de validation.

#### API Renderable/Construct

```typescript
import { Input, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

renderer.root.add(
  Input({
    id: "username",
    width: 30,
    placeholder: "Enter your username",
    value: "",
    onSubmit: (value) => {
      console.log("Username:", value)
    },
  }),
)
```

#### Propriétés principales

| Propriété     | Type              | Description                          |
| ------------- | ----------------- | ------------------------------------ |
| `value`       | `string`          | Valeur actuelle                      |
| `placeholder` | `string`          | Texte d’aide                         |
| `onSubmit`    | `(value) => void` | Callback lors de l’appui sur `Enter` |
| `onChange`    | `(value) => void` | Callback à chaque modification       |
| `bg`, `fg`    | `ColorInput`      | Couleurs du champ                    |
| `cursorColor` | `ColorInput`      | Couleur du curseur                   |

#### Exemple : formulaire de connexion

Associez plusieurs `Input` dans un `Box` vertical, puis utilisez un bouton ou `onSubmit` pour traiter les données.

### Select

Le composant **Select** affiche une liste verticale navigable au clavier.

#### API Renderable/Construct

```typescript
import { Select, SelectEvents, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const select = Select({
  id: "menu",
  options: [
    { label: "Open", value: "open" },
    { label: "Save", value: "save" },
    { label: "Exit", value: "exit" },
  ],
})

select.on(SelectEvents.ITEM_SELECTED, (index, option) => {
  console.log("Selected:", option.value)
})

renderer.root.add(select)
select.focus()
```

#### Propriétés principales

| Propriété                  | Type                      | Description                 |
| -------------------------- | ------------------------- | --------------------------- |
| `options`                  | `Array<{ label, value }>` | Liste d’options             |
| `selected`                 | `number`                  | Index sélectionné           |
| `onChange`                 | `(index, option) => void` | Callback lors du changement |
| `bg`, `fg`                 | `ColorInput`              | Couleurs de base            |
| `hoverBg`, `hoverFg`       | `ColorInput`              | Couleurs au survol          |
| `selectedBg`, `selectedFg` | `ColorInput`              | Couleurs de sélection       |

#### Navigation et événements

Les flèches Haut/Bas déplacent la sélection. Le clic valide l’option (événement `ITEM_SELECTED`). On peut aussi utiliser `setSelectedIndex()` et `getSelectedIndex()` pour contrôler la sélection par code.

### Textarea

**Textarea** permet la saisie de texte multi‑ligne avec scroll et sélection.

#### API Renderable/Construct

```typescript
import { Textarea, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

renderer.root.add(
  Textarea({
    id: "notes",
    width: 40,
    height: 5,
    initialValue: "Write here...",
    wrapMode: "word",
    cursorColor: "#FF00FF",
    onSubmit: (value) => {
      console.log("Submitted:", value)
    },
  }),
)
```

#### Propriétés principales

| Propriété         | Type                | Description                  |
| ----------------- | ------------------- | ---------------------------- |
| `width`, `height` | `number`            | Dimensions                   |
| `initialValue`    | `string`            | Texte initial                |
| `placeholder`     | `string`            | Aide                         |
| `wrapMode`        | `"word"` | `"char"` | Gestion du retour à la ligne |
| `cursorColor`     | `ColorInput`        | Couleur du curseur           |
| `onSubmit`        | `(value) => void`   | Callback sur `Enter`         |

#### Sélection et contrôles

La sélection fonctionne comme dans `Text`. Les touches flèches, `PageUp/PageDown`, `Home/End` naviguent dans le champ. `Ctrl+C` copie la sélection.

### ScrollBox

**ScrollBox** est un conteneur scrollable permettant d’afficher des listes ou des contenus dynamiques.

#### API Renderable

```typescript
import { ScrollBoxRenderable, TextRenderable, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const scrollBox = new ScrollBoxRenderable(renderer, {
  id: "logs",
  width: "50%",
  height: 10,
  scrollStep: 1,
})

for (let i = 0; i < 30; i++) {
  scrollBox.add(new TextRenderable(renderer, { content: `Line ${i}` }))
}

renderer.root.add(scrollBox)
```

#### API Construct

```typescript
import { ScrollBox, Text } from "@opentui/core"

renderer.root.add(
  ScrollBox(
    {
      id: "logs",
      width: "50%",
      height: 10,
      scrollStep: 1,
    },
    ...Array.from({ length: 30 }, (_, i) => Text({ content: `Line ${i}` })),
  ),
)
```

#### Scrolling et méthode

Les méthodes `scrollBy(dy)`, `scrollTo(y)` permettent de contrôler le défilement. `ScrollBox` maintient le scroll collé en bas si `stickToBottom: true`. On peut ajouter des barres de scroll personnalisées via `scrollbar`.

#### Propriétés principales

| Propriété        | Type      | Description                                      |
| ---------------- | --------- | ------------------------------------------------ |
| `scrollStep`     | `number`  | Pas de défilement en lignes                      |
| `scrollbarSize`  | `number`  | Taille de la barre                               |
| `scrollbarTrack` | `object`  | Options de style pour le track                   |
| `stickToBottom`  | `boolean` | Reste collé en bas lorsque du contenu est ajouté |
| `smoothScroll`   | `boolean` | Interpolation lors du défilement                 |
| `wrapSelection`  | `boolean` | Navigation continue en boucle                    |

### ScrollBar

La **ScrollBar** peut être utilisée seule ou intégrée à une ScrollBox.

#### API Renderable/Construct

```typescript
import { ScrollBar, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

renderer.root.add(
  ScrollBar({
    id: "scroll",
    orientation: "vertical",
    height: 10,
    scrollSize: 5,
  }),
)
```

#### Propriétés principales

| Propriété      | Type                          | Description          |
| -------------- | ----------------------------- | -------------------- |
| `orientation`  | `"vertical"` | `"horizontal"` | Orientation          |
| `scrollSize`   | `number`                      | Taille du curseur    |
| `value`        | `number`                      | Position (0-1)       |
| `showArrows`   | `boolean`                     | Afficher des flèches |
| `trackOptions` | `object`                      | Couleurs du rail     |
| `thumbOptions` | `object`                      | Couleurs du curseur  |

#### Contrôles clavier

`Up/Down` ou `Left/Right` modifient la position. Lorsqu’elle est intégrée à ScrollBox, la ScrollBar suit automatiquement le contenu.

### Slider

Le **Slider** est un curseur linéaire horizontal ou vertical.

#### API Renderable

```typescript
import { SliderRenderable, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const slider = new SliderRenderable(renderer, {
  id: "volume",
  orientation: "horizontal",
  width: 30,
  min: 0,
  max: 100,
  value: 50,
})

slider.on("change", (value) => {
  console.log("Volume:", value)
})

renderer.root.add(slider)
```

#### API Construct

```typescript
import { Slider } from "@opentui/core"

renderer.root.add(
  Slider({
    id: "volume",
    orientation: "vertical",
    height: 20,
    min: 0,
    max: 10,
    value: 3,
  }),
)
```

#### Propriétés principales

| Propriété      | Type                          | Description                      |
| -------------- | ----------------------------- | -------------------------------- |
| `orientation`  | `"horizontal"` | `"vertical"` | Orientation                      |
| `value`        | `number`                      | Valeur actuelle                  |
| `min`, `max`   | `number`                      | Bornes                           |
| `viewPortSize` | `number`                      | Taille visible                   |
| `onChange`     | `(value) => void`             | Callback lors de la modification |
| `bg`, `fg`     | `ColorInput`                  | Couleurs                         |

### Code

Le composant **Code** affiche du code avec coloration syntaxique via Tree-sitter.

#### API Renderable

```typescript
import { CodeRenderable, SyntaxStyle, RGBA, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const style = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromHex("#E6EDF3") },
  keyword: { fg: RGBA.fromHex("#FF7B72"), bold: true },
  string: { fg: RGBA.fromHex("#A5D6FF") },
})

const code = new CodeRenderable(renderer, {
  id: "example",
  width: 60,
  height: 10,
  content: 'function greet() { return "Hello"; }',
  filetype: "typescript",
  syntaxStyle: style,
  wrapMode: "word",
})

renderer.root.add(code)
```

#### API Construct

```typescript
import { Code, SyntaxStyle } from "@opentui/core"

const style = SyntaxStyle.fromStyles({ /* styles */ })

renderer.root.add(
  Code({
    id: "example",
    content: 'const x = 1',
    filetype: "typescript",
    syntaxStyle: style,
  }),
)
```

#### Configuration des styles

Utilisez `SyntaxStyle.fromStyles()` pour définir des couleurs et attributs selon la classe grammaticale. Le fichier liste des styles pour différents éléments (default, keyword, string, etc.).

#### Fichiers pris en charge

Typescript, Javascript, Python, JSON, Diff, Markdown, Bash, HTML, CSS, Rust, Go, C/C++, Zig et tout langage disposant d’une grammaire Tree-sitter.

#### Mode streaming

Activez `streaming: true` pour du code généré progressivement. Ajoutez du contenu à `code.content` pour mettre à jour l’affichage.

#### Sélection de texte

Définissez `selectable: true`, `selectionBg` et `selectionFg` pour activer la sélection et définir ses couleurs.

#### Concelment et formatage markdown

`conceal` masque certains caractères de formatage (utile pour le markdown).
`LineNumberRenderable` peut être associé au code pour afficher des numéros de ligne.

#### Propriétés héritées et supplémentaires

La table résume les propriétés héritées de `TextBufferRenderable` et les options supplémentaires (`content`, `filetype`, `syntaxStyle`, `streaming`, `conceal`, etc.).
Des styles spécialisés pour Markdown sont disponibles via `markup.*` (voir l’exemple de table de styles).

### Diff

Le composant **Diff** affiche des diffs unifiés ou séparés avec coloration syntaxique et numéros de ligne.

#### API Renderable

```typescript
import { DiffRenderable, SyntaxStyle, RGBA, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromHex("#E6EDF3") },
  string: { fg: RGBA.fromHex("#A5D6FF") },
  keyword: { fg: RGBA.fromHex("#FF7B72"), bold: true },
})

const diff = new DiffRenderable(renderer, {
  id: "diff",
  width: "100%",
  height: 16,
  diff: `diff --git a/app.ts b/app.ts
index 1111111..2222222 100644
--- a/app.ts
+++ b/app.ts
@@ -1,3 +1,3 @@
-const a = 1
+const a = 2
`,
  view: "split",
  filetype: "typescript",
  syntaxStyle,
  showLineNumbers: true,
})

renderer.root.add(diff)
```

#### API Construct

> Pas disponible. Utilisez `DiffRenderable`.

#### Propriétés principales

Le tableau liste les options comme `diff`, `view` (`"unified"` ou `"split"`), `filetype`, `syntaxStyle`, `wrapMode`, `conceal`, `showLineNumbers`, couleurs de lignes ajoutées/retirées, etc.

### Markdown

Le composant **Markdown** permet d’afficher du markdown avec une mise en forme synchrone et un surlignage optionnel des blocs de code via Tree-sitter.

#### API Renderable

````typescript
import { MarkdownRenderable, SyntaxStyle, RGBA, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const syntaxStyle = SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.list": { fg: RGBA.fromHex("#FF7B72") },
  "markup.raw": { fg: RGBA.fromHex("#A5D6FF") },
  default: { fg: RGBA.fromHex("#E6EDF3") },
})

const markdown = new MarkdownRenderable(renderer, {
  id: "readme",
  width: 60,
  content: "# Hello\n\n- One\n- Two\n\n```ts\nconst x = 1\n```",
  syntaxStyle,
})

renderer.root.add(markdown)
````

#### Mode conceal et streaming

`conceal: true` masque les marqueurs markdown (backticks, astérisques).
`streaming: true` permet d’ajouter du contenu au fur et à mesure (par exemple, pour afficher des logs).

#### Rendu personnalisé

La fonction `renderNode` permet de surcharger le rendu d’un token particulier et de se reposer sur le rendu par défaut sinon.

#### API Construct

> Pas disponible. Utilisez `MarkdownRenderable`.

#### Propriétés principales

`content`, `syntaxStyle`, `conceal`, `streaming`, `treeSitterClient`, `renderNode`.

### ASCIIFont

Le composant **ASCIIFont** affiche du texte en art ASCII.

#### API Renderable

```typescript
import { ASCIIFontRenderable, RGBA, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const title = new ASCIIFontRenderable(renderer, {
  id: "title",
  text: "OPENTUI",
  font: "tiny",
  color: RGBA.fromInts(255, 255, 255, 255),
})

renderer.root.add(title)
```

#### API Construct

```typescript
import { ASCIIFont, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

renderer.root.add(
  ASCIIFont({
    text: "HELLO",
    font: "block",
    color: "#00FF00",
  }),
)
```

#### Polices disponibles

Les polices incluses : `tiny`, `block`, `shade`, `slick`, `huge`, `grid`, `pallet`.

#### Positionnement et propriétés

On peut positionner le texte (`x`, `y`), changer la couleur, l’arrière‑plan, activer/désactiver la sélection, etc. La table des propriétés liste tous les paramètres (`text`, `font`, `color`, `backgroundColor`, `selectable`, `selectionBg`, `selectionFg`, `x`, `y`).

#### Exemples

Le fichier présente plusieurs exemples : écran d’accueil avec ASCII art, mise à jour dynamique du texte (compteur) et effets de couleur en superposant plusieurs ASCIIFont.

### TabSelect

Le composant **TabSelect** propose une sélection horizontale via des onglets avec défilement.

#### API Renderable

```typescript
import { TabSelectRenderable, TabSelectRenderableEvents, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const tabs = new TabSelectRenderable(renderer, {
  id: "tabs",
  width: 60,
  options: [
    { name: "Home", description: "Dashboard and overview" },
    { name: "Files", description: "File management" },
    { name: "Settings", description: "Application settings" },
  ],
  tabWidth: 20,
})

tabs.on(TabSelectRenderableEvents.ITEM_SELECTED, (index, option) => {
  console.log("Tab selected:", option.name)
})

tabs.focus()
renderer.root.add(tabs)
```

#### API Construct

```typescript
import { TabSelect, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const tabs = TabSelect({
  width: 60,
  tabWidth: 15,
  options: [
    { name: "Tab 1", description: "First tab" },
    { name: "Tab 2", description: "Second tab" },
    { name: "Tab 3", description: "Third tab" },
  ],
})

tabs.focus()
renderer.root.add(tabs)
```

#### Navigation au clavier

| Touche        | Action                        |
| ------------- | ----------------------------- |
| `Left` / `[`  | Aller à l’onglet précédent    |
| `Right` / `]` | Aller à l’onglet suivant      |
| `Enter`       | Sélectionner l’onglet courant |

#### Événements

`ITEM_SELECTED` et `SELECTION_CHANGED` sont émis respectivement lors de la validation et du survol d’un onglet.

#### Propriétés principales

La table récapitule les options (`width`, `options`, `tabWidth`, `backgroundColor`, `textColor`, `focusedBackgroundColor`, `focusedTextColor`, `selectedBackgroundColor`, `selectedTextColor`, `selectedDescriptionColor`, `showScrollArrows`, `showDescription`, `showUnderline`, `wrapSelection`, `keyBindings`, `keyAliasMap`).

#### Exemple d’interface à onglets

L’exemple complet montre comment synchroniser un `TabSelect` avec des panneaux de contenu via les événements et manipuler dynamiquement les onglets et le contenu.

#### Contrôle programmatique

Méthodes : `getSelectedIndex()`, `setSelectedIndex(index)`, `setOptions(options)`.

#### Comportement de défilement

Lorsque le nombre d’onglets dépasse la largeur, le composant gère automatiquement le scroll horizontal.

### FrameBuffer

Le composant **FrameBuffer** fournit une surface de rendu bas niveau pour dessiner des graphiques personnalisés. Il expose un tableau 2D de cellules, et des méthodes optimisées pour le dessin.

#### API Renderable

```typescript
import { FrameBufferRenderable, RGBA, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const canvas = new FrameBufferRenderable(renderer, {
  id: "canvas",
  width: 50,
  height: 20,
})

canvas.frameBuffer.fillRect(5, 2, 20, 10, RGBA.fromHex("#FF0000"))
canvas.frameBuffer.drawText("Hello!", 8, 6, RGBA.fromHex("#FFFFFF"))

renderer.root.add(canvas)
```

#### API Construct

```typescript
import { FrameBuffer, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

renderer.root.add(
  FrameBuffer({
    width: 50,
    height: 20,
  }),
)
```

#### Méthodes de dessin

* **`setCell(x, y, char, fg, bg, attributes?)`** : dessine un caractère à une position avec couleurs et attributs.
* **`setCellWithAlphaBlending(x, y, char, fg, bg)`** : applique un blending alpha pour des effets de transparence.
* **`drawText(text, x, y, fg, bg?, attributes?)`** : dessine du texte à une position.
* **`fillRect(x, y, width, height, color)`** : remplit un rectangle.
* **`drawFrameBuffer(destX, destY, sourceBuffer, sourceX?, sourceY?, sourceWidth?, sourceHeight?)`** : copie un buffer dans un autre.

#### Propriétés

`width` et `height` sont obligatoires. `respectAlpha` active le blending alpha. Les propriétés de position permettent un positionnement relatif ou absolu (`left`, `top`, etc.).

#### Exemples

Le fichier fournit deux exemples complets : un mini‑jeu où l’on déplace un personnage et un exemple de barre de progression. Ils démontrent l’utilisation des méthodes de dessin, la gestion du clavier et l’optimisation des couleurs.

#### Conseils de performance

Pour optimiser : batcher les mises à jour, éviter les appels répétés à `fillRect`, réutiliser des objets `RGBA` dans les boucles.

---

Cette documentation compile l’ensemble des guides et références disponibles pour OpenTUI. Elle devrait servir de base solide pour développer des interfaces terminal complexes avec cette bibliothèque.