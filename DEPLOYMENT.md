# AERO (Ambulance Emergency Routing Operation) — Production Deployment Guide

This document is the authoritative, comprehensive deployment specification for the AERO mission-critical emergency corridor and dispatch system.

---

## 1. Recommended Hosting Architectures

AERO consists of a modern React 19 + Vite frontend and a high-performance Node.js / Express backend with Supabase PostgreSQL, PostGIS, and Realtime integration. Choose one of two recommended deployment architectures based on your infrastructure preference:

### Architecture Option A: Decoupled Deployments (Recommended for Scale)
- **Frontend**: **Vercel** or **Cloudflare Pages** or **Netlify**
  - Edge CDN distribution for fast map asset rendering.
  - Automatic single-page application (SPA) routing via `vercel.json` or `public/_redirects`.
- **Backend API**: **Render** (Web Service), **Railway**, or **Fly.io**
  - Continuous Node.js runtime for real-time corridor calculations, Groq AI inference, and TomTom traffic proxies.
  - Automatic HTTPS and zero-downtime rolling deploys.
- **Database & Auth**: **Supabase** Managed PostgreSQL & Auth.

### Architecture Option B: Unified Single-Container Deployment (Recommended for Cost Simplicity)
- **Full-Stack Container / Host**: **Render Web Service**, **Railway**, **Fly.io**, or **Docker on VPS**
  - The frontend is built with `npm run build` producing static assets in `dist/`.
  - The Node.js Express server (`server/index.js`) serves `dist/` directly with SPA fallback (`/*` -> `dist/index.html`) while handling all `/api/*` and `/health` routes on a single domain.
  - Eliminates cross-origin CORS complexity entirely because frontend and backend share the exact same origin.

---

## 2. Environment Variables & Secret Segregation

Variables are strictly segregated between **Client-Side (Public Bundles)** and **Server-Side (Private Secrets)**. Never mix them.

### A. Frontend Environment Variables
Set these in your frontend host dashboard (e.g. Vercel / Netlify) or in `.env` before building:

| Variable Name | Required | Target / Exposure | Description |
| :--- | :---: | :--- | :--- |
| `VITE_SUPABASE_URL` | **Yes** | Client Bundle (Public) | The HTTPS project URL from Supabase Dashboard (`https://<ref>.supabase.co`). |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | **Yes** | Client Bundle (Public) | Supabase anonymous / public publishable key. RLS enforces all table access. |
| `VITE_BACKEND_URL` | Optional | Client Bundle (Public) | Base URL of the backend (e.g., `https://aero-api.onrender.com`). **Leave empty** if using Unified Single Container or same-domain proxy. |
| `VITE_TOMTOM_API_KEY` | **Yes** | Client Bundle (Public) | TomTom Map display, vector tiles, traffic flow layer, and POI search key. |
| `VITE_ROUTING_PROVIDER` | Optional | Client Bundle (Public) | Primary routing provider (`tomtom`, `osrm`, or `openrouteservice`). Defaults to `tomtom`. |

### B. Backend Environment Variables
Set these in your server host dashboard (e.g. Render / Railway) or runtime environment:

| Variable Name | Required | Target / Exposure | Description |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | **Yes** | Server Runtime (Private) | Must be set to `production`. Guards mock tokens and enables secure error formatting. |
| `PORT` | **Yes** | Server Runtime (Auto) | Listening port. Injected automatically by Render, Railway, Fly.io, or Heroku (default: `3001`). |
| `ALLOWED_ORIGINS` | **Yes** | Server Runtime (Private) | Comma-separated list of allowed frontend origins for CORS (e.g., `https://aero.vercel.app,https://aero-app.com`). |
| `GROQ_API_KEY` | **Yes** | Server Runtime (Private) | Private API key for clinical AI triage summaries, protocol guidance, and dispatch summaries. |
| `GROQ_MODEL` | Optional | Server Runtime (Private) | LLM model name (default: `openai/gpt-oss-120b`). |
| `TOMTOM_API_KEY` | **Yes** | Server Runtime (Private) | Server-side key for traffic-aware corridor routing calculations and hospital search queries. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Server Runtime (Private) | Privileged Supabase key for administrative operations. **NEVER expose to frontend or prefix with `VITE_`**. |

