# 🔧 Architecture — 100% Extensible Real-Time Tool Gateway

This document explains the "Tool Gateway Pattern" we built today. It is the core architectural decision that makes the platform infinitely extensible without touching Python code.

---

## The Problem We Solved

**Before today:**
Every live in-call integration (like Google Calendar, WhatsApp, patient database lookup) would need to be:
1. Written as a new Python tool inside the agent
2. Deployed to the server
3. Agent restarted (dropping active calls)
4. Credentials stored in Python environment variables

**This is fragile, slow, and not multi-tenant.**

---

## The Solution: Tool Gateway Pattern

```
PYTHON AGENT                    NEXT.JS DASHBOARD
─────────────────               ─────────────────────────────────────
                                
query_workspace_integration     /api/tools/execute
(ONE generic tool)      ──────► switch(action_name) {
                         HTTP     case "book_appointment":
                         POST       → Google Calendar API
                                   case "check_availability":
                                     → Google freeBusy API
                                   case "send_whatsapp":       ← add new
                                     → Twilio/WhatsApp API     ← integrations
                                   case "lookup_patient":      ← here
                                     → Patient DB API          ← ZERO Python
                                   default:                    ← changes
                                     → graceful fallback
                                 }
```

---

## Python Side (ONE tool, never changes)

```python
@function_tool
async def query_workspace_integration(
    context: RunContext[InboundContext],
    action_name: str,
    parameters_json: str
) -> str:
    """
    Execute any workspace integration action in real-time during the call.
    action_name: The integration action to perform (e.g. 'book_appointment')
    parameters_json: JSON string of parameters for the action
    """
    # Just POSTs to the Next.js gateway and returns the result string
    # The agent speaks this string back to the caller
```

This tool is registered once in `agent_inbound.py` and **never needs to be changed**.

---

## Next.js Side (Add new integrations here)

File: `dashboard/app/api/tools/execute/route.ts`

```typescript
switch (action_name) {
  case "book_appointment":
    result = await handleBookAppointment(parameters, workspaceId);
    break;

  case "check_availability":
    result = await handleCheckAvailability(parameters, workspaceId);
    break;

  // ── ADD NEW INTEGRATIONS HERE ──────────────────────────────────
  // case "send_whatsapp_confirmation":
  //   result = await handleSendWhatsApp(parameters, workspaceId);
  //   break;
  //
  // case "lookup_patient_records":
  //   result = await handleLookupPatient(parameters, workspaceId);
  //   break;
  //
  // case "check_insurance_eligibility":
  //   result = await handleInsuranceCheck(parameters, workspaceId);
  //   break;
  //
  // case "create_word_report":          ← Scenario 2 future requirement
  //   result = await handleWordReport(parameters, workspaceId);
  //   break;
  // ──────────────────────────────────────────────────────────────

  default:
    result = "I'm sorry, that action isn't configured yet.";
}
```

**To add a new integration:**
1. Write a `handleXxx(params, workspaceId)` async function
2. Add a `case` in the switch
3. Deploy the Next.js dashboard (hot-reload in dev, no agent restart)
4. Update the `query_workspace_integration` description in `data/agent_config.json` so the LLM knows about the new action
5. Done. The Python agent doesn't know or care what happened — it just gets a string back to speak

---

## Token Management

```
USER FLOW:                              CALL FLOW:
─────────────────────────              ──────────────────────────────
User clicks                            Agent calls query_workspace_integration
"Connect Google Calendar"              
         │                                       │
         ▼                                       ▼
/api/auth/gmail/start               /api/tools/execute
(requests Gmail + Calendar               reads Supabase:
 scopes in one OAuth flow)            integrations table
         │                            WHERE workspace_id = 'xxx'
         ▼                            AND service = 'google_calendar'
/api/auth/google/callback                        │
  → exchanges code for tokens                    ▼
  → saves to Supabase:                  if token expired:
    integrations table                    refresh via refresh_token
    (workspace_id, service, tokens)              │
         │                                       ▼
         ▼                              call Google Calendar API
UI shows "Connected!" toast
```

**Key insight:** The Python agent **never touches OAuth tokens directly**. It just calls the Next.js gateway which handles all credential management.

---

## Applying This to Future Scenarios

### Scenario 2 (Used Car Sales) future needs:
- After call ends → `create_word_report` → generate a Word doc summary → `send_email` → email it to the dealership manager
- This is a **post-call** task → use the Visual Workflow Builder (not the tool gateway)
- The workflow builder triggers after call ends, has no latency constraint

### Any new scenario:
1. **Real-time during call** → Add a `case` to tool gateway switch
2. **Post-call** → Add a step to the Visual Workflow Builder

---

## Error Handling & Reliability

The system is designed so **the call never crashes** regardless of integration failures:

| Failure Scenario | What Happens |
|-----------------|-------------|
| Supabase unreachable | Gateway returns graceful Hindi string, agent speaks it |
| Google Calendar API error | Gateway returns "team will confirm" message |
| Token expired, refresh fails | Gateway returns graceful fallback |
| Network timeout (>6s) | Python tool catches timeout, returns Hindi fallback |
| Unknown action_name | Gateway returns "not configured" message |
| Gateway returns 500 | Python catches exception, speaks fallback |

The Python tool always returns a string. The LLM always has something to speak. The call always continues.
