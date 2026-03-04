import { BrevoClient } from '@getbrevo/brevo';
import { config } from '../config/env';

// ─── BASE TEMPLATE ────────────────────────────────────────────────────────────
const baseTemplate = (preheader: string, bodyContent: string): string => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Talex Awards</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,sans-serif;">

  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${preheader}
  </span>

  <table width="100%" cellpadding="0" cellspacing="0"
         style="background:#F1F5F9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:12px;
                      overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#1E3A5F;padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;
                         letter-spacing:2px;font-weight:700;">
                TALEX AWARDS
              </h1>
              <p style="margin:6px 0 0;color:#93C5FD;font-size:12px;
                        letter-spacing:1px;">
                CAREER ONE FOR ONE
              </p>
            </td>
          </tr>

          <!-- Gold accent line -->
          <tr>
            <td style="background:#D97706;height:4px;font-size:0;">&nbsp;</td>
          </tr>

          <!-- Body content -->
          <tr>
            <td style="padding:40px;">
              ${bodyContent}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F8FAFC;padding:24px 40px;
                       border-top:1px solid #E2E8F0;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:#64748B;">
                Need help? Contact us at
                <a href="mailto:support@career141.com"
                   style="color:#1E3A5F;font-weight:600;">
                  support@career141.com
                </a>
              </p>
              <p style="margin:0;font-size:11px;color:#94A3B8;">
                &copy; ${new Date().getFullYear()} Talex Awards &bull; Career One for One
                &bull; Colombo, Sri Lanka
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#94A3B8;">
                You are receiving this email because you registered on
                <a href="${config.FRONTEND_URL}" style="color:#94A3B8;">
                  Talex Awards
                </a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
`;

// ─── REUSABLE UI COMPONENTS ───────────────────────────────────────────────────
const otpBox = (otp: string) => `
  <div style="background:#F8FAFC;border:2px dashed #CBD5E1;
              border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
    <p style="margin:0 0 8px;font-size:12px;color:#64748B;
              letter-spacing:2px;text-transform:uppercase;">
      Your verification code
    </p>
    <div style="font-size:44px;font-weight:700;letter-spacing:14px;
                color:#1E3A5F;font-family:monospace;">
      ${otp}
    </div>
  </div>
`;

const primaryButton = (url: string, label: string) => `
  <div style="text-align:center;margin:32px 0;">
    <a href="${url}"
       style="background:#1E3A5F;color:#ffffff;padding:14px 32px;
              text-decoration:none;border-radius:8px;font-weight:600;
              font-size:15px;display:inline-block;border:2px solid #1E3A5F;">
      ${label}
    </a>
  </div>
  <p style="text-align:center;font-size:12px;color:#94A3B8;margin-top:-16px;">
    Or copy this link:
    <a href="${url}" style="color:#0D9488;word-break:break-all;">${url}</a>
  </p>
`;

const infoRow = (label: string, value: string) => `
  <tr>
    <td style="padding:8px 12px;font-size:13px;color:#64748B;
               font-weight:600;width:140px;vertical-align:top;">
      ${label}
    </td>
    <td style="padding:8px 12px;font-size:13px;color:#1E293B;">
      ${value}
    </td>
  </tr>
`;

const infoTable = (rows: string) => `
  <table width="100%" cellpadding="0" cellspacing="0"
         style="border:1px solid #E2E8F0;border-radius:8px;
                overflow:hidden;margin:20px 0;">
    ${rows}
  </table>
