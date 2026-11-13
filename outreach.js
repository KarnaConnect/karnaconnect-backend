// ── Mash sales outreach ───────────────────────────────────────────────────────
// Mash calling Australian businesses to sell Mash itself. This module owns:
//   - the "Mash — Sales Outreach" VAPI assistant (script, tools, analysis),
//     created/updated automatically on backend startup
//   - compliant campaign pacing (calling hours, do-not-call list, concurrency)
//   - the tools the assistant calls mid-call (book demo, send trial link, opt out)
//   - updating campaign contacts when VAPI sends the end-of-call report
//
// Only campaigns run by an outbound agent with purpose = 'sales' use this pacing.
// Other outbound agents (e.g. Platinum's pickup notifications) keep the old runner.

const SALES_AGENT_NAME = 'Mash — Sales Outreach';
const TRIAL_LINK = 'https://dashboard.mashai.com.au/onboarding';
const ADMIN_EMAIL = 'syedadilshah@live.com';
const FROM_EMAIL = 'Mash <noreply@mashai.com.au>';
const STALE_CALL_MINUTES = 20;

// Telemarketing and Research Calls Industry Standard 2017: calls only
// Mon–Fri 9am–8pm and Sat 9am–5pm in the recipient's local time, never on
// Sundays or national public holidays. Sales campaigns use a tighter
// business-hours window inside that, set per campaign.
const LEGAL_WINDOW = { weekday: ['09:00', '20:00'], saturday: ['09:00', '17:00'] };
const DEFAULT_SALES_CAMPAIGN = {
  timezone: 'Australia/Perth',
  window_start: '09:30',
  window_end: '16:30',
  weekdays_only: true,
  max_concurrent: 1
};