> [!CAUTION]
> **Secret Hygiene**: Real secrets must never be committed to Git. The `.gitignore` file enforces exclusion of `.env` and `.env.*`. If any API key was historically committed or exposed, rotate it immediately in the respective provider dashboard.

---

## 3. Supabase Database Configuration & Migration Steps

All database objects, schemas, indexes, and Row Level Security (RLS) policies are codified in:
`supabase/migrations/20261023_production_deployment_schema.sql`

### Migration Execution Procedure
1. Log into your [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to your project -> **SQL Editor** -> **+ New Query**.
3. Copy the entire contents of [`supabase/migrations/20261023_production_deployment_schema.sql`](supabase/migrations/20261023_production_deployment_schema.sql) and paste them into the editor.
4. Click **Run**.
5. Verify in **Table Editor** that the following tables exist with RLS enabled:
   - `public.profiles` (User metadata and role assignments: `AMBULANCE`, `POLICE`, `HOSPITAL`, `ADMIN`).
   - `public.emergency_incidents` (P0/P1 lifecycle records, coordinates, destination hospital).
   - `public.hospitals` (Emergency department facilities, ER capacity, trauma capabilities).
   - `public.clinical_observations` (Vital signs, chief complaints, paramedic observations).
   - `public.police_route_coordination` (Intersection clearance checkpoints, police clearances).
   - `public.ai_conversations` (Triage decision logs and dispatch AI interactions).

### Critical Database Caveats
> [!IMPORTANT]
> - **PostGIS System Tables (`spatial_ref_sys`)**: Do NOT execute `ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;`. This table is owned by the internal `supabase_admin` role; attempting to alter it will fail with error `42501: must be owner of table spatial_ref_sys`. PostGIS system reference data is read-only for public queries and completely secure.
> - **Supabase Generated Columns**: In `auth.users`, the column `confirmed_at` is a generated column. When updating email confirmations directly via SQL, update `email_confirmed_at = NOW()`; attempting to write to `confirmed_at` will fail with error `428C9`.
> - **Realtime Publication**: Ensure tables are included in `supabase_realtime`:
>   ```sql
>   ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_incidents, public.clinical_observations, public.police_route_coordination, public.hospitals;
>   ```

---

## 4. Supabase Authentication & URL Configuration

Email and password authentication is the active, verified authentication method for production.

### Step 1: Configure URL Redirects in Supabase Dashboard
1. Go to **Authentication** -> **URL Configuration**.
2. Set **Site URL** to your primary production domain:
   - Example: `https://aero-emergency.vercel.app`
3. Add the following to **Redirect URLs**:
   - `https://your-production-domain.com/auth/callback`
   - `https://your-production-domain.com/login`
   - `http://localhost:5173/auth/callback` *(for local development)*
   - `http://localhost:5173/login`
   - `http://<your-lan-ip>:5173/auth/callback` *(for mobile device testing over LAN)*

### Step 2: Configure Production Custom SMTP (Avoid Rate Limits)
By default, Supabase's built-in email service is limited to 3-4 emails per hour for development and triggers rate-limiting (`429 email rate limit exceeded`). For production:
1. In Supabase Dashboard, go to **Project Settings** -> **Authentication** -> **SMTP Settings**.
2. Enable **Enable Custom SMTP**.
3. Enter your enterprise SMTP provider credentials (e.g. Resend, SendGrid, Amazon SES, or Postmark):
   - **Sender email**: `no-reply@your-domain.com`
   - **Sender name**: `AERO Emergency Dispatch`
   - **Host**: `smtp.resend.com` (or provider host)
   - **Port**: `587` or `465`
   - **Username** & **Password**: *Provided by your SMTP vendor*
4. Test delivery to verify that registration confirmation and password recovery emails are delivered reliably.

---

## 5. Deployment Step-by-Step Instructions

### Option A: Deploying Frontend to Vercel & Backend to Render

#### 1. Backend Deployment (Render)
1. In the [Render Dashboard](https://dashboard.render.com), click **New +** -> **Web Service**.
2. Connect your Git repository.
3. Configure the service:
   - **Name**: `aero-backend`
   - **Environment**: `Node`
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start` (or `node server/index.js`)
4. In **Environment Variables**, add:
   - `NODE_ENV`: `production`
   - `PORT`: `10000` (or leave default, Render sets this automatically)
   - `ALLOWED_ORIGINS`: `https://your-frontend-domain.vercel.app`
   - `TOMTOM_API_KEY`: *(your TomTom key)*
   - `GROQ_API_KEY`: *(your Groq API key)*
   - `GROQ_MODEL`: `openai/gpt-oss-120b`
5. Deploy and note your backend URL: `https://aero-backend.onrender.com`.

#### 2. Frontend Deployment (Vercel)
1. In the [Vercel Dashboard](https://vercel.com), click **Add New...** -> **Project**.
2. Import your Git repository.
3. Configure project settings:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. In **Environment Variables**, add:
   - `VITE_SUPABASE_URL`: `https://<your-project-ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: *(your Supabase anon key)*
   - `VITE_TOMTOM_API_KEY`: *(your TomTom key)*
   - `VITE_BACKEND_URL`: `https://aero-backend.onrender.com`
5. Deploy. Vercel will build the frontend and serve it globally with SPA routing managed by `vercel.json`.

---

### Option B: Deploying Unified Container to Render / Railway

In this single-origin configuration, the Express server serves both API endpoints and the compiled frontend:
1. Set the **Build Command** to: `npm install && npm run build`
2. Set the **Start Command** to: `npm start`
3. Add the backend environment variables (`NODE_ENV=production`, `TOMTOM_API_KEY`, `GROQ_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TOMTOM_API_KEY`).
4. `server/index.js` automatically detects `dist/index.html` and serves the frontend on the root URL while servicing all `/api/*` and `/health` requests seamlessly on the same port.

---

## 6. Build & Health-Check Verification

### Build Verification
Always verify the production build locally before triggering a deployment:
```bash
npm run build
```
Expected output:
```text
vite v8.2.2 building client environment for production...
✓ 4218 modules transformed.
dist/index.html
dist/assets/...
✓ built in <time>
```

### Health-Check Endpoints
The backend provides dedicated health-check endpoints for uptime monitors, container orchestrators, and cloud load balancers:
- **`GET /health`** (Standard cloud load-balancer endpoint)
- **`GET /api/health`** (Detailed service status)

**Expected Response (HTTP 200 OK)**:
```json
{
  "status": "ok",
  "service": "aero-backend",
  "version": "1.0.0",
  "uptime": 128.4,
  "timestamp": "2026-10-21T07:15:00.000Z"
}
```

---

## 7. Production Troubleshooting Guide

| Issue / Symptom | Root Cause | Resolution |
| :--- | :--- | :--- |
| **404 Not Found on Page Refresh** (e.g. `/ambulance`, `/login`) | Static hosting server trying to locate a physical file instead of falling back to SPA entry point. | Ensure `public/_redirects` (`/*  /index.html  200`) or `vercel.json` rewrite is in place on your host. |
| **CORS Error: Origin Not Allowed** | The frontend origin is not in the backend's `ALLOWED_ORIGINS` variable. | Add your exact frontend domain (including protocol `https://` and without trailing slash) to `ALLOWED_ORIGINS` in your backend dashboard. |
| **Login returns 400: Invalid login credentials** | Password mistyped, or account email has not been confirmed via Supabase email. | Verify account email confirmation status. If testing, confirm the user via Supabase Dashboard -> Users, or resend confirmation. |
| **Password reset returns 429: Rate limit exceeded** | Built-in Supabase email rate limit triggered by multiple requests within an hour. | Wait for the cooldown window (60s client-side cooldown enforced), or configure a Custom SMTP Provider in Supabase. |
| **Database error 42501 (Permission Denied)** | Attempted to alter `spatial_ref_sys` or user lacks RLS permissions for a table. | Confirm user profile has the appropriate role (`AMBULANCE`, `POLICE`, `HOSPITAL`, or `ADMIN`) matching RLS policies. |
| **Realtime Subscriptions Disconnect** | Network drop or WebSocket idle timeout. | AERO's `realtimeService.ts` automatically re-establishes subscriptions with exponential backoff on reconnect. |

---

## 8. Rollback & Secret-Rotation Procedures

### Application Rollback
- **Vercel / Netlify**: In the deployment history dashboard, select the previous stable deployment and click **Promote to Production** (instant zero-downtime rollback).
- **Render / Railway**: Select the previous healthy build commit and click **Rollback**.

### Secret Rotation Protocol
If an API key is ever compromised or rotated for regular maintenance:
1. **Supabase Anon Key**:
   - In Supabase Dashboard -> **Project Settings** -> **API**, click **Rotate Key**.
   - Immediately update `VITE_SUPABASE_PUBLISHABLE_KEY` in your frontend host environment and trigger a redeployment.
2. **Groq API Key**:
   - Generate a new key in [Groq Console](https://console.groq.com/keys).
   - Update `GROQ_API_KEY` in your backend host environment variables. Restart the backend process.
   - Revoke the old key in Groq Console.
3. **TomTom API Key**:
   - Generate a new key in [TomTom Developer Portal](https://developer.tomtom.com/).
   - Update `VITE_TOMTOM_API_KEY` (frontend) and `TOMTOM_API_KEY` (backend).
   - Redeploy frontend and restart backend.

---

## 9. Future Google Auth Checklist (NOT IMPLEMENTED — AFTER DEPLOYMENT)

> [!WARNING]
> **STATUS: NOT IMPLEMENTED IN CURRENT PRODUCTION RELEASE.**
> Per explicit requirements, Google Sign-In and Google OAuth are intentionally deferred until after initial production deployment. The architecture (`src/lib/supabase.ts`, `AuthCallbackPage.tsx`, and `profiles` table) is prepared to support Google OAuth without structural refactoring. Follow this checklist **only after** production deployment is live and verified.

### Phase 1: Google Cloud Console Configuration
- [ ] 1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
- [ ] 2. Create a project named `AERO Emergency Operations` (or select your production organization).
- [ ] 3. Navigate to **APIs & Services** -> **OAuth consent screen**.
- [ ] 4. Select **External** (or **Internal** if using Google Workspace for emergency personnel).
- [ ] 5. Fill in App Name (`AERO Emergency Routing`), User support email, and Developer contact information.
- [ ] 6. Under **Scopes**, add `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile`.
- [ ] 7. Navigate to **APIs & Services** -> **Credentials** -> **+ Create Credentials** -> **OAuth client ID**.
- [ ] 8. Select **Web application**.
- [ ] 9. Under **Authorized JavaScript origins**, add:
  - `https://your-production-domain.com`
  - `https://<your-supabase-project-ref>.supabase.co`
- [ ] 10. Under **Authorized redirect URIs**, add:
  - `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
- [ ] 11. Save and copy the generated **Client ID** and **Client Secret**.

### Phase 2: Supabase Dashboard Provider Activation
- [ ] 1. Log into your [Supabase Dashboard](https://supabase.com/dashboard).
- [ ] 2. Navigate to **Authentication** -> **Providers** -> **Google**.
- [ ] 3. Toggle **Enable Google provider** to ON.
- [ ] 4. Paste your **Client ID** and **Client Secret** from Step 1.
- [ ] 5. Save changes.

### Phase 3: Frontend Client Integration Activation
- [ ] 1. In `src/features/auth/pages/LoginPage.tsx` and `RegisterPage.tsx`, enable the Google Sign-In UI button.
- [ ] 2. Wire the button click handler to trigger:
  ```typescript
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });
  ```
- [ ] 3. In `AuthCallbackPage.tsx`, verify that new Google OAuth users are routed to complete their departmental role assignment (`AMBULANCE`, `POLICE`, `HOSPITAL`) if no profile entry exists in `public.profiles`.
- [ ] 4. Test OAuth sign-in flow on desktop and mobile browsers.
