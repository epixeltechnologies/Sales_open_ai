const prisma  = require('../config/prisma');
const { cacheGet, cacheSet, cacheDel, cacheDelPattern } = require('../config/memoryStore');
const { analyzeTranscript, generateFollowUpEmail } = require('../services/openaiService');
const { generateTwiML, createVapiSession, getVapiCallDetails, getRecordingUrl } = require('../services/voiceService');
const { sendEmail }  = require('../services/emailService');
const { sendSuccess, sendError } = require('../utils/responseHelpers');
const { logger }     = require('../utils/logger');

/* ─────────────────────────────────────────────────────────────
   POST /api/call/webhook  —  Twilio inbound call
───────────────────────────────────────────────────────────── */
const handleInboundCall = async (req, res) => {
  try {
    const { CallSid, From, To } = req.body;
    logger.info(`Inbound call: ${CallSid} from ${From}`);

    const user = await prisma.user.findFirst({
      where:   { isActive: true },
      include: { agentSettings: true, subscription: true },
    });

    if (!user?.agentSettings) {
      const twiml = generateTwiML('Thank you for calling. Our office is currently unavailable. Please try again later.');
      res.type('text/xml');
      return res.send(twiml);
    }

    // Minutes guard
    const sub = user.subscription;
    if (sub && sub.minutesUsed >= sub.minutesLimit) {
      res.type('text/xml');
      return res.send(generateTwiML('Thank you for calling. We are unable to take your call at this time.'));
    }

    const call = await prisma.call.create({
      data: { userId: user.id, twilioCallSid: CallSid, status: 'IN_PROGRESS', direction: 'INBOUND', fromNumber: From, toNumber: To },
    });

    await prisma.callLog.create({ data: { userId: user.id, callId: call.id, event: 'CALL_STARTED', data: { from: From } } });

    const vapiSession = await createVapiSession(user.agentSettings, CallSid, From);

    if (vapiSession?.id) {
      await prisma.call.update({ where: { id: call.id }, data: { vapiCallId: vapiSession.id } });
      cacheSet(`call:${CallSid}`, { callId: call.id, userId: user.id, vapiCallId: vapiSession.id }, 3600);

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${process.env.VAPI_WEBSOCKET_URL || 'wss://api.vapi.ai/twilio'}">
      <Parameter name="vapiCallId" value="${vapiSession.id}"/>
    </Stream>
  </Connect>
</Response>`;
      res.type('text/xml');
      return res.send(twiml);
    }

    // Fallback gather flow
    cacheSet(`call:${CallSid}`, { callId: call.id, userId: user.id }, 3600);
    const gatherUrl = `${process.env.TWILIO_WEBHOOK_URL}/api/call/gather`;
    res.type('text/xml');
    return res.send(generateTwiML(user.agentSettings.welcomeMessage, gatherUrl));
  } catch (error) {
    logger.error('handleInboundCall error:', error);
    res.type('text/xml');
    return res.send(generateTwiML('Thank you for calling. Please try again later.'));
  }
};

/* ─────────────────────────────────────────────────────────────
   POST /api/call/gather  —  speech input from caller
───────────────────────────────────────────────────────────── */
const handleGather = async (req, res) => {
  try {
    const { CallSid, SpeechResult } = req.body;
    const cached = cacheGet(`call:${CallSid}`);
    if (!cached) { res.type('text/xml'); return res.send(generateTwiML('Thank you for calling. Goodbye!')); }

    const convKey = `conv:${CallSid}`;
    const history = cacheGet(convKey) || [];
    if (SpeechResult) history.push({ role: 'user', content: SpeechResult });

    const gatherUrl    = `${process.env.TWILIO_WEBHOOK_URL}/api/call/gather`;
    const agentResponse = 'Thank you for that information. Could you tell me more about your specific needs?';
    history.push({ role: 'assistant', content: agentResponse });
    cacheSet(convKey, history, 3600);

    res.type('text/xml');
    return res.send(generateTwiML(agentResponse, gatherUrl));
  } catch (error) {
    logger.error('handleGather error:', error);
    res.type('text/xml');
    return res.send(generateTwiML('I apologise, please try again.'));
  }
};

/* ─────────────────────────────────────────────────────────────
   POST /api/call/status  —  Twilio status callback
───────────────────────────────────────────────────────────── */
const handleCallStatus = async (req, res) => {
  try {
    const { CallSid, CallStatus, CallDuration } = req.body;
    logger.info(`Call status: ${CallSid} → ${CallStatus}`);

    const cached = cacheGet(`call:${CallSid}`);
    if (!cached) return res.sendStatus(200);

    const { callId, userId, vapiCallId } = cached;

    const statusMap = { completed: 'COMPLETED', failed: 'FAILED', busy: 'BUSY', 'no-answer': 'NO_ANSWER', canceled: 'FAILED' };
    const status    = statusMap[CallStatus] || 'COMPLETED';
    const duration  = parseInt(CallDuration) || 0;

    const recordingUrl = await getRecordingUrl(CallSid);

    let transcript = null;
    let analysis   = null;

    if (vapiCallId) {
      const vapiDetails = await getVapiCallDetails(vapiCallId);
      if (vapiDetails?.transcript) {
        transcript = vapiDetails.transcript;
        const user = await prisma.user.findUnique({ where: { id: userId }, include: { agentSettings: true } });
        analysis   = await analyzeTranscript(transcript, user?.agentSettings || {});
      }
    }

    if (!transcript) {
      const history = cacheGet(`conv:${CallSid}`) || [];
      if (history.length) {
        transcript = history.map((h) => `${h.role === 'user' ? 'Caller' : 'Agent'}: ${h.content}`).join('\n');
      }
    }

    await prisma.call.update({
      where: { id: callId },
      data:  { status, duration, recordingUrl, transcript, summary: analysis?.summary, sentiment: analysis?.sentiment, qualified: analysis?.qualified },
    });

    if (analysis) await processCallAnalysis(callId, userId, analysis);

    if (duration > 0) {
      const mins = Math.ceil(duration / 60);
      await prisma.subscription.update({ where: { userId }, data: { minutesUsed: { increment: mins } } }).catch(() => {});
    }

    await prisma.callLog.create({ data: { userId, callId, event: 'CALL_ENDED', data: { status, duration } } });

    // Invalidate dashboard cache for this user
    cacheDelPattern(`dashboard:${userId}`);
    cacheDel(`call:${CallSid}`);
    cacheDel(`conv:${CallSid}`);

    return res.sendStatus(200);
  } catch (error) {
    logger.error('handleCallStatus error:', error);
    return res.sendStatus(200);
  }
};

/* ─────────────────────────────────────────────────────────────
   Internal: process AI analysis after call ends
───────────────────────────────────────────────────────────── */
const processCallAnalysis = async (callId, userId, analysis) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const call = await prisma.call.findUnique({ where: { id: callId } });

    if (!call) return;

    let lead = await prisma.lead.findFirst({ where: { userId, phone: call.fromNumber } });

    const leadData = {
      name:       analysis.callerName   || 'Unknown Caller',
      phone:      call.fromNumber,
      ...(analysis.callerEmail   && { email:      analysis.callerEmail }),
      ...(analysis.callerCompany && { company:    analysis.callerCompany }),
      ...(analysis.budget        && { budget:     analysis.budget }),
      ...(analysis.painPoints    && { painPoints: analysis.painPoints }),
      status: analysis.qualified ? 'QUALIFIED' : 'UNQUALIFIED',
      score:  analysis.qualificationScore || 0,
      notes:  analysis.summary,
    };

    if (lead) {
      lead = await prisma.lead.update({ where: { id: lead.id }, data: leadData });
    } else {
      lead = await prisma.lead.create({ data: { userId, callId, ...leadData } });
      await prisma.call.update({ where: { id: callId }, data: { leadId: lead.id } });
    }

    // Book appointment
    if (analysis.appointmentRequested && analysis.appointmentDateTime) {
      try {
        const scheduledAt = new Date(analysis.appointmentDateTime);
        if (!isNaN(scheduledAt)) {
          await prisma.appointment.create({
            data: { userId, leadId: lead.id, callId, title: `Sales call with ${lead.name}`, scheduledAt, status: 'SCHEDULED' },
          });
          await prisma.lead.update({ where: { id: lead.id }, data: { status: 'APPOINTMENT_BOOKED' } });
        }
      } catch (e) { logger.error('Appointment creation error:', e); }
    }

    // Follow-up email for unqualified leads
    if (!analysis.qualified && lead.email) {
      const content = await generateFollowUpEmail(lead, analysis.summary, user.companyName);
      await sendEmail({
        to:      lead.email,
        subject: content.subject,
        html:    `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">${content.body.replace(/\n/g,'<br>')}</div>`,
      });
    }

    // Notify account owner of qualified lead
    if (analysis.qualified && user?.email) {
      await sendEmail({ to: user.email, template: 'leadQualified', data: { leadName: lead.name, companyName: user.companyName, agentName: 'Alex' } });
    }
  } catch (error) {
    logger.error('processCallAnalysis error:', error);
  }
};