const SALES_PROMPT = `Your name is Mash. You are the AI sales rep for Mash AI, a Perth-based Australian company that gives businesses an AI receptionist that answers every call, 24/7. You share your name with the product: you ARE Mash, so this call is a live demo of what you're selling.

This is an OUTBOUND COLD CALL to a business that has NOT contacted us before.

What we know about them (blank means unknown; never read out a blank or a placeholder):
- Business: {{businessName}}
- Contact name: {{contactName}}
- Industry: {{industry}}
- Suburb: {{suburb}}

═══ HOW TO SOUND ═══
You are a friendly, switched-on Aussie salesperson having a real phone conversation, not a recording reading a script.
- Talk WITH them, not AT them. Say one short thing (one or two sentences), then stop and let them talk. Most of your turns should end with a question or a natural pause for them to respond.
- Listen and react to what they actually said before moving on: "Oh nice", "Yeah, fair enough", "Ha, I bet", "Right, so you're on the tools most of the day?"
- Follow their lead. If they ask a question, answer it properly, then ask if that helps or ask a follow-up. If they want to talk about something, talk about it. The call flow below is a guide, not a script to rush through.
- Use their name once you know it, but not every sentence.
- Plain, everyday words. Contractions. No corporate jargon, no lists read aloud, no "As an AI language model".
- Never repeat the same sentence twice in a call. If they didn't hear you, rephrase it more simply.
- If they interrupt, stop talking and respond to them.
- It's fine to be a bit cheeky or warm if they are. Match their energy and pace.

═══ NON-NEGOTIABLE RULES (Australian telemarketing rules) ═══
1. Your first turn must say you're an AI calling from Mash AI and that the call is recorded. If asked whether you're a real person, always say plainly you're an AI. Never pretend to be human.
2. Say why you're calling within your first two turns.
3. If they say anything like "not interested", "take me off your list", "don't call again", "stop calling", or ask to end the call: don't pitch or argue. Say "No worries at all, I'll make sure we don't call you again. Have a good one." Then call opt_out, then endCall. Do this the FIRST time they say it. (A question, a concern or "I'm not sure" is NOT an opt-out. That's a conversation.)
4. Never claim they enquired, signed up, or asked to be called. They didn't.
5. Where we got their number: "From your public business listing, like Google or your website."
6. Who's calling: "Mash AI, based in South Lake in Perth. You can email hello@mashai.com.au or just call this number back."
7. Never invent features, prices, discounts, guarantees, integrations or client results. If it's not in PRODUCT KNOWLEDGE below, say you'll get Adil to confirm.
8. Aim for 3 to 6 minutes, but if they're engaged and asking questions, keep going. Never rush someone who's interested.
9. Only talk about Mash and Mash AI. Don't mention KarnaConnect in your opener, pitch, voicemail or wrap-up. Bring it up ONLY if they ask who owns or runs Mash, what company is behind it, for the registered business name or ABN, about KarnaConnect directly, or what else KarnaConnect does. Then answer honestly and plainly: "Mash AI is a trading name of KarnaConnect, a Perth business run by Adil, our founder. The ABN is 84 924 272 443." If they ask what other services KarnaConnect offers, don't guess or make anything up: say Adil's the best person to run them through that, and offer a quick chat with him (book_demo) or a call back (request_callback). Then steer back to Mash if they're happy to.

═══ GOAL ═══
Have a genuine conversation, find out if missed calls are a problem for them, and if it fits, agree a next step:
  A) A free 15-minute demo/chat with Adil, the founder (book_demo), or
  B) The free-trial link by text or email (send_trial_link), or
  C) A call back at a better time (request_callback).
Don't push for a sale on this call. If it's not a fit, that's fine; thank them and wrap up.

═══ CALL FLOW (a guide; adapt to them) ═══
1. OPENER. They'll usually answer first ("Hello, Bob's Plumbing"). Your first turn, short and natural:
   "Hi, it's Mash calling from Mash AI here in Perth. Just so you know, I'm an AI assistant and this call's recorded. Am I speaking with the owner{% if businessName != blank %} of {{businessName}}{% endif %}?"
   Then stop and wait.

2. GATEKEEPER. If it's staff: "No worries. I'm calling about how the business handles calls it can't get to. Is the owner or manager around?" If not, ask when's a good time and use request_callback. Be nice to them; they decide if the boss hears about you.

3. REASON + PERMISSION. "I'll be quick. We help {{industry | default: 'local'}} businesses stop missing calls when they're flat out or after hours. Have you got a couple of minutes?" Wait.
   If no: "No worries, when's a better time?" and use request_callback.

4. DISCOVERY: the most important part. Ask, listen, follow up. One question at a time, pick what fits:
   - "Who usually answers the phone when you're busy on a job?"
   - "What happens to calls after hours or on weekends?"
   - "Roughly how many calls a week would you say you miss?"
   - "When someone gets your voicemail, do they usually leave a message, or ring the next business?"
   - "What's a typical job worth to you?"
   React to answers ("Ah, so the phone's in your pocket while you're on a roof?") and dig a little deeper before pitching.

5. CONNECT IT TO THEM. Explain Mash using what they told you, in two or three sentences, e.g.
   "So that's exactly where Mash fits. When you can't get to the phone, Mash picks up, has a proper chat like I'm having with you now, takes their details and what they need, and texts or emails you a summary straight away. So no job goes to the next guy."
   Then check in: "Does that sound like it'd help, or is it not really an issue for you?"

6. QUESTIONS AND DETAIL. Expect them to ask how it works, what it costs, what callers hear, setup, contracts. Answer from PRODUCT KNOWLEDGE, conversationally, a bit at a time. Offer more if they want it: "Want me to run you through how setup works?"

7. NEXT STEP. When they're warm: "Easiest next step is a quick 15-minute chat with Adil, our founder. He'll show you the dashboard and how it'd work for {{businessName | default: 'your business'}}. Would that be worth a look?"
   - Yes → ask, one at a time: their name, best email, and a day and time that suits. Then book_demo and confirm it back.
   - "Just send me something" → offer the free-trial link by text (confirm the mobile) or email, then send_trial_link.
   - "Not right now" → offer the trial link anyway, or a call back later.

8. WRAP UP. Recap the next step ("So Adil will email you to lock in Thursday at 2"), thank them by name, say goodbye, and wait for their goodbye before using endCall.

═══ PRODUCT KNOWLEDGE ═══
What it is:
- Mash is an AI receptionist for small and medium Australian businesses. It answers the phone 24/7 in a natural Australian voice, has a real conversation with the caller, answers common questions, takes their details and what they need, and passes it to the business straight away.
- It works alongside existing staff: after hours, weekends, lunch breaks, when the line's busy, or when the owner is on a job. It can also answer every call if a business wants that.
- The AI is set up for each business: its name, greeting, tone, services, service area, business hours, after-hours message, FAQs, and the main goal (e.g. capture leads, take bookings, answer enquiries). Things it should always say or never say can be added.

What the business gets after each call:
- An instant email alert and an app (push) notification with a summary of the call.
- A live dashboard with every call: recording, full transcript, AI summary, and tags like Quote, Booking, Complaint, Urgent, Follow-up.
- ROI stats on the dashboard: total calls, calls handled, hours saved and cost saved.
- Weekly or daily reports on the higher plans.
- Mash can also make outbound calls for a business, like reminders or "your car's ready" calls (that's what you're doing right now, as a sales call).

What callers experience:
- A friendly, natural conversation, just like this one. If they want something the AI can't do, it takes a message and the business gets an alert. Nothing falls through the cracks.

Setup:
- Fill in a short onboarding form at mashai.com.au (about five minutes): business details, services, hours, FAQs, goal.
- The Mash team builds, tests and tunes the agent, usually within 24 hours.
- The business gets an Australian phone number for Mash. Most businesses forward their calls to it when they're busy or after hours; the Mash team helps set that up.
- No setup fees, no lock-in contracts.

Plans (AUD per month). Only give pricing when asked, or when they're clearly keen:
- Basic, $149: 100 minutes of calls, 1 agent, 1 number, dashboard, recordings, transcripts, summaries, email alerts, 24-hour support.
- Standard, $299 (most popular): 300 minutes, weekly reports, agent tuning included, 12-hour support.
- Premium, $699: 1,000 minutes, up to 3 agents and 3 numbers, daily reports, CRM integration, unlimited tuning, 4-hour support.
- Every plan has a 7-day free trial. A card is needed to start, nothing is charged until day 8, cancel any time.
- How many minutes they'd need: a typical call is one to three minutes, so 100 minutes is roughly 40 to 80 calls a month.
- Anything else (extra minutes, custom integrations, other languages, discounts): "Good question. I'll get Adil to confirm that for you."

Why it's worth it (use what fits their situation, don't list them all):
- Every missed call can be a lost job; a lot of people who get voicemail just ring the next business.
- From $149 a month, often one extra job pays for it.
- Cheaper than a receptionist or answering service, and it never calls in sick.
- They can try it free for 7 days and see the calls come in on the dashboard.

═══ OBJECTIONS (acknowledge, answer once briefly, then ask a question to keep talking; never argue) ═══
- "We already have a receptionist" → "Nice, that helps. Does anyone cover the phone after hours or when they're on lunch? That's usually where Mash fits in."
- "Customers won't want to talk to AI" → "Totally fair. Honestly, you've been chatting to one for a couple of minutes now. Most callers just want to be looked after and get a call back, and Mash makes sure that happens. Would a quick trial help you see how your customers take it?"
- "Too expensive" → "Fair enough. What's one job usually worth to you? For most businesses, catching one extra job a month covers it, and the first seven days are free."
- "I'm busy" → "No worries at all. When's a better time for a quick chat?" then request_callback.
- "Just send me info" → "Sure thing. Want me to text you the free-trial link? Is this the best mobile?" then send_trial_link.
- "I need to think about it" → "Of course. Would it help if I sent the trial link so you can try it with no cost for a week?"
- "How do I know it works?" → "That's the beauty of the free trial. You see every call, recording and summary on the dashboard. And, well, you're hearing it right now."
- "Is my data safe?" → "Calls and details go into your private dashboard with secure logins, only for your business. For the specifics, I'll get Adil to send you the details."

═══ VOICEMAIL, PICKUPS AND WRONG NUMBERS ═══
- Treat it as voicemail ONLY if you clearly hear a recorded greeting ("you've reached...", "leave a message after the tone") or a beep. A person saying "hello?", "who's this?" or "sorry, I can't hear you" is a LIVE PERSON.
- On a real voicemail, after the beep, say once: "Hi, it's Mash, an AI assistant from Mash AI in Perth. I was calling about helping your business answer every call, even after hours. No need to call back. If you're curious, have a look at mash ai dot com dot au. Have a great day." Then endCall.
- If a live person picks up or starts talking at ANY point, even halfway through a voicemail message, stop immediately and talk to them: "Oh hi, sorry, I thought I'd got your voicemail! It's Mash from Mash AI here in Perth. Just so you know, I'm an AI and this call's recorded. Have I caught the owner?" Then carry on with the normal conversation. Never repeat the voicemail message to a live person.
- If they say "hello?" or can't hear you, rephrase your intro briefly. Don't repeat it word for word.
- Clearly the wrong business or a personal number: apologise, say you won't call again, opt_out with reason "wrong number", then endCall.

═══ TOOLS ═══
- book_demo: once you have name, an email (or mobile) and a preferred day and time.
- send_trial_link: once they agree to receive it. Pass mobile and/or email.
- request_callback: when they want a call back at another time.
- opt_out: whenever they decline, ask not to be called, or it's a wrong number.
- endCall: ONLY after goodbyes, a confirmed opt-out, a finished voicemail, or a wrong number. Never while they're still talking or asking questions.`;

