// api/sor.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL   = process.env.OPENAI_MODEL   || "gpt-4o-mini";

const GEMINI_API_KEY     = process.env.GEMINI_API_KEY     || "";
const GEMINI_MODEL       = process.env.GEMINI_MODEL       || "gemini-1.5-flash";
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || "v1";

module.exports = async (req, res) => {
  try {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.status(200).end();

    // Sağlık (GET)
    if (req.method === "GET") {
      const provider =
        OPENAI_API_KEY ? "openai" :
        (GEMINI_API_KEY ? "gemini" : "none");

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

    // Body parse
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}"): (req.body || {});
    } catch (_) {
      return res.status(400).json({ error: "bad_json" });
    }

    const prompt = String(body.prompt || "").trim();
    const lang   = String(body.lang || "tr");
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
    if (!prompt) return res.status(400).json({ error: "prompt_required" });

    // Dil talimatı
    const instruction =
        lang === "de" ? "Antworten Sie ausschließlich auf Deutsch."
      : lang === "fr" ? "Répondez uniquement en français."
      : lang === "ar" ? "يرجى الإجابة باللغة العربية فقط."
      : lang === "tr" ? "Lütfen yalnızca Türkçe yanıt ver."
      : "Please respond in English only.";

    const finalPrompt = `${instruction}\n\n${prompt}`;

    // Yardımcılar
    const askOpenAI = async () => {
      if (!OPENAI_API_KEY) throw new Error("openai_not_configured");
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
      if (!r.ok) throw new Error(`openai_http_${r.status} ${text}`);
      const j = JSON.parse(text);
      return j?.choices?.[0]?.message?.content ?? "";
    };

    const askGemini = async () => {
      if (!GEMINI_API_KEY) throw new Error("gemini_not_configured");
      const base = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}`;
      const modelsToTry = [
        GEMINI_MODEL,              // env: gemini-1.5-flash
        "gemini-1.5-flash-8b",     // hafif sürüm
        "gemini-1.5-pro"           // daha güçlü sürüm
      ];
      let lastErr = null;

      for (const m of modelsToTry) {
        try {
          const url = `${base}/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] })
          });
          const text = await r.text();
          if (!r.ok) {
            // 404 ise sıradaki modeli dene
            if (r.status === 404) { lastErr = `gemini_http_404 ${text}`; continue; }
            throw new Error(`gemini_http_${r.status} ${text}`);
          }
          const j = JSON.parse(text);
          const out = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          return out;
        } catch (e) {
          lastErr = String(e);
          // sıradaki modeli dene
        }
      }
      throw new Error(`gemini_not_found_all ${lastErr || ""}`);
    };

    // Sağlayıcı seçimi
    const wanted = body.provider || 
      (OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none"));

    if (wanted === "openai") {
      const output = await askOpenAI();
      return res.status(200).json({ provider: "openai", output, lang });
    }
    if (wanted === "gemini") {
      const output = await askGemini();
      return res.status(200).json({ provider: "gemini", output, lang });
    }

    // Otomatik: önce OpenAI, hata olursa Gemini
    if (OPENAI_API_KEY) {
      try {
        const output = await askOpenAI();
        return res.status(200).json({ provider: "openai", output, lang });
      } catch (e) {
        if (GEMINI_API_KEY) {
          try {
            const output = await askGemini();
            return res.status(200).json({ provider: "gemini", output, lang });
          } catch (g) {
            return res.status(502).json({
              error: "both_failed",
              openai_error: String(e),
              gemini_error: String(g)
            });
          }
        }
        return res.status(502).json({ error: "openai_failed_no_gemini", detail: String(e) });
      }
    } else if (GEMINI_API_KEY) {
      const output = await askGemini();
      return res.status(200).json({ provider: "gemini", output, lang });
    }

    return res.status(500).json({ error: "no_provider_configured" });
  } catch (err) {
    // Artık “FUNCTION_INVOCATION_FAILED” yerine JSON dönüyor
    return res.status(500).json({ error: "handler_crashed", detail: String(err?.stack || err) });
  }
};