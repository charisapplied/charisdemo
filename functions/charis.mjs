// netlify/functions/charis.mjs
// Charis Applied Intelligence — live generator.
//   mode "answer" (default): a tailored "where Applied Intelligence helps" line for any business + region.
//   mode "demo": a short scripted walkthrough (JSON steps) for any business, for the "Watch it" screen.
//
// Requires env var in Netlify:  ANTHROPIC_API_KEY   (Site settings -> Environment variables. Never commit it.)

const MODEL = "claude-haiku-4-5"; // fast + cheap, built for real-time

const REGIONS = ["India", "United States", "Canada", "Global"];

const SYSTEM_ANSWER = `You are the voice of Charis Applied Intelligence — a firm that points AI at the exact place a business wins or loses.

The user gives you a business or industry and a region. Write ONE answer (2-3 sentences, 45 words MAX) showing where Applied Intelligence would help THAT specific business.

HARD RULES:
- Lead with revenue, sharper decisions, reach, or winning the moment. NEVER lead with "saving time" or "automating repetitive tasks" — that is the commodity pitch we reject.
- Begin with: For <b>[the business]</b>, Applied Intelligence starts ...
- Be concrete to that business — name the real lever (the customer, the deal, the booking, the patient, the bid, the listing).
- Plain, confident language. No hype words, no emojis, no lists, no headings.
- The ONLY HTML allowed is <b></b>, on the business name and at most one key phrase.
- Tailor the closing clause lightly to the region: India = WhatsApp-first and local languages; United States = every channel, on-brand and on time; Canada = bilingual-ready and privacy-first; Global = every timezone and language at once.
- If the input is not a genuine business or industry, or is unsafe, reply with exactly: FALLBACK`;

const FEWSHOT_ANSWER = [
  { role: "user", content: "Business / industry: a dental clinic\nRegion: United States" },
  { role: "assistant", content: "For a <b>dental clinic</b>, Applied Intelligence starts by finding the care your schedule is leaving on the table — overdue treatment, recalls no one got to, waitlist gaps — surfacing <b>real revenue</b>, not just answering phones. In the US, that runs across every channel, on-brand and on time." }
];

const SYSTEM_DEMO = `You script a short, realistic "live walkthrough" for Charis Applied Intelligence.

Given a business/industry, return ONLY valid JSON (no markdown fences, no prose before or after) in EXACTLY this shape:
{"steps":[
 {"type":"in","l":"Incoming","t":"<a specific, believable real moment in this business>"},
 {"type":"work","l":"Charis","t":"<what Applied Intelligence does — concrete, shows judgment / revenue / reach>"},
 {"type":"work","l":"Charis","t":"<a second concrete move>"},
 {"type":"done","l":"Result","t":"<the outcome, one sentence>","result":"<a punchy one-line payoff; you may use <b></b> on a few words>"}
]}

RULES:
- Each "t" under 35 words.
- Be specific to THIS business — name the real lever (the customer, the deal, the booking, the patient, the bid, the listing).
- Lead with revenue, sharper decisions, reach, or winning the moment. NEVER "saving time" or "automating tasks".
- Plain, confident language. No emojis. The only HTML allowed is <b></b>, inside "result".
- If the input is not a genuine business/industry, or is unsafe, return exactly: {"fallback":true}`;

const FEWSHOT_DEMO = [
  { role: "user", content: "Business / industry: a dental clinic" },
  { role: "assistant", content: "{\"steps\":[{\"type\":\"in\",\"l\":\"Incoming\",\"t\":\"A patient calls to reschedule. Routine — but the whole schedule is being watched, not just that call.\"},{\"type\":\"work\",\"l\":\"Charis\",\"t\":\"Spots two gaps next week, pulls two waitlisted patients in, and flags four patients overdue for treatment they were already recommended.\"},{\"type\":\"work\",\"l\":\"Charis\",\"t\":\"Drafts the recall messages in your practice's voice for your approval.\"},{\"type\":\"done\",\"l\":\"Result\",\"t\":\"One reschedule became a fuller week and recovered care that was just sitting there.\",\"result\":\"<b>Found about $4,800 in treatment</b> your calendar was quietly leaving on the table.\"}]}" }
];

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const business = String(body.business || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const region = REGIONS.includes(body.region) ? body.region : "Global";
  const mode = body.mode === "demo" ? "demo" : "answer";

  if (!business) return json({ error: "missing business" }, 400);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "server not configured" }, 500);

  const isDemo = mode === "demo";
  const payload = {
    model: MODEL,
    max_tokens: isDemo ? 500 : 220,
    system: isDemo ? SYSTEM_DEMO : SYSTEM_ANSWER,
    messages: isDemo
      ? [...FEWSHOT_DEMO, { role: "user", content: "Business / industry: " + business }]
      : [...FEWSHOT_ANSWER, { role: "user", content: "Business / industry: " + business + "\nRegion: " + region }]
  };

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      return json({ error: "upstream", detail }, 502);
    }

    const data = await r.json();
    let text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();

    if (isDemo) {
      const parsed = safeJson(text);
      if (!parsed || parsed.fallback || !Array.isArray(parsed.steps) || !parsed.steps.length) {
        return json({ steps: [] });
      }
      const steps = parsed.steps.slice(0, 4).map(s => ({
        type: ["in", "work", "done"].includes(s.type) ? s.type : "work",
        l: cleanText(s.l || "Charis").slice(0, 24),
        t: cleanText(s.t || ""),
        result: s.result ? cleanText(s.result) : ""
      }));
      return json({ steps });
    }

    if (!text || /FALLBACK/i.test(text)) return json({ answer: "" });
    return json({ answer: cleanText(text) });
  } catch (e) {
    return json({ error: "exception", detail: String(e).slice(0, 200) }, isDemo ? 200 : 500);
  }
};

function cleanText(s) {
  return String(s).replace(/<(?!\/?b\s*>)[^>]*>/gi, "").trim();
}

function safeJson(s) {
  if (!s) return null;
  let t = s.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a !== -1 && b !== -1) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
