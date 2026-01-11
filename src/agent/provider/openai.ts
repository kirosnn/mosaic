import { streamText, CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export async function* sendToOpenAI(
  messages: CoreMessage[],
  model: string,
  apiKey?: string,
  systemPrompt?: string
): AsyncGenerator<string> {
  const openai = createOpenAI({
    apiKey: apiKey,
  });

  const result = streamText({
    model: openai(model),
    messages: messages,
    system: systemPrompt,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