/* ─────────────────────────────────────────────────────────────
   POST /api/call/vapi-webhook  —  Vapi events
───────────────────────────────────────────────────────────── */
const handleVapiWebhook = async (req, res) => {
  try {
    const { type, call } = req.body;
    logger.info(`Vapi webhook: ${type}`);

    if (type === 'end-of-call-report' && call?.metadata?.twilioCallSid) {
      const cached = cacheGet(`call:${call.metadata.twilioCallSid}`);
      if (cached && call.transcript) {
        await prisma.call.update({
          where: { id: cached.callId },
          data:  { transcript: call.transcript, summary: call.summary, recordingUrl: call.recordingUrl },
        });
      }
    }
    return res.sendStatus(200);
  } catch (error) {
    logger.error('handleVapiWebhook error:', error);
    return res.sendStatus(200);
  }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/call/:id  &  GET /api/call
───────────────────────────────────────────────────────────── */
const getCall = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId  = req.user.id;
    const call    = await prisma.call.findFirst({
      where:   { id, userId },
      include: { lead: true, callLogs: { orderBy: { timestamp: 'asc' } }, appointment: true },
    });
    if (!call) return sendError(res, 'Call not found', 404);
    return sendSuccess(res, call, 'Call retrieved');
  } catch (error) { next(error); }
};

const getCalls = async (req, res, next) => {
  try {
    const userId          = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const skip            = (parseInt(page) - 1) * parseInt(limit);

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where:   { userId },
        skip,
        take:    parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: { lead: { select: { name: true, status: true } } },
      }),
      prisma.call.count({ where: { userId } }),
    ]);

    return res.json({
      success: true,
      data:    calls,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) { next(error); }
};

module.exports = { handleInboundCall, handleGather, handleCallStatus, handleVapiWebhook, getCall, getCalls };