const FIRST_MESSAGE = "Hi, it's Mash calling from Mash AI here in Perth. Just so you know, I'm an AI assistant and this call's recorded. Am I speaking with the owner{% if businessName != blank %} of {{businessName}}{% endif %}?";

const VOICEMAIL_MESSAGE = "Hi, this is Mash, an AI assistant from Mash AI in Perth. I was calling about helping your business answer every call, even after hours. No need to call back. If you're curious, have a look at mash ai dot com dot au. Thanks, and have a great day.";

const END_CALL_MESSAGE = "Thanks so much for your time. Have a great day!";

function salesTools(backendUrl) {
  const server = { url: `${backendUrl}/tools/outreach` };
  const fn = (name, description, properties, required = []) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
    server
  });
  return [
    fn('book_demo', 'Book a 15-minute demo with Adil, the Mash founder. Call once you have the person\'s name, a contact method and a preferred day/time.', {
      name: { type: 'string', description: 'Full name of the person' },
      business_name: { type: 'string', description: 'Name of their business' },
      email: { type: 'string', description: 'Email address for the calendar invite' },
      mobile: { type: 'string', description: 'Best mobile number if different from the number called' },
      preferred_date: { type: 'string', description: 'Preferred day, e.g. "Thursday" or "12 November"' },
      preferred_time: { type: 'string', description: 'Preferred time, e.g. "2pm"' },
      notes: { type: 'string', description: 'Anything useful for Adil: how they handle calls now, objections, interest level' }
    }, ['name', 'preferred_date']),
    fn('send_trial_link', 'Send the free 7-day trial sign-up link to the prospect by SMS and/or email. Call only after they agree to receive it.', {
      name: { type: 'string', description: 'Their name' },
      business_name: { type: 'string', description: 'Name of their business' },
      mobile: { type: 'string', description: 'Mobile number to text the link to. Leave empty to use the number we called if it is a mobile.' },
      email: { type: 'string', description: 'Email address to send the link to' }
    }),
    fn('request_callback', 'Arrange for Mash to call back at a better time, or to reach the owner/manager later.', {
      name: { type: 'string', description: 'Name of the person to call back' },
      business_name: { type: 'string', description: 'Name of their business' },
      callback_time: { type: 'string', description: 'When to call back, e.g. "tomorrow after 2pm"' },
      notes: { type: 'string', description: 'Context for the callback' }
    }, ['callback_time']),
    fn('opt_out', 'Add this number to the Mash do-not-call list. Use whenever the person declines, asks not to be called again, or it is a wrong number.', {
      reason: { type: 'string', description: 'e.g. "not interested", "asked not to be called", "wrong number"' }
    }),
    { type: 'endCall' }
  ];
}

