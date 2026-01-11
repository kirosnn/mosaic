import { streamText, CoreMessage } from 'ai';
import { createMistral } from '@ai-sdk/mistral';

export async function* sendToMistral(
  messages: CoreMessage[],
  model: string,
  apiKey?: string,
  systemPrompt?: string
): AsyncGenerator<string> {
  const mistral = createMistral({
    apiKey: apiKey,
  });

  const result = streamText({
    model: mistral(model),
    messages: messages,
    system: systemPrompt,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
