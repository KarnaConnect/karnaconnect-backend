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
  const { call } = req.body;
  if (!call) return res.status(400).json({ error: 'No call data' });

  const { data, error } = await supabase.from('calls').insert([{
    vapi_call_id: call.id,
    caller_number: call.customer?.number,
    call_duration: call.duration,
    call_outcome: call.endedReason,
    call_summary: call.summary,
    started_at: call.startedAt,
    ended_at: call.endedAt
  }]);

  if (error) return res.status(500).json({ error });
  res.json({ success: true, data });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
