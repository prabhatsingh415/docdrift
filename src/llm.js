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
    const status = response.status;
    if ([429, 502, 503, 504].includes(status)) {
      throw new Error(
        `The model is rate-limited or busy right now (HTTP ${status}). Try again in a minute, or set another model in DOCDRIFT_MODEL.`,
      );
    }
    if (status === 401 || status === 403) {
      throw new Error(
        `The API key was rejected (HTTP ${status}). Check DOCDRIFT_API_KEY.`,
      );
    }
    throw new Error(`The model request failed (HTTP ${status}).`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? '';
}