Section 3: Complete Database Schema
File: prisma/schema.prisma
Update your existing schema with the following additions.

User Model
model User {
  id                   String    @id @default(uuid())
  supabase_uid          String?   @unique @map("supabase_uid")  // Links to Supabase Auth
  firstName             String    @map("first_name")
  lastName              String    @map("last_name")
  email                 String    @unique
  password_hash         String
  company               String
  designation           String
  phone                 String?
  role                  Role      @default(CANDIDATE)
  is_verified           Boolean   @default(false)
  is_active             Boolean   @default(true)
  is_locked             Boolean   @default(false)
  locked_until          DateTime?
  login_attempts        Int       @default(0)
  last_login_at         DateTime?
  created_at            DateTime  @default(now())
  updated_at            DateTime  @updatedAt
  applications          Application[]
  emailTokens           EmailToken[]
  auditLogs             AuditLog[]
  @@index([email]) @@map("users")
}
 
enum Role { CANDIDATE ADMIN JUDGE }

EmailToken Model
model EmailToken {
  id          String    @id @default(uuid())
  user_id     String
  user        User      @relation(fields: [user_id], references: [id], onDelete: Cascade)
  token       String    @unique @default(uuid())
  type        TokenType
  expires_at  DateTime
  used_at     DateTime?
  created_at  DateTime  @default(now())
  @@index([user_id]) @@index([token]) @@map("email_tokens")
}
enum TokenType { EMAIL_VERIFY PASSWORD_RESET }

Section 4: Folder Structure
File / Path	Status	Action Today
src/config/env.ts	→ Update	Add Supabase + Brevo vars
src/config/supabase.ts	→ Create	Supabase client init
src/controllers/auth.controller.ts	→ Create	8 auth endpoints
src/middleware/auth.middleware.ts	→ Create	requireAuth, requireRole
src/middleware/rate-limiter.ts	→ Configure	Global, auth, reset limiters
src/middleware/validate.ts	→ Create	Zod request body validation
src/routes/auth.routes.ts	→ Create	Auth route definitions
src/services/email.service.ts	→ Create	Brevo 4 email types
src/services/token.service.ts	→ Create	JWT generate/verify
src/services/audit.service.ts	→ Create	Auth event logging
src/utils/constants.ts	→ Create	JWT config, security constants
src/utils/validation.ts	→ Expand	Zod schemas
src/app.ts	→ Update	Add cookie-parser, new routes
prisma/schema.prisma	→ Update	Complete User + EmailToken schema

Section 5: Supabase Setup
Step 1: Create Supabase Project
1.	1. Go to: https://app.supabase.com → New Project.
2.	2. Note your Project URL and API keys (anon + service_role).
3.	3. Go to Authentication → Settings → Enable email confirmation.
4.	4. Go to Storage → Create bucket named uploads (private).

S

Step 3: Supabase Client
// src/config/supabase.ts
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";
 
// Admin client (server-side only — has full access)
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_KEY
);
 
// Anon client (validate user tokens)
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY
);