function salesAssistantConfig(backendUrl) {
  return {
    name: SALES_AGENT_NAME,
    model: {
      provider: 'openai',
      model: 'gpt-4.1',
      temperature: 0.6,
      messages: [{ role: 'system', content: SALES_PROMPT }],
      tools: salesTools(backendUrl)
    },
    voice: {
      provider: '11labs',
      voiceId: 'luVEyhT3CocLZaLBps8v',
      model: 'eleven_turbo_v2_5',
      stability: 0.5,
      similarityBoost: 0.8,
      speed: 1.0
    },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'en' },
    // Cold calls: let them say "Hello?" first, then the model gives the opener
    // from the prompt. Speaking first talked over people as they picked up.
    firstMessage: FIRST_MESSAGE,
    firstMessageMode: 'assistant-waits-for-user',
    firstMessageInterruptionsEnabled: true,
    endCallMessage: END_CALL_MESSAGE,
    // VAPI's voicemail detection hung up on a real person saying "hello? hello?".
    // The script handles real voicemails instead.
    voicemailDetection: 'off',
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 420,
    serverMessages: ['end-of-call-report'],
    server: { url: `${backendUrl}/webhook/vapi` },
    analysisPlan: {
      summaryPrompt: 'Summarise this outbound sales call in 2-3 sentences for the Mash founder. Include who answered, whether a decision maker was reached, how they handle missed calls today, any objections, and the agreed next step. Third person, past tense.',
      structuredDataPlan: {
        schema: {
          type: 'object',
          properties: {
            outcome: {
              type: 'string',
              enum: ['Demo Booked', 'Trial Link Sent', 'Callback Requested', 'Interested - Follow Up', 'Not Interested', 'Opted Out', 'Gatekeeper', 'Voicemail', 'Wrong Number', 'No Conversation'],
              description: 'Final result of the call'
            },
            decision_maker_reached: { type: 'boolean', description: 'Whether the owner or manager was spoken to' },
            opted_out: { type: 'boolean', description: 'True if the person declined or asked not to be called again' },
            interest_level: { type: 'integer', description: '1 (none) to 5 (very keen)' },
            contact_name: { type: 'string', description: 'Name of the person spoken to' },
            email: { type: 'string', description: 'Email given, if any' },
            current_call_handling: { type: 'string', description: 'How they handle missed / after-hours calls today' },
            main_objection: { type: 'string', description: 'Main objection raised, if any' }
          }
        }
      },
      successEvaluationPlan: { rubric: 'PassFail' }
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Normalise an Australian number to E.164 (+61...). Returns null if it doesn't look valid.
function normalizeAuPhone(raw) {
  if (!raw) return null;
  let n = String(raw).replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  if (n.startsWith('0011')) n = n.slice(4);
  if (n.startsWith('61')) n = n.slice(2);
  if (n.startsWith('0')) n = n.slice(1);
  if (!/^[2-478]\d{8}$/.test(n)) return null;
  return '+61' + n;
}

const isAuMobile = (e164) => /^\+614\d{8}$/.test(e164 || '');

// Best guess at the recipient's timezone. Landline area codes give the state;
// mobiles fall back to the campaign's timezone. (08 covers WA, SA and NT —
// Perth is the earliest of those, so checking Perth time is the safe choice
// for the start of the day, and the window ends well before 8pm everywhere.)
function recipientTimezone(e164, fallback) {
  const m = /^\+61([2378])/.exec(e164 || '');
  if (!m) return fallback;
  return { '2': 'Australia/Sydney', '3': 'Australia/Melbourne', '7': 'Australia/Brisbane', '8': 'Australia/Perth' }[m[1]];
}

function localParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
  }).formatToParts(date).map(p => [p.type, p.value]));
  return {
    year: +parts.year, month: +parts.month, day: +parts.day,
    minutes: (+parts.hour % 24) * 60 + +parts.minute,
    weekday: parts.weekday // 'Mon' ... 'Sun'
  };
}

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

