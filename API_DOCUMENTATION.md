# API Documentation

The Paklance Backend is built with NestJS and exposes RESTful endpoints with a global route prefix `/api`. Interactive OpenAPI documentation and test sandbox are available via Swagger UI at `/api/docs`.

---

## 1. Authentication & Security Header

All secured endpoints require an HTTP Bearer JWT token in the `Authorization` header:

```http
Authorization: Bearer <your_access_token>
```

Tokens are valid for 7 days (`7d`) and contain claims `{ sub: string, email: string, role: 'ADMIN' | 'CLIENT' | 'SPECIALIST' }`.

---

## 2. Authentication Module (`/api/auth`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Register a new user (`email`, `password`, `name`, `role`). Dispatches 6-digit email OTP. |
| `POST` | `/api/auth/verify-email` | Public | Verify 6-digit email OTP. Activates user account and returns `{ user, accessToken }`. |
| `POST` | `/api/auth/resend-verification` | Public | Resend email OTP. Rate-limited to once per 60 seconds. |
| `POST` | `/api/auth/login` | Public | Authenticate with email and password. Returns `{ user, accessToken }`. Rejects unverified accounts. |
| `POST` | `/api/auth/google` | Public | Google OAuth sign-in/sign-up via OAuth `code` or Google ID token `credential`. |

---

## 3. Current User & Profile Management (`/api/me` & `/api/profiles`)

### Me Endpoints (`/api/me`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/me` | Public / Token | Returns currently authenticated user or `{ user: null }` if unauthenticated. |
| `PATCH` | `/api/me` | Authenticated | Update user bio, headline, skills, city, country, rate, avatarUrl, availability. |
| `GET` | `/api/me/profile` | Authenticated | Get full profile including portfolio items and summary statistics. |
| `PUT` | `/api/me/profile` | Authenticated | Idempotent update/creation of public profile and skills. |
| `POST` | `/api/me/portfolio` | Authenticated | Add a portfolio/experience/education item (`title`, `subtitle`, `url`, `amount`, `startYear`, `endYear`, `description`, `kind`). |
| `DELETE` | `/api/me/portfolio/:id`| Authenticated | Delete a portfolio item owned by the user. |
| `DELETE` | `/api/me/photo` | Authenticated | Remove profile avatar photo. |

### Public Profiles (`/api/profiles`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/profiles/search` | Public | Search and filter specialists by search query, skills, category, availability, hourly rate range. |
| `GET` | `/api/profiles/:id` | Public | Fetch public specialist profile, reviews, and portfolio items. |
| `PATCH` | `/api/profiles/me` | Authenticated | Update profile details (mirrors `/api/me`). |
| `PUT` | `/api/profiles/me` | Authenticated | Update profile details (PUT alias). |
| `POST` | `/api/profiles/me/portfolio` | Authenticated | Add portfolio item. |
| `DELETE` | `/api/profiles/me/portfolio/:id` | Authenticated | Delete portfolio item. |

---

## 4. Jobs & Proposals (`/api/jobs` & `/api/proposals`)

### Jobs
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/jobs` | `CLIENT`, `ADMIN` | Post a new job (`title`, `description`, `budget`, `skills`). |
| `GET` | `/api/jobs` | Public | Browse and search active jobs with pagination and category filters. |
| `GET` | `/api/jobs/:id` | Public | Retrieve single job post and client information. |
| `PATCH` | `/api/jobs/:id` | `CLIENT` (Owner) | Edit job details. |
| `DELETE` | `/api/jobs/:id` | `CLIENT` (Owner) | Delete job post. |

### Proposals
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/proposals` | `SPECIALIST` | Submit a proposal on an open job (`jobId`, `bidAmount`, `deliveryDays`, `coverLetter`). |
| `GET` | `/api/proposals/job/:jobId` | `CLIENT` (Owner) | Get all proposals submitted to a specific job post. |
| `GET` | `/api/proposals/my` | `SPECIALIST` | Get all proposals submitted by the authenticated specialist. |
| `PATCH` | `/api/proposals/:id/accept` | `CLIENT` (Owner) | Accept proposal, reject competing proposals, and initialize draft contract. |
| `PATCH` | `/api/proposals/:id/reject` | `CLIENT` (Owner) | Reject proposal. |
| `PATCH` | `/api/proposals/:id/withdraw` | `SPECIALIST` (Owner)| Withdraw submitted proposal. |

---

## 5. Contracts, Milestones & Escrow (`/api/contracts`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/contracts` | `CLIENT` | Create contract with milestones and auto-provision escrow account. |
| `GET` | `/api/contracts` | Authenticated | Retrieve user contracts (as Client or Specialist). |
| `GET` | `/api/contracts/:id` | Participant | Retrieve contract details, milestone statuses, and escrow balance. |
| `POST` | `/api/contracts/:id/fund` | `CLIENT` | Fund escrow for the contract from wallet or gateway balance. |
| `PATCH` | `/api/contracts/milestones/:milestoneId/release` | `CLIENT` | Release milestone funds from escrow directly to specialist's wallet balance. |
| `GET` | `/api/contracts/:id/files` | Participant | List files attached to a contract. |
| `POST` | `/api/contracts/:id/files` | Participant | Upload work deliverable or agreement attachment (up to 3MB, PDF/PNG/JPG/ZIP). |
| `GET` | `/api/contracts/:id/files/:fileId` | Participant | Download attached contract deliverable. |

---

