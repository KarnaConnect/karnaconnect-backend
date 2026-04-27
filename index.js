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
  const call = body.call || body;

  if (!call) {
    console.log('No call data found');
    return res.status(400).json({ error: 'No call data' });
  }

  console.log('Call data:', JSON.stringify(call, null, 2));

  const { data, error } = await supabase.from('calls').insert([{
    vapi_call_id: call.id,
    caller_number: call.customer?.number,
    call_duration: call.duration,
    call_outcome: call.endedReason,
    call_summary: call.summary,
    started_at: call.startedAt,
    ended_at: call.endedAt
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
