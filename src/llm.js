/**
 * Send a chat completion request to an OpenAI-compatible endpoint.
 *
 * @param {{ baseUrl: string, apiKey?: string, model: string }} config
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<string>}
 */
export async function chat(config, messages) {
  const baseUrl = String(config.baseUrl ?? '').replace(/\/+$/, '');

  const headers = { 'content-type': 'application/json' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `chat request failed with status ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? '';
}