import { streamText, CoreMessage } from 'ai';
import { createXai } from '@ai-sdk/xai';

export async function* sendToXai(
  messages: CoreMessage[],
  model: string,
  apiKey?: string,
  systemPrompt?: string
): AsyncGenerator<string> {
  const xai = createXai({
    apiKey: apiKey,
  });

  const result = streamText({
    model: xai(model),
    messages: messages,
    system: systemPrompt,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
