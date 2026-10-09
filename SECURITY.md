# Security Policy & Architecture

This document outlines the security architecture, threat model mitigations, credential management practices, and defense-in-depth mechanisms implemented in Paklance.

---

## 1. Authentication & Token Security

### 1.1 Strict JWT Secret Startup Guard
- The application implements a fail-fast startup guard in `src/auth/jwt.strategy.ts` and `src/auth/auth.module.ts`.
- If `JWT_SECRET` is missing, an empty string, or composed solely of whitespace, the NestJS application refuses to boot and immediately throws an error:
  ```typescript
  if (!secret || secret.trim() === '') {
    throw new Error('FATAL: JWT_SECRET environment variable is missing or empty. Application will not start.');
  }
  ```
- No hardcoded fallback secret exists anywhere in the codebase.

### 1.2 Password Hashing & Secret Sanitization
- Passwords are encrypted using **bcrypt** with a salt factor of 10 (`bcrypt.hash(password, 10)`).
- The `passwordHash` column is explicitly excluded in Prisma query projections (`select: { passwordHash: false }`) and stripped from all controller responses.
- In unit and end-to-end regression suites, test assertions explicitly confirm that user registration and login payloads never contain `passwordHash`.

### 1.3 OTP Generation & Rate Limiting
- Email verification codes are generated as random 6-digit numeric strings with a 15-minute expiration window (`emailVerifyExpires`).
- An email resend rate limit of **60 seconds** is enforced via `emailVerifyLastSentAt` to prevent mail service flooding and brute-force abuse.
- OTPs are transmitted only via secure email channels (Resend / SendGrid / Brevo / SMTP) and are never exposed in API responses or logs.

---

## 2. Authorization & Resource Isolation

### 2.1 Role-Based Access Control (RBAC)
- Endpoints are protected with NestJS execution guards: `JwtAuthGuard` and `RolesGuard`.
- Roles are strictly validated using the `@Roles(...)` decorator against the database enum (`ADMIN`, `CLIENT`, `SPECIALIST`).

### 2.2 Multi-Tenant Data Isolation
- Direct object reference (IDOR) attacks are mitigated by validating ownership before executing database operations:
  - **Wallet & Balances**: Users can only inspect their own wallet balance and transactions.
  - **Payout Methods**: Modifying or selecting a payout method requires checking `pm.userId === currentUser.id`.
  - **Contract Deliverables**: Attachments can only be accessed or downloaded by the contract's Client or Specialist.
  - **Messaging**: Fetching conversation messages verifies that the requesting user's ID matches either participant.

---

## 3. Financial & Transactional Integrity

### 3.1 ACID Database Transactions
All critical financial operations are executed within isolated Prisma transactions (`prisma.$transaction(async (tx) => { ... })`):
- **Escrow Funding**: Deducts client balance and increments escrow balance in a single atomic step.
- **Milestone Release**: Decrements escrow balance and increments specialist wallet balance atomically while creating an immutable audit transaction record.
- **Two-Phase Withdrawals**:
  1. Phase 1: Moves funds into `lockedBalance` to reserve them against concurrent spend attempts.
  2. Phase 2: Deducts `balance` and `lockedBalance` upon successful disbursement, or reverts `lockedBalance` to available balance if rejected.

### 3.2 Webhook Signature Verification
- Inbound payment notifications from JazzCash and Easypaisa are validated using cryptographic HMAC hash signatures.
- All incoming webhooks, signatures, and payload parameters are archived in `PaymentWebhookLog` for audit inspection and fraud detection.

---

## 4. Network, HTTP & Input Security

### 4.1 Global Exception Sanitization
- An application-wide `GlobalExceptionFilter` intercepts all thrown errors.
- In **development**, full error details are included for developer productivity.
- In **production** (`NODE_ENV === 'production'`), error responses omit internal error messages, stack traces, and database table references, returning clean, non-revealing messages to prevent reconnaissance attacks:
  ```typescript
  response.status(status).json({
    statusCode: status,
    timestamp: new Date().toISOString(),
    path: request.url,
    message,
    ...(process.env.NODE_ENV !== 'production' ? { errorDetail: errMsg } : {}),
  });
  ```

### 4.2 Helmet & HTTP Security Headers
- Helmet middleware is enabled globally in `main.ts` to configure security headers:
  - `X-DNS-Prefetch-Control`
  - `X-Frame-Options: SAMEORIGIN`
  - `Strict-Transport-Security` (HSTS)
  - `X-Download-Options`
  - `X-Content-Type-Options: nosniff`
  - `X-XSS-Protection`

### 4.3 Strict Request Validation & Whitelisting
- NestJS `ValidationPipe` enforces:
  - `whitelist: true`: Drops any properties not explicitly defined in the DTO class.
  - `forbidNonWhitelisted: true`: Immediately rejects payloads with unmapped fields.
  - `transform: true`: Automatically coerces types into declared primitives.
- Payload body size is bounded to 15MB for JSON and URL-encoded bodies.

### 4.4 SQL & NoSQL Injection Protection
- The application uses **Prisma ORM** which executes parameterized SQL queries against PostgreSQL. Raw string interpolation in queries is strictly prohibited.

---

## 5. Secret Management & Deployment Hygiene

- **No Secrets in Version Control**: `.env` and `.env.local` are excluded via `.gitignore`.
- **Environment Variables**: Production secrets (`DATABASE_URL`, `JWT_SECRET`, email API keys) are configured directly in the Vercel project settings.
- **Maintenance Script Isolation**: Administrative maintenance scripts (such as temporary test-user seeders) are located in `scratch/` or `scripts/` and excluded from production builds.
- **Dependency Auditing**: Regularly run `npm audit` to detect and patch vulnerabilities in npm packages.
