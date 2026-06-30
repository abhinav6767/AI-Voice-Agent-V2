import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Tool Gateway — /api/tools/execute
// ---------------------------------------------------------------------------
// Called by the Python voice agent during active calls via query_workspace_integration.
// Resolves any action_name → executes the matching integration → returns a
// natural-language string the agent can speak back to the caller immediately.
//
// To add a new real-time integration:
//   1. Add a handler function below.
//   2. Add a case to the switch in the POST handler.
//   3. Zero Python changes needed.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ── Helper: fetch integration tokens from Supabase ──────────────────────────
async function getIntegrationTokens(
  workspaceId: string,
  service: string
): Promise<Record<string, string> | null> {
  const url = `${SUPABASE_URL}/rest/v1/integrations?workspace_id=eq.${encodeURIComponent(workspaceId)}&service=eq.${encodeURIComponent(service)}&select=tokens&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    console.error("[tool-gateway] Supabase fetch failed:", await res.text());
    return null;
  }

  const rows: { tokens: Record<string, string> }[] = await res.json();
  return rows[0]?.tokens ?? null;
}

// ── Helper: refresh Google access token ─────────────────────────────────────
async function refreshGoogleAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    console.error("[tool-gateway] Token refresh failed:", await res.text());
    return null;
  }

  const data = await res.json();
  return data.access_token ?? null;
}

// ── Helper: parse natural language date/time into ISO datetimes ─────────────
function parseAppointmentDateTime(
  dateStr: string,
  timeStr: string,
  durationMinutes: number = 30
): { start: string; end: string; readableDate: string; readableTime: string } {
  const now = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // ── Date parsing ──
  let appointmentDate = new Date(now);
  const lowerDate = dateStr.toLowerCase().trim();

  if (["today", "aaj"].includes(lowerDate)) {
    appointmentDate = new Date(now);
  } else if (["tomorrow", "kal", "kaal", "parday"].includes(lowerDate)) {
    appointmentDate = new Date(now);
    appointmentDate.setDate(appointmentDate.getDate() + 1);
  } else if (["day after tomorrow", "parson"].includes(lowerDate)) {
    appointmentDate = new Date(now);
    appointmentDate.setDate(appointmentDate.getDate() + 2);
  } else {
    // Try standard date parse
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      appointmentDate = parsed;
    } else {
      // Try partial match (e.g. "5th July", "July 5th")
      const ordinalStripped = dateStr.replace(/(\d+)(st|nd|rd|th)/gi, "$1");
      const parsed2 = new Date(ordinalStripped + " " + now.getFullYear());
      if (!isNaN(parsed2.getTime()) && parsed2 > now) {
        appointmentDate = parsed2;
      } else {
        // Default: next working day
        appointmentDate = new Date(now);
        appointmentDate.setDate(appointmentDate.getDate() + 1);
        if (appointmentDate.getDay() === 0) { // Skip Sunday
          appointmentDate.setDate(appointmentDate.getDate() + 1);
        }
      }
    }
  }

  // Ensure not a Sunday (clinic closed)
  if (appointmentDate.getDay() === 0) {
    appointmentDate.setDate(appointmentDate.getDate() + 1);
  }

  // ── Time parsing ──
  const lowerTime = timeStr.toLowerCase().trim();
  let hours = 10;
  let minutes = 0;

  // Hindi number words to hours
  const hindiTimeMap: Record<string, number> = {
    "nau": 9, "das": 10, "gyarah": 11, "barah": 12, "ek": 13,
    "do": 14, "teen": 15, "chaar": 16, "paanch": 17, "chhe": 18,
    "saat": 19, "aath": 20,
  };

  const hindiKey = Object.keys(hindiTimeMap).find((k) =>
    lowerTime.includes(k + " baje") || lowerTime.startsWith(k)
  );

  if (hindiKey) {
    hours = hindiTimeMap[hindiKey];
  } else {
    const timeMatch = lowerTime.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const period = timeMatch[3];
      if (period === "pm" && hours < 12) hours += 12;
      if (period === "am" && hours === 12) hours = 0;
    }
  }

  // Clinic hours guard: clamp to valid windows (9-13 or 17-20 IST)
  if (hours < 9) hours = 9;
  else if (hours > 13 && hours < 17) hours = 17;
  else if (hours >= 20) hours = 9; // wrap to next morning slot

  appointmentDate.setHours(hours, minutes, 0, 0);

  const endDate = new Date(appointmentDate);
  endDate.setMinutes(endDate.getMinutes() + durationMinutes);

  const readableDate = `${dayNames[appointmentDate.getDay()]}, ${appointmentDate.getDate()} ${monthNames[appointmentDate.getMonth()]}`;
  const readableTime = appointmentDate.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

  return {
    start: appointmentDate.toISOString(),
    end: endDate.toISOString(),
    readableDate,
    readableTime,
  };
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

async function handleBookAppointment(
  params: Record<string, unknown>,
  workspaceId: string
): Promise<string> {
  const patientName = String(params.patient_name || params.name || "Patient");
  const dateStr     = String(params.date || "tomorrow");
  const timeStr     = String(params.time || "10 AM");
  const treatment   = String(params.treatment || "Dental Consultation");
  const phone       = String(params.phone || "");
  const durationMin = Number(params.duration_minutes || 30);

  // Get Google Calendar tokens from Supabase
  const tokens = await getIntegrationTokens(workspaceId, "google_calendar");

  // Parse the date/time regardless (for readable response)
  const { start, end, readableDate, readableTime } = parseAppointmentDateTime(
    dateStr,
    timeStr,
    durationMin
  );

  if (!tokens) {
    console.warn("[tool-gateway] No Google Calendar tokens for workspace:", workspaceId);
    // Graceful degradation — confirm verbally without calendar
    return `Bilkul! Main ne aapka appointment note kar liya hai. ${patientName} ji, ${treatment} ke liye ${readableDate} ko ${readableTime} baje. Hamare team aapko confirm karne ke liye call karenge.`;
  }

  let accessToken = tokens.access_token;
  if (tokens.refresh_token) {
    const fresh = await refreshGoogleAccessToken(tokens.refresh_token);
    if (fresh) accessToken = fresh;
  }

  const eventBody = {
    summary: `${treatment} — ${patientName}`,
    description: [
      `Dental appointment booked via AI Receptionist (Aayushi)`,
      `Patient: ${patientName}`,
      phone ? `Contact: ${phone}` : "",
      `Treatment: ${treatment}`,
      `Duration: ${durationMin} minutes`,
      `Booked: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    ].filter(Boolean).join("\n"),
    start: { dateTime: start, timeZone: "Asia/Kolkata" },
    end:   { dateTime: end,   timeZone: "Asia/Kolkata" },
    location: "Shri Krishna Dental Clinic, M-14, Greater Kailash Part 1, New Delhi - 110048",
    colorId: "11", // Tomato — easy to spot on calendar
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup",  minutes: 60   },
        { method: "email",  minutes: 1440 }, // 24 hours before
      ],
    },
  };

  const calRes = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    }
  );

  if (!calRes.ok) {
    const errText = await calRes.text();
    console.error("[tool-gateway] Google Calendar API error:", errText);
    return `Aapka appointment note ho gaya hai. ${patientName} ji, ${treatment} ke liye ${readableDate} ko ${readableTime} baje. Hamar team aapko call karke confirm karenge.`;
  }

  const event = await calRes.json();
  console.log("[tool-gateway] ✅ Calendar event created:", event.id, "|", event.htmlLink);

  return `Perfect! Aapka appointment confirm ho gaya! ${patientName} ji, ${treatment} ke liye ${readableDate} ko ${readableTime} baje — Shri Krishna Dental Clinic, Greater Kailash mein. Aapko ek reminder bhi milega. Appointment ke din thodi der pehle aa jayiyega.`;
}

