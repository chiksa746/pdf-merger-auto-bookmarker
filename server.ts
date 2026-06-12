import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

// Body parser
app.use(express.json({ limit: "50mb" }));

// Lazy-loaded Gemini client getter
function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
    throw new Error("Gemini API Key is not configured. Please open the Settings > Secrets configuration panel (in the top right of AI Studio) and add your 'GEMINI_API_KEY' secret to unlock automatic AI bookmarking!");
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Gemini bookmark generation endpoint
app.post("/api/gemini/bookmarks", async (req, res) => {
  try {
    const ai = getAiClient();
    const { pages, mode = "general" } = req.body;

    if (!pages || !Array.isArray(pages)) {
      res.status(400).json({ error: "Missing pages list" });
      return;
    }

    // Limit pages input scope to avoid overwhelming context sizes
    const simplifiedPages = pages.map((p) => ({
      fileName: p.fileName,
      pageIndex: p.pageIndex,
      textSample: (p.textSample || "").substring(0, 1500), // first 1500 chars is plenty for header analysis
    }));

    let prompt = "";
    if (mode === "sheet") {
      prompt = `Analyze the following sequence of pages representing engineering schematics, blueprints, CAD plans, architectural drawings, or multi-sheet Excel/document exports.
Identify the **Sheet Name**, **Sheet Title**, **Drawing Name**, and/or **Sheet Number** for each page in this sequence.

Guidelines:
1. Scan each page text sample carefully for standard title blocks (typically located in corner margins) containing strings like "Sheet Name", "Sheet Title", "Drawing Title", "Sheet No.", "DWG NO", "Scale", or "A-101", "E-201", "Sheet 1", etc.
2. Generate a clear bookmark at each corresponding pageIndex naming that sheet's identity.
3. Prefer a clean, professional format for the bookmark title: "[Sheet Number/ID] [Sheet Title]" (e.g., "A-101 Floor Plan", "Detail Sheet 3.2", "Sheet 2: Monthly Expenses"). If there is no specific number, use the detected Sheet Name/Title.
4. Set level: 0 for all major sheets. If a sheet represents a sub-detail or supplementary diagram within the previous sheet, use level: 1.
5. Keep titles concise, under 45 characters.
6. Outputs must be chronologically ordered by pageIndex.

Here is the document page list:
${JSON.stringify(simplifiedPages, null, 2)}`;
    } else if (mode === "page_titles") {
      prompt = `Analyze the following sequence of pages from a single merged document.
For EACH individual page index, detect its primary page title, header, division subject, or document section title.

Guidelines:
1. You MUST generate exactly ONE bookmark for each pageIndex present in the sequence list.
2. Carefully inspect the text content of each page, find the most prominent main title, major topic, main sheet header, or section indicator on that page.
3. Format the bookmark title cleanly (e.g., "Chapter 1: Historical Data", "Page 2: Financial Charts", "System Layout Diagram"). Keep it under 45 characters.
4. Set level: 0 for all generated page-by-page bookmarks.
5. Ensure the resulting pages are sequentially ordered by pageIndex.

Here is the document page list:
${JSON.stringify(simplifiedPages, null, 2)}`;
    } else {
      prompt = `Analyze the following sequence of pages that represent a merged document. Review the document filenames and page content text samples sequentially to identify major structural boundaries, chapter headings, and key sub-sections.
Generate a professional hierarchical PDF Outlines (table of contents bookmarks) list.

Guidelines:
1. Always create a top-level bookmark (level: 0) at pageIndex = 0 for the first document.
2. For each subsequent document boundary (where filename changes), generate a top-level bookmark (level: 0) naming the document.
3. Throughout the body text, identify transition structures (e.g. headings like "Introduction", "Chapter 1", "Work Experience", "Financial Reports", "1.1 Technical Background", "Summary", "Table 1") and assign level:
   - level: 0 for document boundaries and top-level chapter beginnings
   - level: 1 for secondary sub-sections (e.g. heading details)
   - level: 2 for tertiary subsections (e.g. details within sections)
4. Ensure pageIndex corresponds exactly to the 0-based page index provided in the list.
5. Create concise, meaningful bookmark titles (up to 40 characters limit).
6. Arrange bookmark outputs chronologically by pageIndex.

Here is the document page list:
${JSON.stringify(simplifiedPages, null, 2)}`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: mode === "sheet"
          ? "You are a professional architectural and engineering draft structures assistant specialized in scanning PDF drawing files to extract sheet names and drawing numbers into structured PDF outlines."
          : mode === "page_titles"
          ? "You are an expert document outline engine. Your task is to identify and extract a single, clear, highly precise main title or header for every single individual page of a document to generate a flat page-by-page table of contents."
          : "You are an intelligent PDF document structuring assistant that extracts semantic outlines from merged files and structures beautiful PDF bookmark layouts.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bookmarks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: {
                    type: Type.STRING,
                    description: "Concise title for the PDF bookmark"
                  },
                  pageIndex: {
                    type: Type.INTEGER,
                    description: "The 0-based pageIndex of the page in the overall document"
                  },
                  level: {
                    type: Type.INTEGER,
                    description: "Hierarchical nesting level. 0 is root/primary, 1 is secondary, 2 is tertiary"
                  }
                },
                required: ["title", "pageIndex", "level"]
              }
            }
          },
          required: ["bookmarks"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      res.status(500).json({ error: "No response text received from Gemini API" });
      return;
    }

    const data = JSON.parse(resultText.trim());
    res.json(data);
  } catch (error: any) {
    console.error("Gemini Bookmark API Error:", error);
    let friendlyMessage = error.message || "Failed to generate outlines";
    
    // Check error details or full error context string for scope and permission failures
    const errString = typeof error === "object" ? JSON.stringify(error) : String(error);
    if (
      friendlyMessage.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
      friendlyMessage.includes("insufficient authentication scopes") ||
      friendlyMessage.includes("PERMISSION_DENIED") ||
      friendlyMessage.includes("403") ||
      errString.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
      errString.includes("PERMISSION_DENIED")
    ) {
      friendlyMessage = "Gemini API key is invalid or lacks proper permission scopes. Please open the **Settings > Secrets** configuration panel (in the top right of AI Studio) and make sure your 'GEMINI_API_KEY' is correctly configured with a valid, active Gemini API Key.";
    }
    
    res.status(500).json({ error: friendlyMessage });
  }
});

// Configure serving of Vite files
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development server with Vite integration
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched on port ${PORT}`);
  });
}

setupServer();
