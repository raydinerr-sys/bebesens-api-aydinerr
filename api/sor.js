// api/sor.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL   = process.env.OPENAI_MODEL   || "gpt-4o-mini";

const GEMINI_API_KEY     = process.env.GEMINI_API_KEY     || "";
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || "v1beta";
const GEMINI_MODEL       = process.env.GEMINI_MODEL       || "gemini-1.5-flash-latest";

// ---- Yardımcılar (throw YOK; hep JSON döndürür) ----
async function askOpenAI(prompt, temperature) {
  if (!OPENAI_API_KEY) return { ok: false, error: "openai_not_configured" };
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: prompt}],
        temperature
      })
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: "openai_http_" + r.status, body: text };
    const j = JSON.parse(text);
    const output = j?.choices?.[0]?.message?.content ?? "";
    return { ok: true, provider: "openai", output };
  } catch (e) {
    return { ok: false, error: "openai_exception", detail: String(e) };
  }
}

async function askGemini(prompt) {
  if (!GEMINI_API_KEY) return { ok: false, error: "gemini_not_configured" };

  const versions = [...new Set([GEMINI_API_VERSION, "v1beta"])]
  const models   = [...new Set([GEMINI_MODEL, "gemini-1.5-flash-latest", "gemini-1.5-flash", "gemini-1.5-flash-8b"])]

  let last = null;
  for (const v of versions) {
    for (const m of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/${v}/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const text = await r.text();
        if (!r.ok) { last = { error: "gemini_http_" + r.status, body: text, version: v, model: m }; continue; }
        const j = JSON.parse(text);
        const output = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        return { ok: true, provider: "gemini", output, version: v, model: m };
      } catch (e) {
        last = { error: "gemini_exception", detail: String(e), version: v, model: m };
      }
    }
  }
  return { ok: false, error: "gemini_all_failed", last };
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET → sağlık
  if (req.method === "GET") {
    const provider = OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none");
    return res.status(200).json({
      ok: true,
      provider,
      openai_model: OPENAI_MODEL,
      gemini_model: GEMINI_MODEL,
      gemini_api_version: GEMINI_API_VERSION
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // Body parse
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}"): (req.body || {});
  } catch {
    return res.status(400).json({ error: "bad_json" });
  }

  const rawPrompt   = String(body.prompt || "").trim();
  const lang        = String(body.lang || "tr");
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
  if (!rawPrompt) return res.status(400).json({ error: "prompt_required" });

  const instruction =
      lang === "de" ? "Antworten Sie ausschließlich auf Deutsch."
    : lang === "fr" ? "Répondez uniquement en français."
    : lang === "ar" ? "يرجى الإجابة باللغة العربية فقط."
    : lang === "tr" ? "Lütfen yalnızca Türkçe yanıt ver."
    : "Please respond in English only.";
  const prompt = `${instruction}\n\n${rawPrompt}`;

  const wanted =
    body.provider || (OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none"));

  // OPENAI zorla
  if (wanted === "openai") {
    const r = await askOpenAI(prompt, temperature);
    return r.ok
      ? res.status(200).json({ provider: r.provider, output: r.output, lang })
      : res.status(502).json(r);
  }

  // GEMINI zorla
  if (wanted === "gemini") {
    const r = await askGemini(prompt);
    return r.ok
      ? res.status(200).json({ provider: r.provider, output: r.output, lang, version: r.version, model: r.model })
      : res.status(502).json(r);
  }

  // OTOMATİK: önce OpenAI, olmazsa Gemini
  if (OPENAI_API_KEY) {
    const o = await askOpenAI(prompt, temperature);
    if (o.ok) return res.status(200).json({ provider: o.provider, output: o.output, lang });
    if (GEMINI_API_KEY) {
      const g = await askGemini(prompt);
      return g.ok
        ? res.status(200).json({ provider: g.provider, output: g.output, lang, fallback: "from_openai_error", version: g.version, model: g.model })
        : res.status(502).json({ error: "both_failed", openai: o, gemini: g });
    }
    return res.status(502).json(o);
  }

  if (GEMINI_API_KEY) {
    const g = await askGemini(prompt);
    return g.ok
      ? res.status(200).json({ provider: g.provider, output: g.output, lang, version: g.version, model: g.model })
      : res.status(502).json(g);
  }

  return res.status(500).json({ error: "no_provider_configured" });
};