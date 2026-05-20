const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: { rejectUnauthorized: false }
});

async function getClientIdFromPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null
  
  // Check if it's the KarnaConnect number
  if (phoneNumberId === '75706cd2-0532-405d-b237-77fd2ae9df3a') return null
  
  // Look up client by vapi_phone_number_id in Supabase
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

  const clientId = await getClientIdFromPhoneNumberId(phoneNumberId)
  const notifyKey = clientId || 'karnaconnect';
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

  const clientDetails = await getClientDetails(clientId)
  const notifyEmail = clientDetails.email
  const businessName = clientDetails.name
  if (notifyEmail) {
    const duration = message.durationSeconds ? `${Math.round(message.durationSeconds)}s` : 'Unknown';
    const outcome = message.endedReason || 'Unknown';
    const caller = customer.number || 'Unknown';
    const summary = analysis.summary || 'No summary available';

    const emailHtml = '<div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;"><div style="background:linear-gradient(135deg,#2563eb,#06b6d4);border-radius:12px 12px 0 0;padding:24px;text-align:center;"><h1 style="color:white;margin:0;font-size:1.3rem;">New Call - Mash</h1><p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:0.85rem;">' + businessName + ' - KarnaConnect AI</p></div><div style="background:white;border-radius:0 0 12px 12px;padding:28px;border:1px solid #e2e8f0;border-top:none;"><p><strong>Caller:</strong> ' + caller + '</p><p><strong>Duration:</strong> ' + duration + '</p><p><strong>Outcome:</strong> ' + outcome + '</p><p><strong>Summary:</strong> ' + summary + '</p><a href="https://dashboard.karnaconnect.com.au" style="display:block;text-align:center;background:linear-gradient(135deg,#2563eb,#06b6d4);color:white;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:20px;">View Dashboard</a></div></div>';

    try {
      const result = await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: notifyEmail,
        subject: 'New Call - ' + caller + ' (' + duration + ') - ' + businessName,
        html: emailHtml
      });
      console.log('Email sent successfully:', result.messageId);
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
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
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
    tone, always_say, never_say, faqs, plan_name
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
        clientMessages: ['transcript']
      })
    });

    const vapiAgent = await vapiResponse.json();
    console.log('VAPI full response:', JSON.stringify(vapiAgent));
    console.log('VAPI agent ID:', vapiAgent.id);

    if (vapiAgent.id) {
      await supabase.from('clients').update({
        vapi_agent_id: vapiAgent.id
      }).eq('id', client_id);
      console.log('Client updated with VAPI agent ID');
    }

    const emailHtml = '<div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>New Client Onboarded</h2><p><strong>Business:</strong> ' + business_name + '</p><p><strong>Contact:</strong> ' + contact_name + '</p><p><strong>Email:</strong> ' + contact_email + '</p><p><strong>Phone:</strong> ' + contact_phone + '</p><p><strong>Plan:</strong> ' + plan_name + '</p><p><strong>Agent:</strong> ' + agent_name + '</p><p><strong>VAPI ID:</strong> ' + (vapiAgent.id || 'Failed to create') + '</p><br><p>Next steps: Review agent in VAPI, assign Twilio number, test call, create client login.</p><a href="https://dashboard.vapi.ai">Review Agent in VAPI</a></div>';

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
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
    const planName = session.metadata?.plan_name;
    const customerEmail = session.customer_email;

    console.log('Payment completed for:', businessName, clientId);

    if (clientId) {
      // Activate client in Supabase
      const { error } = await supabase.from('clients').update({
        active: true,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription
      }).eq('id', clientId);

      if (error) {
        console.log('Error activating client:', error.message);
      } else {
        console.log('Client activated:', clientId);
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    console.log('Subscription cancelled:', subscription.id);

    const { error } = await supabase.from('clients')
      .update({ active: false })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.log('Error deactivating client:', error.message);
    } else {
      console.log('Client deactivated');
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    console.log('Payment failed for subscription:', invoice.subscription);

    const { error } = await supabase.from('clients')
      .update({ active: false })
      .eq('stripe_subscription_id', invoice.subscription);

    if (error) {
      console.log('Error deactivating client on payment failure:', error.message);
    } else {
      console.log('Client deactivated due to payment failure');
    }
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    console.log('Payment succeeded for subscription:', invoice.subscription);

    const { error } = await supabase.from('clients')
      .update({ active: true })
      .eq('stripe_subscription_id', invoice.subscription);

    if (error) {
      console.log('Error reactivating client:', error.message);
    } else {
      console.log('Client reactivated after successful payment');
    }
  }

  res.json({ received: true });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
