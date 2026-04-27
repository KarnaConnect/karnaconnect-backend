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
  const body = req.body;
  
  // Log every top level key and its value
  console.log('=== TOP LEVEL KEYS ===');
  Object.keys(body).forEach(key => {
    console.log(`KEY: ${key} = ${JSON.stringify(body[key]).substring(0, 100)}`);
  });

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
