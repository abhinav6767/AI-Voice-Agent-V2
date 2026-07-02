import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "..", "data");

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Only allow csv files
    const allowedExtensions = [".csv"];
    const ext = path.extname(file.name).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return NextResponse.json(
        { error: `File type '${ext}' not supported. Allowed: ${allowedExtensions.join(", ")}` },
        { status: 400 }
      );
    }

    // Create workflow_uploads directory
    const uploadDir = path.join(DATA_DIR, "workflow_uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Save file with a timestamp to prevent accidental overwrites
    const buffer = Buffer.from(await file.arrayBuffer());
    
    // e.g. leads_170000000.csv
    const baseName = path.basename(file.name, ext);
    const safeName = `${baseName}_${Date.now()}${ext}`;
    const filePath = path.join(uploadDir, safeName);
    
    fs.writeFileSync(filePath, buffer);

    // This is the relative path we will save in node.config.filePath
    // The executor resolves relative to process.cwd(), ".."
    const relativePath = `../data/workflow_uploads/${safeName}`;

    return NextResponse.json({
      success: true,
      file: {
        name: file.name,
        path: relativePath,
      },
    });
  } catch (e: any) {
    console.error("[WORKFLOW UPLOAD ERROR]", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
