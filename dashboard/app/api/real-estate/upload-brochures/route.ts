import { NextRequest, NextResponse } from "next/server";

const MAX_CHARS_PER_BROCHURE = 3000; // Keep summaries compact for system prompt

// ── Clean extracted text: keep only English words, numbers, and basic punctuation ──
function cleanExtractedText(raw: string): string {
  // Step 1: Remove PDF structural junk (hex streams, font refs, metadata)
  let text = raw
    .replace(/<[0-9A-Fa-f]{16,}>/g, "")           // hex strings like <0A1B2C3D...>
    .replace(/<</g, "").replace(/>>/g, "")          // PDF object delimiters
    .replace(/\bobj\b/gi, "").replace(/\bendobj\b/gi, "")
    .replace(/\bstream\b/gi, "").replace(/\bendstream\b/gi, "")
    .replace(/\bxref\b/gi, "").replace(/\btrailer\b/gi, "")
    .replace(/\bstartxref\b/gi, "")
    .replace(/\/Type\s*\/\w+/g, "")                 // /Type /Page etc
    .replace(/\/Font[^}]*}/g, "")                   // /Font {...}
    .replace(/\/[A-Z][a-zA-Z]+\s*=/g, "")          // /Key = value patterns
    .replace(/\d+ \d+ R/g, "")                      // object references like "12 0 R"
    .replace(/\bPID[\s:]\S+/gi, "")                 // PID metadata
    .replace(/UUID[\s:]\S+/gi, "");                 // UUID metadata

  // Step 2: Keep ONLY English letters, digits, spaces, and basic punctuation
  // Remove everything else (non-ASCII, special chars, symbols)
  text = text.replace(/[^a-zA-Z0-9\s.,;:!?\-/'()&%$@#+=<>*\n\r]/g, " ");

  // Step 3: Remove lines that are too short (likely junk) or too long (binary data)
  const lines = text.split(/\n/);
  const cleaned = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length < 3) return false;               // too short
    if (trimmed.length > 500) return false;              // likely binary
    if (/^\d+$/.test(trimmed)) return false;             // just numbers
    if (/^[a-zA-Z]\d{4,}$/.test(trimmed)) return false; // font encoding artifacts
    // Must contain at least 30% letters to be real text
    const letterCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
    if (letterCount / trimmed.length < 0.3) return false;
    return true;
  });

  // Step 4: Collapse whitespace and trim
  return cleaned
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Text extractor for PDFs (multi-strategy) ─────────────────────────────────
async function extractPdf(buffer: Buffer): Promise<string> {
  // Strategy 1: Try pdf-parse (works on most Node versions)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    if (data.text && data.text.trim().length > 0) {
      return data.text;
    }
  } catch (e: any) {
    console.warn("[upload-brochures] pdf-parse failed, trying fallback:", e.message);
  }

  // Strategy 2: Fallback — extract readable text streams from PDF buffer
  // This handles most PDFs by finding text between BT/ET markers and raw text streams
  try {
    const text = extractTextFromPdfBuffer(buffer);
    if (text.trim().length > 0) return text;
  } catch (e: any) {
    console.warn("[upload-brochures] fallback extraction failed:", e.message);
  }

  return "";
}

function extractTextFromPdfBuffer(buffer: Buffer): string {
  const str = buffer.toString("latin1");

  // Extract text from BT ... ET (text blocks) in content streams
  const textBlocks: string[] = [];
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  let match;

  while ((match = tjRegex.exec(str)) !== null) {
    const raw = match[1];
    if (raw.trim()) textBlocks.push(raw);
  }

  while ((match = tjArrayRegex.exec(str)) !== null) {
    const segment = match[1];
    const innerRegex = /\(([^)]*)\)/g;
    let inner;
    const parts: string[] = [];
    while ((inner = innerRegex.exec(segment)) !== null) {
      if (inner[1]) parts.push(inner[1]);
    }
    if (parts.length) textBlocks.push(parts.join(""));
  }

  if (textBlocks.length > 0) {
    return textBlocks.join("\n");
  }

  // Last resort: extract readable text but filter out PDF structure noise
  const readable = str.match(/[ -~\n]{4,}/g);
  if (!readable) return "";

  const noise = [
    /^%PDF-/,
    /^xref$/,
    /^startxref$/,
    /^endobj$/,
    /^obj$/,
    /^endstream$/,
    /^stream$/,
    /^trailer$/,
    /^<<.*>>$/,
    /^\d+ \d+ obj/,
    /^<\// ,
    /^0000000/,
    /^endobj/,
    /^\s*$/,
  ];

  const filtered = readable
    .join("\n")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length < 4) return false;
      return !noise.some((pattern) => pattern.test(trimmed));
    });

  return filtered.join("\n");
}

// ── POST /api/real-estate/upload-brochures ────────────────────────────────────
// Accepts FormData with:
//   - files: multiple PDF files
//   - names: JSON array of project names (one per file)
// Returns extracted text content for each brochure.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const namesRaw = formData.get("names") as string | null;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const names: string[] = namesRaw ? JSON.parse(namesRaw) : [];

    const brochures = await Promise.all(
      files.map(async (file, index) => {
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        if (ext !== "pdf") {
          return {
            name: names[index] || file.name.replace(/\.pdf$/i, ""),
            fileName: file.name,
            content: "",
            charCount: 0,
            error: `Unsupported file type: .${ext}. Only PDF files are accepted.`,
          };
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        let rawText = "";

        try {
          rawText = await extractPdf(buffer);
        } catch (err: any) {
          return {
            name: names[index] || file.name.replace(/\.pdf$/i, ""),
            fileName: file.name,
            content: "",
            charCount: 0,
            error: `Failed to extract text: ${err.message}`,
          };
        }

        // Clean: remove junk, keep only English + numbers + basic punctuation
        rawText = cleanExtractedText(rawText);

        // Truncate to max chars
        let content = rawText;
        let truncated = false;
        if (content.length > MAX_CHARS_PER_BROCHURE) {
          content = content.substring(0, MAX_CHARS_PER_BROCHURE);
          truncated = true;
        }

        return {
          name: names[index] || file.name.replace(/\.pdf$/i, ""),
          fileName: file.name,
          content,
          charCount: content.length,
          totalChars: rawText.length,
          truncated,
        };
      })
    );

    return NextResponse.json({ success: true, brochures });
  } catch (err: any) {
    console.error("[Real Estate Upload Brochures]", err);
    return NextResponse.json(
      { error: err.message || "Failed to process brochures" },
      { status: 500 }
    );
  }
}
