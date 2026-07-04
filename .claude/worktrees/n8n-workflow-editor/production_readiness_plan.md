# Production Readiness & Architecture Roadmap

As the system evolves from a highly functional prototype into a production-grade, scalable cloud application, several architectural shifts are required. This document outlines the top 5 high-impact transitions necessary for enterprise scale, security, and observability.

---

## 1. 🚨 Eradicate Local File I/O for State & Data
**The Problem:** 
Currently, the Next.js dashboard writes configuration to `data/agent_config.json`, and the Python agents read from it. Local CSV/JSON files (`leads.csv`, `call_logs.json`, `workflows.json`) are also used. In modern cloud hosting (Vercel, AWS ECS, Docker), the local filesystem is *ephemeral*. Data is wiped on container restarts, scaling creates out-of-sync files, and race conditions occur during simultaneous read/writes.

**The Solution: Migrate all state to Supabase**
* Create relational tables in Supabase for `agent_configurations`, `leads`, `call_logs`, and `workflows` with proper Row-Level Security (RLS).
* Python agents must use the `supabase-py` client to fetch their configuration directly from the database on startup/call.
* This fully bridges the gap between the Next.js Auth system and the data layer, making the app 100% cloud-ready.

---

## 2. 🏗️ Decouple the Python Process Manager
**The Problem:** 
`run.py` acts as a monolithic manager using `subprocess.Popen` to spawn inbound and outbound agents in the background. If `run.py` crashes, both agents die. It prevents independent scaling based on traffic (e.g., high inbound, zero outbound).

**The Solution: Containerize with Docker**
* Create separate `Dockerfile.inbound` and `Dockerfile.outbound`.
* Run them as completely independent microservices.
* Host the Next.js frontend on Vercel, and the Python Voice Agents on a scalable backend orchestration platform like AWS ECS, Google Cloud Run, or Railway.

---

## 3. ⚡ Event-Driven Realtime Flow (Webhooks)
**The Problem:** 
Post-call analytics are written to a local file by `analytics.py`. The frontend lacks a direct, real-time trigger to know when a call finishes, requiring polling or manual refreshes to see new leads.

**The Solution: Implement a Webhook Architecture**
* Configure LiveKit to send webhook events (e.g., `room_finished`, `participant_joined`) directly to a new Next.js endpoint: `/api/webhooks/livekit`.
* Upon receiving the webhook, Next.js instantly updates the Supabase database.
* Utilizing Supabase Realtime Subscriptions, the React Dashboard will instantly push the new lead/log to the user's screen without a page refresh.

---

## 4. 🔒 API Gateway & Secret Management
**The Problem:** 
The Python agents connect directly to various APIs (Groq, Sarvam, Deepgram) using keys sitting in a local `.env` file. For a multi-tenant SaaS, sharing a single set of hardcoded keys is a security risk.

**The Solution: Centralized Secret Management**
* **Short term:** Move `.env` management to a secure secrets manager (AWS Secrets Manager, Doppler, or Infisical).
* **Long term:** Python agents should not call the LLM directly. Instead, they should send the transcript to a secured internal Next.js API route (`/api/internal/llm`). The Next.js server injects the API keys, handles rate-limiting, manages billing per tenant, and returns the response.

---

## 5. 📊 Distributed Tracing & Observability
**The Problem:** 
`log_runner.py` dumps massive text files into a `logs/` folder. Troubleshooting a specific dropped call requires manual text searching through unconnected log files.

**The Solution: Structured Logging with Correlation IDs**
* Generate a unique `call_id` (UUID) every time a call starts.
* Pass this `call_id` through every layer: Next.js → LiveKit → Python Agent → Deepgram → Groq.
* Aggregate logs using a modern observability platform like Datadog, Sentry, or Axiom. This enables searching for a `call_id` and viewing a complete, timeline-based waterfall of the event across the frontend, backend, and external APIs.
