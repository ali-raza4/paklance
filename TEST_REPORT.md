# Test Report

This document records the results, execution metrics, and coverage analysis of the automated test suite for the Paklance backend.

---

## 1. Executive Summary

| Metric | Result | Status |
|---|---|---|
| **Test Framework** | Jest 29 + ts-jest | Supported |
| **Total Test Suites** | 10 Passed / 10 Total | **100% Pass** |
| **Total Test Cases** | 79 Passed / 79 Total | **100% Pass** |
| **Failed Tests** | 0 | None |
| **Execution Duration** | ~6.8 seconds | High Performance |
| **Compilation Status** | Clean (0 TypeScript errors) | Verified |

---

## 2. Unit Test Suite Results

The automated unit tests validate core business logic, input validation, role checks, and database transaction integrity across the application.

```text
PASS src/app.controller.spec.ts
PASS src/auth/auth.verification.spec.ts
PASS src/proposals/proposals.service.spec.ts
PASS src/contracts/contracts.service.spec.ts
PASS src/messaging/messaging.service.spec.ts
PASS src/auth/auth.google.spec.ts
PASS src/auth/auth.regression.spec.ts
PASS src/wallet/wallet.withdrawal.spec.ts
PASS src/uploads/uploads.controller.spec.ts
PASS src/me/me.controller.spec.ts

Test Suites: 10 passed, 10 total
Tests:       79 passed, 79 total
Snapshots:   0 total
Time:        6.792 s
Ran all test suites.
```

---

## 3. Detailed Test Suite Breakdown

### 3.1 Authentication & Security (`auth.regression.spec.ts` & `auth.verification.spec.ts` & `auth.google.spec.ts`)
- **JWT Secret Guard**:
  - Validates that server startup rejects missing, empty, or whitespace-only `JWT_SECRET`.
  - Ensures hardcoded fallback secrets are forbidden.
  - Verifies token signature verification and rejection of altered tokens.
- **Email OTP Registration & Activation**:
  - Unverified accounts cannot authenticate via standard login (HTTP 401).
  - Validates 6-digit cryptographic OTP generation and email dispatch.
  - Verification activates account, purges OTP fields, and returns JWT.
  - Enforces 60-second cooldown rate limit on resending verification emails.
- **Google OAuth Integration**:
  - Validates Google Client ID configuration verification.
  - Authenticates existing users upon Google ID token validation.
  - Auto-provisions new users with securely generated hashed passwords and verified status.
  - Rejects unverified Google accounts or tokens with mismatched audience IDs.

### 3.2 Wallet & Two-Phase Withdrawals (`wallet.withdrawal.spec.ts`)
- **DTO Validation**:
  - Validates `BANK`, `JAZZCASH`, `EASYPAISA`, and `RAAST` channels.
  - Rejects amounts below minimum PKR 500 or non-positive values.
  - Validates payout channel and type compatibility.
- **Transaction & Balance Logic**:
  - Ensures withdrawals only proceed if `availableBalance` (`balance - lockedBalance`) is sufficient.
  - Enforces funds reservation into `lockedBalance` upon request creation.
  - Validates ownership check on user payout methods.
  - Verifies atomic funds restoration upon request cancellation.

### 3.3 Proposals & Contracts (`proposals.service.spec.ts` & `contracts.service.spec.ts`)
- **Proposals**:
  - Validates client-only access for viewing submitted proposals.
  - Accepts proposal, updates job state, and auto-generates contract draft.
  - Rejects non-owners attempting to review or accept proposals.
- **Contracts & Deliverables**:
  - Verifies file upload security (enforces 3MB file size limit and allowed MIME types).
  - Ensures contract attachments can only be accessed or uploaded by verified participants.

### 3.4 User Profiles & Identity (`me.controller.spec.ts`)
- Validates retrieval of authenticated user details.
- Validates profile updates across `skills`, `bio`, `headline`, `city`, `country`, `hourlyRate`, and `avatarUrl`.
- Tests adding, updating, and removing portfolio items and profile photos.

### 3.5 Messaging & Communication (`messaging.service.spec.ts`)
- Verifies conversation isolation between sender and receiver.
- Tests unread message status update to `read` and `delivered`.
- Tests message unsend functionality (guarantees users can only unsend their own messages).

### 3.6 Media Uploads (`uploads.controller.spec.ts`)
- Validates upload processing for JPEG, PNG, and WebP formats.
- Rejects non-image mime types and uploads larger than 5MB.

---

## 4. End-to-End (E2E) Test Suite Catalog

The repository includes a comprehensive E2E test suite under `/test` that simulates full HTTP request/response lifecycles:

| Suite | File | Coverage Areas |
|---|---|---|
| **Auth** | `test/auth.e2e-spec.ts` | Registration, login, OTP verification, token refresh |
| **Security** | `test/security.e2e-spec.ts` | Missing tokens, invalid signatures, passwordHash leak prevention, data isolation |
| **Admin Controls** | `test/admin.e2e-spec.ts` | Admin authentication, user listing, disputes oversight |
| **Admin Financials** | `test/admin-financials.e2e-spec.ts` | Financial stats aggregation, withdrawal settlement (`PROCESSING`, `COMPLETED`, `FAILED`) |
| **Jobs** | `test/jobs.e2e-spec.ts` | Job posting, public search, filtering, update & deletion |
| **Proposals** | `test/proposals.e2e-spec.ts` | Proposal submission, client review, acceptance flow |
| **Payments** | `test/payments.e2e-spec.ts` | Gateway checkout initiation, webhook processing, signature validation |
| **Wallet** | `test/wallet.e2e-spec.ts` | Balance checks, deposit simulation, two-phase withdrawal request & cancellation |
| **Messaging** | `test/messaging.e2e-spec.ts` | Thread creation, messaging exchange, unread sync, message deletion |
| **Profiles** | `test/profiles.e2e-spec.ts` | Public profile directory, filtering, portfolio management |
| **Uploads** | `test/uploads.e2e-spec.ts` | File upload validation and payload encoding |

---

## 5. How to Run the Tests

```bash
# Execute unit test suite
npm test

# Run tests in verbose mode
npm test -- --verbose

# Run with coverage report
npm run test:cov

# Run end-to-end integration tests
npm run test:e2e
```
