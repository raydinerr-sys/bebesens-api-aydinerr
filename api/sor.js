// api/sor.js — OpenAI / Gemini destekli
module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  const OPENAI_MODEL   = process.env.OPENAI_MODEL   || "gpt-4o-mini";
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

  if (req.method === "GET") {
    const provider = OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none");
    return res.status(200).json({ ok: true, provider });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}"): (req.body || {});

    const prompt = String(body.prompt || "").trim();
    const lang   = String(body.lang || "en");
    const temp   = typeof body.temperature === "number" ? body.temperature : 0.7;

    if (!prompt) return res.status(400).json({ error: "prompt_required" });

    const instruction =
      lang === "tr" ? "Lütfen sadece Türkçe yanıtla."
    : lang === "de" ? "Bitte antworte nur auf Deutsch."
    : lang === "fr" ? "Réponds uniquement en français, s'il te plaît."
    : lang === "ar" ? "من فضلك أجب باللغة العربية فقط."
    : "Please answer in English only.";

    const finalPrompt = `${instruction}\n\n${prompt}`;

    // Kullanıcı isterse sağlayıcıyı manuel seçebilir: { provider:"openai"|"gemini" }
    const chosen = body.provider || (OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none"));
    if (chosen === "none") {
      return res.status(500).json({ error: "no_provider_configured" });
    }

    let output = "";

    if (chosen === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "user", content: finalPrompt }],
          temperature: temp
        })
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        return res.status(500).json({ error: "openai_request_failed", status: r.status, body: txt });
      }
      const j = await r.json();
      output = j?.choices?.[0]?.message?.content ?? "";
    } else {
      // Gemini
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] })
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        return res.status(500).json({ error: "gemini_request_failed", status: r.status, body: txt });
      }
      const j = await r.json();
      output = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }

    return res.status(200).json({ provider: chosen, output, lang });
  } catch (e) {
    return res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
  }
};