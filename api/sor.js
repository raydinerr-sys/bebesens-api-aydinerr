// api/sor.js — Gemini: modelleri listele, uygun olanı otomatik seç
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// CORS tek yerden
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

// /v1 ve /v1beta uçlarından modelleri dene, ilk başarılı olanı döndür
async function listModels() {
  if (!GEMINI_API_KEY) return { base: null, models: [] };

  const bases = ["v1", "v1beta"];
  for (const base of bases) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/${base}/models?key=${GEMINI_API_KEY}`);
      const text = await r.text();
      if (!r.ok) continue;
      const j = JSON.parse(text);
      // name genelde "models/gemini-1.5-..." şeklinde gelir
      const models = (j?.models || [])
        .map(m => (m?.name || "").replace(/^models\//, ""))
        .filter(Boolean);
      if (models.length) return { base, models };
    } catch (_) {}
  }
  return { base: null, models: [] };
}

// Tercih sırasına göre model seç
function pickModel(models) {
  const prefs = [
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-1.5-pro",
    "gemini-pro",
  ];
  for (const p of prefs) {
    const found = models.find(name => name.includes(p));
    if (found) return found;
  }
  // fallback: "gemini" geçen ilk modeli al
  return models.find(n => n.includes("gemini")) || null;
}

// Seçilen base (v1/v1beta) ve model ile çağrı yap
async function askGemini({ base, model, prompt }) {
  if (!GEMINI_API_KEY) throw new Error("gemini_key_missing");
  if (!base || !model) throw new Error("gemini_model_unknown");

  const url = `https://generativelanguage.googleapis.com/${base}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`gemini_http_${r.status} ${text}`);

  const j = JSON.parse(text);
  return j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const listed = await listModels();
    const picked = pickModel(listed.models);
    return res.status(200).json({
      ok: true,
      route: "/api/sor",
      provider: GEMINI_API_KEY ? "gemini" : "none",
      base: listed.base,                    // "v1" veya "v1beta"
      picked_model: picked || null,         // seçilen model adı (id)
      models_count: listed.models.length,   // kaç model görünüyor
      sample_models: listed.models.slice(0, 10), // ilk 10 model
      ts: Date.now(),
    });
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}"): (req.body || {});
      const prompt = String(body.prompt || "").trim();
      const lang = String(body.lang || "tr");
      const provider = String(body.provider || "gemini"); // varsayılan: gemini
      const forceModel = body.model ? String(body.model) : null;

      if (!prompt) return res.status(400).json({ ok: false, error: "prompt_required" });

      if (provider !== "gemini") {
        // Şimdilik yalnız Gemini’yi destekliyoruz (OpenAI kota nedeniyle kapalı)
        return res.status(200).json({ ok: true, provider: "none", echo: prompt, lang });
      }

      // Model seç: body.model varsa onu, yoksa listeden otomatik
      let base = "v1";
      let model = forceModel;
      if (!model) {
        const listed = await listModels();
        base = listed.base;
        model = pickModel(listed.models);
        if (!base || !model) {
          return res.status(502).json({ ok: false, error: "no_gemini_models_visible" });
        }
      } else {
        // Zorunlu model verildiyse yine base’i listelemeden bul
        const listed = await listModels();
        base = listed.base || "v1";
      }

      const output = await askGemini({ base, model, prompt });
      return res.status(200).json({ ok: true, provider: "gemini", base, model, output, lang });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "handler_crashed", detail: String(e) });
    }
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
};
