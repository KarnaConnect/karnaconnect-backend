// One-off: patch Mash inbound agent with analysisPlan so VAPI generates summaries
// Run with: node patch-mash-analysis.js
require('dotenv').config();

const MASH_AGENT_ID = 'e501e589-0645-40ca-a70f-162bc71412df';

const analysisPlan = {
  summaryPrompt: 'Summarise this call in 2-3 sentences. Include: who called, what they needed, and what was resolved or left for follow-up. Write in third person, past tense.',
  structuredDataPlan: {
    schema: {
      type: 'object',
      properties: {
        caller_name: { type: 'string', description: 'Full name of the caller if provided' },
        intent: { type: 'string', description: 'Primary reason for the call, e.g. price enquiry, book appointment, complaint, general enquiry' },
        outcome: { type: 'string', enum: ['Lead Captured', 'Appointment Booked', 'Enquiry Handled', 'Callback Requested', 'Not Interested', 'Wrong Number', 'Other'] },
        follow_up_required: { type: 'boolean', description: 'Whether the business needs to follow up with this caller' }
      }
    }
  },
  successEvaluationPlan: {
    rubric: 'DescriptiveScale',
    prompt: "Was this call handled successfully? Did the agent capture the caller's needs and provide a helpful response?"
  }
};

async function patch() {
  const res = await fetch(`https://api.vapi.ai/assistant/${MASH_AGENT_ID}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ analysisPlan })
  });

  const data = await res.json();
  if (data.id) {
    console.log('✓ Mash agent patched successfully. analysisPlan active.');
  } else {
    console.error('✗ Patch failed:', JSON.stringify(data, null, 2));
  }
}

patch().catch(console.error);
