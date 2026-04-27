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
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));

  const body = req.body;
  const callData = body.call || body;
  const customer = body.customer || callData.customer;

  if (!callData) {
    console.log('No call data found');
    return res.status(400).json({ error: 'No call data' });
  }

  console.log('Saving call to Supabase...');

  const { data, error } = await supabase.from('calls').insert([{
    vapi_call_id: callData.id,
    caller_number: customer?.number,
    call_duration: body.durationSeconds || callData.duration,
    call_outcome: body.endedReason || callData.endedReason,
    call_summary: body.summary || callData.summary,
    started_at: callData.createdAt,
    ended_at: body.endedAt
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
