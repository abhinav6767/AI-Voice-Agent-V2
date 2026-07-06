import { NextRequest, NextResponse } from "next/server";
import { getCallLogs } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
    const startDate = req.nextUrl.searchParams.get("start");
    const endDate = req.nextUrl.searchParams.get("end");

    const allLogs = await getCallLogs();

    // Filter by date range
    let filtered = allLogs;
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      filtered = filtered.filter((l: any) => new Date(l.timestamp) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter((l: any) => new Date(l.timestamp) <= end);
    }

    // Sort by timestamp descending (newest first)
    filtered.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const logs = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      logs,
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (e: any) {
    console.error("[CallLogs API]", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