// National public holidays (plus Monday substitutes, to be safe).
function isNationalHoliday({ year, month, day, weekday }) {
  const key = (mo, d) => `${mo}-${d}`;
  const today = key(month, day);
  const fixed = [key(1, 1), key(1, 26), key(4, 25), key(12, 25), key(12, 26)];
  if (fixed.includes(today)) return true;
  const easter = easterSunday(year);
  const shift = (days) => { const d = new Date(easter); d.setUTCDate(d.getUTCDate() + days); return key(d.getUTCMonth() + 1, d.getUTCDate()); };
  if ([shift(-2), shift(1)].includes(today)) return true; // Good Friday, Easter Monday
  // Substitute days when New Year / Australia Day / Christmas / Boxing Day fall on a weekend
  if (weekday === 'Mon' || weekday === 'Tue') {
    const back = (n) => { const d = new Date(Date.UTC(year, month - 1, day - n)); return key(d.getUTCMonth() + 1, d.getUTCDate()); };
    const prior = weekday === 'Mon' ? [back(1), back(2)] : [back(2), back(3)];
    if (prior.some(p => [key(1, 1), key(1, 26), key(12, 25), key(12, 26)].includes(p))) return true;
  }
  return false;
}

const toMinutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };

// Is it OK to ring this number right now under the legal window and the campaign's own window?
function canCallNow(campaign, e164, now = new Date()) {
  const tz = recipientTimezone(e164, campaign.timezone || DEFAULT_SALES_CAMPAIGN.timezone);
  const t = localParts(now, tz);
  if (t.weekday === 'Sun' || isNationalHoliday(t)) return false;
  if (t.weekday === 'Sat' && campaign.weekdays_only !== false) return false;
  const legal = t.weekday === 'Sat' ? LEGAL_WINDOW.saturday : LEGAL_WINDOW.weekday;
  const start = Math.max(toMinutes(legal[0]), toMinutes(campaign.window_start || legal[0]));
  const end = Math.min(toMinutes(legal[1]), toMinutes(campaign.window_end || legal[1]));
  return t.minutes >= start && t.minutes < end;
}

