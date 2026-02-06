## Providers existants (côté LLM) dans ce workspace

Implémentés dans `src/agent/provider/` et instanciés dans `src/agent/Agent.ts` :

- **OpenAI** (`openai`)
- **Anthropic** (`anthropic`)
- **Google** (`google`)
- **Mistral** (`mistral`)
- **xAI** (`xai`)
- **Ollama** (`ollama`, avec logique “local vs cloud”)

Déclarés dans la config (`AI_PROVIDERS` dans [src/utils/config.ts](cci:7://file:///c:/Users/Nassim/Projects/mosaic/src/utils/config.ts:0:0-0:0)) mais **pas implémentés** côté agent :
- **OpenRouter** (`openrouter`)  
  => aujourd’hui c’est une différence “corrigeable” : le provider apparaît dans la liste, mais `Agent.createProvider()` ne sait pas le construire.

---

## Différences “corrigeables” entre providers (incohérences / gaps)

### 1) **OpenRouter déclaré mais non supporté**
- **Constat**  
  - `AI_PROVIDERS` contient `openrouter`
  - `Agent.createProvider()` n’a pas de `case 'openrouter'`
  - Pas de `src/agent/provider/openrouter.ts`
- **Impact**  
  - Tu peux sélectionner `openrouter` via config/commande, mais l’agent crashera sur `Unknown provider: openrouter`.
- **Correction typique**  
  - Soit **retirer** `openrouter` de `AI_PROVIDERS` (si pas prêt)  
  - Soit **implémenter** `OpenRouterProvider` + l’ajouter au switch.

### 3) **Logs/debug non uniformes**
- **OpenAI** : beaucoup de `debugLog`, y compris OAuth.
- **Anthropic/Google** : logs `starting stream`, logs tool-call, logs finish.
- **Mistral/xAI** : très peu (Mistral aucun debug, xAI aucun debug).
- **Pourquoi c’est corrigeable**  
  - Quand tu débugges des tool-calls/erreurs, tu n’as pas les mêmes infos selon provider.
- **Correction typique**  
  - Ajouter des `debugLog` alignés (start/tool-call/finish/error) à Mistral et xAI et ceux qui n'en ont pas pour etre sur de l'homogénéité des logs providers.

### 4) **Gestion “OAuth” uniquement pour OpenAI (et config partiellement prévue pour d’autres)**
- **Constat**  
  - `ProviderConfig.auth` supporte `oauth`, `MosaicConfig` a `oauthTokens`/`oauthModels`.
  - Dans `getAllProviders()`: `oauthModelsForProvider = provider.id === 'anthropic' ? [] : oauthModels[provider.id] || []`  
    => logique spéciale “Anthropic n’a pas d’OAuth models”.
  - Mais **seul OpenAIProvider** implémente réellement refresh + fetch custom + `setOAuthTokenForProvider`.
- **Différence corrigeable**  
  - Soit assumer “OpenAI only” et verrouiller l’UX (ne pas exposer oauth pour les autres),  
  - Soit implémenter OAuth (au moins token injection) pour Google/Mistral/xAI/OpenRouter si prévu.

### 5) **`maxContextTokens` présent dans les types/config mais non utilisé par les providers**
- **Constat**  
  - `ProviderConfig.maxContextTokens` existe, `Agent` calcule `resolvedMaxContextTokens` (champ), et `MosaicConfig` expose `maxContextTokens`.
  - Mais côté providers, je ne vois **aucun** usage de `maxContextTokens` dans les appels `streamText(...)`.
- **Pourquoi c’est corrigeable**  
  - Si l’UI/config laisse penser que ça limite le contexte, c’est actuellement un “no-op”.
- **Correction typique**  
  - Appliquer `maxTokens`/`maxOutputTokens`/`maxContext` selon l’API (ça dépend des SDK), ou retirer l’option si non supportée.

### 6) **Ollama a une préparation très spécifique que les autres n’ont pas**
- **Constat**  
  - `Agent.ensureProviderReady()` ne fait quelque chose que pour **Ollama** (check/start).
  - Les autres providers n’ont pas de check “API key présente / reachable”.
- **Corrigeable (si tu veux homogénéiser)**  
  - Ajouter des checks légers : “api key manquante” => erreur explicite avant de streamer.
  - Aujourd’hui, certains providers vont juste échouer plus tard avec un message moins clair.

### 7) **Transform “tools schema strict” seulement pour OpenAI responses**
- **Constat**
  - OpenAIProvider transforme les schémas Zod pour rendre toutes les propriétés requises via `transformToolsForResponsesApi()` quand endpoint `responses`.
  - Les autres providers passent `tools` “as-is”.
- **Pourquoi c’est corrigeable**
  - Si tu observes des divergences de tool-call (args partiels / invalides) selon provider, c’est souvent ce genre de détail.
- **Correction typique**
  - Soit rendre la stratégie explicite (OpenAI-only parce que Responses API est stricte),
  - Soit appliquer un traitement similaire là où nécessaire.

---

## Différences “corrigeables” dans la config (AI_PROVIDERS)

### 8) **Incohérences de modèles / libellés**
Exemples visibles :
- `openrouter` contient un modèle `anthropic/claude-opus-4.5` mais `name: 'Claude 3'` (ça a l’air faux / incohérent).
- `ollama` : mélange “local” (`gpt-oss:120b`) et “cloud” (`glm-4.7:cloud`) avec `requiresApiKey` au niveau modèle. C’est OK, mais il faut que l’UX (commande `/provider`, setup, etc.) reflète bien ce `requiresApiKey` par modèle (je vois `modelRequiresApiKey()` qui gère ça, donc plutôt bon).

### 9) **Ollama ne fonctionne pas pour Explore, et peut etre d'autres outils**