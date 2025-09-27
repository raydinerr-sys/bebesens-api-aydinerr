// api/sor.js
// Basit GET/POST + OpenAI→Gemini otomatik fallback
module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
  const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-1.5-flash-latest";

  // Sağlık bilgisi
  if (req.method === "GET") {
    const provider = OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none");
    return res.status(200).json({
      ok: true,
      provider,
      openai_model: OPENAI_MODEL,
      gemini_model: GEMINI_MODEL
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Body oku
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}"): (req.body || {});
  } catch (_) { body = {}; }

  const prompt      = String(body.prompt || "").trim();
  const lang        = String(body.lang || "tr");
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
  let   providerReq = String(body.provider || "").trim().toLowerCase();

  if (!prompt) return res.status(400).json({ error: "prompt_required" });

  const instruction =
      lang === "tr" ? "Lütfen yalnızca Türkçe yanıt ver."
    : lang === "de" ? "Antworten Sie ausschließlich auf Deutsch."
    : lang === "fr" ? "Répondez uniquement en français."
    : lang === "ar" ? "يرجى الإجابة باللغة العربية فقط."
    : "Please respond in English only.";

  const finalPrompt = `${instruction}\n\n${prompt}`;

  // Sağlayıcı seçimi (elle belirtilmediyse otomatik)
  if (!providerReq) {
    providerReq = OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none");
  }
  if (providerReq === "none") {
    return res.status(500).json({ error: "no_provider_configured" });
  }

  // Yardımcı çağrılar
  async function callOpenAI() {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: finalPrompt }],
        temperature
      })
    });
    const text = await r.text();
    if (!r.ok) {
      return { ok: false, status: r.status, raw: text };
    }
    const j = JSON.parse(text);
    const output = j?.choices?.[0]?.message?.content ?? "";
    return { ok: true, output };
  }

  async function callGemini() {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: finalPrompt }] }]
      })
    });
    const bodyText = await r.text();
    if (!r.ok) {
      return { ok: false, status: r.status, raw: bodyText };
    }
    const j = JSON.parse(bodyText);
    const output = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
    return { ok: true, output };
  }

  try {
    // 1) Sağlayıcı açıkça GEMINI ise
    if (providerReq === "gemini") {
      if (!GEMINI_API_KEY) return res.status(500).json({ error: "gemini_key_missing" });
      const g = await callGemini();
      if (!g.ok) return res.status(500).json({ error: "gemini_request_failed", status: g.status, body: g.raw });
      return res.status(200).json({ provider: "gemini", output: g.output, lang });
    }

    // 2) Sağlayıcı OPENAI ise (veya otomatik seçim openai çıktıysa)
    if (providerReq === "openai") {
      if (!OPENAI_API_KEY) {
        // Key yoksa gerekirse direkt Gemini'ye düş
        if (GEMINI_API_KEY) {
          const g = await callGemini();
          if (!g.ok) return res.status(500).json({ error: "gemini_request_failed", status: g.status, body: g.raw });
          return res.status(200).json({ provider: "gemini", fallbackFrom: "openai", output: g.output, lang });
        }
        return res.status(500).json({ error: "openai_key_missing" });
      }
      const o = await callOpenAI();
      if (o.ok) {
        return res.status(200).json({ provider: "openai", output: o.output, lang });
      }
      // Otomatik fallback: 401/429 (kimlik/limit) gibi durumlarda Gemini'yi dene
      if ((o.status === 401 || o.status === 429) && GEMINI_API_KEY) {
        const g = await callGemini();
        if (!g.ok) {
          return res.status(500).json({ error: "gemini_request_failed", status: g.status, body: g.raw, fallbackFrom: "openai" });
        }
        return res.status(200).json({ provider: "gemini", fallbackFrom: "openai", output: g.output, lang });
      }
      // Diğer OpenAI hataları
      return res.status(500).json({ error: "openai_request_failed", status: o.status, body: o.raw });
    }

    // 3) Bilinmeyen provider
    return res.status(400).json({ error: "unknown_provider", provider: providerReq });

  } catch (e) {
    return res.status(500).json({ error: "upstream_error", detail: String(e?.message || e) });
  }
};
