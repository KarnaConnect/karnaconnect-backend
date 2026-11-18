// ── Mash sales leads: find → call → sort → follow up ─────────────────────────
// - Lead finder: local businesses by industry from OpenStreetMap (free to store,
//   ODbL licence), plus CSV import. Emails are picked up from listings and the
//   business's own website where shown publicly.
// - Pipeline: every call updates the lead's status (hot, wants_info,
//   on_the_fence, not_interested, no_answer...) and schedules the next step.
// - Follow-ups: Mash calls back automatically (inside the industry's calling
//   window, DNCR wash still valid), or the lead is flagged for Adil.
// - Summary email after the call, only when the person said yes on the call
//   (Spam Act: consent, sender identified, working unsubscribe).

const crypto = require('crypto');
const industries = require('./industries');

// Railway has no IPv6 egress; without this, fetches to dual-stack hosts like the OSM servers can hang.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch {}
try { require('net').setDefaultAutoSelectFamily?.(true); } catch {}
const UA = 'MashAI-LeadFinder/1.0 (hello@mashai.com.au)';
const DNCR_VALID_DAYS = 30;
const MAX_ATTEMPTS = 3;          // cold-call attempts before 'unreachable'
const MAX_FOLLOW_UPS = 2;        // Mash follow-up calls before handing to Adil
const STALE_MINUTES = 20;
const TRIAL_LINK = 'https://dashboard.mashai.com.au/onboarding';
const FROM_EMAIL = 'Adil from Mash <hello@mashai.com.au>';
const SENDER_EMAIL = 'Mash <noreply@mashai.com.au>';

