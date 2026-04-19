# Provider Support Matrix

This matrix reflects the runtime as implemented today, not an aspirational roadmap.

## Support levels

- `supported`: expected to work as a normal user-facing provider path
- `supported with caveats`: supported, but with notable runtime or product limitations
- `not supported`: exposed in docs or config only after implementation exists

## Matrix

| Provider path | Status | Auth | Caveats |
|---|---|---|---|
| OpenAI API key | supported | API key | Primary implementation path |
| OpenAI OAuth | supported with caveats | ChatGPT OAuth | Model list restricted to the allowed OAuth catalog |
| Anthropic API key | supported | API key | No OAuth support |
| Google API key | supported | API key | Standard Gemini provider path |
| Google OAuth | supported with caveats | Google OAuth | Uses Code Assist endpoints, may require onboarding, and enforces a single-tool-per-response constraint |
| Mistral API key | supported | API key | Standard API-key integration |
| xAI API key | supported | API key | Standard API-key integration |
| Groq API key | supported with caveats | API key | Uses a custom chat/tool adapter rather than the common AI SDK flow |
| Ollama local | supported with caveats | none | Requires local runtime reachability and local model availability |
| Ollama cloud | supported with caveats | API key | Depends on Ollama cloud account/model access |
| OpenRouter API key | supported with caveats | API key | Upstream model behavior varies by routed provider/model |

## Practical guidance

- Prefer OpenAI, Anthropic, Mistral, or xAI for the most predictable API-key flows.
- Prefer OpenAI API-key auth over OpenAI OAuth if you need the widest model freedom.
- Treat Google OAuth and Ollama as higher-variance paths with more environment-specific failure modes.
- Treat OpenRouter as a convenience surface, not a uniform compatibility guarantee.

## Notes for contributors

- If a provider is exposed in `src/utils/config.ts`, its status here should be kept aligned.
- Do not mark a provider as fully supported unless install, auth, model selection, streaming, and tool-calling behavior are all expected to be production-usable.
