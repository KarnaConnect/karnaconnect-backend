const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Map VAPI phone number IDs to client IDs in your database
// Add each client's VAPI phone number ID and their Supabase client ID here
const phoneNumberToClient = {
  'YOUR_KARNACONNECT_VAPI_PHONE_ID': null, // KarnaConnect — no client_id needed
  'YOUR_DESCOM_VAPI_PHONE_ID': 'dd674a90-90b5-4f57-9b7b-cced0cb57d89'
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

  console.log('Phone Number ID:', phoneNumberId);
  console.log('Caller:', customer.number);

  // Look up which client this call belongs to
  const clientId = phoneNumberToClient[phoneNumberId] || null;
  console.log('Client ID:', clientId);

  const { data, error } = await supabase.from('calls').insert([{
    vapi_call_id: call.id,
    caller_number: customer.number,
    call_duration: message.durationSeconds,
    call_outcome: message.endedReason,
    call_summary: analysis.summary,
    started_at: call.createdAt,
    ended_at: message.endedAt,
    client_id: clientId
  }]);

  if (error) {
    console.log('Supabase error:', error);
    return res.status(500).json({ error });
  }

  console.log('Call saved successfully');
  res.json({ success: true, data });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
