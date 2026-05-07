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
  tls: {
    rejectUnauthorized: false
  }
});

const phoneNumberToClient = {
  '75706cd2-0532-405d-b237-77fd2ae9df3a': null,
  '6e85e01a-8c76-4607-837d-5fdafed4bc69': 'dd674a90-90b5-4f57-9b7b-cced0cb57d89'
}

const clientNotifyEmail = {
  'karnaconnect': 'info@karnaconnect.com.au',
  'dd674a90-90b5-4f57-9b7b-cced0cb57d89': 'syed@descomconsultant.com.au'
}

const clientNames = {
  'karnaconnect': 'KarnaConnect',
  'dd674a90-90b5-4f57-9b7b-cced0cb57d89': 'Descom Consultants'
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

  const clientId = phoneNumberToClient[phoneNumberId] || null;
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
  // Update client monthly minutes usage
  if (clientId && message.durationSeconds) {
    const minutes = message.durationSeconds / 60;
    await supabase.rpc('increment_minutes', {
      client_id_input: clientId,
      minutes_to_add: minutes
    });
    console.log('Minutes updated for client:', clientId, '+', minutes.toFixed(2), 'min');
  }

  if (clientNotifyEmail[notifyKey]) {
    const notifyEmail = clientNotifyEmail[notifyKey];
    const businessName = clientNames[notifyKey] || 'KarnaConnect';
    const duration = message.durationSeconds ? `${Math.round(message.durationSeconds)}s` : 'Unknown';
    const outcome = message.endedReason || 'Unknown';
    const caller = customer.number || 'Unknown';
    const summary = analysis.summary || 'No summary available';

    const emailHtml = `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
        <div style="background: linear-gradient(135deg, #2563eb, #06b6d4); border-radius: 12px 12px 0 0; padding: 24px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 1.3rem;">New Call — Mash</h1>
          <p style="color: rgba(255,255,255,0.8); margin: 6px 0 0; font-size: 0.85rem;">${businessName} · KarnaConnect AI</p>
        </div>
        <div style="background: white; border-radius: 0 0 12px 12px; padding: 28px; border: 1px solid #e2e8f0; border-top: none;">
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; width: 40%;">Caller</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: 600;">${caller}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px;">Duration</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: 600;">${duration}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px;">Outcome</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: 600;">${outcome}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px;">Time (AWST)</td>
              <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Perth' })}</td>
            </tr>
          </table>

          <div style="background: #f8fafc; border-left: 3px solid #2563eb; border-radius: 0 8px 8px 0; padding: 16px; margin-bottom: 24px;">
            <p style="color: #2563eb; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin: 0 0 8px;">AI Call Summary</p>
            <p style="color: #475569; font-size: 0.9rem; line-height: 1.7; margin: 0;">${summary}</p>
          </div>

          <a href="https://dashboard.karnaconnect.com.au" style="display: block; text-align: center; background: linear-gradient(135deg, #2563eb, #06b6d4); color: white; padding: 13px 20px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 0.9rem;">
            View Full Dashboard
          </a>

          <p style="text-align: center; color: #94a3b8; font-size: 0.75rem; margin-top: 20px;">
            Powered by KarnaConnect · AI Command Centre · South Lake WA 6164
          </p>
        </div>
      </div>
    `;

    try {
      console.log('Attempting email to:', notifyEmail);
      console.log('SMTP config:', process.env.SMTP_HOST, process.env.SMTP_PORT, process.env.SMTP_USER);
      const result = await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: notifyEmail,
        subject: `New Call - ${caller} (${duration}) - ${businessName}`,
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
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`
      }
    });

    const vapiCalls = await response.json();
    console.log(`Found ${vapiCalls.length} calls in VAPI`);

    let updated = 0;
    let skipped = 0;

    for (const call of vapiCalls) {
      const recordingUrl = call.recordingUrl || call.artifact?.recordingUrl || null;
      const transcript = call.transcript || call.artifact?.transcript || null;
      const summary = call.analysis?.summary || null;

      if (!recordingUrl && !transcript && !summary) {
        skipped++;
        continue;
      }

      const { error } = await supabase
        .from('calls')
        .update({
          recording_url: recordingUrl,
          full_transcript: transcript,
          call_summary: summary
        })
        .eq('vapi_call_id', call.id);

      if (error) {
        console.log('Error updating call:', call.id, error.message);
      } else {
        updated++;
      }
    }

    res.json({ success: true, updated, skipped });
  } catch (err) {
    console.log('Backfill error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
app.post('/notify-onboard', async (req, res) => {
  const {
    business_name, contact_name, contact_email,
    contact_phone, plan_name, agent_name, vapi_agent_id
  } = req.body

  const emailHtml = `
    <div style="font-family:'Segoe UI',sans-serif; max-width:600px; margin:0 auto; background:#f8fafc; padding:20px;">
      <div style="background:linear-gradient(135deg,#2563eb,#06b6d4); border-radius:12px 12px 0 0; padding:24px; text-align:center;">
        <h1 style="color:white; margin:0; font-size:1.3rem;">New Client Onboarded</h1>
        <p style="color:rgba(255,255,255,0.8); margin:6px 0 0; font-size:0.85rem;">KarnaConnect AI Command Centre</p>
      </div>
      <div style="background:white; border-radius:0 0 12px 12px; padding:28px; border:1px solid #e2e8f0; border-top:none;">
        <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
          <tr><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#94a3b8; font-size:0.8rem; text-transform:uppercase; width:40%;">Business</td><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#0f172a; font-weight:600;">${business_name}</td></tr>
          <tr><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#94a3b8; font-size:0.8rem; text-transform:uppercase;">Contact</td><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#0f172a; font-weight:600;">${contact_name}</td></tr>
          <tr><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#94a3b8; font-size:0.8rem; text-transform:uppercase;">Email</td><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#0f172a; font-weight:600;">${contact_email}</td></tr>
          <tr><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#94a3b8; font-size:0.8rem; text-transform:uppercase;">Phone</td><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#0f172a; font-weight:600;">${contact_phone}</td></tr>
          <tr><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#94a3b8; font-size:0.8rem; text-transform:uppercase;">Plan</td><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#0f172a; font-weight:600;">${plan_name}</td></tr>
          <tr><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#94a3b8; font-size:0.8rem; text-transform:uppercase;">Agent Name</td><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#0f172a; font-weight:600;">${agent_name}</td></tr>
          <tr><td style="padding:10px 0; color:#94a3b8; font-size:0.8rem; text-transform:uppercase;">VAPI Agent ID</td><td style="padding:10px 0; color:#0f172a; font-weight:600; font-family:monospace; font-size:0.8rem;">${vapi_agent_id}</td></tr>
        </table>
        <div style="background:#f8fafc; border-left:3px solid #2563eb; border-radius:0 8px 8px 0; padding:16px; margin-bottom:24px;">
          <p style="color:#2563eb; font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; font-weight:700; margin:0 0 8px;">Next Steps</p>
          <p style="color:#475569; font-size:0.875rem; line-height:1.7; margin:0;">
            1. Review the draft VAPI agent in your VAPI dashboard<br/>
            2. Assign a Twilio phone number to the agent<br/>
            3. Test the agent with a call<br/>
            4. Create login credentials for the client in Supabase<br/>
            5. Send the client their welcome email
          </p>
        </div>
        <a href="https://dashboard.vapi.ai" style="display:block; text-align:center; background:linear-gradient(135deg,#2563eb,#06b6d4); color:white; padding:13px 20px; border-radius:8px; text-decoration:none; font-weight:700; font-size:0.9rem;">Review Agent in VAPI</a>
      </div>
    </div>
  `

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: 'info@karnaconnect.com.au',
      subject: `New Client — ${business_name} (${plan_name} Plan)`,
      html: emailHtml
    })
    res.json({ success: true })
  } catch (err) {
    console.log('Email error:', err.message)
    res.status(500).json({ error: err.message })
  }
})
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
