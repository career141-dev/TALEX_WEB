import { BrevoClient } from '@getbrevo/brevo';
import { config } from '../config/env';

class EmailService {
    private client: BrevoClient;

    constructor() {
        this.client = new BrevoClient({
            apiKey: config.BREVO_API_KEY || '',
        });
    }

    private async send({ to, subject, htmlContent }: { to: string; subject: string; htmlContent: string }) {
        if (!config.BREVO_API_KEY) {
            console.warn('⚠️ BREVO_API_KEY not set. Email not sent:', { to, subject });
            return;
        }

        try {
            await this.client.transactionalEmails.sendTransacEmail({
                subject,
                htmlContent,
                sender: { name: config.FROM_NAME, email: config.FROM_EMAIL },
                to: [{ email: to }],
            });
        } catch (error) {
            console.error('❌ Brevo Email Error:', error);
            throw new Error('Failed to send email');
        }
    }

    async sendVerificationEmail(email: string, firstName: string, otp: string) {
        const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #333;">Welcome to Talex Awards, ${firstName}!</h2>
        <p>Thank you for registering. Please use the following One-Time Password (OTP) to verify your account:</p>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; border-radius: 5px; margin: 20px 0;">
          ${otp}
        </div>
        <p>This code will expire in 24 hours. If you did not request this, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #777;">&copy; ${new Date().getFullYear()} Talex Awards. All rights reserved.</p>
      </div>
    `;
        await this.send({ to: email, subject: 'Verify Your Email - Talex Awards', htmlContent });
    }

    async sendPasswordResetEmail(email: string, firstName: string, token: string) {
        const resetUrl = `${config.FRONTEND_URL}/reset-password?token=${token}`;
        const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #333;">Reset Your Password</h2>
        <p>Hi ${firstName}, we received a request to reset your password. Click the button below to proceed:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: #000; color: #fff; padding: 15px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
        </div>
        <p>If you did not request this, please ignore this email or contact support if you have concerns.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #777;">&copy; ${new Date().getFullYear()} Talex Awards. All rights reserved.</p>
      </div>
    `;
        await this.send({ to: email, subject: 'Reset Your Password - Talex Awards', htmlContent });
    }
}

export const emailService = new EmailService();
