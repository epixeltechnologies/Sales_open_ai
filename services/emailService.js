const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');

let transporter;

const getTransporter = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true,
    maxConnections: 5,
  });

  return transporter;
};

// Email templates
const templates = {
  welcome: ({ name, companyName }) => ({
    subject: 'Welcome to SalesVoice AI!',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #f9fafb;">
        <div style="background: white; border-radius: 16px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #6366f1; font-size: 28px; margin: 0;">SalesVoice AI</h1>
          </div>
          <h2 style="color: #111827; font-size: 22px;">Welcome, ${name}! 🎉</h2>
          <p style="color: #6b7280; line-height: 1.6;">
            Thank you for signing up for SalesVoice AI. Your AI sales agent is ready to start qualifying leads and booking appointments for <strong>${companyName}</strong>.
          </p>
          <div style="background: #f0f9ff; border-radius: 12px; padding: 20px; margin: 24px 0;">
            <h3 style="color: #0369a1; margin: 0 0 12px;">🚀 Getting Started</h3>
            <ul style="color: #374151; padding-left: 20px; margin: 0;">
              <li style="margin-bottom: 8px;">Configure your AI agent settings</li>
              <li style="margin-bottom: 8px;">Connect your Twilio phone number</li>
              <li style="margin-bottom: 8px;">Set your qualification questions</li>
              <li>Go live and start capturing leads!</li>
            </ul>
          </div>
          <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.FRONTEND_URL}/dashboard" 
               style="background: #6366f1; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
              Go to Dashboard →
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            SalesVoice AI · Powered by Anthropic AI · <a href="#" style="color: #9ca3af;">Unsubscribe</a>
          </p>
        </div>
      </body>
      </html>
    `,
  }),

  resetPassword: ({ name, resetUrl }) => ({
    subject: 'Reset your SalesVoice AI password',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #f9fafb;">
        <div style="background: white; border-radius: 16px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <h1 style="color: #6366f1; font-size: 24px; text-align: center;">SalesVoice AI</h1>
          <h2 style="color: #111827;">Password Reset</h2>
          <p style="color: #6b7280; line-height: 1.6;">Hi ${name}, we received a request to reset your password.</p>
          <p style="color: #6b7280;">This link expires in <strong>1 hour</strong>.</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" 
               style="background: #6366f1; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #9ca3af; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      </body>
      </html>
    `,
  }),

  leadQualified: ({ leadName, companyName, agentName }) => ({
    subject: `New Qualified Lead: ${leadName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #f9fafb;">
        <div style="background: white; border-radius: 16px; padding: 40px;">
          <h1 style="color: #6366f1; font-size: 24px;">🎯 New Qualified Lead!</h1>
          <p style="color: #374151;">Your AI agent <strong>${agentName}</strong> just qualified a new lead for <strong>${companyName}</strong>.</p>
          <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; border-radius: 0 8px 8px 0; margin: 20px 0;">
            <strong style="color: #166534;">Lead: ${leadName}</strong>
          </div>
          <a href="${process.env.FRONTEND_URL}/leads" style="background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Lead →</a>
        </div>
      </body>
      </html>
    `,
  }),

  followUp: ({ leadName, companyName }) => ({
    subject: `Follow up from ${companyName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #f9fafb;">
        <div style="background: white; border-radius: 16px; padding: 40px;">
          <h2 style="color: #111827;">Thank you for your interest, ${leadName}!</h2>
          <p style="color: #6b7280; line-height: 1.6;">
            We appreciate you taking the time to speak with us. We'd love to continue the conversation and show you how we can help.
          </p>
          <p style="color: #6b7280;">Feel free to reply to this email or call us back at your convenience.</p>
          <p style="color: #374151;">Best regards,<br><strong>${companyName} Team</strong></p>
        </div>
      </body>
      </html>
    `,
  }),
};

/**
 * Send email
 */
const sendEmail = async ({ to, subject, template, data, html }) => {
  try {
    const t = getTransporter();
    let emailHtml = html;
    let emailSubject = subject;

    if (template && templates[template]) {
      const rendered = templates[template](data);
      emailHtml = rendered.html;
      emailSubject = rendered.subject;
    }

    const mailOptions = {
      from: `SalesVoice AI <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
      to,
      subject: emailSubject,
      html: emailHtml,
    };

    const result = await t.sendMail(mailOptions);
    logger.info(`Email sent to ${to}: ${result.messageId}`);
    return result;
  } catch (error) {
    logger.error('Email send error:', error);
    // Don't throw - email failures shouldn't crash the app
    return null;
  }
};

module.exports = { sendEmail };
