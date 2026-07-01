import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const MAX_CHARS = 8000; // LiveKit metadata size limit — truncate if needed

// ── Text extractors (server-side only) ────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse");
  const data = await pdfParse(buffer);
  return data.text || "";
}

async function extractDocx(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

function extractText(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
      "text/csv",
      "application/csv",
    ];
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const allowedExts = ["pdf", "docx", "doc", "txt", "csv", "md"];

    if (!allowedExts.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type: .${ext}. Please upload PDF, DOCX, DOC, TXT, or CSV.` },
        { status: 400 }
      );
    }

    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract text based on file type
    let rawText = "";
    if (ext === "pdf") {
      rawText = await extractPdf(buffer);
    } else if (ext === "docx" || ext === "doc") {
      rawText = await extractDocx(buffer);
    } else {
      rawText = extractText(buffer);
    }

    // Clean up: collapse excessive whitespace
    rawText = rawText.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    // Truncate to MAX_CHARS to stay within metadata limits
    let content = rawText;
    let truncated = false;
    if (content.length > MAX_CHARS) {
      content = content.substring(0, MAX_CHARS);
      truncated = true;
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileSize: file.size,
      charCount: content.length,
      totalChars: rawText.length,
      truncated,
      content,
    });
  } catch (err: any) {
    console.error("[RAG Upload]", err);
    return NextResponse.json(
      { error: err.message || "Failed to process file" },
      { status: 500 }
    );
  }
}
