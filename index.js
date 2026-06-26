const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const admin = require('firebase-admin');
const cron = require('node-cron');

const app = express();

// CORS — allow dashboard and local dev
app.use((req, res, next) => {
  const allowed = ['https://dashboard.mashai.com.au', 'https://mashboard.karnaconnect.com.au', 'http://localhost:3000', 'http://localhost:3001'];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

// Initialize Firebase Admin
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      })
    });
    console.log('Firebase Admin initialized successfully');
  }
} catch (err) {
  console.log('Firebase Admin initialization error:', err.message);
}

async function getClientIdFromPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null

  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .eq('vapi_phone_number_id', phoneNumberId)
    .single()

  if (error || !data) {
    console.log('No client found for phone number ID:', phoneNumberId)
    return null
  }

  return data.id
}

async function getClientDetails(clientId) {
  if (!clientId) return { email: 'info@karnaconnect.com.au', name: 'KarnaConnect' }

  const { data, error } = await supabase
    .from('clients')
    .select('business_name, contact_email')
    .eq('id', clientId)
    .single()

  if (error || !data) return { email: 'info@karnaconnect.com.au', name: 'KarnaConnect' }

  return { email: data.contact_email, name: data.business_name }
}

async function sendPushNotification(clientId, title, body, url) {
  try {
    const { data: tokens, error } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('client_id', clientId)

    if (error || !tokens || tokens.length === 0) {
      console.log('No device tokens found for client:', clientId)
      return
    }

    for (const { token } of tokens) {
      try {
        await admin.messaging().send({
          notification: { title, body },
          data: { url: url || 'https://dashboard.mashai.com.au' },
          token
        })
        console.log('Push notification sent successfully')
      } catch (err) {
        console.log('Error sending push notification:', err.message)
        if (err.code === 'messaging/registration-token-not-registered') {
          await supabase.from('device_tokens').delete().eq('token', token)
          console.log('Removed invalid token')
        }
      }
    }
  } catch (err) {
    console.log('Push notification error:', err.message)
  }
}

app.get('/', (req, res) => {
  res.send('KarnaConnect API is running');
});

app.post('/webhook/vapi', async (req, res) => {
  console.log('Webhook received');

  const body = req.body;
  const message = body.message || body;
  const call = message.call || {};
  const analysis = message.analysis || {};
  const customer = message.customer || call.customer || {};
  const phoneNumberId = call.phoneNumberId;

  console.log('Phone Number ID received:', phoneNumberId);
  console.log('Full call object:', JSON.stringify(call));
  const clientId = await getClientIdFromPhoneNumberId(phoneNumberId)
  console.log('Client ID:', clientId);
  console.log('Caller:', customer.number);

  const fullTranscript = message.artifact?.transcript || null;
  const recordingUrl = message.artifact?.recordingUrl || null;

  const { data, error } = await supabase.from('calls').insert([{
    vapi_call_id: call.id,
    caller_number: customer.number,
    call_duration: message.durationSeconds,
    call_outcome: message.endedReason,
    call_summary: analysis.summary,
    started_at: call.createdAt,
    ended_at: message.endedAt,
    client_id: clientId,
    full_transcript: fullTranscript,
    recording_url: recordingUrl
  }]);

  if (error) {
    console.log('Supabase error:', error);
    return res.status(500).json({ error });
  }

  console.log('Call saved successfully');

  if (clientId && message.durationSeconds) {
    const minutes = message.durationSeconds / 60;
    await supabase.rpc('increment_minutes', {
      client_id_input: clientId,
      minutes_to_add: minutes
    });
    console.log('Minutes updated for client:', clientId, '+', minutes.toFixed(2), 'min');
  }

  // Send push notification
  if (clientId) {
    const caller = customer.number || 'Unknown'
    const summary = analysis.summary
      ? analysis.summary.substring(0, 100) + '...'
      : 'New call handled by Mash'
    await sendPushNotification(
      clientId,
      '📞 New call from ' + caller,
      summary,
      'https://dashboard.mashai.com.au'
    )
  }

  const clientDetails = await getClientDetails(clientId)
  const notifyEmail = clientDetails.email
  const businessName = clientDetails.name

  if (notifyEmail) {
    const duration = message.durationSeconds ? `${Math.round(message.durationSeconds)}s` : 'Unknown';
    const outcome = message.endedReason || 'Unknown';
    const caller = customer.number || 'Unknown';
    const summary = analysis.summary || 'No summary available';

    const emailHtml = '<div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;"><div style="background:linear-gradient(135deg,#534AB7,#7F77DD);border-radius:12px 12px 0 0;padding:24px;text-align:center;"><h1 style="color:white;margin:0;font-size:1.3rem;">New Call — Mash</h1><p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:0.85rem;">' + businessName + '</p></div><div style="background:white;border-radius:0 0 12px 12px;padding:28px;border:1px solid #e2e8f0;border-top:none;"><p><strong>Caller:</strong> ' + caller + '</p><p><strong>Duration:</strong> ' + duration + '</p><p><strong>Outcome:</strong> ' + outcome + '</p><p><strong>Summary:</strong> ' + summary + '</p><a href="https://dashboard.mashai.com.au" style="display:block;text-align:center;background:linear-gradient(135deg,#534AB7,#7F77DD);color:white;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:20px;">View Dashboard</a></div></div>';

    try {
      await resend.emails.send({
        from: 'Mash <noreply@mashai.com.au>',
        to: notifyEmail,
        subject: 'New Call - ' + caller + ' (' + duration + ') - ' + businessName,
        html: emailHtml
      });
      console.log('Email sent successfully');
    } catch (emailError) {
      console.log('Email error:', emailError.message);
    }
  }

  res.json({ success: true, data });
});

