// api/sor.js
// Basit GET/POST + OpenAI→Gemini otomatik fallback (v1 endpoint, -latest fallback, provider seçimi)
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
  let providerReq   = String(body.provider || "").trim().toLowerCase();

  if (!prompt) return res.status(400).json({ error: "prompt_required" });

  const instruction =
      lang === "tr" ? "Lütfen yalnızca Türkçe yanıt ver."
    : lang === "de" ? "Antworten Sie ausschließlich auf Deutsch."
    : lang === "fr" ? "Répondez uniquement en français."
    : lang === "ar" ? "يرجى الإجابة باللغة العربية فقط."
    : "Please respond in English only.";

  const finalPrompt = `${instruction}\n\n${prompt}`;

  // --- OpenAI çağrısı (değiştirme) ---
  async function callOpenAI(finalPrompt, temperature) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: finalPrompt }],
        temperature,
      }),
    });
    if (!r.ok) throw new Error("openai_http_" + r.status);
    const j = await r.json();
    return j?.choices?.[0]?.message?.content ?? "";
  }

  // --- Gemini çağrısı (v1 endpoint + -latest destekli) ---
  async function callGemini(finalPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
      }),
    });
    if (!r.ok) {
      // Bazı hesaplarda -latest 404 verebiliyor → hızlı geri dönüş
      if (r.status === 404 && GEMINI_MODEL.endsWith("-latest")) {
        const fallback = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const r2 = await fetch(fallback, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
          }),
        });
        if (!r2.ok) throw new Error("gemini_http_" + r2.status);
        const j2 = await r2.json();
        return j2?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      }
      throw new Error("gemini_http_" + r.status);
    }
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  // Sağlayıcı seçimi (elle belirtilmediyse otomatik)
  if (!providerReq) {
    providerReq = OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none");
  }
  if (providerReq === "none") {
    return res.status(500).json({ error: "no_provider_configured" });
  }

  let output = "";
  let used = "openai";

  try {
    if (providerReq === "gemini") {
      used = "gemini";
      output = await callGemini(finalPrompt);
    } else {
      // openai veya auto → önce OpenAI
      output = await callOpenAI(finalPrompt, temperature);
    }
  } catch (e) {
    // OpenAI hata verirse ve Gemini anahtarı varsa → Gemini’ye düş
    if (used === "openai" && GEMINI_API_KEY) {
      used = "gemini";
      output = await callGemini(finalPrompt);
    } else {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }

  return res.status(200).json({ provider: used, output, lang });
};