async function handleCheckAvailability(
  params: Record<string, unknown>,
  workspaceId: string
): Promise<string> {
  const dateStr   = String(params.date || "tomorrow");
  const treatment = String(params.treatment || "consultation");

  const tokens = await getIntegrationTokens(workspaceId, "google_calendar");

  if (!tokens) {
    return `${treatment} ke liye slots available hain — morning mein 9 baje se 1 baje tak, aur evening mein 5 baje se 8 baje tak. Monday se Saturday. Sunday clinic band rehti hai. Kaunsa time aapko theek lagta hai?`;
  }

  let accessToken = tokens.access_token;
  if (tokens.refresh_token) {
    const fresh = await refreshGoogleAccessToken(tokens.refresh_token);
    if (fresh) accessToken = fresh;
  }

  const { start: startIso } = parseAppointmentDateTime(dateStr, "9 AM", 30);
  const startOfDay = new Date(startIso);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);

  // Skip Sunday check
  if (startOfDay.getDay() === 0) {
    return `Sunday ko hamaari clinic band rehti hai. Kya Monday ko appointment book karein? Hum Monday se Saturday, morning 9 baje se 1 baje, aur evening 5 baje se 8 baje tak available hain.`;
  }

  const freeBusyRes = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      timeZone: "Asia/Kolkata",
      items: [{ id: "primary" }],
    }),
  });

  if (!freeBusyRes.ok) {
    return `${treatment} ke liye morning (9 AM - 1 PM) aur evening (5 PM - 8 PM) mein slots available hain. Kaunsa time prefer karenge?`;
  }

  const freeBusy = await freeBusyRes.json();
  const busyCount: number = (freeBusy.calendars?.primary?.busy ?? []).length;

  if (busyCount === 0) {
    return `${treatment} ke liye us din puri slots available hain! Morning 9 baje se 1 baje, ya evening 5 baje se 8 baje — kaunsa time aapko suit karta hai?`;
  } else if (busyCount < 3) {
    return `${treatment} ke liye kuch slots available hain us din. Morning mein 9 se 1, evening mein 5 se 8. Kaunsa session prefer karenge?`;
  } else {
    return `Us din kaafi appointments hain, lekin hum aapke liye ek slot nikaal sakte hain. Kya morning (9 AM se 1 PM) ya evening (5 PM se 8 PM) prefer karenge?`;
  }
}

