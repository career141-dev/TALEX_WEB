Step 2: Install Dependencies (5 min)
npm install @getbrevo/brevo express-slow-down cookie-parser @supabase/supabase-js
npm install -D @types/cookie-parser
# Verify already installed:
npm list express-rate-limit rate-limit-redis bcryptjs jsonwebtoken zod

Step 3: Constants (10 min)
// src/utils/constants.ts
export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: "15m",
  REFRESH_TOKEN_EXPIRY: "7d",
  REFRESH_TOKEN_REDIS_TTL: 7 * 24 * 60 * 60,
};
export const SECURITY_CONFIG = {
  BCRYPT_ROUNDS: 12,
  MAX_LOGIN_ATTEMPTS: 5,
  ACCOUNT_LOCK_DURATION: 15 * 60 * 1000,   // 15 minutes
  EMAIL_TOKEN_EXPIRY_HOURS: 24,
  PASSWORD_RESET_TOKEN_EXPIRY_HOURS: 1,
};

Step 4: Brevo Email Service (30 min)
// src/services/email.service.ts
import * as SibApiV3Sdk from "@getbrevo/brevo";
 
class EmailService {
  async sendVerificationEmail(email, firstName, token): Promise<void> {
    const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${token}`;
    // Responsive HTML template with verify button
    await this.send({ to: email, subject: "Verify Your Email - Talex Awards", htmlContent });
  }
  async sendWelcomeEmail(email, firstName): Promise<void> { ... }
  async sendPasswordResetEmail(email, firstName, token): Promise<void> { ... }
  async sendPasswordChangedEmail(email, firstName): Promise<void> { ... }
}
export const emailService = new EmailService();

Step 5: Auth Middleware (20 min)
// src/middleware/auth.middleware.ts
export const requireAuth = async (req: AuthRequest, res, next): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "Unauthorized" }); return;
  }
  const token = authHeader.split(" ")[1];
  const { data, error } = await supabase.auth.getUser(token);
  if (error) { res.status(401).json({ success: false, error: error.message }); return; }
  req.user = data.user;
  next();
};
 
export const requireRole = (...roles: Role[]) => (req: AuthRequest, res, next) => {
  const role = req.user?.user_metadata?.role;
  if (!roles.includes(role)) { res.status(403).json({ success: false, error: "Forbidden" }); return; }
  next();
};

Step 6: Auth Controller (60 min — Most Important)
Endpoint	Implementation Steps
POST /api/auth/register	1. Validate with Zod · 2. Check email exists → 409 · 3. Supabase Auth signUp · 4. bcrypt hash password · 5. Create user in DB · 6. Create email verify token (24h) · 7. Send verification email via Brevo · 8. Log in audit · Return 201.
POST /api/auth/verify-email	1. Find token in EmailToken table · 2. Check not used + not expired · 3. Transaction: mark user verified + token used · 4. Send welcome email · 5. Log event · Return 200.
POST /api/auth/login	1. Find user by email · 2. Check password (always run bcrypt even if not found) · 3. Check not locked (auto-unlock if time expired) · 4. Check email verified · 5. Check active · 6. Reset login_attempts, update last_login_at · 7. Supabase Auth signIn · 8. Set refresh token in httpOnly cookie · Return 200.
POST /api/auth/refresh	1. Read refreshToken from httpOnly cookie · 2. Call Supabase Auth refreshSession · 3. Set new cookie · Return new accessToken.
POST /api/auth/logout	1. Supabase Auth signOut · 2. Clear cookie · 3. Log event in audit.
POST /api/auth/forgot-password	1. Find user (always return success — prevents enumeration) · 2. Create PASSWORD_RESET token (1h) · 3. Send reset email via Brevo.
POST /api/auth/reset-password	1. Find + verify reset token · 2. Hash new password · 3. Transaction: update password + mark token used · 4. Revoke all sessions · 5. Send confirmation email.
GET /api/auth/me	Return current user profile (select safe fields only — no password_hash).

Step 7: Auth Routes (15 min)
// src/routes/auth.routes.ts
router.post("/register", authRateLimiter, validate(registerSchema), authController.register);
router.post("/verify-email", validate(verifyEmailSchema), authController.verifyEmail);
router.post("/login", authRateLimiter, validate(loginSchema), authController.login);
router.post("/forgot-password", passwordResetRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), authController.resetPassword);
router.post("/refresh", authController.refreshToken);
router.post("/logout", requireAuth, authController.logout);
router.get("/me", requireAuth, authController.getProfile);

Step 8: Rate Limiting (15 min)
// src/middleware/rate-limiter.ts
export const globalRateLimiter = rateLimit({ windowMs: 15*60*1000, max: 100,
  store: new RedisStore({ client: redisClient, prefix: "rl:global:" }) });
 
export const authRateLimiter = rateLimit({ windowMs: 15*60*1000, max: 5,
  skipSuccessfulRequests: true,
  store: new RedisStore({ client: redisClient, prefix: "rl:auth:" }) });
 
export const passwordResetRateLimiter = rateLimit({ windowMs: 60*60*1000, max: 3,
  store: new RedisStore({ client: redisClient, prefix: "rl:reset:" }) });

Section 7: Testing Your Authentication
Test	Command	Expected Result
1. Health	curl http://localhost:5000/health	200 · { "success": true }
2. Register	POST /api/auth/register with valid body	201 · Verification email sent
3. Verify Email	POST /api/auth/verify-email with token from email	200 · Welcome email sent
4. Login	POST /api/auth/login with email + password	200 · accessToken + httpOnly cookie
5. Get Profile	GET /api/auth/me with Bearer token	200 · User profile data
6. Forgot Password	POST /api/auth/forgot-password	200 · Reset email sent
7. Reset Password	POST /api/auth/reset-password with token + new password	200 · Confirmation email
8. Logout	POST /api/auth/logout with Bearer token	200 · Cookie cleared

Section 8: Common Errors & Solutions
Error	Solution
"Supabase API key invalid"	Check .env file. Ensure SUPABASE_SERVICE_KEY is the service_role key, not anon.
"Brevo API key invalid"	Check .env file. Regenerate key in Brevo dashboard.
"Email not sent"	Verify sender email is added and verified in Brevo sender settings.
"User not found after register"	Check Prisma schema is migrated: npx prisma migrate dev.
"Token expired"	Generate new token. Verify (24h), reset (1h).
"CORS error"	Check FRONTEND_URL in .env matches your frontend origin exactly.
"Redis connection failed"	Ensure Redis is running: docker ps. Check REDIS_URL.
"Account locked"	Wait 15 min or update locked_until to past date in Supabase dashboard.
"Validation failed"	Check request body fields match Zod schema. Check required vs optional.

Section 9: Production Deployment Checklist

### Security
- [ ] Change all JWT secrets to strong random strings (64+ chars): `openssl rand -base64 64`
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS only — configure SSL certificate.
- [ ] Set `secure: true` on cookie options.
- [ ] Add your domain to CORS allowlist.
- [ ] Review all rate limits — tighten for production.

### Email (Brevo)
- [ ] Add custom domain in Brevo dashboard.
- [ ] Verify domain ownership (DNS records: SPF, DKIM).
- [ ] Update `FROM_EMAIL` to your domain email.
- [ ] Test all email templates.

### Supabase
- [ ] Enable Point-in-Time Recovery (backups).
- [ ] Configure Row Level Security (RLS) on all tables.
- [ ] Set up database webhooks for critical events.
- [ ] Review authentication rate limits in Supabase Auth settings.

### Monitoring
- [ ] Set up error logging (Sentry).
- [ ] Configure uptime monitoring (UptimeRobot).
- [ ] Add performance monitoring.
- [ ] Set up alerts for failed login spikes.

