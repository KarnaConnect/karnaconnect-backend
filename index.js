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

  // VAPI sends data in these exact locations
  const callId = body?.call?.id;
  const callerNumber = body?.customer?.number || body?.call?.customer?.number;
  const duration = body?.durationSeconds;
  const outcome = body?.endedReason;
  const summary = body?.summary;
  const startedAt = body?.call?.createdAt;
  const endedAt = body?.call?.updatedAt;

  console.log('Extracted fields:', { callId, callerNumber, duration, outcome, summary });

  const { data, error } = await supabase.from('calls').insert([{
    vapi_call_id: callId,
    caller_number: callerNumber,
    call_duration: duration,
    call_outcome: outcome,
    call_summary: summary,
    started_at: startedAt,
    ended_at: endedAt
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
