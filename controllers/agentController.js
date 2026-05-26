const prisma  = require('../config/prisma');
const { cacheDelPattern } = require('../config/memoryStore');
const { sendSuccess, sendError } = require('../utils/responseHelpers');

const getSettings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    let settings = await prisma.agentSettings.findUnique({ where: { userId } });

    if (!settings) {
      settings = await prisma.agentSettings.create({
        data: {
          userId,
          agentName:             'Alex',
          welcomeMessage:        'Hello! Thank you for calling. How can I assist you today?',
          qualificationQuestions: JSON.stringify([
            'What company are you with?',
            "What's your current budget?",
            'What are your main pain points?',
            "What's your timeline?",
          ]),
          objectionHandling: 'I understand your concern. Let me address that…',
          voice:       'rachel',
          temperature: 0.7,
        },
      });
    }

    return sendSuccess(res, {
      ...settings,
      qualificationQuestions: typeof settings.qualificationQuestions === 'string'
        ? JSON.parse(settings.qualificationQuestions)
        : settings.qualificationQuestions,
    }, 'Agent settings retrieved');
  } catch (error) {
    next(error);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      agentName, welcomeMessage, qualificationQuestions, objectionHandling,
      voice, temperature, language, maxCallDuration, followUpEmail,
    } = req.body;

    const settings = await prisma.agentSettings.upsert({
      where:  { userId },
      update: {
        ...(agentName             !== undefined && { agentName }),
        ...(welcomeMessage        !== undefined && { welcomeMessage }),
        ...(qualificationQuestions !== undefined && { qualificationQuestions: JSON.stringify(qualificationQuestions) }),
        ...(objectionHandling     !== undefined && { objectionHandling }),
        ...(voice                 !== undefined && { voice }),
        ...(temperature           !== undefined && { temperature: parseFloat(temperature) }),
        ...(language              !== undefined && { language }),
        ...(maxCallDuration       !== undefined && { maxCallDuration: parseInt(maxCallDuration) }),
        ...(followUpEmail         !== undefined && { followUpEmail }),
      },
      create: {
        userId,
        agentName:              agentName    || 'Alex',
        welcomeMessage:         welcomeMessage || 'Hello! Thank you for calling.',
        qualificationQuestions: JSON.stringify(qualificationQuestions || []),
        objectionHandling:      objectionHandling || '',
        voice:                  voice        || 'rachel',
        temperature:            temperature  ? parseFloat(temperature) : 0.7,
        language:               language     || 'en-US',
        maxCallDuration:        maxCallDuration ? parseInt(maxCallDuration) : 600,
        followUpEmail:          followUpEmail !== undefined ? followUpEmail : true,
      },
    });

    cacheDelPattern(`agent:${userId}`);

    return sendSuccess(res, {
      ...settings,
      qualificationQuestions: typeof settings.qualificationQuestions === 'string'
        ? JSON.parse(settings.qualificationQuestions)
        : settings.qualificationQuestions,
    }, 'Agent settings saved');
  } catch (error) {
    next(error);
  }
};

const getVoices = async (_req, res, next) => {
  try {
    const voices = [
      { id: 'rachel', name: 'Rachel', gender: 'female', accent: 'American', preview: 'Warm and professional' },
      { id: 'josh',   name: 'Josh',   gender: 'male',   accent: 'American', preview: 'Confident and friendly' },
      { id: 'bella',  name: 'Bella',  gender: 'female', accent: 'American', preview: 'Energetic and upbeat' },
      { id: 'adam',   name: 'Adam',   gender: 'male',   accent: 'American', preview: 'Deep and authoritative' },
      { id: 'elli',   name: 'Elli',   gender: 'female', accent: 'American', preview: 'Young and enthusiastic' },
      { id: 'sam',    name: 'Sam',    gender: 'male',   accent: 'American', preview: 'Calm and reassuring' },
      { id: 'aria',   name: 'Aria',   gender: 'female', accent: 'British',  preview: 'Sophisticated and clear' },
      { id: 'thomas', name: 'Thomas', gender: 'male',   accent: 'British',  preview: 'Polished and professional' },
    ];
    return sendSuccess(res, voices, 'Voices retrieved');
  } catch (error) {
    next(error);
  }
};

module.exports = { getSettings, updateSettings, getVoices };
