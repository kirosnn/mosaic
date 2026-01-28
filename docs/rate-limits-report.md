# Rapport: Prevention des erreurs de rate limit

Date: 2026-01-27
Scope: analyse du code Mosaic (providers + pipeline d execution) et recommandations pour eviter les erreurs de rate limit des providers.

## 1) Constats dans le code (etat actuel)

### 1.1 Couche provider (appels LLM)
- `src/agent/provider/openai.ts`, `src/agent/provider/anthropic.ts`, `src/agent/provider/google.ts`, `src/agent/provider/mistral.ts`, `src/agent/provider/xai.ts` utilisent `streamText(...)` sans strategie explicite de retry/backoff pour erreurs 429 ou 5xx.
- `src/agent/provider/ollama.ts` contient un retry pour erreurs transientes (ECONNREFUSED, ETIMEDOUT, 500, socket), mais pas de gestion 429 ni de respect d un `Retry-After`.

### 1.2 Boucle d agent / steps
- `src/agent/Agent.ts` fixe `maxSteps: 100`. Avec tool calling, `streamText` peut declencher plusieurs requetes par message utilisateur. Plus de steps => plus de risques de rate limit.

### 1.3 Serveur web / concurrence
- `src/web/server.tsx` ne met pas de limite de concurrence par provider ou par session. Plusieurs requetes paralleles peuvent partir sans limitation.
- `currentAbortController` est global: en cas de requetes simultanees, il peut etre ecrase et ne protege pas contre la concurrence.

### 1.4 Prompts et retries
- `src/agent/prompts/systemPrompt.ts` insiste sur le retry immediat des outils en cas d erreur. Sans exception pour 429, cela peut amplifier les rate limits (boucle de retry trop agressive).

### 1.5 Absence de capteurs de limite
- Pas de lecture des headers `Retry-After`, `x-ratelimit-*` ou equivalents.
- Pas de budget tokens/minute, pas de file d attente (queue), pas de backoff global.

## 2) Risques concrets observes

- Erreurs 429 (rate limit) non gerees => echec immediat du stream.
- Retry implicite par l agent (via prompt) qui peut empirer la situation.
- Degradation en charge: plusieurs utilisateurs ou plusieurs fenetres web peuvent saturer les quotas.
- Reasoning auto et maxSteps eleves => explosion du nombre de requetes et du volume tokens.

## 3) Recommandations precises (par priorite)

### Priorite A: Gestion robuste des 429 et du backoff

1) Ajouter un retry/backoff centralise par provider
- Fichier cible: `src/agent/provider/*.ts` (tous les providers).
- Objectif: si erreur 429 ou 5xx, appliquer un backoff exponentiel avec jitter, et respecter `Retry-After` quand disponible.
- Strategie proposee:
  - maxRetries: 3 a 5
  - baseDelayMs: 500 a 1000
  - backoff: delay = min(maxDelay, baseDelay * 2^attempt + random(0, 250))
  - Si header `Retry-After` existe, attendre ce delai (en secondes) au lieu du backoff.
  - Ne pas retry sur erreurs 4xx autres que 429.

2) Normaliser la detection des erreurs rate limit
- Creer un helper (ex: `src/agent/provider/rateLimit.ts` ou `src/utils/rateLimit.ts`) qui:
  - detecte 429 via structure d erreur (si le SDK expose status / response)
  - ou via message texte (fallback) quand le type est inconnu
  - extrait `Retry-After` et autres headers si disponibles

### Priorite B: Limitation de concurrence et file d attente

3) Limiteur global (semaphore) par provider et par modele
- Point d integration: `src/agent/Agent.ts` ou `src/web/server.tsx`.
- But: eviter les rafales de requetes simultanees.
- Exemple: max 1 ou 2 requetes concurrentes par provider+model.
- En cas de depassement: mettre en file d attente (queue) ou retourner une erreur locale type 429 avec message clair.

4) Limiteur cote serveur web
- Dans `src/web/server.tsx`, ajouter une file d attente pour `/api/message`:
  - soit une queue FIFO simple
  - soit un refus explicite si une requete est deja en cours (reponse 429 locale)
- Cela reduit les collisions si plusieurs sessions web sont ouvertes.

### Priorite C: Reduction de la charge par requete

5) Ajuster `maxSteps` en dynamique
- Aujourd hui: `maxSteps: 100` fixe dans `src/agent/Agent.ts`.
- Propose:
  - base: 10-20
  - augmenter seulement si l agent justifie une longue sequence d outils
  - baisser automatiquement apres un 429

6) Raisonner sur le reasoning
- `shouldEnableReasoning` active parfois le mode reasoning fort pour tous les appels.
- Recommandation:
  - activer reasoning uniquement quand demande explicite de l utilisateur ou quand un tool call complex est requis
  - proposer une option config pour desactiver reasoning par defaut

7) Reduction du contexte envoye
- Le serveur envoie tout l historique client (`buildConversationHistory`).
- Ajouter:
  - resume/summarization des anciens tours
  - limite sur le nombre de messages conserves
  - eviction des tours qui ne sont pas necessaires

### Priorite D: Observabilite et UX

8) Logging rate limit
- Loguer les erreurs 429 avec timestamp, provider, modele, delai applique.
- Afficher dans l UI un message clair: "Rate limit atteint, reprise dans Xs".

9) Telemetrie interne (optionnel)
- Compteur de requetes/minute et tokens/minute par provider.
- Utile pour ajuster automatiquement la pression.

### Priorite E: Prompts et comportements d agent

10) Adapter les instructions de retry en cas de 429
- Dans `src/agent/prompts/systemPrompt.ts`, ajouter une regle:
  - si erreur rate limit, attendre / backoff avant de reessayer
  - ne pas enchainer des retries immediats

## 4) Plan d implementation propose (ordre minimal et efficace)

1) Ajouter helper rate limit + backoff (Priorite A)
2) Integrer le helper dans chaque provider (OpenAI, Anthropic, Google, Mistral, xAI, Ollama)
3) Ajouter un semaphore global dans le serveur web (Priorite B)
4) Baisser `maxSteps` par defaut et le rendre configurable
5) Ajouter un plafonnement de l historique + option de resume

## 5) Chemin des fichiers concernes

- Providers: `src/agent/provider/openai.ts`, `src/agent/provider/anthropic.ts`, `src/agent/provider/google.ts`, `src/agent/provider/mistral.ts`, `src/agent/provider/xai.ts`, `src/agent/provider/ollama.ts`
- Agent: `src/agent/Agent.ts`
- Prompts: `src/agent/prompts/systemPrompt.ts`
- Serveur web: `src/web/server.tsx`
- Utils: `src/utils/models.ts` (source d infos modele), `src/utils/config.ts`

## 6) Resultat attendu

Apres ces changements:
- Les erreurs 429 deviennent rares et auto-resolues via backoff.
- Les pics de charge ne cassent plus l experience utilisateur.
- La charge tokens/requetes est mieux controlee.
- L agent evite de reessayer trop vite en cas de rate limit.

---
Fin du rapport.
