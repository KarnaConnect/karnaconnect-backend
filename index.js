const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

  console.log('Message type:', message.type);
  console.log('Caller:', customer.number);
  console.log('Summary:', analysis.summary);
  console.log('Outcome:', message.endedReason);
  console.log('Duration:', message.durationSeconds);

  const { data, error } = await supabase.from('calls').insert([{
    vapi_call_id: call.id,
    caller_number: customer.number,
    call_duration: message.durationSeconds,
    call_outcome: message.endedReason,
    call_summary: analysis.summary,
    started_at: call.createdAt,
    ended_at: message.endedAt
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
