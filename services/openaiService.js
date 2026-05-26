const OpenAI = require('openai');
const { logger } = require('../utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Build the system prompt for the AI sales agent
 */
const buildSystemPrompt = (settings, lead = null) => {
  const questions = typeof settings.qualificationQuestions === 'string'
    ? JSON.parse(settings.qualificationQuestions)
    : settings.qualificationQuestions || [];

  return `You are ${settings.agentName}, an AI sales agent for a company. You are on a phone call.

PERSONALITY: Professional, friendly, empathetic, and consultative. Never pushy.

YOUR GOALS (in order):
1. Greet the caller warmly
2. Learn their name and company
3. Understand their needs
4. Qualify them by asking these questions naturally (one at a time):
${questions.map((q, i) => `   ${i + 1}. ${q}`).join('\n')}
5. If qualified: Offer to book an appointment
6. If not qualified: Thank them and offer to send follow-up information

OBJECTION HANDLING:
${settings.objectionHandling}

RULES:
- Ask only ONE question at a time
- Listen actively and acknowledge answers before moving on
- Be conversational, not robotic
- Never reveal you are an AI unless directly asked (then be honest)
- Keep responses concise (phone call - 1-3 sentences max)
- If they want to book: collect their preferred time/date
- Always end calls professionally

${lead ? `CALLER INFO (if known): ${JSON.stringify(lead)}` : ''}

OUTPUT FORMAT: Respond with ONLY what you would say out loud. No stage directions, no narration.`;
};

/**
 * Process a transcript turn with OpenAI
 */
const processCallTurn = async (settings, conversationHistory, userMessage, lead = null) => {
  try {
    const systemPrompt = buildSystemPrompt(settings, lead);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: settings.temperature || 0.7,
      max_tokens: 200,
      stream: false,
    });

    const agentResponse = response.choices[0].message.content;
    return { response: agentResponse, tokens: response.usage };
  } catch (error) {
    logger.error('OpenAI processCallTurn error:', error);
    throw error;
  }
};

/**
 * Analyze call transcript to extract lead info and qualification
 */
const analyzeTranscript = async (transcript, settings) => {
  try {
    const prompt = `Analyze this sales call transcript and extract structured information.

TRANSCRIPT:
${transcript}

Extract and return a JSON object with these fields:
{
  "callerName": "string or null",
  "callerCompany": "string or null",
  "callerEmail": "string or null",
  "callerPhone": "string or null",
  "budget": "string or null",
  "painPoints": "string or null",
  "timeline": "string or null",
  "qualified": boolean (true if they showed genuine interest and meet criteria),
  "qualificationScore": number (0-100),
  "appointmentRequested": boolean,
  "appointmentDateTime": "ISO string or null",
  "summary": "2-3 sentence summary of the call",
  "sentiment": "positive|neutral|negative",
  "nextAction": "string describing what to do next",
  "objections": ["list", "of", "objections", "raised"],
  "keyInsights": ["list", "of", "key", "insights"]
}

Return ONLY valid JSON, no other text.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    return analysis;
  } catch (error) {
    logger.error('OpenAI analyzeTranscript error:', error);
    return {
      callerName: null,
      callerCompany: null,
      callerEmail: null,
      qualified: false,
      qualificationScore: 0,
      appointmentRequested: false,
      summary: 'Call analysis failed',
      sentiment: 'neutral',
      nextAction: 'Manual review required',
      objections: [],
      keyInsights: [],
    };
  }
};

/**
 * Generate follow-up email content
 */
const generateFollowUpEmail = async (lead, callSummary, companyName) => {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: `Write a brief, personalized follow-up email for this sales lead.
          
Lead: ${lead.name} from ${lead.company || 'their company'}
Call Summary: ${callSummary}
Our Company: ${companyName}

The email should:
- Thank them for their time
- Reference something specific from the call
- Provide value (not just a sales pitch)
- Have a clear soft CTA
- Be under 150 words
- Sound human and warm

Return JSON: { "subject": "...", "body": "..." }`,
        },
      ],
      temperature: 0.7,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    logger.error('OpenAI generateFollowUpEmail error:', error);
    return {
      subject: `Following up from our conversation`,
      body: `Hi ${lead.name},\n\nThank you for speaking with us today. We'd love to continue the conversation.\n\nBest regards`,
    };
  }
};

module.exports = { processCallTurn, analyzeTranscript, generateFollowUpEmail, buildSystemPrompt };
