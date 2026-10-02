// Vercel serverless function: proxies Email Preflight reviews to the Claude API.
// The API key stays here, never in the browser.
const INSTRUCTIONS = require('./_instructions');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const ACCESS_CODE = process.env.ACCESS_CODE || '';           // optional: leave blank for open access
const MAX_PROMPT_CHARS = 120000;
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 1500000;
const SEP = '\u001e';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ code: 'error' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ code: 'not_configured' });
  if (ACCESS_CODE && req.headers['x-access-code'] !== ACCESS_CODE) {
    return res.status(401).json({ code: req.headers['x-access-code'] ? 'unauthorized' : 'access_required' });
  }

  const { prompt, images = [] } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.startsWith('# INPUT')) return res.status(400).json({ code: 'error' });
  if (prompt.length > MAX_PROMPT_CHARS) return res.status(413).json({ code: 'prompt_too_large' });
  if (!Array.isArray(images) || images.length > MAX_IMAGES ||
      images.some((i) => !i || i.media_type !== 'image/jpeg' || typeof i.data !== 'string' || i.data.length > MAX_IMAGE_B64)) {
    return res.status(400).json({ code: 'image_rejected' });
  }

  const content = [
    ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } })),
    { type: 'text', text: prompt },
  ];

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, stream: true, system: INSTRUCTIONS, messages: [{ role: 'user', content }] }),
    });
  } catch (e) {
    return res.status(502).json({ code: 'error' });
  }

  if (!upstream.ok) {
    const code = upstream.status === 429 || upstream.status === 529 ? 'rate_limited'
      : upstream.status === 413 ? 'prompt_too_large' : 'error';
    console.error('Anthropic error', upstream.status, await upstream.text().catch(() => ''));
    return res.status(upstream.status === 429 ? 429 : 502).json({ code });
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });

  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = '', stopReason = null, error = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') res.write(ev.delta.text);
        else if (ev.type === 'message_delta' && ev.delta) stopReason = ev.delta.stop_reason || stopReason;
        else if (ev.type === 'error') error = ev.error && ev.error.type === 'overloaded_error' ? 'rate_limited' : 'error';
      }
    }
  } catch (e) {
    error = 'error';
  }
  if (stopReason === 'refusal') error = 'refused';
  res.end(SEP + JSON.stringify({ stop_reason: stopReason, error }));
};
