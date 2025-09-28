// api/sor.js — Gemini-first, sade ve sağlam
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// Tek yerden CORS
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

async function askGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error("gemini_key_missing");

  // DİKKAT: v1 ve model adı sabit, ek sonek yok
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
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
    return res.status(200).json({
      ok: true,
      route: "/api/sor",
      provider: GEMINI_API_KEY ? "gemini" : "none",
      model: "gemini-1.5-flash",
      api_version: "v1",
      ts: Date.now(),
    });
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}"): (req.body || {});
      const prompt = String(body.prompt || "").trim();
      const lang = String(body.lang || "tr");
      const provider = String(body.provider || (GEMINI_API_KEY ? "gemini" : "none"));

      if (!prompt) return res.status(400).json({ ok: false, error: "prompt_required" });

      if (provider === "gemini") {
        const output = await askGemini(prompt);
        return res.status(200).json({ ok: true, provider: "gemini", output, lang });
      }

      // provider=none ise sadece echo
      return res.status(200).json({ ok: true, provider: "none", echo: prompt, lang });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "handler_crashed", detail: String(e) });
    }
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
};
