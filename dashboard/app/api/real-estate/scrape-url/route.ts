import { NextRequest, NextResponse } from "next/server";

const MAX_CHARS = 6000;

function stripHtml(html: string): string {
  // Remove script and style elements
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Only HTTP/HTTPS URLs are supported");
      }
    } catch {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }

    console.log(`[Scrape URL] Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AIVoiceAgent/1.0)",
        Accept: "text/html,text/plain,*/*",
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${response.status} ${response.statusText}` },
        { status: 402 }
      );
    }

    const contentType = response.headers.get("content-type") || "";
    const rawText = await response.text();

    let content: string;

    if (contentType.includes("text/html")) {
      content = stripHtml(rawText);
    } else {
      // Plain text, JSON, etc. — use as-is
      content = rawText.replace(/\s+/g, " ").trim();
    }

    const totalChars = content.length;
    let truncated = false;

    if (content.length > MAX_CHARS) {
      content = content.substring(0, MAX_CHARS);
      truncated = true;
    }

    console.log(`[Scrape URL] Extracted ${totalChars} chars from ${url}${truncated ? " (truncated)" : ""}`);

    return NextResponse.json({
      success: true,
      url,
      content,
      charCount: content.length,
      totalChars,
      truncated,
    });
  } catch (err: any) {
    console.error("[Scrape URL]", err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch URL" },
      { status: 500 }
    );
  }
}
