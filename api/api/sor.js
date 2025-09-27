module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  const OPENAI_MODEL  = process.env.OPENAI_MODEL  || "gpt-4o-mini";
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

  if (req.method === "GET") {
    const provider = OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none");
    return res.status(200).json({ ok: true, provider });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const prompt = String(body.prompt || "").trim();
    const lang   = String(body.lang || "tr");
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
    if (!prompt) return res.status(400).json({ error: "prompt_required" });

    const instruction =
      lang === "en" ? "Please respond in English only."
    : lang === "de" ? "Antworten Sie ausschließlich auf Deutsch."
    : lang === "fr" ? "Répondez uniquement en français."
    : lang === "ar" ? "يرجى الإجابة باللغة العربية فقط."
    : "Lütfen yalnızca Türkçe yanıt ver.";

    const finalPrompt = `${instruction}\n\n${prompt}`;
    const provider = body.provider || (OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none"));
    if (provider === "none") return res.status(500).json({ error: "no_provider_configured" });

    let output = "";

    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: "user", content: finalPrompt }], temperature })
      });
      if (!r.ok) return res.status(500).json({ error: "openai_http_" + r.status });
      const j = await r.json();
      output = j?.choices?.[0]?.message?.content ?? "";
    } else {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] })
      });
      if (!r.ok) return res.status(500).json({ error: "gemini_http_" + r.status });
      const j = await r.json();
      output = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }

    return res.status(200).json({ provider, output, lang });
  } catch (e) {
    return res.status(500).json({ error: "upstream_error", detail: String(e?.message || e) });
  }
};
