import { streamText, CoreMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

export async function* sendToAnthropic(
  messages: CoreMessage[],
  model: string,
  apiKey?: string,
  systemPrompt?: string
): AsyncGenerator<string> {
  const anthropic = createAnthropic({
    apiKey: apiKey,
  });

  const result = streamText({
    model: anthropic(model),
    messages: messages,
    system: systemPrompt,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
