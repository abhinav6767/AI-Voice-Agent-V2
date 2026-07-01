import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  // Use the unified Google callback that saves to Supabase AND handles Calendar
  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/google/callback`;

  // Read optional workspace_id from query param (e.g. ?workspace_id=ws_abc123)
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspace_id") || "default";
  const state = encodeURIComponent(JSON.stringify({ workspace_id: workspaceId }));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar",          // full calendar access (read + write + freeBusy)
      "https://www.googleapis.com/auth/calendar.events",   // create/edit events
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ].join(" "),
    access_type: "offline",
    prompt: "consent", // force refresh_token every time
    state,
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return NextResponse.redirect(googleAuthUrl);
}
