# Known Issues & Technical Considerations

This document records architectural nuances, environment limitations, and recommended future enhancements for the incoming development team.

---

## 1. Serverless Runtime & WebSockets

### Issue / Context
The backend is architected for deployment on **Vercel Serverless Functions**. Serverless runtimes are stateless and terminate function containers between requests.
- **Impact**: Persistent TCP-level WebSocket gateways (such as `@nestjs/websockets` with `ws` or `socket.io`) cannot maintain persistent bidirectional sockets without an external WebSocket broker.
- **Current Solution**: Real-time communication is handled through:
  1. Standard HTTP REST endpoints with short polling on active conversation views.
  2. Web Push Notifications (`/api/push`) using VAPID keys for background alerts.
- **Recommended Enhancement**: If instant sub-second chat updates are required at scale, connect an external managed real-time broker such as **Pusher Channels**, **Ably**, or **Supabase Realtime**.

---

## 2. Neon Database Connection Pooling

### Issue / Context
The application connects to a cloud-hosted Neon PostgreSQL database. In serverless environments, high concurrency can rapidly spawn new lambda instances and exhaust PostgreSQL's maximum connection limit (`max_connections`).
- **Current Solution**: Prisma Client manages an internal connection pool with configured timeouts.
- **Recommended Practice**:
  - Always use the **Neon Pooled Connection String** (host ending with `-pooler.neondb.tech`) in production `DATABASE_URL`.
  - Append connection pooling parameters to the URL (e.g. `?pgbouncer=true&connection_limit=10`).

---

## 3. File Attachments & Data URIs

### Issue / Context
Contract deliverables and avatar uploads currently allow Base64 Data URIs stored directly or handled in memory up to 3MB (contracts) and 5MB (avatars).
- **Impact**: Storing large file attachments directly in PostgreSQL can lead to rapid database storage bloat and slower table scan times over large datasets.
- **Recommended Enhancement**:
  - Integrate an S3-compatible cloud object store (such as **Cloudflare R2**, **AWS S3**, or **Supabase Storage**).
  - Use pre-signed upload URLs: clients upload files directly to the bucket, and the backend stores only the resulting public or signed CDN URL in the database.

---

## 4. Local Webhook Testing for Pakistani Gateways

### Issue / Context
Payment gateways (JazzCash, Easypaisa) send Instant Payment Notifications (IPN) and server-to-server callbacks asynchronously after a transaction completes.
- **Limitation**: Gateways cannot send webhooks to `localhost:3000`.
- **Local Workaround**:
  - Use a secure tunneling service such as **ngrok** (`ngrok http 3000`) or **cloudflared** to expose a public HTTPS callback URL during local testing.
  - Alternatively, use the built-in sandbox simulation endpoint (`POST /api/payments/sandbox/simulate`) to trigger end-to-end checkout completion in non-production environments.

---

## 5. Distributed Cache & Rate Limiting

### Issue / Context
Email verification cooldown (60 seconds) is currently tracked using the `emailVerifyLastSentAt` database timestamp on the `User` record.
- **Impact**: While reliable and serverless-compatible, tracking rapid rate-limits in PostgreSQL adds slight write overhead to the user table.
- **Recommended Enhancement**: For high-volume API rate limiting (e.g., brute-force attack mitigation on `/api/auth/login`), introduce an external in-memory cache such as **Upstash Redis** (`@upstash/ratelimit`).

---

## 6. Email Provider Configuration

### Issue / Context
The `MailService` sequentially attempts delivery across configured providers:
1. Resend (`RESEND_API_KEY`)
2. SendGrid (`SENDGRID_API_KEY`)
3. Brevo (`BREVO_API_KEY`)
4. Custom SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`)
- **Fallback Behavior**: If none of these variables are configured in the environment, email sending is skipped and the OTP is logged to the console (designed for local development).
- **Production Requirement**: Ensure that at least one valid provider key (Resend recommended) is configured in Vercel environment variables before promoting to production.