app.get('/backfill', async (req, res) => {
  console.log('Starting backfill...');
  try {
    const response = await fetch('https://api.vapi.ai/call?limit=100', {
      headers: { 'Authorization': 'Bearer ' + process.env.VAPI_API_KEY }
    });
    const vapiCalls = await response.json();
    console.log('Found ' + vapiCalls.length + ' calls in VAPI');
    let updated = 0;
    let skipped = 0;
    for (const call of vapiCalls) {
      const recordingUrl = call.recordingUrl || call.artifact?.recordingUrl || null;
      const transcript = call.transcript || call.artifact?.transcript || null;
      const summary = call.analysis?.summary || null;
      if (!recordingUrl && !transcript && !summary) { skipped++; continue; }
      const { error } = await supabase.from('calls').update({
        recording_url: recordingUrl,
        full_transcript: transcript,
        call_summary: summary
      }).eq('vapi_call_id', call.id);
      if (error) { console.log('Error updating call:', call.id, error.message); }
      else { updated++; }
    }
    res.json({ success: true, updated, skipped });
  } catch (err) {
    console.log('Backfill error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/notify-onboard', async (req, res) => {
  const { business_name, contact_name, contact_email, contact_phone, plan_name, agent_name, vapi_agent_id } = req.body;
  const emailHtml = '<div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>New Client Onboarded</h2><p><strong>Business:</strong> ' + business_name + '</p><p><strong>Contact:</strong> ' + contact_name + '</p><p><strong>Email:</strong> ' + contact_email + '</p><p><strong>Phone:</strong> ' + contact_phone + '</p><p><strong>Plan:</strong> ' + plan_name + '</p><p><strong>Agent:</strong> ' + agent_name + '</p><p><strong>VAPI ID:</strong> ' + vapi_agent_id + '</p><a href="https://dashboard.vapi.ai">Review Agent in VAPI</a></div>';
  try {
    await resend.emails.send({
      from: 'Mash <noreply@mashai.com.au>',
      to: 'info@karnaconnect.com.au',
      subject: 'New Client - ' + business_name + ' (' + plan_name + ' Plan)',
      html: emailHtml
    });
    res.json({ success: true });
  } catch (err) {
    console.log('Email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/create-agent', async (req, res) => {
  const {
    client_id, business_name, industry, contact_name, contact_email,
    contact_phone, agent_name, business_description, services,
    service_area, business_hours, after_hours, agent_goal,
    tone, always_say, never_say, faqs, plan_name, vapi_phone_number_id
  } = req.body;

  console.log('Creating VAPI agent for:', business_name);

  const systemPrompt = 'CRITICAL RULE: You must ask only ONE question at a time. Never combine multiple questions in a single response.\n\n'
    + 'You are ' + agent_name + ', a friendly and professional AI assistant for ' + business_name
    + (industry ? ' — a ' + industry + ' business' : '') + '.'
    + (business_description ? ' ' + business_description : '') + '\n\n'
    + (services ? 'Services offered:\n' + services + '\n\n' : '')
    + (service_area ? 'Service area: ' + service_area + '\n\n' : '')
    + (business_hours ? 'Business hours: ' + business_hours + '\n\n' : '')
    + 'Your main goal is to: ' + (agent_goal || 'answer enquiries and capture caller details for the team to follow up') + '\n\n'
    + 'When someone calls:\n'
    + '- Warmly greet the caller and introduce yourself as ' + agent_name + ' from ' + business_name + '\n'
    + '- Understand what they need and help them accordingly\n'
    + '- Collect their details one at a time: full name, best contact number, email, and the nature of their enquiry\n'
    + '- Let them know the team will be in touch as soon as possible\n\n'
    + (after_hours ? 'After hours: ' + after_hours : 'If after hours, let callers know the team will contact them next business day.') + '\n'
    + (tone ? 'Tone: ' + tone : 'Be warm, professional and conversational.') + '\n'
    + (always_say ? 'Always mention: ' + always_say + '\n' : '')
    + (never_say ? 'Never say: ' + never_say + '\n' : '')
    + (faqs ? 'FAQs:\n' + faqs + '\n' : '')
    + '\nAlways use Australian English.';

  const agentName = (business_name + ' ' + agent_name).substring(0, 38);

  try {
    const vapiResponse = await fetch('https://api.vapi.ai/assistant', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.VAPI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: agentName,
        model: {
          provider: 'openai',
          model: 'gpt-4.1',
          messages: [{ role: 'system', content: systemPrompt }]
        },
        voice: {
          provider: '11labs',
          voiceId: 'ZkDZ5VCyH0GGbxO7o4aO',
          model: 'eleven_turbo_v2_5',
          stability: 0.5,
          similarityBoost: 0.75,
          speed: 1.1
        },
        firstMessage: 'Thanks for calling ' + business_name + '. I am ' + agent_name + ', your AI assistant. How can I help you today?',
        transcriber: {
          provider: 'deepgram',
          model: 'flux-general-en',
          language: 'en'
        },
        serverMessages: ['end-of-call-report'],
        clientMessages: ['transcript'],
        server: {
          url: 'https://expressjs-production-48b3.up.railway.app/webhook/vapi'
        }
      })
    });

    const vapiAgent = await vapiResponse.json();
    console.log('VAPI full response:', JSON.stringify(vapiAgent));
    console.log('VAPI agent ID:', vapiAgent.id);

    if (vapiAgent.id) {
      const updateData = { vapi_agent_id: vapiAgent.id }
      if (vapi_phone_number_id) updateData.vapi_phone_number_id = vapi_phone_number_id
      await supabase.from('clients').update(updateData).eq('id', client_id);
      console.log('Client updated with VAPI agent ID');
    }

    const emailHtml = '<div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>New Client Onboarded</h2><p><strong>Business:</strong> ' + business_name + '</p><p><strong>Contact:</strong> ' + contact_name + '</p><p><strong>Email:</strong> ' + contact_email + '</p><p><strong>Phone:</strong> ' + contact_phone + '</p><p><strong>Plan:</strong> ' + plan_name + '</p><p><strong>Agent:</strong> ' + agent_name + '</p><p><strong>VAPI ID:</strong> ' + (vapiAgent.id || 'Failed') + '</p><br><p>Next steps: Review agent in VAPI, assign Twilio number, update vapi_phone_number_id in Supabase, test call, create client login.</p><a href="https://dashboard.vapi.ai">Review Agent in VAPI</a></div>';

    try {
      await resend.emails.send({
        from: 'Mash <noreply@mashai.com.au>',
        to: 'info@karnaconnect.com.au',
        subject: 'New Client - ' + business_name + ' (' + plan_name + ' Plan)',
        html: emailHtml
      });
      console.log('Notification email sent');
    } catch (emailErr) {
      console.log('Email error (non-fatal):', emailErr.message);
    }

    res.json({ success: true, vapi_agent_id: vapiAgent.id });

  } catch (err) {
    console.error('Create agent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log('Stripe webhook error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  console.log('Stripe event:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const clientId = session.metadata?.client_id;
    const businessName = session.metadata?.business_name;
    console.log('Payment completed for:', businessName, clientId);

    if (clientId) {
      // Activate client
      await supabase.from('clients').update({
        active: true,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription
      }).eq('id', clientId);
      console.log('Client activated:', clientId);

      // Get client details
      const { data: clientData } = await supabase
        .from('clients')
        .select('contact_email, contact_name, business_name')
        .eq('id', clientId)
        .single();

      if (clientData?.contact_email) {
        // Generate temporary password
        const tempPassword = 'Mash' + Math.random().toString(36).slice(-6).toUpperCase() + '!';

        // Create Supabase auth user
        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
          email: clientData.contact_email,
          password: tempPassword,
          email_confirm: true
        });

        if (authError) {
          console.log('Auth user creation error:', authError.message);
        } else if (authUser?.user) {
          // Link user to client
          const { error: linkError } = await supabase.from('user_clients').insert({
            user_id: authUser.user.id,
            client_id: clientId,
            role: 'client'
          });

          if (linkError) {
            console.log('User client link error:', linkError.message);
          } else {
            console.log('User created and linked to client:', clientId);
          }

          // Send welcome email
          const welcomeHtml = `
            <div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;">
              <div style="background:linear-gradient(135deg,#1a1535,#211a42);border-radius:12px 12px 0 0;padding:32px;text-align:center;">
                <svg width="48" height="48" viewBox="0 0 48 48" style="margin-bottom:16px;">
                  <circle cx="24" cy="24" r="24" fill="#EEEDFE"/>
                  <rect x="10" y="18" width="4" height="12" rx="2" fill="#534AB7"/>
                  <rect x="16" y="13" width="4" height="22" rx="2" fill="#534AB7"/>
                  <rect x="22" y="8" width="4" height="32" rx="2" fill="#7F77DD"/>
                  <rect x="28" y="13" width="4" height="22" rx="2" fill="#534AB7"/>
                  <rect x="34" y="18" width="4" height="12" rx="2" fill="#534AB7"/>
                </svg>
                <h1 style="color:#fff;margin:0;font-size:1.4rem;font-weight:800;">Welcome to Mash!</h1>
                <p style="color:#AFA9EC;margin:8px 0 0;font-size:0.9rem;">Your AI receptionist is ready</p>
              </div>
              <div style="background:#fff;border-radius:0 0 12px 12px;padding:32px;border:1px solid #e2e8f0;border-top:none;">
                <p style="color:#1a1535;font-size:1rem;font-weight:600;margin-bottom:8px;">Hi ${clientData.contact_name},</p>
                <p style="color:#475569;font-size:0.9rem;line-height:1.7;margin-bottom:24px;">
                  Welcome to Mash! Your AI receptionist for <strong>${clientData.business_name}</strong> is being set up and will be live within 24 hours.
                </p>
                <div style="background:#f5f3ff;border-radius:10px;padding:20px;margin-bottom:24px;border:1px solid #CECBF6;">
                  <p style="font-size:0.8rem;font-weight:700;color:#534AB7;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Your Login Details</p>
                  <p style="margin:0 0 8px;font-size:0.9rem;color:#1a1535;"><strong>Dashboard:</strong> <a href="https://dashboard.mashai.com.au" style="color:#534AB7;">dashboard.mashai.com.au</a></p>
                  <p style="margin:0 0 8px;font-size:0.9rem;color:#1a1535;"><strong>Email:</strong> ${clientData.contact_email}</p>
                  <p style="margin:0;font-size:0.9rem;color:#1a1535;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                </div>
                <p style="color:#94a3b8;font-size:0.82rem;margin-bottom:24px;">Please log in and change your password as soon as possible.</p>
                <a href="https://dashboard.mashai.com.au/login" style="display:block;text-align:center;background:linear-gradient(135deg,#534AB7,#7F77DD);color:#fff;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;">Log In to Your Dashboard →</a>
                <div style="margin-top:24px;padding-top:24px;border-top:1px solid #f1f5f9;">
                  <p style="color:#94a3b8;font-size:0.8rem;line-height:1.6;">
                    Questions? Reply to this email or contact us at <a href="mailto:info@karnaconnect.com.au" style="color:#534AB7;">info@karnaconnect.com.au</a><br/>
                    Mash · A KarnaConnect product · ABN 84 924 272 443
                  </p>
                </div>
              </div>
            </div>
          `;

          try {
            await resend.emails.send({
            from: 'Mash <noreply@mashai.com.au>',
            to: clientData.contact_email,
            subject: 'Welcome to Mash — Your login details',
            html: welcomeHtml
          });
          console.log('Welcome email sent to:', clientData.contact_email);
          } catch (emailErr) {
            console.log('Welcome email error:', emailErr.message);
          }
        }
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    await supabase.from('clients').update({ active: false }).eq('stripe_subscription_id', subscription.id);
    console.log('Client deactivated - subscription cancelled');
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    await supabase.from('clients').update({ active: false }).eq('stripe_subscription_id', invoice.subscription);
    console.log('Client deactivated - payment failed');
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    await supabase.from('clients').update({ active: true }).eq('stripe_subscription_id', invoice.subscription);
    console.log('Client reactivated - payment succeeded');
  }

  res.json({ received: true });
});

app.post('/send-digests', async (req, res) => {
  const { type } = req.body; // 'daily' or 'weekly'
  if (!type || !['daily', 'weekly'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

  const now = new Date();
  const since = new Date(now);
  if (type === 'daily') since.setDate(since.getDate() - 1);
  else since.setDate(since.getDate() - 7);

  const { data: clients } = await supabase
    .from('clients')
    .select('id, business_name, contact_name, contact_email, digest_frequency')
    .eq('active', true)
    .eq('digest_frequency', type);

  if (!clients || clients.length === 0) return res.json({ sent: 0 });

  let sent = 0;
  for (const client of clients) {
    const { data: calls } = await supabase
      .from('calls')
      .select('*')
      .eq('client_id', client.id)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false });

    if (!calls) continue;

    const total = calls.length;
    const completed = calls.filter(c => c.call_outcome && c.call_outcome.includes('ended')).length;
    const missed = calls.filter(c => c.call_outcome === 'no-answer').length;
    const voicemails = calls.filter(c => c.call_outcome === 'voicemail').length;
    const totalSecs = calls.filter(c => c.call_duration).reduce((s, c) => s + parseFloat(c.call_duration), 0);
    const hoursHandled = (totalSecs / 3600).toFixed(1);
    const periodLabel = type === 'daily' ? 'Yesterday' : 'This Week';
    const topCalls = calls.filter(c => c.call_summary).slice(0, 5);

    const summaryRows = topCalls.map(c => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:0.82rem;color:#475569;">${new Date(c.created_at).toLocaleString('en-AU', { timeZone: 'Australia/Perth', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:0.82rem;color:#475569;">${c.caller_number || 'Unknown'}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;font-size:0.82rem;color:#475569;">${c.call_summary || ''}</td>
      </tr>`).join('');

    const html = `
      <div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;">
        <div style="background:linear-gradient(135deg,#1a1535,#211a42);border-radius:12px 12px 0 0;padding:32px;text-align:center;">
          <svg width="48" height="48" viewBox="0 0 48 48" style="margin-bottom:16px;">
            <circle cx="24" cy="24" r="24" fill="#EEEDFE"/>
            <rect x="10" y="18" width="4" height="12" rx="2" fill="#534AB7"/>
            <rect x="16" y="13" width="4" height="22" rx="2" fill="#534AB7"/>
            <rect x="22" y="8" width="4" height="32" rx="2" fill="#7F77DD"/>
            <rect x="28" y="13" width="4" height="22" rx="2" fill="#534AB7"/>
            <rect x="34" y="18" width="4" height="12" rx="2" fill="#534AB7"/>
          </svg>
          <h1 style="color:#fff;margin:0;font-size:1.3rem;font-weight:800;">${periodLabel}'s Summary</h1>
          <p style="color:#AFA9EC;margin:8px 0 0;font-size:0.85rem;">${client.business_name} · Mash AI Receptionist</p>
        </div>
        <div style="background:#fff;border-radius:0 0 12px 12px;padding:32px;border:1px solid #e2e8f0;border-top:none;">
          <p style="color:#1a1535;font-size:0.9rem;font-weight:600;margin-bottom:20px;">Hi ${client.contact_name},</p>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px;">
            ${[['📞','Total Calls',total],['✅','Completed',completed],['❌','Missed',missed],['📬','Voicemails',voicemails]].map(([icon,label,val]) => `
            <div style="background:#f5f3ff;border-radius:10px;padding:14px;text-align:center;">
              <div style="font-size:1.2rem;margin-bottom:4px;">${icon}</div>
              <div style="font-size:1.3rem;font-weight:800;color:#1a1535;">${val}</div>
              <div style="font-size:0.7rem;color:#94a3b8;font-weight:600;">${label}</div>
            </div>`).join('')}
          </div>
          <p style="font-size:0.82rem;color:#94a3b8;margin-bottom:20px;">⏱ Mash handled <strong>${hoursHandled} hours</strong> of calls on your behalf.</p>
          ${topCalls.length > 0 ? `
          <div style="margin-bottom:24px;">
            <p style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#534AB7;margin-bottom:12px;">Recent Calls</p>
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <th style="text-align:left;font-size:0.7rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;">Time</th>
                <th style="text-align:left;font-size:0.7rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;">Caller</th>
                <th style="text-align:left;font-size:0.7rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;">Summary</th>
              </tr>
              ${summaryRows}
            </table>
          </div>` : ''}
          <a href="https://dashboard.mashai.com.au" style="display:block;text-align:center;background:linear-gradient(135deg,#534AB7,#7F77DD);color:#fff;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;">View Full Dashboard →</a>
          <div style="margin-top:24px;padding-top:24px;border-top:1px solid #f1f5f9;">
            <p style="color:#94a3b8;font-size:0.75rem;">Mash · A KarnaConnect product · ABN 84 924 272 443<br/>
            <a href="https://dashboard.mashai.com.au" style="color:#534AB7;">dashboard.mashai.com.au</a></p>
          </div>
        </div>
      </div>`;

    try {
      await resend.emails.send({
        from: 'Mash <noreply@mashai.com.au>',
        to: client.contact_email,
        subject: `${periodLabel}'s Mash Summary — ${client.business_name}`,
        html
      });
      sent++;
    } catch (err) {
      console.log('Digest email error for', client.business_name, err.message);
    }
  }

  res.json({ sent });
});

// Daily digest — 8am AWST (UTC+8) = midnight UTC
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily digest...');
  try {
    const res = await fetch(`http://localhost:${process.env.PORT || 3000}/send-digests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'daily' })
    });
    const data = await res.json();
    console.log('Daily digest sent:', data.sent, 'emails');
  } catch (err) { console.log('Daily digest error:', err.message); }
});

// Weekly digest — Monday 8am AWST = Monday midnight UTC
cron.schedule('0 0 * * 1', async () => {
  console.log('Running weekly digest...');
  try {
    const res = await fetch(`http://localhost:${process.env.PORT || 3000}/send-digests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'weekly' })
    });
    const data = await res.json();
    console.log('Weekly digest sent:', data.sent, 'emails');
  } catch (err) { console.log('Weekly digest error:', err.message); }
});

// ── Outbound agents list ──────────────────────────────────────────────────────
app.get('/outbound-agents/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { data, error } = await supabase
      .from('outbound_agents')
      .select('id, label, vapi_agent_id, vapi_phone_number_id')
      .eq('client_id', clientId)
      .order('created_at');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Outbound call ─────────────────────────────────────────────────────────────
app.post('/call/outbound', async (req, res) => {
  try {
    const { agentId, phoneNumberId, customerNumber, customerName } = req.body;
    if (!agentId || !phoneNumberId || !customerNumber) {
      return res.status(400).json({ error: 'agentId, phoneNumberId and customerNumber are required' });
    }
    const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assistantId: agentId,
        phoneNumberId,
        customer: { number: customerNumber, name: customerName || undefined }
      })
    });
    const result = await vapiRes.json();
    if (!vapiRes.ok) return res.status(vapiRes.status).json({ error: result });
    res.json({ success: true, callId: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
