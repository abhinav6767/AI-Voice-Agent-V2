import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

async function getIntegrationTokens(workspaceId: string, service: string): Promise<Record<string, string> | null> {
  // Try with actual workspace_id first, then fallback to "default"
  for (const wsId of [workspaceId, "default"]) {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/integrations?workspace_id=eq.${wsId}&service=eq.${service}&select=tokens`;
    const res = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    });
    if (res.ok) {
      const rows = await res.json();
      if (rows?.[0]?.tokens) return rows[0].tokens;
    }
  }
  return null;
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<string | null> {
  try {
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
    const data = await res.json();
    if (!res.ok) {
      console.error("[Token Refresh] Failed:", res.status, data);
      return null;
    }
    console.log("[Token Refresh] Success, new access_token length:", data.access_token?.length);
    return data.access_token || null;
  } catch (e: any) {
    console.error("[Token Refresh] Error:", e.message);
    return null;
  }
}

// POST /api/real-estate/test-email — send a test email to verify Gmail is working
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles").select("business_id, role").eq("auth_user_id", user.id).single();

    // Resolve workspace: super_admin uses cookie, others use profile business_id
    let workspaceId = profile?.business_id;
    if (profile?.role === "super_admin") {
      const cookieStore = await cookies();
      const activeWorkspaceId = cookieStore.get("active_workspace_id")?.value;
      if (activeWorkspaceId) {
        workspaceId = activeWorkspaceId;
      } else {
        const { data: firstWorkspace } = await supabase
          .from("businesses").select("id").eq("is_active", true)
          .order("created_at", { ascending: true }).limit(1).single();
        workspaceId = firstWorkspace?.id;
      }
    }
    if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 });

    const { toEmail, subject, body } = await req.json();
    if (!toEmail) return NextResponse.json({ error: "toEmail is required" }, { status: 400 });

    // Try gmail first, then google_calendar (both store the same tokens)
    let tokens = await getIntegrationTokens(workspaceId, "gmail");
    if (!tokens) tokens = await getIntegrationTokens(workspaceId, "google_calendar");
    if (!tokens) return NextResponse.json({ error: "Gmail not connected" }, { status: 400 });

    console.log("[Test Email] Found tokens, refresh_token present:", !!tokens.refresh_token);

    let accessToken = tokens.access_token;
    if (tokens.refresh_token) {
      console.log("[Test Email] Attempting token refresh...");
      const fresh = await refreshGoogleAccessToken(tokens.refresh_token);
      if (fresh) {
        console.log("[Test Email] Token refreshed successfully");
        accessToken = fresh;
        // Save refreshed token back to Supabase
        try {
          const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/integrations?workspace_id=eq.${workspaceId}&service=eq.gmail`;
          await fetch(url, {
            method: "PATCH",
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ tokens: { ...tokens, access_token: fresh } }),
          });
        } catch {}
      } else {
        console.error("[Test Email] Token refresh failed");
      }
    }

    const fromEmail = tokens.email || "me";

    // Build simple MIME email
    const emailContent = [
      `To: ${toEmail}`,
      `From: ${fromEmail}`,
      `Subject: ${subject || "Test Email from Real Estate Agent"}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      body || "This is a test email from the Real Estate AI Calling Agent. If you received this, Gmail integration is working correctly.",
    ].join("\r\n");

    const base64Email = Buffer.from(emailContent).toString("base64url");

    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64Email }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      console.error("[Test Email] Send failed:", err);
      return NextResponse.json({ error: `Send failed: ${err}` }, { status: 500 });
    }

    const result = await sendRes.json();
    console.log(`[Test Email] Sent to ${toEmail}, message ID: ${result.id}`);

    return NextResponse.json({ success: true, messageId: result.id, from: fromEmail });
  } catch (err: any) {
    console.error("[Test Email]", err);
    return NextResponse.json({ error: err.message || "Failed to send test email" }, { status: 500 });
  }
}
