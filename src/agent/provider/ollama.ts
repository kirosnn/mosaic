import { Ollama } from 'ollama';

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function* sendToOllama(
  messages: OllamaMessage[],
  model: string,
  systemPrompt?: string
): AsyncGenerator<string> {
  const ollamaClient = new Ollama();

  const finalMessages = systemPrompt
    ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
    : messages;

  const response = await ollamaClient.chat({
    model: model,
    messages: finalMessages.map(msg => ({
      role: msg.role,
      content: msg.content,
    })),
    stream: true,
  });

  for await (const chunk of response) {
    if (chunk.message?.content) {
      yield chunk.message.content;
    }
  }
}
