// api/sor.js — OpenAI -> (gerekirse) Gemini fallback, sadece v1 + stabil modeller
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL   = process.env.OPENAI_MODEL   || "gpt-4o-mini";

const GEMINI_API_KEY     = process.env.GEMINI_API_KEY || "";
const GEMINI_API_VERSION = (process.env.GEMINI_API_VERSION || "v1").trim(); // v1 KULLAN
const GEMINI_MODEL_MAIN  = (process.env.GEMINI_MODEL || "gemini-1.5-flash").trim();

// Sadece destekli modeller
const GEMINI_MODEL_FALLBACKS = [
  GEMINI_MODEL_MAIN,
  "gemini-1.5-flash",
  "gemini-1.5-pro"
];

function langInstruction(lang) {
  if (lang === "tr") return "Lütfen sadece Türkçe yanıt ver.";
  if (lang === "en") return "Please respond in English only.";
  return "Please respond in English only.";
}

async function askOpenAI(finalPrompt, temperature = 0.7) {
  if (!OPENAI_API_KEY) throw new Error("openai_no_key");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}", "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: "user", content: finalPrompt }], temperature })
  });
  if (!r.ok) { const txt = await r.text(); const e = new Error("openai_http_" + r.status); e.body = txt; throw e; }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

async function askGeminiWithModel(finalPrompt, model, version, temperature = 0.7) {
  if (!GEMINI_API_KEY) throw new Error("gemini_no_key");
  const base = version === "v1" 
    ? `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`; // sadece v1 kullanıyoruz
  const r = await fetch(`${base}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: finalPrompt }] }], generationConfig: { temperature } })
  });
  if (!r.ok) { const txt = await r.text(); const e = new Error("gemini_http_" + r.status); e.body = txt; throw e; }
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function askGemini(finalPrompt, temperature = 0.7) {
  let last;
  for (const m of GEMINI_MODEL_FALLBACKS) {
    try { return await askGeminiWithModel(finalPrompt, m, "v1", temperature); }
    catch (e) { last = e; if (!String(e?.message).includes("gemini_http_404")) throw e; }
  }
  const err = new Error("gemini_all_failed"); err.last = last; throw err;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      provider: OPENAI_API_KEY ? "openai" : (GEMINI_API_KEY ? "gemini" : "none"),
      openai_model: OPENAI_MODEL,
      gemini_model: GEMINI_MODEL_MAIN,
      gemini_api_version: GEMINI_API_VERSION
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}"): (req.body || {});
    const prompt = String(body?.prompt || "").trim();
    const lang = String(body?.lang || "tr");
    const provider = String(body?.provider || "").trim().toLowerCase();
    const temperature = typeof body?.temperature === "number" ? body.temperature : 0.7;
    if (!prompt) return res.status(400).json({ error: "prompt_required" });

    const finalPrompt = `${langInstruction(lang)}\n\n${prompt}`;

    if (provider === "openai")  return res.status(200).json({ ok: true, provider: "openai",  output: await askOpenAI(finalPrompt, temperature),  lang });
    if (provider === "gemini")  return res.status(200).json({ ok: true, provider: "gemini",  output: await askGemini(finalPrompt, temperature),  lang });

    // Otomatik: önce OpenAI, 401/403/429 gelirse Gemini
    if (OPENAI_API_KEY) {
      try { return res.status(200).json({ ok: true, provider: "openai", output: await askOpenAI(finalPrompt, temperature), lang }); }
      catch (e) {
        const msg = String(e?.message || "");
        const fallback = msg.includes("openai_http_401") || msg.includes("openai_http_403") || msg.includes("openai_http_429") || msg.includes("openai_no_key");
        if (!fallback || !GEMINI_API_KEY) throw e;
      }
    }
    return res.status(200).json({ ok: true, provider: "gemini", output: await askGemini(finalPrompt, temperature), lang });
  } catch (e) {
    return res.status(500).json({ error: "handler_crashed", detail: String(e?.stack || e) });
  }
};
