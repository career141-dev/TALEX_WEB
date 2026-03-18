# TALEX Awards - Project Status Overview

## 📅 Status as of: March 16, 2026
**Current Branch:** `develop` (Merged from `feature/payments`)
**Build Status:** Production Ready (Hardened)

---

## 📂 Backend Folder Structure

```
talex-backend/
├── prisma/                     # Database Schema & Migrations
│   ├── migrations/             # SQL Migration History
│   └── schema.prisma           # Authoritative Prisma Model
├── src/                        # Main Application Source
│   ├── config/                 # Environment & Service Clients
│   │   ├── db.ts               # Prisma Instance
│   │   ├── env.ts              # Zod Environment Validation
│   │   ├── redis.ts            # Upstash Redis Configuration
│   │   └── supabase.ts         # Supabase Client setup
│   ├── controllers/            # Business Logic Handlers
│   │   ├── auth.controller.ts  # Login, Register, OTP flows (768 lines)
│   │   ├── payment.controller.ts # Webhook, Initiate, Retry (277 lines)
│   │   └── adminPayment.controller.ts # Admin Payment Management
│   ├── jobs/                   # Scheduled Cron Tasks
│   │   └── expirePayments.job.ts # Automated payment expiry logic
│   ├── middleware/             # Express Middlewares
│   │   ├── auth.middleware.ts  # Role & JWT verification
│   │   ├── rate-limiter.ts     # Upstash Anti-DDoS/Brute Force
│   │   └── requirePayment.ts   # Route guard for Candidate modules
│   ├── routes/                 # API Endpoint Definitions
│   │   ├── auth.routes.ts      # Public & Auth endpoints
│   │   └── payment.routes.ts   # Payment & Webhook endpoints
│   ├── services/               # Reusable Logic (Thin Controllers)
│   │   ├── email.service.ts    # Brevo Transactional Email (OTPs, Receipts)
│   │   └── payment.service.ts  # PayHere API & HMAC Logic
│   ├── utils/                  # Shared Constants & Helpers
│   │   ├── constants.ts        # Security & Role Configs
│   │   └── validation.ts       # Zod Schemas
│   ├── app.ts                  # Express App Setup
│   └── server.ts               # Entry Point
├── scripts/                    # Management & Testing Scripts
│   ├── delete-test-user-full.ts # Complete Cleanup Tool
│   └── verify-reset.ts         # User status reset utility
├── tests/                      # Testing Suite
│   ├── e2e/                    # End-to-End Tests
│   ├── integration/            # API Integration Tests
│   └── unit/                   # Unit Logic Tests
├── .env.example                # Standardized Environment Template
├── test-payment.html           # PayHere Sandbox Bridge
└── package.json                # Dependencies & Scripts
```

---

## 🚀 Key Features Implemented

### 1. Payment System (V3)
- **Initiation**: Secure session creation with custom Order IDs (`TALEX-timestamp-UUID`).
- **Webhook Processing**: Authoritative status updates via PayHere Server-to-Server callbacks.
- **Retry Mechanism**: Max 3 attempts enforced via database tracking and rate-limiters.
- **Expiry Logic**: Automated hourly cron job to expire stale pending payments.
- **Security**: Strict PayHere HMAC MD5 signature verification enabled (Production Standard).

### 2. Authentication & Authorization
- **OTP Verification**: Secure 6-digit registration codes with 24h expiry.
- **Ghost Account Protection**: Anti-enumeration measures in `/register`.
- **RBAC**: Role-Based Access Control (ADMIN, CANDIDATE, JUDGE).
- **Session Security**: Rotate refresh tokens via httpOnly cookies.

### 3. Developer Tools & Hardening
- **Automated Cleanup**: Scripts to reset test users from both Prisma and Supabase.
- **Rate Limiting**: Global, Auth, and Payment-specific limits via Upstash/Redis.
- **Health Checks**: Authoritative `/api/health` and `/api/payment/status` endpoints.

---

## 🛠 Active Tooling
- **Database**: Prisma + PostgreSQL (Supabase)
- **Cache**: Redis (Upstash)
- **Auth**: Supabase Auth (Admin API + Local Hash)
- **Email**: Brevo
- **Payment**: PayHere (Sandbox)
- **Monitoring**: Audit Log table (Auditing all sensitive actions)
