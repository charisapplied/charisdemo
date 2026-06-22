// netlify/functions/charis.mjs
// Charis Applied Intelligence — live answer generator.
// Generates a tailored "where Applied Intelligence helps" answer for ANY business/industry.
//
// Requires an environment variable in Netlify:  ANTHROPIC_API_KEY
// (Site settings -> Environment variables. NEVER commit the key to the repo.)

const MODEL = "claude-haiku-4-5"; // fast + cheap, built for real-time

const SYSTEM = `You are the voice of Charis Applied Intelligence — a firm that points AI at the exact place a business wins or loses.

The user gives you a business or industry and a region. Write ONE answer (2-3 sentences, 45 words MAX) showing where Applied Intelligence would help THAT specific business.

HARD RULES:
- Lead with revenue, sharper decisions, reach, or winning the moment. NEVER lead with "saving time" or "automating repetitive tasks" — that is the commodity pitch we reject.
- Begin with: For <b>[the business]</b>, Applied Intelligence starts ...
- Be concrete to that business — name the real lever (the customer, the deal, the booking, the patient, the bid, the listing).
- Plain, confident language. No hype words, no emojis, no lists, no headings.
- The ONLY HTML allowed is <b></b>, used on the business name and at most one key phrase.
- Tailor the closing clause lightly to the region when natural: India = WhatsApp-first and local languages; United States = every channel, on-brand and on time; Canada = bilingual-ready and privacy-first; Global = every timezone and language at once.
- If the input is not a genuine business or industry (gibberish, a person's name, a question, or anything unsafe, sexual, hateful, or off-topic), reply with exactly: FALLBACK`;

// One example to anchor the voice.
const FEWSHOT = [
  { role: "user", content: "Business / industry: a dental clinic\nRegion: United States" },
  { role: "assistant", content: "For a <b>dental clinic</b>, Applied Intelligence starts by finding the care your schedule is leaving on the table — overdue treatment, recalls no one got to, waitlist gaps — surfacing <b>real revenue</b>, not just answering phones. In the US, that runs across every channel, on-brand and on time." }
];

const REGIONS = ["India", "United States", "Canada", "Global"];

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  // sanitize input — hard cap length to limit cost/abuse
  const business = String(body.business || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const region = REGIONS.includes(body.region) ? body.region : "Global";

  if (!business) return json({ error: "missing business" }, 400);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "server not configured" }, 500);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 220,
        system: SYSTEM,
        messages: [...FEWSHOT, { role: "user", content: `Business / industry: ${business}\nRegion: ${region}` }]
      })
    });

    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      return json({ error: "upstream", detail }, 502);
    }

    const data = await r.json();
    let text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();

    // model declined / not a real business -> tell client to use its own fallback
    if (!text || /FALLBACK/i.test(text)) return json({ answer: "" });

    // strip any HTML tag that isn't <b> / </b>
    text = text.replace(/<(?!\/?b\s*>)[^>]*>/gi, "");

    return json({ answer: text });
  } catch (e) {
    return json({ error: "exception", detail: String(e).slice(0, 200) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