const STATUSES = ['new', 'queued', 'no_answer', 'hot', 'wants_info', 'on_the_fence', 'not_interested', 'customer', 'do_not_call', 'unreachable'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const daysAgo = (d) => d ? (Date.now() - new Date(d).getTime()) / 86400000 : Infinity;
const dncrValid = (lead) => daysAgo(lead?.dncr_checked_at) <= DNCR_VALID_DAYS;

function unsubToken(email) {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_KEY || 'mash';
  return crypto.createHmac('sha256', secret).update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
}

function industryAngle(key) {
  const ind = industries.getIndustry(key);
  const m = /Angle: ([^\n]+)/.exec(ind ? ind.playbook : industries.DEFAULT_PLAYBOOK);
  return m ? m[1] : '';
}

// Map an end-of-call result to an interest bucket
function interestFrom(sd, outcome, endedReason) {
  if (sd?.interest) return sd.interest;
  const o = String(outcome || '');
  if (/Demo Booked/i.test(o)) return 'hot_lead';
  if (/Trial Link|Interested - Follow/i.test(o)) return 'wants_info';
  if (/Callback/i.test(o)) return 'on_the_fence';
  if (/Not Interested|Opted Out|Wrong Number|Do Not Call/i.test(o)) return 'not_interested';
  if (/voicemail|answer|busy|Gatekeeper|No Conversation|Failed/i.test(o + ' ' + (endedReason || ''))) return 'no_conversation';
  return 'no_conversation';
}

module.exports = function registerLeads(app, deps) {
  const { supabase, resend, requireAdmin, normalizeAuPhone, canCallNow, nextCallableTime, addToDoNotCall, notifyAdmin, dial, perthToday } = deps;

  async function settings() {
    const { data } = await supabase.from('outreach_settings').select('*').eq('id', 1).maybeSingle();
    return data || { paused: false, auto_followups: true };
  }

  async function salesAgent() {
    const { data } = await supabase.from('outbound_agents').select('*').eq('purpose', 'sales').maybeSingle();
    return data;
  }

  function windowsFor(industryKey) {
    const ind = industries.getIndustry(industryKey);
    return ind ? { days: ind.days, windows: ind.windows } : { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], windows: [['09:30', '11:30'], ['14:00', '16:00']] };
  }

  const pseudoCampaign = (industryKey) => ({ timezone: 'Australia/Perth', weekdays_only: true, call_windows: windowsFor(industryKey) });

  async function updateLead(id, patch) {
    if (!id) return;
    const { error } = await supabase.from('leads').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) console.error('Lead update failed:', id, error.message);
  }

  async function leadForCall(call) {
    const id = call?.metadata?.leadId;
    if (id) {
      const { data } = await supabase.from('leads').select('*').eq('id', id).maybeSingle();
      if (data) return data;
    }
    if (!call?.id) return null;
    const { data: byFlight } = await supabase.from('leads').select('*').eq('in_flight_call_id', call.id).maybeSingle();
    if (byFlight) return byFlight;
    const { data: contact } = await supabase.from('campaign_contacts').select('lead_id').eq('call_id', call.id).maybeSingle();
    if (contact?.lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', contact.lead_id).maybeSingle();
      return data;
    }
    return null;
  }

  // ── Emails ────────────────────────────────────────────────────────────────
  function emailFooter(email) {
    const base = (process.env.PUBLIC_BACKEND_URL || 'https://expressjs-production-48b3.up.railway.app').replace(/\/$/, '');
    const url = `${base}/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;
    return {
      url,
      html: `<hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 16px;">
        <p style="font-size:12px;color:#64748b;line-height:1.5;">You're receiving this because you said yes to a summary email on a call with Mash today. Mash AI is a trading name of KarnaConnect (ABN 84 924 272 443), South Lake WA 6164. <a href="${url}" style="color:#64748b;">Unsubscribe</a> and we won't email you again.</p>`
    };
  }

  async function sendSummaryEmail({ email, name, discussionNotes, lead, calledNumber }) {
    const to = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { sent: false, reason: 'invalid email' };
    if (lead?.email_opt_out) return { sent: false, reason: 'unsubscribed' };
    const { data: optedOut } = await supabase.from('leads').select('id').ilike('email', to).eq('email_opt_out', true).limit(1);
    if (optedOut?.length) return { sent: false, reason: 'unsubscribed' };

    const first = name ? String(name).split(' ')[0] : '';
    const business = lead?.business_name || '';
    const angle = industryAngle(lead?.industry);
    const footer = emailFooter(to);
    const html = `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#151129;line-height:1.55;">
      <p>Hi${first ? ' ' + esc(first) : ''},</p>
      <p>Thanks for chatting with Mash just now. As promised, here's a quick summary so you've got it in writing.</p>
      ${discussionNotes ? `<p style="background:#f5f3fe;border-left:3px solid #6f5fd6;border-radius:8px;padding:12px 14px;"><strong>What we talked about:</strong> ${esc(discussionNotes)}</p>` : ''}
      <p><strong>How Mash would help${business ? ' ' + esc(business) : ''}:</strong> ${esc(angle || 'Mash answers every call 24/7, takes the details and sends you a summary straight away, so no enquiry is lost.')}</p>
      <ul style="padding-left:18px;">
        <li>Answers every call 24/7 in a natural Australian voice</li>
        <li>Instant email and app alerts with a summary of each call</li>
        <li>Live dashboard with recordings, transcripts and call tags</li>
        <li>No setup fees, no lock-in contracts</li>
      </ul>
      <p>Plans start at $149 a month, and every plan comes with a <strong>7-day free trial</strong>. You're not charged until day 8, and you can cancel any time.</p>
      <p style="text-align:center;margin:26px 0;"><a href="${TRIAL_LINK}" style="background:linear-gradient(135deg,#534AB7,#7F77DD);color:#fff;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Start my free trial</a></p>
      <p>Prefer a quick 15-minute chat first? Just reply to this email with a time that suits and I'll set it up.</p>
      <p>Cheers,<br>Adil Shah<br>Founder, Mash AI<br><a href="https://mashai.com.au" style="color:#534AB7;">mashai.com.au</a></p>
      ${footer.html}
    </div>`;
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        reply_to: 'hello@mashai.com.au',
        to,
        subject: `${first ? first + ', here' : 'Here'}'s your Mash summary${business ? ' for ' + business : ''}`,
        html,
        headers: { 'List-Unsubscribe': `<${footer.url}>, <mailto:hello@mashai.com.au?subject=unsubscribe>` }
      });
    } catch (err) {
      console.error('Summary email failed:', err.message);
      return { sent: false, reason: err.message };
    }
    if (lead) await updateLead(lead.id, { email: to, email_consent: true, email_sent_at: new Date().toISOString() });
    return { sent: true };
  }

  app.get('/unsubscribe', async (req, res) => {
    const email = String(req.query.e || '').trim();
    const ok = email && req.query.t === unsubToken(email);
    if (ok) {
      await supabase.from('leads').update({ email_opt_out: true, updated_at: new Date().toISOString() }).ilike('email', email);
      console.log('Unsubscribed:', email);
    }
    res.set('Content-Type', 'text/html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;text-align:center;color:#151129;">
      <h2>${ok ? "You're unsubscribed" : 'Link not recognised'}</h2>
      <p style="color:#64748b;">${ok ? "We won't email you again. Sorry for the bother." : 'Please email hello@mashai.com.au and we will remove you straight away.'}</p></div>`);
  });

  // ── Called from the VAPI tool handler ────────────────────────────────────
  async function onTool(name, args, call, calledNumber) {
    const lead = await leadForCall(call);
    if (name === 'send_summary_email') {
      const r = await sendSummaryEmail({ email: args.email, name: args.name, discussionNotes: args.discussion_notes, lead, calledNumber });
      return r.sent
        ? 'Summary email sent. Let them know it\'s on its way, then wrap up.'
        : r.reason === 'unsubscribed'
          ? 'This address has unsubscribed, so no email was sent. Don\'t mention it again; just wrap up.'
          : 'The email address didn\'t look right. Read it back to them and try once more, or skip it.';
    }
    if (!lead) return null;
    if (name === 'book_demo') {
      await updateLead(lead.id, { status: 'hot', follow_up_by: 'adil', follow_up_at: new Date().toISOString(), follow_up_note: `Demo requested: ${args.preferred_date || ''} ${args.preferred_time || ''}`.trim(), email: args.email || lead.email });
    } else if (name === 'send_trial_link') {
      const patch = {};
      if (args.email) Object.assign(patch, { email: args.email, email_consent: true, email_sent_at: new Date().toISOString() });
      if (Object.keys(patch).length) await updateLead(lead.id, patch);
    } else if (name === 'request_callback') {
      const s = await settings();
      let when = null;
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(args.callback_at || '');
      if (m) {
        // Interpret as Perth local time (UTC+8, no DST)
        when = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]));
        if (isNaN(when) || when < new Date() || daysAgo(when) < -21) when = null;
      }
      if (when && !canCallNow({ timezone: 'Australia/Perth', weekdays_only: true }, lead.phone_number, when)) {
        when = nextCallableTime({ timezone: 'Australia/Perth', weekdays_only: true }, lead.phone_number, when);
      }
      const byMash = when && s.auto_followups && dncrValid(lead);
      await updateLead(lead.id, {
        status: 'on_the_fence',
        follow_up_by: byMash ? 'mash' : 'adil',
        follow_up_at: (when || new Date()).toISOString(),
        follow_up_note: `Callback requested: ${args.callback_time || args.callback_at || ''}${args.name ? ' (ask for ' + args.name + ')' : ''}`
      });
    } else if (name === 'opt_out') {
      await updateLead(lead.id, { status: 'do_not_call', follow_up_by: null, follow_up_at: null, follow_up_note: null });
    }
    return null;
  }

  // ── Called when VAPI sends the end-of-call report ─────────────────────────
  async function onCallEnded(message) {
    const call = message.call || {};
    const lead = await leadForCall(call);
    if (!lead) return;
    const sd = message.analysis?.structuredData || {};
    const outcome = sd.outcome || message.endedReason || '';
    const interest = interestFrom(sd, outcome, message.endedReason);
    const s = await settings();
    const now = new Date();
    const patch = {
      in_flight_call_id: null,
      last_call_id: call.id,
      last_called_at: lead.last_called_at && lead.in_flight_call_id === call.id ? lead.last_called_at : now.toISOString(),
      last_outcome: outcome || null,
      last_summary: message.summaryText || message.analysis?.summary || null
    };
    if (sd.email && !lead.email) patch.email = sd.email;

    // A callback set during the call (request_callback tool) wins
    const fresh = (await supabase.from('leads').select('status, follow_up_note, updated_at').eq('id', lead.id).maybeSingle()).data || {};
    const callbackSet = /^Callback requested/.test(fresh.follow_up_note || '') && daysAgo(fresh.updated_at) < 0.05;
    const later = (days) => nextCallableTime(pseudoCampaign(lead.industry), lead.phone_number, new Date(now.getTime() + days * 86400000));
    const mashOrAdil = (days, note) => {
      const mash = s.auto_followups && (lead.follow_up_count || 0) < MAX_FOLLOW_UPS && dncrValid(lead);
      const at = mash ? later(days) : now;
      return { follow_up_by: mash && at ? 'mash' : 'adil', follow_up_at: (at || now).toISOString(), follow_up_note: mash && at ? note : `${note} (your call)` };
    };

    if (fresh.status === 'do_not_call' || interest === 'not_interested') {
      Object.assign(patch, { status: interest === 'not_interested' ? 'not_interested' : 'do_not_call', follow_up_by: null, follow_up_at: null, follow_up_note: null });
    } else if (interest === 'hot_lead') {
      Object.assign(patch, { status: 'hot', follow_up_by: 'adil', follow_up_at: now.toISOString(), follow_up_note: fresh.follow_up_note && /Demo/.test(fresh.follow_up_note) ? fresh.follow_up_note : 'Hot lead: call them back' });
      notifyAdmin(`🔥 Hot lead: ${lead.business_name}`, 'Hot Lead', [
        ['Business', lead.business_name], ['Industry', industries.getIndustry(lead.industry)?.label || lead.industry], ['Phone', lead.phone_number], ['Email', patch.email || lead.email], ['Summary', patch.last_summary]
      ], 'ACTION: give them a call while it\'s warm.').catch(() => {});
    } else if (callbackSet) {
      patch.status = 'on_the_fence';
    } else if (interest === 'wants_info') {
      Object.assign(patch, { status: 'wants_info' }, mashOrAdil(3, 'Check they got the info; aim for demo or trial'));
    } else if (interest === 'on_the_fence') {
      Object.assign(patch, { status: 'on_the_fence' }, mashOrAdil(7, 'Follow up: answer questions, offer the free trial'));
    } else {
      // No conversation (voicemail, no answer, gatekeeper)
      const attempts = lead.call_attempts || 0;
      if (lead.status === 'wants_info' || lead.status === 'on_the_fence') {
        // A follow-up that didn't connect: try again once more later
        Object.assign(patch, mashOrAdil(2, lead.follow_up_note || 'Follow up'));
      } else if (attempts < MAX_ATTEMPTS && s.auto_followups && dncrValid(lead)) {
        const at = later(1);
        Object.assign(patch, { status: 'no_answer', follow_up_by: at ? 'mash' : null, follow_up_at: at ? at.toISOString() : null, follow_up_note: `Retry (attempt ${attempts + 1} of ${MAX_ATTEMPTS})` });
      } else {
        Object.assign(patch, { status: attempts >= MAX_ATTEMPTS ? 'unreachable' : 'no_answer', follow_up_by: null, follow_up_at: null, follow_up_note: null });
      }
    }
    await updateLead(lead.id, patch);
    await supabase.from('campaign_contacts').update({ interest }).eq('call_id', call.id);
  }

  // ── Follow-up runner (every minute, from the campaign cron) ───────────────
  async function tickFollowUps(now = new Date(), inFlightElsewhere = 0) {
    const s = await settings();
    if (s.paused || !s.auto_followups) return;

    // Clear calls that never reported back
    const staleBefore = new Date(now.getTime() - STALE_MINUTES * 60000).toISOString();
    await supabase.from('leads').update({ in_flight_call_id: null }).not('in_flight_call_id', 'is', null).lt('last_called_at', staleBefore);

    const { count: leadInFlight } = await supabase.from('leads').select('*', { count: 'exact', head: true }).not('in_flight_call_id', 'is', null);
    if ((leadInFlight || 0) + inFlightElsewhere > 0) return; // one sales call at a time

    const agent = await salesAgent();
    if (!agent) return;
    const { data: due } = await supabase.from('leads').select('*')
      .eq('follow_up_by', 'mash').lte('follow_up_at', now.toISOString())
      .in('status', ['no_answer', 'wants_info', 'on_the_fence'])
      .is('in_flight_call_id', null).order('follow_up_at').limit(20);

    for (const lead of due || []) {
      const phone = normalizeAuPhone(lead.phone_number);
      const { data: dnc } = phone ? await supabase.from('do_not_call').select('phone_number').eq('phone_number', phone).maybeSingle() : { data: null };
      if (!phone || dnc) { await updateLead(lead.id, { status: 'do_not_call', follow_up_by: null, follow_up_at: null }); continue; }
      if (!dncrValid(lead)) {
        await updateLead(lead.id, { follow_up_by: 'adil', follow_up_note: 'Re-wash this number on the Do Not Call Register before Mash can call again' });
        continue;
      }
      if (!canCallNow(pseudoCampaign(lead.industry), phone, now)) continue;

      const isFollowUp = lead.status !== 'no_answer';
      try {
        const callId = await dial({ id: null, industry: lead.industry }, agent, {
          id: null, lead_id: lead.id, phone_number: phone, business_name: lead.business_name, industry_key: lead.industry,
          suburb: lead.suburb, email: lead.email_opt_out ? '' : lead.email
        }, isFollowUp ? {
          callType: 'follow_up',
          previousSummary: lead.last_summary || '',
          lastCallDate: lead.last_called_at ? new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(lead.last_called_at)) : 'recently'
        } : {});
        await updateLead(lead.id, {
          in_flight_call_id: callId, last_called_at: now.toISOString(), call_attempts: (lead.call_attempts || 0) + (isFollowUp ? 0 : 1),
          follow_up_count: (lead.follow_up_count || 0) + (isFollowUp ? 1 : 0), follow_up_by: null, follow_up_at: null
        });
        console.log('Follow-up call placed:', lead.business_name, callId);
      } catch (err) {
        console.error('Follow-up dial failed:', lead.id, err.message);
        await updateLead(lead.id, { follow_up_by: 'adil', follow_up_note: 'Mash could not place the follow-up call: ' + err.message.slice(0, 120) });
      }
      return; // one call per tick
    }
  }

  // ── Lead finder (OpenStreetMap) ───────────────────────────────────────────
  async function geocode(area) {
    const q = /australia|wa\b|western/i.test(area) ? area : `${area}, Western Australia, Australia`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Map lookup failed (${r.status})`);
    const j = await r.json();
    if (!j?.length) throw new Error(`Couldn't find "${area}" on the map`);
    return { lat: +j[0].lat, lon: +j[0].lon, name: j[0].display_name };
  }

  async function findEmailOnWebsite(url) {
    try {
      const u = /^https?:\/\//.test(url) ? url : `https://${url}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(timer);
      const html = (await r.text()).slice(0, 400000);
      const found = new Set();
      for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) found.add(decodeURIComponent(m[1]).toLowerCase());
      for (const m of html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(?:com\.au|net\.au|org\.au|com|au|net|org|biz)\b/g)) found.add(m[0].toLowerCase());
      const host = new URL(u).hostname.replace(/^www\./, '');
      const list = [...found].filter(e => !/\.(png|jpg|jpeg|gif|webp|svg)$/.test(e) && !/example\.|sentry|wixpress|domain\.com|yourname|email@/.test(e));
      return list.find(e => e.endsWith('@' + host)) || list.find(e => /^(info|hello|admin|enquir|contact|office|reception|bookings?|sales)@/.test(e)) || list[0] || null;
    } catch { return null; }
  }

  // Overpass servers are free and often busy: try each with a timeout.
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  async function overpass(q) {
    const errors = [];
    // The main server first (twice, since it often throws a quick 502/429 when busy), then the mirrors.
    for (const url of [OVERPASS[0], OVERPASS[0], ...OVERPASS.slice(1)]) {
      if (errors.length) await new Promise(r => setTimeout(r, 8000));
      const t0 = Date.now();
      try {
        const r = await fetch(url, {
          method: 'POST', signal: AbortSignal.timeout(90000),
          headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q)
        });
        if (!r.ok) { errors.push(`${new URL(url).host} ${r.status} ${Math.round((Date.now() - t0) / 1000)}s`); continue; }
        return (await r.json()).elements || [];
      } catch (err) { errors.push(`${new URL(url).host} ${err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code || err.message)} ${Math.round((Date.now() - t0) / 1000)}s`); }
    }
    throw new Error(`OpenStreetMap search failed: ${errors.join('; ')}`);
  }

  async function findLeads({ industry, area, radiusKm = 8, enrichEmails = true, place: knownPlace }) {
    const ind = industries.getIndustry(industry);
    if (!ind) throw new Error('Unknown industry');
    const place = knownPlace || await geocode(area);
    const radius = Math.min(Math.max(+radiusKm || 8, 1), 30) * 1000;
    const parts = ind.osm.map(([k, v]) => `nwr["${k}"="${v}"](around:${radius},${place.lat},${place.lon});`).join('');
    const q = `[out:json][timeout:60];(${parts});out center tags 500;`;
    const elements = await overpass(q);

    const stats = { found: elements.length, added: 0, alreadyListed: 0, noPhone: 0, chains: 0, doNotCall: 0, withEmail: 0 };
    const rows = [];
    const seen = new Set();
    for (const el of elements) {
      const t = el.tags || {};
      if (!t.name) continue;
      if (t.brand || t['brand:wikidata']) { stats.chains++; continue; }
      const rawPhone = (t.phone || t['contact:phone'] || t['contact:mobile'] || '').split(';')[0];
      const phone = normalizeAuPhone(rawPhone);
      if (!phone) { stats.noPhone++; continue; }
      if (seen.has(phone)) continue;
      seen.add(phone);
      rows.push({
        business_name: t.name.slice(0, 200),
        phone_number: phone,
        industry,
        suburb: t['addr:suburb'] || t['addr:city'] || null,
        address: [t['addr:housenumber'], t['addr:street'], t['addr:suburb'] || t['addr:city'], t['addr:postcode']].filter(Boolean).join(' ') || null,
        website: t.website || t['contact:website'] || null,
        email: (t.email || t['contact:email'] || '').split(';')[0].trim().toLowerCase() || null,
        source: 'OpenStreetMap',
        source_ref: `osm:${el.type}/${el.id}`
      });
    }

    // Skip numbers already in the pipeline or on the do-not-call list
    const phones = rows.map(r => r.phone_number);
    const existing = new Set(), blocked = new Set();
    for (let i = 0; i < phones.length; i += 200) {
      const chunk = phones.slice(i, i + 200);
      const { data: ex } = await supabase.from('leads').select('phone_number').in('phone_number', chunk);
      (ex || []).forEach(x => existing.add(x.phone_number));
      const { data: dn } = await supabase.from('do_not_call').select('phone_number').in('phone_number', chunk);
      (dn || []).forEach(x => blocked.add(x.phone_number));
    }
    const fresh = rows.filter(r => {
      if (blocked.has(r.phone_number)) { stats.doNotCall++; return false; }
      if (existing.has(r.phone_number)) { stats.alreadyListed++; return false; }
      return true;
    });

    if (enrichEmails) {
      const need = fresh.filter(r => !r.email && r.website).slice(0, 40);
      for (let i = 0; i < need.length; i += 5) {
        await Promise.all(need.slice(i, i + 5).map(async r => { r.email = await findEmailOnWebsite(r.website); }));
      }
    }
    stats.withEmail = fresh.filter(r => r.email).length;
    if (fresh.length) {
      const { error } = await supabase.from('leads').upsert(fresh, { onConflict: 'phone_number', ignoreDuplicates: true });
      if (error) throw error;
    }
    stats.added = fresh.length;
    return { area: place.name, stats, leads: fresh };
  }

  // ── Admin routes for the dashboard ────────────────────────────────────────
  app.get('/leads/industries', requireAdmin, (req, res) => res.json(industries.listIndustries()));

  app.get('/leads', requireAdmin, async (req, res) => {
    try {
      let q = supabase.from('leads').select('*').order('updated_at', { ascending: false }).limit(1000);
      if (req.query.status) q = q.in('status', String(req.query.status).split(','));
      if (req.query.industry) q = q.eq('industry', req.query.industry);
      const { data, error } = await q;
      if (error) throw error;
      const { data: all } = await supabase.from('leads').select('status, industry');
      const counts = {};
      for (const r of all || []) counts[r.status] = (counts[r.status] || 0) + 1;
      res.json({ leads: data, counts, total: (all || []).length, settings: await settings(), industries: industries.listIndustries() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/leads/find', requireAdmin, async (req, res) => {
    try {
      const result = await findLeads(req.body || {});
      res.json({ area: result.area, stats: result.stats });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post('/leads/import', requireAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const stats = { received: rows.length, added: 0, invalid: 0, doNotCall: 0, duplicates: 0 };
      const clean = [], seen = new Set();
      for (const r of rows) {
        const phone = normalizeAuPhone(r.phone_number || r.phone);
        const industry = industries.matchIndustry(r.industry) || industries.matchIndustry(req.body?.industry) || null;
        if (!phone || !r.business_name || !industry) { stats.invalid++; continue; }
        if (seen.has(phone)) { stats.duplicates++; continue; }
        seen.add(phone);
        clean.push({ business_name: String(r.business_name).slice(0, 200), phone_number: phone, industry, suburb: r.suburb || null, address: r.address || null, website: r.website || null, email: r.email ? String(r.email).trim().toLowerCase() : null, source: r.source || 'CSV import' });
      }
      const phones = clean.map(c => c.phone_number);
      const blocked = new Set();
      for (let i = 0; i < phones.length; i += 200) {
        const { data: dn } = await supabase.from('do_not_call').select('phone_number').in('phone_number', phones.slice(i, i + 200));
        (dn || []).forEach(x => blocked.add(x.phone_number));
      }
      const toAdd = clean.filter(c => !blocked.has(c.phone_number));
      stats.doNotCall = clean.length - toAdd.length;
      if (toAdd.length) {
        const { data, error } = await supabase.from('leads').upsert(toAdd, { onConflict: 'phone_number', ignoreDuplicates: true }).select('id');
        if (error) throw error;
        stats.added = (data || []).length;
        stats.duplicates += toAdd.length - stats.added;
      }
      res.json({ stats });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/leads/update', requireAdmin, async (req, res) => {
    try {
      const { ids, status, followUpBy, followUpAt, notes } = req.body || {};
      if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No leads selected' });
      const patch = {};
      if (status !== undefined) {
        if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
        patch.status = status;
        if (['customer', 'not_interested', 'do_not_call', 'unreachable'].includes(status)) Object.assign(patch, { follow_up_by: null, follow_up_at: null, follow_up_note: null });
      }
      if (followUpBy !== undefined) {
        patch.follow_up_by = followUpBy || null;
        patch.follow_up_at = followUpBy ? (followUpAt ? new Date(followUpAt).toISOString() : new Date().toISOString()) : null;
        if (followUpBy === 'adil') patch.follow_up_note = 'You said you\'d call them';
      }
      if (notes !== undefined) patch.notes = notes;
      patch.updated_at = new Date().toISOString();
      const { error } = await supabase.from('leads').update(patch).in('id', ids);
      if (error) throw error;
      if (status === 'do_not_call') {
        const { data } = await supabase.from('leads').select('phone_number, business_name').in('id', ids);
        for (const l of data || []) await addToDoNotCall(l.phone_number, 'marked in dashboard', 'dashboard', l.business_name);
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Record a Do Not Call Register wash: registered numbers go on our list
  app.post('/leads/dncr', requireAdmin, async (req, res) => {
    try {
      const { ids, washedAt, registeredNumbers = [] } = req.body || {};
      const d = new Date(washedAt);
      if (!Array.isArray(ids) || !ids.length || isNaN(d) || daysAgo(d) > DNCR_VALID_DAYS || daysAgo(d) < -1) {
        return res.status(400).json({ error: 'Pick the leads and a wash date from the last 30 days' });
      }
      const registered = new Set(registeredNumbers.map(normalizeAuPhone).filter(Boolean));
      const { data: leads } = await supabase.from('leads').select('id, phone_number, business_name').in('id', ids);
      let blocked = 0;
      for (const l of leads || []) {
        if (registered.has(l.phone_number)) {
          await addToDoNotCall(l.phone_number, 'on the Do Not Call Register', 'dncr', l.business_name);
          await updateLead(l.id, { status: 'do_not_call', follow_up_by: null, follow_up_at: null, dncr_checked_at: washedAt });
          blocked++;
        } else {
          await updateLead(l.id, { dncr_checked_at: washedAt });
        }
      }
      res.json({ success: true, washed: (leads || []).length, blocked });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Turn selected leads into one campaign per industry, using each industry's best calling times
  app.post('/leads/campaign', requireAdmin, async (req, res) => {
    try {
      const { ids, startAt, name } = req.body || {};
      const agent = await salesAgent();
      if (!agent) return res.status(400).json({ error: 'The Mash sales agent is not set up yet' });
      const { data: leads } = await supabase.from('leads').select('*').in('id', ids || []);
      const callable = (leads || []).filter(l => ['new', 'no_answer', 'wants_info', 'on_the_fence'].includes(l.status));
      const unwashed = callable.filter(l => !dncrValid(l));
      if (unwashed.length) return res.status(400).json({ error: `${unwashed.length} of these leads haven't been washed against the Do Not Call Register in the last 30 days. Download them, wash them, and record the wash first.` });
      if (!callable.length) return res.status(400).json({ error: 'None of the selected leads can be called (already called, customers or do-not-call).' });

      const byIndustry = {};
      for (const l of callable) (byIndustry[l.industry] ||= []).push(l);
      const created = [];
      for (const [key, group] of Object.entries(byIndustry)) {
        const ind = industries.getIndustry(key);
        const oldestWash = group.map(l => l.dncr_checked_at).sort()[0];
        const { data: campaign, error } = await supabase.from('campaigns').insert({
          client_id: agent.client_id,
          outbound_agent_id: agent.id,
          name: `${name || 'Mash outreach'}: ${ind ? ind.folder : key}`,
          scheduled_at: startAt ? new Date(startAt).toISOString() : new Date().toISOString(),
          total_contacts: group.length,
          industry: key,
          call_windows: windowsFor(key),
          timezone: 'Australia/Perth',
          weekdays_only: true,
          max_concurrent: 1,
          dnc_checked_at: oldestWash
        }).select().single();
        if (error) throw error;
        const rows = group.map(l => ({ campaign_id: campaign.id, lead_id: l.id, name: null, phone_number: l.phone_number, business_name: l.business_name, industry: key, suburb: l.suburb }));
        const { error: ce } = await supabase.from('campaign_contacts').insert(rows);
        if (ce) throw ce;
        await supabase.from('leads').update({ status: 'queued', follow_up_by: null, follow_up_at: null, updated_at: new Date().toISOString() }).in('id', group.map(l => l.id));
        created.push({ id: campaign.id, name: campaign.name, contacts: group.length, windows: windowsFor(key) });
      }
      res.json({ success: true, campaigns: created });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/leads/settings', requireAdmin, async (req, res) => {
    const patch = { updated_at: new Date().toISOString() };
    if (typeof req.body?.paused === 'boolean') patch.paused = req.body.paused;
    if (typeof req.body?.autoFollowups === 'boolean') patch.auto_followups = req.body.autoFollowups;
    const { error } = await supabase.from('outreach_settings').update(patch).eq('id', 1);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, settings: await settings() });
  });

  // ── One-off starter list: every industry across Perth's southern suburbs ──
  // Runs once on startup when no OpenStreetMap leads exist yet. Adil chose the
  // southern suburbs on 18 Nov 2026. Nothing is called: leads land as 'new'.
  // Fixed points so the seed doesn't depend on the geocoder.
  const SEED_AREAS = [
    { name: 'Cockburn Central', lat: -32.1219, lon: 115.8478 },
    { name: 'Fremantle', lat: -32.0569, lon: 115.7439 },
    { name: 'Booragoon', lat: -32.0390, lon: 115.8340 },
    { name: 'Rockingham', lat: -32.2799, lon: 115.7300 },
    { name: 'Kwinana Town Centre', lat: -32.2394, lon: 115.7702 }
  ];
  // Leaves a readable trail in the Supabase API logs (a harmless read), since Railway logs aren't reachable from support tooling.
  const seedTrace = (msg) => supabase.from('leads').select('id').eq('source_ref', `seed-trace:${String(msg).slice(0, 180)}`).limit(1).then(() => {}, () => {});
  let seedAttempts = 0;
  async function seedStarterLeads() {
    if (process.env.SEED_LEADS === 'off') return;
    seedAttempts++;
    const { count } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('source', 'OpenStreetMap');
    if (count) return;
    console.log('Seeding starter leads for southern suburbs...');
    seedTrace('start');
    const totals = {};
    let failsInARow = 0;
    for (const key of Object.keys(industries.INDUSTRIES)) {
      totals[key] = { added: 0, withEmail: 0 };
      for (const area of SEED_AREAS) {
        try {
          const r = await findLeads({ industry: key, area: area.name, radiusKm: 6, place: area });
          seedTrace(`${key} ${area.name} found=${r.stats.found} added=${r.stats.added} email=${r.stats.withEmail}`);
          failsInARow = 0;
          totals[key].added += r.stats.added;
          totals[key].withEmail += r.stats.withEmail;
        } catch (err) {
          console.error('Seed failed:', key, area.name, err.message);
          seedTrace(`FAIL ${key} ${area.name} ${err.message}`);
          if (++failsInARow >= 4) {
            // Free map servers are down or busy: try again later, up to 8 times (about a day).
            if (seedAttempts < 8) { seedTrace(`retry later (attempt ${seedAttempts})`); setTimeout(() => seedStarterLeads().catch(() => {}), 3 * 3600 * 1000); }
            else seedTrace('gave up');
            return;
          }
        }
        await new Promise(r => setTimeout(r, 3000)); // be polite to the free OSM servers
      }
      console.log('Seeded', key, totals[key]);
    }
    seedTrace('done');
    await notifyAdmin('Mash lead lists are ready', 'Starter Leads Found',
      Object.entries(totals).map(([k, t]) => [industries.getIndustry(k).label, `${t.added} businesses (${t.withEmail} with email)`]),
      'Nothing has been called. Review them on the Leads page.');
  }
  setTimeout(() => seedStarterLeads().catch(err => console.error('Lead seed error:', err.message)), 60000);

  return { onTool, onCallEnded, tickFollowUps, settings, sendSummaryEmail, findLeads, emailFooter, _internal: { interestFrom, unsubToken, findEmailOnWebsite } };
};
