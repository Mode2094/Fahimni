export type OpenAiKeyTestResult = { ok: true; code: 'ok' } | { ok: false; code: 'invalid' | 'network' | 'error' };

// Low-cost official validity probe: listing models is free and only requires
// the key itself. The candidate key is never logged or returned.
export async function testOpenAiKey(key: string): Promise<OpenAiKeyTestResult> {
  const candidate = key.trim();
  if (!candidate) return { ok: false, code: 'invalid' };
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${candidate}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return { ok: true, code: 'ok' };
    if (response.status === 401 || response.status === 403) return { ok: false, code: 'invalid' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'network' };
  }
}
