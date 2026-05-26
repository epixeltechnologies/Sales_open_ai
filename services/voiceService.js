const twilio = require('twilio');
const axios = require('axios');
const { logger } = require('../utils/logger');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * Generate TwiML response to hand off call to Vapi
 */
const generateTwiMLForVapi = (vapiWebhookUrl) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.connect().stream({ url: vapiWebhookUrl });
  return twiml.toString();
};

/**
 * Generate simple TwiML with voice response
 */
const generateTwiML = (message, gatherUrl = null) => {
  const twiml = new twilio.twiml.VoiceResponse();

  if (gatherUrl) {
    const gather = twiml.gather({
      input: 'speech',
      action: gatherUrl,
      speechTimeout: 'auto',
      language: 'en-US',
    });
    gather.say({ voice: 'Polly.Joanna', language: 'en-US' }, message);
  } else {
    twiml.say({ voice: 'Polly.Joanna', language: 'en-US' }, message);
  }

  return twiml.toString();
};

/**
 * Create a Vapi call session
 */
const createVapiSession = async (settings, callSid, fromNumber) => {
  try {
    if (!process.env.VAPI_API_KEY) {
      logger.warn('VAPI_API_KEY not set, skipping Vapi session creation');
      return null;
    }

    const questions =
      typeof settings.qualificationQuestions === 'string'
        ? JSON.parse(settings.qualificationQuestions)
        : settings.qualificationQuestions || [];

    const response = await axios.post(
      'https://api.vapi.ai/call',
      {
        type: 'inboundPhoneCall',
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        assistant: {
          name: settings.agentName,
          firstMessage: settings.welcomeMessage,
          model: {
            provider: 'openai',
            model: 'gpt-4o',
            systemPrompt: `You are ${settings.agentName}, a professional AI sales agent. 
Your goal is to qualify callers by naturally asking: ${questions.join(', ')}.
Handle objections with empathy. Keep responses brief (1-3 sentences for phone).
${settings.objectionHandling}`,
            temperature: settings.temperature,
          },
          voice: {
            provider: 'elevenlabs',
            voiceId: settings.voice || 'rachel',
          },
          endCallMessage: 'Thank you for your time. Have a wonderful day!',
          endCallPhrases: ['goodbye', 'bye', 'talk later', 'gotta go'],
          recordingEnabled: true,
          transcriptPlan: { enabled: true },
        },
        metadata: { twilioCallSid: callSid, fromNumber },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error('Vapi session creation error:', error.response?.data || error.message);
    return null;
  }
};

/**
 * Get Vapi call details (transcript, recording)
 */
const getVapiCallDetails = async (vapiCallId) => {
  try {
    if (!process.env.VAPI_API_KEY || !vapiCallId) return null;

    const response = await axios.get(`https://api.vapi.ai/call/${vapiCallId}`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    });

    return response.data;
  } catch (error) {
    logger.error('Vapi get call error:', error.message);
    return null;
  }
};

/**
 * Validate Twilio webhook signature
 */
const validateTwilioSignature = (req) => {
  if (process.env.NODE_ENV === 'development') return true;

  const twilioSignature = req.headers['x-twilio-signature'];
  const url = `${process.env.TWILIO_WEBHOOK_URL}/api/call/webhook`;
  const params = req.body;

  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, twilioSignature, url, params);
};

/**
 * Get call recording URL from Twilio
 */
const getRecordingUrl = async (callSid) => {
  try {
    const recordings = await twilioClient.recordings.list({ callSid, limit: 1 });
    if (recordings.length > 0) {
      const rec = recordings[0];
      return `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${rec.sid}.mp3`;
    }
    return null;
  } catch (error) {
    logger.error('Get recording error:', error.message);
    return null;
  }
};

module.exports = {
  generateTwiML,
  generateTwiMLForVapi,
  createVapiSession,
  getVapiCallDetails,
  validateTwilioSignature,
  getRecordingUrl,
};