## 6. Payments & Checkout Gateways (`/api/payments`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/payments/checkout/initiate` | `CLIENT` | Initiate payment session via JazzCash, Easypaisa, Raast, or Bank Transfer. Returns redirect URL/payload. |
| `GET` | `/api/payments/status/:referenceId` | Authenticated | Check status of transaction by unique reference ID. |
| `POST` | `/api/payments/jazzcash/callback` | Public (Webhook) | JazzCash Instant Payment Notification (IPN) webhook and callback handler. Validates HMAC signature. |
| `POST` | `/api/payments/easypaisa/callback` | Public (Webhook) | Easypaisa IPN webhook and return callback handler. |
| `POST` | `/api/payments/sandbox/simulate` | Authenticated | Simulate gateway approval or decline (available in staging/test environments). |

---

## 7. Wallet & Specialist Payouts (`/api/wallet`)

### Wallet Operations
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/wallet/balance` | Authenticated | Get current total balance, locked balance, and available balance. |
| `POST` | `/api/wallet/deposit` | Authenticated | Credit funds to wallet. |
| `POST` | `/api/wallet/withdraw` | Authenticated | Request withdrawal (Min PKR 500). Verifies available balance and locks funds in 2-phase withdrawal state. |
| `GET` | `/api/wallet/withdrawals` | Authenticated | Get withdrawal request history and settlement status. |
| `PATCH` | `/api/wallet/withdrawals/:id/cancel` | Authenticated (Owner)| Cancel pending withdrawal and immediately restore locked funds. |
| `GET` | `/api/wallet/transactions` | Authenticated | Get chronological ledger log of all wallet transactions. |

### Payout Methods (`/api/wallet/payout-methods`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/wallet/payout-methods` | Authenticated | Add payout method (`BANK`, `JAZZCASH`, `EASYPAISA`, `RAAST`) with account title and account number. |
| `GET` | `/api/wallet/payout-methods` | Authenticated | List saved payout methods. |
| `PATCH` | `/api/wallet/payout-methods/:id/default`| Authenticated | Set payout method as default. |
| `DELETE` | `/api/wallet/payout-methods/:id` | Authenticated | Remove saved payout method. |

---

## 8. Real-time Messaging (`/api/messaging`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/messaging/send` | Authenticated | Send direct message (`receiverId` or `conversationId`, `content`). |
| `GET` | `/api/messaging/conversations` | Authenticated | Get user conversations with latest message snippet and unread counts. |
| `GET` | `/api/messaging/conversations/:id/messages` | Participant | Get full message thread; automatically marks unread messages as read and delivered. |
| `POST` | `/api/messaging/sync-delivered` | Authenticated | Mark pending incoming messages as delivered. |
| `DELETE` | `/api/messaging/messages/:id` | Sender | Unsend/delete message. |

---

## 9. Reviews, Disputes & Verification

### Reviews (`/api/reviews`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/reviews` | Contract Party | Leave contract feedback and 1-5 star rating for the other party. |
| `GET` | `/api/reviews/user/:userId` | Public | List reviews and aggregate rating received by a user. |

### Disputes (`/api/disputes`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/disputes` | Contract Party | Raise dispute against a contract (`contractId`, `reason`). Freezes milestone actions. |
| `GET` | `/api/disputes/contract/:contractId` | Participant / Admin | View disputes raised for a contract. |
| `PATCH` | `/api/disputes/:id/resolve` | `ADMIN` | Resolve dispute with resolution notes. |

### Specialist Identity Verification (`/api/verification`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/verification/apply` | `SPECIALIST` | Submit identity document verification application. |
| `GET` | `/api/verification/status` | `SPECIALIST` | Check current verification status (`PENDING`, `APPROVED`, `REJECTED`). |

### Media Uploads (`/api/uploads`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/uploads/image` | Authenticated | Upload image (avatar, portfolio banner). Supports JPEG, PNG, WebP up to 5MB. Returns Data URL / storage URL. |

---

## 10. Admin Financial Controls & Platform Governance (`/api/admin`)

All `/api/admin` endpoints require a Bearer token with role `ADMIN`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/stats` | High-level system statistics (user count, active jobs, contracts, open disputes, pending verifications). |
| `GET` | `/api/admin/users` | List all registered users with role and timestamps. |
| `GET` | `/api/admin/users/:id` | Detailed user record with bio, skills, and activity. |
| `GET` | `/api/admin/disputes` | List all open and resolved platform disputes. |
| `GET` | `/api/admin/verifications` | List all pending identity verification submissions. |
| `GET` | `/api/admin/financials/stats` | Aggregated escrow balances, completed payments volume, pending/failed withdrawals volume. |
| `GET` | `/api/admin/financials/payments` | Comprehensive transaction records across payment gateways. |
| `GET` | `/api/admin/financials/webhooks` | Audit log of recent gateway webhook payloads, signatures, and processing status. |
| `GET` | `/api/admin/financials/withdrawals` | All withdrawal requests submitted by specialists. |
| `PATCH` | `/api/admin/financials/withdrawals/:id/process` | Process withdrawal action: `PROCESSING`, `COMPLETED` (atomically deducts balance), or `FAILED` (restores funds). |
| `POST` | `/api/admin/maintenance/cleanup-test-data` | Atomic maintenance endpoint for removing disposable test accounts while protecting production records. |
| `POST` | `/api/admin/maintenance/delete-duplicate-job` | Clean up duplicate job postings. |

---

## 11. Error Responses & Format

All error responses adhere to the standard NestJS exception schema:

```json
{
  "statusCode": 400,
  "timestamp": "2026-10-08T14:35:00.000Z",
  "path": "/api/wallet/withdraw",
  "message": "Minimum withdrawal amount is PKR 500"
}
```

In non-production environments, an optional `errorDetail` field is provided for debugging. In `production`, internal stack traces and database errors are sanitized to prevent information leakage.