`;

// ─── EMAIL SERVICE ────────────────────────────────────────────────────────────
class EmailService {
  private client: BrevoClient;

  constructor() {
    this.client = new BrevoClient({
      apiKey: config.BREVO_API_KEY || '',
    });
  }

  private async send({
    to,
    toName,
    subject,
    htmlContent,
    textContent,
    attachment,
  }: {
    to: string;
    toName: string;
    subject: string;
    htmlContent: string;
    textContent?: string;
    attachment?: { content: string; name: string }[];
  }) {
    if (!config.BREVO_API_KEY) {
      console.warn('⚠️  BREVO_API_KEY not set. Email not sent:', { to, subject });
      return;
    }

    try {
      await this.client.transactionalEmails.sendTransacEmail({
        sender: { name: config.FROM_NAME, email: config.FROM_EMAIL },
        to: [{ email: to, name: toName }],
        subject,
        htmlContent,
        ...(textContent && { textContent }),
        ...(attachment && { attachment }),
      });
      console.log(`✅ Email sent: "${subject}" → ${to}`);
    } catch (error) {
      console.error('❌ Brevo Email Error:', error);
      throw new Error('Failed to send email');
    }
  }

  // ── 1. Email Verification OTP ─────────────────────────────────────────────
  async sendVerificationEmail(email: string, firstName: string, otp: string) {
    const body = `
      <h2 style="margin:0 0 8px;color:#1E3A5F;font-size:22px;">
        Welcome, ${firstName}!
      </h2>
      <p style="color:#64748B;margin:0 0 20px;font-size:15px;line-height:1.6;">
        Thank you for registering for <strong>Talex Awards</strong>.
        Please verify your email address using the code below.
      </p>

      ${otpBox(otp)}

      <p style="color:#64748B;font-size:13px;line-height:1.6;">
        This code expires in <strong>24 hours</strong>.
        Enter it on the verification page to activate your account.
      </p>
      <p style="color:#94A3B8;font-size:12px;">
        If you did not create a Talex Awards account, you can safely ignore this email.
      </p>
    `;

    await this.send({
      to: email,
      toName: firstName,
      subject: `${otp} is your Talex Awards verification code`,
      htmlContent: baseTemplate(
        `Your verification code is ${otp} — enter it to activate your account`,
        body
      ),
      textContent: `Welcome to Talex Awards!\n\nYour verification code is: ${otp}\n\nThis code expires in 24 hours.`,
    });
  }

  // ── 2. Password Reset OTP ─────────────────────────────────────────────────
  async sendPasswordResetOtp(email: string, firstName: string, otp: string) {
    const body = `
      <h2 style="margin:0 0 8px;color:#1E3A5F;font-size:22px;">
        Password Reset Request
      </h2>
      <p style="color:#64748B;margin:0 0 20px;font-size:15px;line-height:1.6;">
        Hi <strong>${firstName}</strong>, we received a request to reset your
        Talex Awards password. Use the code below — it expires in
        <strong>15 minutes</strong>.
      </p>

      ${otpBox(otp)}

      <div style="background:#FEF3C7;border-left:4px solid #D97706;
                  padding:14px 16px;border-radius:0 8px 8px 0;margin:20px 0;">
        <p style="margin:0;font-size:13px;color:#92400E;">
          <strong>Did not request this?</strong> Your account is safe.
          Someone may have entered your email by mistake.
          You can ignore this email.
        </p>
      </div>
    `;

    await this.send({
      to: email,
      toName: firstName,
      subject: `${otp} is your Talex Awards password reset code`,
      htmlContent: baseTemplate(
        `Your password reset code is ${otp} — expires in 15 minutes`,
        body
      ),
      textContent: `Password Reset\n\nYour reset code is: ${otp}\n\nExpires in 15 minutes.\n\nIf you did not request this, ignore this email.`,
    });
  }

  // ── 3. Payment Receipt ────────────────────────────────────────────────────
  async sendReceiptEmail(
    email: string,
    firstName: string,
    orderId: string,
    amount: string
  ) {
    const body = `
      <h2 style="margin:0 0 8px;color:#16A34A;font-size:22px;">
        ✓ Payment Confirmed
      </h2>
      <p style="color:#64748B;margin:0 0 20px;font-size:15px;line-height:1.6;">
        Hi <strong>${firstName}</strong>, your application fee has been
        received. You can now access and complete your application.
      </p>

      ${infoTable(`
        ${infoRow('Amount Paid', `<strong style="color:#16A34A;">LKR ${amount}</strong>`)}
        ${infoRow('Reference', `<code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;">${orderId}</code>`)}
        ${infoRow('Date', new Date().toLocaleDateString('en-LK', {
      year: 'numeric', month: 'long', day: 'numeric'
    }))}
        ${infoRow('Status', '<span style="color:#16A34A;font-weight:600;">Confirmed</span>')}
      `)}

      ${primaryButton(`${config.FRONTEND_URL}/candidate/dashboard`, 'Go to My Application')}
    `;

    await this.send({
      to: email,
      toName: firstName,
      subject: 'Payment Confirmed — Talex Awards Application Fee',
      htmlContent: baseTemplate(
        `Payment of LKR ${amount} confirmed. You can now complete your application.`,
        body
      ),
      textContent: `Payment Confirmed\n\nAmount: LKR ${amount}\nReference: ${orderId}\n\nYou can now complete your application at ${config.FRONTEND_URL}`,
    });
  }

  // ── 4. Application Submission Confirmation (with PDF attachment) ──────────
  async sendConfirmationEmail(
    email: string,
    firstName: string,
    applicationId: string,
    category: string,
    pdfBuffer: Buffer
  ) {
    const body = `
      <h2 style="margin:0 0 8px;color:#0D9488;font-size:22px;">
        Application Submitted Successfully
      </h2>
      <p style="color:#64748B;margin:0 0 20px;font-size:15px;line-height:1.6;">
        Hi <strong>${firstName}</strong>, your Talex Awards application has been
        received and is now under review by our team.
      </p>

      ${infoTable(`
        ${infoRow('Application ID', `<code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;font-size:12px;">${applicationId}</code>`)}
        ${infoRow('Category', category)}
        ${infoRow('Submitted', new Date().toLocaleDateString('en-LK', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }))}
        ${infoRow('Status', '<span style="color:#D97706;font-weight:600;">Under Review</span>')}
      `)}

      <div style="background:#F0FDF4;border:1px solid #BBF7D0;
                  border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">
          A <strong>PDF summary</strong> of your submission is attached to
          this email for your records. We will notify you of any updates
          at this email address.
        </p>
      </div>

      ${primaryButton(`${config.FRONTEND_URL}/candidate/dashboard`, 'View My Application')}
    `;

    await this.send({
      to: email,
      toName: firstName,
      subject: 'Application Submitted — Talex Awards',
      htmlContent: baseTemplate(
        `Your Talex Awards application has been received and is under review.`,
        body
      ),
      textContent: `Application Submitted\n\nApplication ID: ${applicationId}\nCategory: ${category}\n\nA PDF summary is attached. View your application at ${config.FRONTEND_URL}/candidate/dashboard`,
      attachment: [{
        content: pdfBuffer.toString('base64'),
        name: 'Talex_Awards_Application_Summary.pdf',
      }],
    });
  }
}

export const emailService = new EmailService();
