import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Unified Google OAuth Callback — /api/auth/google/callback
// ---------------------------------------------------------------------------
// Handles tokens for both Gmail (send) and Google Calendar (events) scopes.
// After token exchange:
//   1. Fetches user profile info (email, name, picture)
//   2. Upserts tokens into Supabase `integrations` table (server-accessible
//      by the Python voice agent via the tool gateway)
//   3. Passes a sanitized summary back to the browser via URL params so
//      the Integrations UI can display the connected account
// ---------------------------------------------------------------------------

const SUPABASE_URL    = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLIENT_ID       = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET   = process.env.GOOGLE_CLIENT_SECRET!;
const BASE_URL        = process.env.NEXT_PUBLIC_BASE_URL!;
const REDIRECT_URI    = `${BASE_URL}/api/auth/google/callback`;

// ── Upsert integration tokens to Supabase ───────────────────────────────────
async function saveTokensToSupabase(
  workspaceId: string,
  service: string,
  tokens: Record<string, string>
): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/integrations`;
  const body = {
    workspace_id: workspaceId,
    service,
    tokens,
    updated_at: new Date().toISOString(),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates", // UPSERT on (workspace_id, service) UNIQUE constraint
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[google-callback] Supabase upsert failed:", errText);
    throw new Error(`Supabase upsert failed: ${errText}`);
  }

  console.log(`[google-callback] ✅ Tokens saved to Supabase for workspace=${workspaceId} service=${service}`);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state"); // Contains workspace_id if passed

  const redirectBase = `${BASE_URL}/integrations`;

  if (error || !code) {
    console.error("[google-callback] OAuth error:", error);
    return NextResponse.redirect(`${redirectBase}?gcal_error=${error || "no_code"}`);
  }

  // ── Token exchange ───────────────────────────────────────────────────────
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("[google-callback] Token exchange failed:", errText);
    return NextResponse.redirect(`${redirectBase}?gcal_error=token_exchange_failed`);
  }

  const tokens = await tokenRes.json();
  const { access_token, refresh_token, expires_in } = tokens;

  // ── Fetch user profile ───────────────────────────────────────────────────
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  const userInfo = userRes.ok ? await userRes.json() : {};
  const email   = userInfo.email   || "unknown@gmail.com";
  const name    = userInfo.name    || email;
  const picture = userInfo.picture || "";

  // ── Persist to Supabase (for the tool gateway to use during calls) ───────
  // Extract workspace_id from state param (passed by the OAuth start route)
  let workspaceId = "default";
  try {
    if (state) {
      const stateData = JSON.parse(decodeURIComponent(state));
      workspaceId = stateData.workspace_id || "default";
    }
  } catch {
    console.warn("[google-callback] Could not parse state param:", state);
  }

  const tokenRecord = {
    access_token,
    refresh_token:   refresh_token || "",
    expires_in:      String(expires_in || 3600),
    email,
    name,
    picture,
    connected_at:    new Date().toISOString(),
  };

  try {
    // Save under both "google_calendar" and "gmail" services
    // so both the tool gateway and email workflows can find them
    await saveTokensToSupabase(workspaceId, "google_calendar", tokenRecord);
    await saveTokensToSupabase(workspaceId, "gmail", tokenRecord);
  } catch (err) {
    console.error("[google-callback] Failed to save to Supabase:", err);
    // Don't block the redirect — the client-side localStorage will still work
  }

  // ── Build redirect with sanitized data for the Integrations UI ───────────
  // We pass non-sensitive display data (no tokens) in URL params
  const displayData = encodeURIComponent(
    JSON.stringify({ email, name, picture, connected_at: tokenRecord.connected_at })
  );

  return NextResponse.redirect(
    `${redirectBase}?gcal_success=1&gcal_data=${displayData}`
  );
}
