/**
 * Loads PDF.js from CDN dynamically to avoid bundler asset errors or worker startup issues in Vite.
 */
export async function loadPdfJS(): Promise<any> {
  const global = window as any;
  if (global.pdfjsLib) {
    return global.pdfjsLib;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(global.pdfjsLib);
    };
    script.onerror = () => {
      reject(new Error("Failed to load PDF.js from CDN"));
    };
    document.head.appendChild(script);
  });
}

export interface ExtractedPage {
  pageNumber: number; // 1-based page number within the file
  textSample: string;
}

/**
 * Extracts page counts and a consolidated sample of text for each page in a PDF file.
 */
export async function extractPdfPagesInfo(arrayBuffer: ArrayBuffer): Promise<{
  pageCount: number;
  pages: ExtractedPage[];
}> {
  const pdfjs = await loadPdfJS();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const extractedPages: ExtractedPage[] = [];

  // Extract text samples for up to all pages sequentially
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ")
        .slice(0, 1500); // sample the first 1500 chars

      extractedPages.push({
        pageNumber: pageNum,
        textSample: pageText || "[Empty page or scanned image content]",
      });
    } catch (e) {
      console.error(`Failed to extract text for page ${pageNum}`, e);
      extractedPages.push({
        pageNumber: pageNum,
        textSample: "[Error parsing content]",
      });
    }
  }

  return { pageCount, pages: extractedPages };
}

/**
 * Renders a PDF page to a canvas element for visual thumbnail views.
 */
export async function renderPdfPageToCanvas(
  arrayBuffer: ArrayBuffer,
  pageNumber: number,
  canvas: HTMLCanvasElement
): Promise<void> {
  const pdfjs = await loadPdfJS();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNumber);

  const desiredWidth = 160; // Standard thumbnail width
  const viewport = page.getViewport({ scale: 1 });
  const scale = desiredWidth / viewport.width;
  const scaledViewport = page.getViewport({ scale });

  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  await page.render({
    canvasContext: ctx,
    viewport: scaledViewport,
  }).promise;
}