// ---------------------------------------------------------------------------
// Main POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let body: {
    workspace_id?: string;
    action_name?: string;
    parameters?: Record<string, unknown>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workspace_id, action_name, parameters = {} } = body;

  if (!action_name) {
    return NextResponse.json({ error: "action_name is required" }, { status: 400 });
  }

  const workspaceId = workspace_id || "default";
  console.log(`[tool-gateway] → action=${action_name} workspace=${workspaceId}`, parameters);

  try {
    let result: string;

    switch (action_name) {
      case "book_appointment":
        result = await handleBookAppointment(parameters, workspaceId);
        break;

      case "check_availability":
        result = await handleCheckAvailability(parameters, workspaceId);
        break;

      // ─── Add new real-time integrations below ───────────────────────────
      // case "send_whatsapp_confirmation":
      //   result = await handleSendWhatsApp(parameters, workspaceId);
      //   break;
      // case "lookup_patient_records":
      //   result = await handleLookupPatient(parameters, workspaceId);
      //   break;
      // case "check_insurance_eligibility":
      //   result = await handleInsuranceCheck(parameters, workspaceId);
      //   break;
      // ────────────────────────────────────────────────────────────────────

      default:
        console.warn(`[tool-gateway] Unknown action: ${action_name}`);
        result = "I'm sorry, that action isn't configured yet. Our team will follow up shortly.";
    }

    return NextResponse.json({ result });
  } catch (err) {
    console.error("[tool-gateway] Unhandled error:", err);
    // Always return 200 with a speakable result — never let the agent crash
    return NextResponse.json(
      { result: "Main abhi yeh kaam nahi kar pa rahi. Hamaari team aapko jald call karegi." },
      { status: 200 }
    );
  }
}