// VAPI tool calls arrive as { message: { type: 'tool-calls', toolCallList: [...] } }
function parseToolCalls(body) {
  const message = body?.message || {};
  const list = message.toolCallList || (message.toolWithToolCallList || []).map(t => t.toolCall) || [];
  return {
    call: message.call || {},
    customer: message.customer || message.call?.customer || {},
    calls: list.filter(Boolean).map(tc => {
      let args = tc.function?.arguments || {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      return { id: tc.id, name: tc.function?.name, args };
    })
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function adminEmailHtml(title, rows, note) {
  return `<div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;">
    <div style="background:linear-gradient(135deg,#534AB7,#7F77DD);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:1.3rem;">${esc(title)}</h1>
      <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:0.85rem;">Mash outreach call</p>
    </div>
    <div style="background:white;border-radius:0 0 12px 12px;padding:28px;border:1px solid #e2e8f0;border-top:none;">
      ${rows.map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v || '—')}</p>`).join('')}
      ${note ? `<p style="margin-top:20px;padding:14px;background:#EEEDFE;border-radius:8px;color:#534AB7;font-weight:600;">${esc(note)}</p>` : ''}
      <a href="https://dashboard.mashai.com.au/outreach" style="display:block;text-align:center;background:linear-gradient(135deg,#534AB7,#7F77DD);color:white;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:20px;">Open Outreach</a>
    </div></div>`;
}

module.exports = function registerOutreach(app, { supabase, resend }) {
  const backendUrl = () => (process.env.PUBLIC_BACKEND_URL || 'https://expressjs-production-48b3.up.railway.app').replace(/\/$/, '');

  async function sendSms(to, body) {
    const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_SMS_FROM;
    if (!sid || !token || !from) return { sent: false, reason: 'SMS not configured' };
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body })
    });
    if (!res.ok) return { sent: false, reason: `Twilio ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { sent: true };
  }

  async function notifyAdmin(subject, title, rows, note) {
    try {
      await resend.emails.send({ from: FROM_EMAIL, to: ADMIN_EMAIL, subject, html: adminEmailHtml(title, rows, note) });
    } catch (err) {
      console.error('Outreach admin email failed:', err.message);
    }
  }

  async function addToDoNotCall(number, reason, source, businessName) {
    const phone = normalizeAuPhone(number) || number;
    if (!phone) return;
    const { error } = await supabase.from('do_not_call')
      .upsert({ phone_number: phone, reason: reason || null, source, business_name: businessName || null }, { onConflict: 'phone_number' });
    if (error) console.error('do_not_call upsert failed:', error.message);
  }

  async function findContactByCall(callId) {
    if (!callId) return null;
    const { data } = await supabase.from('campaign_contacts').select('*').eq('call_id', callId).maybeSingle();
    return data;
  }

  async function setContactOutcome(callId, outcome) {
    if (!callId) return;
    await supabase.from('campaign_contacts').update({ outcome }).eq('call_id', callId);
  }

  // Admin check: the dashboard sends the user's Supabase access token.
  async function requireAdmin(req, res, next) {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ error: 'Not signed in' });
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: 'Session expired, sign in again' });
      const { data: uc } = await supabase.from('user_clients').select('role').eq('user_id', user.id).maybeSingle();
      if (uc?.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      req.user = user;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async function mashClient() {
    const { data } = await supabase.from('clients').select('id, business_name, phone_number, vapi_phone_number_id').eq('business_name', 'Mash AI').maybeSingle();
    return data;
  }

  // ── Sales agent: created/updated in VAPI on startup ─────────────────────────
  // Creates the assistant the first time (and emails Adil the details), then
  // keeps its script in sync with this file on every deploy.
  async function syncSalesAgent() {
    try {
      const client = await mashClient();
      if (!client?.vapi_phone_number_id) throw new Error('No "Mash AI" client with a VAPI phone number');
      const { data: existing } = await supabase.from('outbound_agents').select('*')
        .eq('client_id', client.id).eq('purpose', 'sales').maybeSingle();

      const config = salesAssistantConfig(backendUrl());
      const vapiRes = await fetch(existing?.vapi_agent_id ? `https://api.vapi.ai/assistant/${existing.vapi_agent_id}` : 'https://api.vapi.ai/assistant', {
        method: existing?.vapi_agent_id ? 'PATCH' : 'POST',
        headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const assistant = await vapiRes.json();
      if (!vapiRes.ok) throw new Error('VAPI rejected the assistant: ' + JSON.stringify(assistant.message || assistant));

      const row = { client_id: client.id, label: 'Mash — Sales Outreach (cold calls)', vapi_agent_id: assistant.id, vapi_phone_number_id: client.vapi_phone_number_id, purpose: 'sales' };
      if (existing) {
        await supabase.from('outbound_agents').update(row).eq('id', existing.id);
        console.log('Sales agent synced to VAPI:', assistant.id);
        return;
      }
      const { error } = await supabase.from('outbound_agents').insert(row);
      if (error) throw error;
      console.log('Sales agent created in VAPI:', assistant.id);
      await notifyAdmin('Mash sales agent created in VAPI', 'Sales Agent Created', [
        ['Assistant ID', assistant.id], ['Name', assistant.name], ['Voice', `${assistant.voice?.provider} ${assistant.voice?.voiceId}`],
        ['Caller ID', `${client.phone_number || ''} (${client.vapi_phone_number_id})`],
        ['Tools', (assistant.model?.tools || []).map(t => t.function?.name || t.type).join(', ')]
      ]);
    } catch (err) {
      console.error('Sales agent sync failed:', err.message);
      await notifyAdmin('Mash sales agent setup FAILED', 'Sales Agent Setup Failed', [['Error', err.message]], 'Paste this error to Claude to fix.');
    }
  }
  setTimeout(syncSalesAgent, 5000);

  // ── Do-not-call list ────────────────────────────────────────────────────────
  app.get('/outreach/dnc', requireAdmin, async (req, res) => {
    const { data, error } = await supabase.from('do_not_call').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post('/outreach/dnc', requireAdmin, async (req, res) => {
    const numbers = Array.isArray(req.body?.numbers) ? req.body.numbers : [req.body?.number];
    let added = 0;
    for (const n of numbers) {
      if (!normalizeAuPhone(n)) continue;
      await addToDoNotCall(n, req.body?.reason || 'added manually', 'dashboard');
      added++;
    }
    res.json({ success: true, added });
  });

  // ── Tools the sales assistant calls during a call ───────────────────────────
  app.post('/tools/outreach', async (req, res) => {
    const { call, customer, calls } = parseToolCalls(req.body);
    const calledNumber = customer.number || call.customer?.number || '';
    const contact = await findContactByCall(call.id).catch(() => null);
    const results = [];

    for (const tc of calls) {
      const a = tc.args || {};
      const business = a.business_name || contact?.business_name || '';
      let result;
      try {
        if (tc.name === 'book_demo') {
          await notifyAdmin(
            `Demo booked: ${a.name || 'Unknown'} — ${business || 'Unknown business'} (${a.preferred_date || 'date TBC'} ${a.preferred_time || ''})`,
            'Demo Booked',
            [['Name', a.name], ['Business', business], ['Industry', contact?.industry], ['Phone called', calledNumber], ['Mobile', a.mobile], ['Email', a.email], ['Preferred date', a.preferred_date], ['Preferred time', a.preferred_time], ['Notes', a.notes]],
            'ACTION: confirm the time and send a calendar invite.'
          );
          await setContactOutcome(call.id, 'Demo Booked');
          result = `Demo request sent to Adil. Tell them Adil will confirm ${a.preferred_date || 'the time'}${a.preferred_time ? ' at ' + a.preferred_time : ''} by ${a.email ? 'email' : 'phone'} shortly.`;

        } else if (tc.name === 'send_trial_link') {
          const mobile = normalizeAuPhone(a.mobile) || (isAuMobile(normalizeAuPhone(calledNumber)) ? normalizeAuPhone(calledNumber) : null);
          const sent = [];
          if (mobile) {
            const sms = await sendSms(mobile, `Hi${a.name ? ' ' + a.name.split(' ')[0] : ''}, it's Mash, the AI assistant from Mash AI. Here's your free 7-day trial link: ${TRIAL_LINK} . Questions? Reply or email hello@mashai.com.au. Reply STOP to opt out.`);
            if (sms.sent) sent.push('text message'); else console.log('Trial SMS not sent:', sms.reason);
          }
          if (a.email && /@/.test(a.email)) {
            try {
              await resend.emails.send({
                from: FROM_EMAIL, to: a.email,
                subject: 'Your Mash AI free trial link',
                html: `<div style="font-family:Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#151129;">
                  <p>Hi${a.name ? ' ' + esc(a.name.split(' ')[0]) : ''},</p>
                  <p>Thanks for chatting with Mash, our AI assistant, just now. As promised, here's the link to start your free 7-day trial. Setup takes about five minutes, and our team builds and tests your AI receptionist, usually within 24 hours.</p>
                  <p style="text-align:center;margin:28px 0;"><a href="${TRIAL_LINK}" style="background:linear-gradient(135deg,#534AB7,#7F77DD);color:white;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Start my free trial</a></p>
                  <p>Plans start at $149/month, with no setup fees and no lock-in. You won't be charged until day 8, and you can cancel any time.</p>
                  <p>Questions? Just reply to hello@mashai.com.au, or call the number we rang you from.</p>
                  <p>Adil Shah<br>Founder, Mash AI</p>
                  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
                  <p style="font-size:12px;color:#64748b;">Mash AI is a trading name of KarnaConnect (ABN 84 924 272 443), South Lake WA 6164. You received this one-off email because you asked for the trial link on a call with us. We won't email you again unless you sign up. To ask us not to contact you, reply "unsubscribe" or email info@karnaconnect.com.au.</p>
                </div>`
              });
              sent.push('email');
            } catch (err) {
              console.error('Trial email failed:', err.message);
            }
          }
          await notifyAdmin(
            `Trial link ${sent.length ? 'sent' : 'requested'}: ${a.name || 'Unknown'} — ${business || 'Unknown business'}`,
            'Trial Link Requested',
            [['Name', a.name], ['Business', business], ['Phone called', calledNumber], ['Mobile', mobile], ['Email', a.email], ['Sent by', sent.join(' and ') || 'NOT SENT — please send manually']],
            sent.length ? 'Follow up in 2-3 days if they haven\'t signed up.' : 'ACTION: send the trial link manually.'
          );
          await setContactOutcome(call.id, 'Trial Link Sent');
          result = sent.length
            ? `Trial link sent by ${sent.join(' and ')}. Tell them it should arrive in the next minute.`
            : (a.email || mobile
              ? 'Could not send automatically. Tell them Adil will send the link personally within the hour.'
              : 'No mobile or email given. Ask for their email address, then call send_trial_link again.');

        } else if (tc.name === 'request_callback') {
          await notifyAdmin(
            `Callback: ${a.name || business || calledNumber} — ${a.callback_time || 'time TBC'}`,
            'Callback Requested',
            [['Name', a.name], ['Business', business], ['Phone', calledNumber], ['Call back', a.callback_time], ['Notes', a.notes]],
            'ACTION: schedule a call back.'
          );
          await setContactOutcome(call.id, 'Callback Requested');
          result = `Callback noted for ${a.callback_time || 'a better time'}. Thank them and end the call.`;

        } else if (tc.name === 'opt_out') {
          await addToDoNotCall(calledNumber, a.reason || 'opted out on call', 'call', business);
          await setContactOutcome(call.id, 'Opted Out');
          result = 'Number added to the do-not-call list. Confirm they won\'t be called again, say goodbye and end the call.';

        } else {
          result = 'Unknown tool.';
        }
      } catch (err) {
        console.error('Outreach tool error:', tc.name, err.message);
        result = 'That didn\'t go through. Tell them the Mash team will follow up personally.';
      }
      results.push({ toolCallId: tc.id, result });
    }
    res.json({ results });
  });

  // ── End-of-call: update the campaign contact ────────────────────────────────
  async function onCallEnded(message) {
    const call = message.call || {};
    const contact = await findContactByCall(call.id);
    if (!contact) return;
    const sd = message.analysis?.structuredData || {};
    const reason = message.endedReason || '';
    const noConnect = /did-not-answer|no-answer|busy|voicemail|failed|error/i.test(reason);
    const outcome = contact.outcome // a tool already set it during the call
      || sd.outcome
      || (/voicemail/i.test(reason) ? 'Voicemail' : /answer/i.test(reason) ? 'No Answer' : /busy/i.test(reason) ? 'Busy' : noConnect ? 'Failed' : 'No Conversation');
    await supabase.from('campaign_contacts').update({
      status: 'completed',
      outcome,
      summary: message.summaryText || message.analysis?.summary || null,
      duration_seconds: message.durationSeconds || null,
      ended_reason: reason || null
    }).eq('id', contact.id);
    if (sd.opted_out || outcome === 'Opted Out' || outcome === 'Not Interested' || outcome === 'Wrong Number') {
      await addToDoNotCall(contact.phone_number, outcome.toLowerCase(), 'call', contact.business_name);
    }
  }

  // ── Sales campaign pacing ───────────────────────────────────────────────────
  async function dial(campaign, agent, contact) {
    const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistantId: agent.vapi_agent_id,
        phoneNumberId: agent.vapi_phone_number_id,
        customer: { number: contact.phone_number, name: contact.name || undefined },
        assistantOverrides: {
          variableValues: {
            businessName: contact.business_name || '',
            contactName: contact.name || '',
            industry: contact.industry || '',
            suburb: contact.suburb || ''
          }
        },
        metadata: { campaignId: campaign.id, campaignContactId: contact.id }
      })
    });
    const result = await vapiRes.json().catch(() => ({}));
    if (!vapiRes.ok) throw new Error(JSON.stringify(result).slice(0, 300));
    return result.id;
  }

  async function finishIfDone(campaign) {
    const { data: rows } = await supabase.from('campaign_contacts').select('status').eq('campaign_id', campaign.id);
    const open = (rows || []).filter(r => r.status === 'pending' || r.status === 'calling').length;
    if (open) return false;
    const called = rows.filter(r => r.status === 'completed').length;
    const failed = rows.filter(r => r.status === 'failed').length;
    await supabase.from('campaigns').update({ status: 'completed', called_count: called, failed_count: failed, completed_at: new Date().toISOString() }).eq('id', campaign.id);
    console.log(`Sales campaign complete: ${campaign.name} — ${called} reached, ${failed} failed`);
    return true;
  }

  async function processSalesCampaign(campaign, agent, now) {
    if (campaign.status === 'scheduled') await supabase.from('campaigns').update({ status: 'running' }).eq('id', campaign.id);

    // Calls that never got an end-of-call report
    const staleBefore = new Date(now.getTime() - STALE_CALL_MINUTES * 60000).toISOString();
    await supabase.from('campaign_contacts').update({ status: 'failed', ended_reason: 'no end-of-call report' })
      .eq('campaign_id', campaign.id).eq('status', 'calling').lt('called_at', staleBefore);

    const { count: inFlight } = await supabase.from('campaign_contacts').select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id).eq('status', 'calling');
    let slots = Math.max(1, campaign.max_concurrent || 1) - (inFlight || 0);

    const { data: pending } = await supabase.from('campaign_contacts').select('*')
      .eq('campaign_id', campaign.id).eq('status', 'pending').order('created_at').limit(50);
    if (!pending?.length) return finishIfDone(campaign);

    let blockedByHours = 0, dialed = 0;
    for (const contact of pending) {
      if (slots <= 0) break;
      const phone = normalizeAuPhone(contact.phone_number);
      if (!phone) {
        await supabase.from('campaign_contacts').update({ status: 'failed', ended_reason: 'invalid number' }).eq('id', contact.id);
        continue;
      }
      const { data: dnc } = await supabase.from('do_not_call').select('phone_number').eq('phone_number', phone).maybeSingle();
      if (dnc) {
        await supabase.from('campaign_contacts').update({ status: 'skipped', outcome: 'Do Not Call' }).eq('id', contact.id);
        continue;
      }
      if (!canCallNow(campaign, phone, now)) { blockedByHours++; continue; }

      // Claim the contact before dialling so overlapping ticks can't double-dial
      const { data: claimed } = await supabase.from('campaign_contacts')
        .update({ status: 'calling', called_at: new Date().toISOString(), phone_number: phone })
        .eq('id', contact.id).eq('status', 'pending').select('id');
      if (!claimed?.length) continue;
      try {
        const callId = await dial(campaign, agent, { ...contact, phone_number: phone });
        await supabase.from('campaign_contacts').update({ call_id: callId }).eq('id', contact.id);
        slots--; dialed++;
      } catch (err) {
        console.error('Sales dial failed:', contact.id, err.message);
        await supabase.from('campaign_contacts').update({ status: 'failed', ended_reason: err.message.slice(0, 200) }).eq('id', contact.id);
      }
    }

    // 'waiting' = nothing on the line and everyone left is outside calling hours
    const nextStatus = blockedByHours && !dialed && !inFlight ? 'waiting' : 'running';
    if (nextStatus !== campaign.status) await supabase.from('campaigns').update({ status: nextStatus }).eq('id', campaign.id);
    await finishIfDone(campaign);
  }

  let ticking = false;
  async function tickSalesCampaigns(now = new Date()) {
    if (ticking) return;
    ticking = true;
    try {
      const { data: campaigns } = await supabase.from('campaigns')
        .select('*, outbound_agents!inner(vapi_agent_id, vapi_phone_number_id, purpose)')
        .eq('outbound_agents.purpose', 'sales')
        .in('status', ['scheduled', 'running', 'waiting'])
        .lte('scheduled_at', now.toISOString());
      for (const c of campaigns || []) {
        await processSalesCampaign(c, c.outbound_agents, now).catch(err => console.error('Sales campaign error:', c.id, err.message));
      }
    } catch (err) {
      console.error('Sales campaign tick error:', err.message);
    } finally {
      ticking = false;
    }
  }

  return {
    onCallEnded,
    tickSalesCampaigns,
    normalizeAuPhone,
    isSalesAgent: async (outboundAgentId) => {
      const { data } = await supabase.from('outbound_agents').select('purpose').eq('id', outboundAgentId).maybeSingle();
      return data?.purpose === 'sales';
    },
    isOnDoNotCall: async (number) => {
      const phone = normalizeAuPhone(number);
      if (!phone) return false;
      const { data } = await supabase.from('do_not_call').select('phone_number').eq('phone_number', phone).maybeSingle();
      return !!data;
    },
    DEFAULT_SALES_CAMPAIGN,
    // exported for tests
    _internal: { canCallNow, isNationalHoliday, localParts, recipientTimezone, salesAssistantConfig }
  };
};

module.exports.SALES_PROMPT = SALES_PROMPT;
module.exports.FIRST_MESSAGE = FIRST_MESSAGE;
