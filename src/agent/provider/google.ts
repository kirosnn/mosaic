import { streamText, CoreMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export async function* sendToGoogle(
  messages: CoreMessage[],
  model: string,
  apiKey?: string,
  systemPrompt?: string
): AsyncGenerator<string> {
  const google = createGoogleGenerativeAI({
    apiKey: apiKey,
  });

  const result = streamText({
    model: google(model),
    messages: messages,
    system: systemPrompt,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
