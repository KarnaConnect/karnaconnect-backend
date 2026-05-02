const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function backfill() {
  console.log('Starting backfill...');

  // Fetch all calls from VAPI
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
        call_summary: call.analysis?.summary || null
      })
      .eq('vapi_call_id', call.id);

    if (error) {
      console.log('Error updating call:', call.id, error.message);
    } else {
      console.log('Updated call:', call.id, recordingUrl ? '✓ recording' : '', transcript ? '✓ transcript' : '', summary ? '✓ summary' : '');
      updated++;
    }
  }

  console.log(`Done. Updated: ${updated}, Skipped: ${skipped}`);
}

backfill().catch(console.error);
