import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const MAX_CHARS = 8000; // LiveKit metadata size limit — truncate if needed

// ── Clean extracted text: keep only English words, numbers, and basic punctuation ──
function cleanExtractedText(raw: string): string {
  let text = raw
    .replace(/<[0-9A-Fa-f]{16,}>/g, "")
    .replace(/<</g, "").replace(/>>/g, "")
    .replace(/\bobj\b/gi, "").replace(/\bendobj\b/gi, "")
    .replace(/\bstream\b/gi, "").replace(/\bendstream\b/gi, "")
    .replace(/\bxref\b/gi, "").replace(/\btrailer\b/gi, "")
    .replace(/\bstartxref\b/gi, "")
    .replace(/\/Type\s*\/\w+/g, "")
    .replace(/\/Font[^}]*}/g, "")
    .replace(/\/[A-Z][a-zA-Z]+\s*=/g, "")
    .replace(/\d+ \d+ R/g, "")
    .replace(/\bPID[\s:]\S+/gi, "")
    .replace(/UUID[\s:]\S+/gi, "");

  text = text.replace(/[^a-zA-Z0-9\s.,;:!?\-/'()&%$@#+=<>*\n\r]/g, " ");

  const lines = text.split(/\n/);
  const cleaned = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length < 3) return false;
    if (trimmed.length > 500) return false;
    if (/^\d+$/.test(trimmed)) return false;
    if (/^[a-zA-Z]\d{4,}$/.test(trimmed)) return false;
    const letterCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
    if (letterCount / trimmed.length < 0.3) return false;
    return true;
  });

  return cleaned
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

    // Clean: remove junk, keep only English + numbers + basic punctuation
    rawText = cleanExtractedText(rawText);

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
