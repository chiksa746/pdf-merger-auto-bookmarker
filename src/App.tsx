/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from "react";
import { 
  ArrowUp, 
  ArrowDown, 
  Trash2, 
  Plus, 
  Sparkles, 
  Bookmark, 
  ChevronRight, 
  ChevronLeft, 
  PlusCircle, 
  Download, 
  Trash, 
  Upload, 
  BookOpen, 
  FolderOpen, 
  Hash, 
  Check, 
  Loader2,
  FileText,
  ArrowUpDown,
  GripVertical,
  Monitor,
  Smartphone,
  Laptop,
  Terminal,
  Copy,
  ExternalLink,
  Layers
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { PDFFile, FlatBookmark } from "./types";
import { extractPdfPagesInfo } from "./utils/pdfText";
import { mergeAndCompilePdf } from "./utils/pdf";
import PageThumbnail from "./components/PageThumbnail";

export default function App() {
  const [pdfFiles, setPdfFiles] = useState<PDFFile[]>([]);
  const [bookmarks, setBookmarks] = useState<FlatBookmark[]>([]);
  
  // Statuses
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiStatusMessage, setAiStatusMessage] = useState("");
  const [isCompiling, setIsCompiling] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [aiMode, setAiMode] = useState<"general" | "sheet" | "page_titles">("general");
  const [autoAnalyzeOnUpload, setAutoAnalyzeOnUpload] = useState(true);
  const [outlineEngine, setOutlineEngine] = useState<"smart" | "local">("local");
  const [draggedFileIndex, setDraggedFileIndex] = useState<number | null>(null);
  const [dragOverFileIndex, setDragOverFileIndex] = useState<number | null>(null);
  
  // Platform Installer States
  const [activePlatform, setActivePlatform] = useState<"windows" | "mac" | "android" | "ios">("windows");
  const [showInstallerPanel, setShowInstallerPanel] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Simple heuristic checking if a file or list of files is likely a Drawing Set (e.g., CAD/blueprints)
  const detectRecommendedMode = (files: PDFFile[]): "general" | "sheet" | "page_titles" => {
    let sheetScore = 0;
    let chaptersScore = 0;

    for (const file of files) {
      const name = file.name.toLowerCase();
      // Filename heuristic
      if (
        name.includes("sheet") || 
        name.includes("cad") || 
        name.includes("dwg") || 
        name.includes("plan") || 
        name.includes("blueprint") ||
        name.includes("drawing") ||
        name.includes("layout") ||
        name.includes("architectural") ||
        name.includes("structural") ||
        name.includes("schedule") ||
        name.includes("merged") ||
        name.includes("combined")
      ) {
        sheetScore += 3;
      }

      // Check common drawing sheet number patterns: e.g. A-101, M-302, E101
      if (/[a-z]-\d{3}/i.test(name) || /[a-z]\d{3}/i.test(name)) {
        sheetScore += 2;
      }

      // Content heuristic
      for (const page of file.pages) {
        const text = page.textSample.toUpperCase();
        if (text.includes("DWG NO") || text.includes("DRAWING NO") || text.includes("SHEET TITLE") || text.includes("SCALE:")) {
          sheetScore += 3;
        }
        if (text.includes("CHAPTER") || text.includes("SECTION") || text.includes("APPENDIX") || text.includes("TABLE OF CONTENTS") || text.includes("CHAPTER 1")) {
          chaptersScore += 2;
        }
      }
    }

    if (sheetScore > chaptersScore && sheetScore >= 3) {
      return "sheet";
    }
    
    // If it is multi-page and has "combined", let's prefer "page_titles" or "general"
    return "general";
  };

  // Highly robust client-side Local Heuristic rule engine for offline PDF bookmark generation
  const generateLocalHeuristicBookmarks = (
    mode: "general" | "sheet" | "page_titles",
    filesToUse: PDFFile[]
  ): FlatBookmark[] => {
    const localBookmarks: FlatBookmark[] = [];
    let globalIndex = 0;

    for (const file of filesToUse) {
      const fileStartPageIndex = globalIndex;
      
      // If we have multiple files associated, inject a parent-level boundary header
      if (filesToUse.length > 1) {
        localBookmarks.push({
          id: `local-boundary-${file.id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          title: `Document: ${file.name.replace(/\.pdf$/i, "")}`,
          pageIndex: fileStartPageIndex,
          level: 0,
        });
      }

      for (const page of file.pages) {
        const text = page.textSample || "";
        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        
        if (mode === "page_titles") {
          let detectedTitle = "";
          // Find the first line that is not purely dynamic data or short digits, of reasonable length
          for (const line of lines) {
            const cleanLine = line.trim();
            if (
              cleanLine.length > 3 && 
              cleanLine.length < 50 && 
              !/^\d+$/.test(cleanLine) && 
              !/^(page|p\.)\s*\d+/i.test(cleanLine) &&
              !cleanLine.includes("/")
            ) {
              detectedTitle = cleanLine;
              break;
            }
          }
          
          if (!detectedTitle) {
            detectedTitle = lines[0] || `Page ${globalIndex + 1}`;
          }
          
          // Clean formatting
          detectedTitle = detectedTitle.replace(/\s+/g, " ");
          if (detectedTitle.length > 45) {
            detectedTitle = detectedTitle.slice(0, 42) + "...";
          }

          localBookmarks.push({
            id: `local-page-${globalIndex}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            title: detectedTitle,
            pageIndex: globalIndex,
            level: filesToUse.length > 1 ? 1 : 0,
          });

        } else if (mode === "sheet") {
          // Drawing Sheet Heuristics (matches indices like A-101, ME-302, CIVIL-10)
          let drawingNo = "";
          let drawingTitle = "";

          // Regex to locate sheet numbers
          const sheetNumRegex = /\b([a-z]{1,4}-\d{2,4}(?:\.\d+)?|[a-z]{1,4}\d{3,4})\b/i;
          for (const line of lines) {
            const match = line.match(sheetNumRegex);
            if (match) {
              drawingNo = match[1].toUpperCase();
              break;
            }
          }

          if (!drawingNo) {
            const sheetSequenceNum = globalIndex - fileStartPageIndex + 1;
            drawingNo = `S-${sheetSequenceNum.toString().padStart(3, "0")}`;
          }

          // Search typical CAD sheet phrases: PLAN, ELEVATION, DETAIL, SECTIONS, SCHEDULE, NOTES, DIAGRAM
          const blueprintKeywords = ["PLAN", "DETAIL", "ELEVATION", "SECTION", "DIAGRAM", "SCHEDULE", "COVER", "NOTE", "MAP", "DRAWING", "LAYOUT"];
          for (const line of lines) {
            const upper = line.toUpperCase();
            if (
              line.length > 4 && 
              line.length < 50 && 
              blueprintKeywords.some(keyword => upper.includes(keyword)) &&
              !upper.includes(drawingNo)
            ) {
              drawingTitle = line;
              break;
            }
          }

          // General uppercase title selection fallback
          if (!drawingTitle) {
            for (const line of lines) {
              const clean = line.trim();
              if (clean.length > 4 && clean.length < 40 && /^[A-Z]/.test(clean) && !clean.toLowerCase().includes("page")) {
                drawingTitle = clean;
                break;
              }
            }
          }

          if (!drawingTitle) {
            drawingTitle = `Sheet Layout ${globalIndex - fileStartPageIndex + 1}`;
          }

          drawingTitle = drawingTitle.replace(/\s+/g, " ");
          if (drawingTitle.length > 35) {
            drawingTitle = drawingTitle.slice(0, 32) + "...";
          }

          localBookmarks.push({
            id: `local-cad-${globalIndex}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            title: `${drawingNo}: ${drawingTitle}`,
            pageIndex: globalIndex,
            level: filesToUse.length > 1 ? 1 : 0,
          });

        } else {
          // General / Chapter Outlines Mode
          let detectedBookmarkOnPage = false;

          for (const line of lines) {
            const upper = line.toUpperCase();
            const isChapterPrefix = /^(CHAPTER|SECTION|PART|APPENDIX|VOLUME|MODULE|UNIT)\b/i.test(line);
            const isNumberedHeading = /^\b\d+(\.\d+){1,3}\s+[A-Z]/i.test(line) || /^\d+\s+[A-Z][a-z]{2,}/.test(line);
            const isUniversalSection = [
              "INTRODUCTION", "ABSTRACT", "REFERENCES", "CONCLUSION", 
              "BIBLIOGRAPHY", "SUMMARY", "FOREWORD", "PREFACE", 
              "INDEX", "TABLE OF CONTENTS", "GLOSSARY", "SCHEDULING"
            ].includes(upper);

            if (isChapterPrefix || isNumberedHeading || isUniversalSection) {
              let parsedTitle = line.trim().replace(/\s+/g, " ");
              if (parsedTitle.length > 45) {
                parsedTitle = parsedTitle.slice(0, 42) + "...";
              }

              // De-duplicate if the exact same page index and title exists
              const alreadyBookmarked = localBookmarks.some(b => b.title === parsedTitle && b.pageIndex === globalIndex);
              if (!alreadyBookmarked) {
                let currentLevel = 1;

                if (isChapterPrefix || isUniversalSection) {
                  currentLevel = 0;
                } else if (isNumberedHeading && !line.includes(".")) {
                  currentLevel = 0;
                }

                // If multiple files are uploaded, shift level down to put under parent multi-file separator
                if (filesToUse.length > 1) {
                  currentLevel = Math.min(currentLevel + 1, 2) as 0 | 1 | 2;
                }

                localBookmarks.push({
                  id: `local-gen-${globalIndex}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                  title: parsedTitle,
                  pageIndex: globalIndex,
                  level: currentLevel as 0 | 1 | 2,
                });
                detectedBookmarkOnPage = true;
              }
            }
          }

          // Cover/Title page placeholder fallback for document starts
          if (globalIndex === fileStartPageIndex && !detectedBookmarkOnPage) {
            localBookmarks.push({
              id: `local-start-${globalIndex}-${Date.now()}`,
              title: `Cover / Start Page`,
              pageIndex: globalIndex,
              level: filesToUse.length > 1 ? 1 : 0,
            });
          }
        }

        globalIndex++;
      }
    }

    return localBookmarks.sort((a, b) => a.pageIndex - b.pageIndex);
  };

  // Input state for quick manual bookmark
  const [quickTitle, setQuickTitle] = useState("");
  const [quickPage, setQuickPage] = useState(1);
  const [quickLevel, setQuickLevel] = useState(0);

  // Computed layout page representation of fully merged document
  const mergedPages = useMemo(() => {
    const list: {
      id: string;
      fileName: string;
      pageNumberInFile: number;
      overallIndex: number;
      arrayBuffer: ArrayBuffer;
    }[] = [];
    let overallIndex = 0;
    
    for (const file of pdfFiles) {
      for (let i = 1; i <= file.pageCount; i++) {
        list.push({
          id: `${file.id}-page-${i}`,
          fileName: file.name,
          pageNumberInFile: i,
          overallIndex: overallIndex,
          arrayBuffer: file.arrayBuffer,
        });
        overallIndex++;
      }
    }
    return list;
  }, [pdfFiles]);

  // Handle drag and drop files
  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files) as File[];
    await handlePdfFiles(dropped);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files) as File[];
      await handlePdfFiles(selected);
    }
  };

  // Process files, extract page counts, and page content samples
  const handlePdfFiles = async (filesList: File[]) => {
    const pdfs = filesList.filter((f) => f.type === "application/pdf" || f.name.endsWith(".pdf"));
    if (pdfs.length === 0) return;

    setIsProcessingFiles(true);
    setErrorMessage("");
    setStatusMessage("Extracting document contents...");

    try {
      const results: PDFFile[] = [];
      for (const pdfFile of pdfs) {
        setStatusMessage(`Reading file: ${pdfFile.name}`);
        const ab = await pdfFile.arrayBuffer();
        const info = await extractPdfPagesInfo(ab);
        
        results.push({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: pdfFile.name,
          size: pdfFile.size,
          arrayBuffer: ab,
          pageCount: info.pageCount,
          pages: info.pages,
        });
      }
      setPdfFiles((prev) => {
        const next = [...prev, ...results];
        if (autoAnalyzeOnUpload && next.length > 0) {
          const recommendedMode = detectRecommendedMode(next);
          setAiMode(recommendedMode);
          setTimeout(() => {
            generateSmartBookmarks(recommendedMode, next);
          }, 80);
        }
        return next;
      });
      setStatusMessage("");
    } catch (err: any) {
      console.error("File loading error:", err);
      setErrorMessage("Failed to load PDF files. Make sure they are not password protected.");
    } finally {
      setIsProcessingFiles(false);
    }
  };

  // Reorder loaded PDF files
  const handleDragReorder = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= pdfFiles.length || toIndex < 0 || toIndex >= pdfFiles.length) return;
    const updated = [...pdfFiles];
    const draggedItem = updated[fromIndex];
    updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, draggedItem);
    setPdfFiles(updated);
    setStatusMessage("Files reordered!");
    setTimeout(() => setStatusMessage(""), 2000);
  };

  const moveFile = (index: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= pdfFiles.length) return;

    const updated = [...pdfFiles];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    setPdfFiles(updated);
  };

  const removeFile = (id: string) => {
    setPdfFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Sort files alphabetically by name (natural sorting)
  const sortFilesByName = () => {
    setPdfFiles((prev) =>
      [...prev].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      )
    );
    setStatusMessage("Files sorted alphabetically by filename!");
    setTimeout(() => {
      setStatusMessage("");
    }, 3000);
  };

  // Quick manually append bookmark
  const addBookmarkManual = (title: string, pageIdx: number, level: number = 0) => {
    const newBookmark: FlatBookmark = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      title: title.trim() || `Bookmark Page ${pageIdx + 1}`,
      pageIndex: Math.min(Math.max(0, pageIdx), Math.max(0, mergedPages.length - 1)),
      level,
    };
    setBookmarks((prev) => [...prev, newBookmark].sort((a, b) => a.pageIndex - b.pageIndex));
  };

  // Quick boundary bookmarker
  const generateBoundaryBookmarks = () => {
    const bMarks: FlatBookmark[] = [];
    let currentOffset = 0;
    
    pdfFiles.forEach((file) => {
      bMarks.push({
        id: `boundary-${file.id}-${Date.now()}`,
        title: file.name.replace(/\.pdf$/i, ""),
        pageIndex: currentOffset,
        level: 0,
      });
      currentOffset += file.pageCount;
    });

    setBookmarks(bMarks);
    setStatusMessage("Document separator boundaries injected successfully!");
    setTimeout(() => setStatusMessage(""), 3000);
  };

  // Smart Gemini AI & Heuristic Bookmark Generator
  const generateSmartBookmarks = async (
    mode: "general" | "sheet" | "page_titles" = "general",
    targetFiles?: PDFFile[]
  ) => {
    const filesToUse = targetFiles || pdfFiles;
    if (filesToUse.length === 0) {
      setErrorMessage("Please upload PDF files first.");
      return;
    }

    setIsAiGenerating(true);
    setErrorMessage("");

    if (outlineEngine === "local") {
      setAiStatusMessage("Running offline client-side heuristic engine...");
      // Wrap in small timeout to let visual spinner render
      setTimeout(() => {
        try {
          const localResults = generateLocalHeuristicBookmarks(mode, filesToUse);
          setBookmarks(localResults);
          setStatusMessage(
            mode === "sheet"
              ? "Successfully generated Drawing Sheet outlines using offline local heuristics!"
              : mode === "page_titles"
              ? "Successfully extracted individual page titles using offline local heuristics!"
              : "Successfully generated chapter outline using offline local heuristics!"
          );
          setTimeout(() => setStatusMessage(""), 4000);
        } catch (err: any) {
          console.error("Local parsing error:", err);
          setErrorMessage("Failed to run local heuristic parsing: " + err.message);
        } finally {
          setIsAiGenerating(false);
          setAiStatusMessage("");
        }
      }, 150);
      return;
    }

    setAiStatusMessage(
      mode === "sheet"
        ? "Scanning page margins and title blocks for Sheet Names & Drawings..."
        : mode === "page_titles"
        ? "Extracting individual titles and topics for every page..."
        : "Analyzing sections across documents to build structural chapters..."
    );

    try {
      // 1. Prepare text samples for analysis
      const pagesToAnalyze: any[] = [];
      let globalIndex = 0;
      
      for (const file of filesToUse) {
        for (const page of file.pages) {
          pagesToAnalyze.push({
            fileName: file.name,
            pageIndex: globalIndex,
            textSample: page.textSample,
          });
          globalIndex++;
        }
      }

      setAiStatusMessage(
        mode === "sheet"
          ? "Consulting Gemini AI to extract drawing/sheet specifications..."
          : mode === "page_titles"
          ? "Consulting Gemini AI to identify independent page titles..."
          : "Consulting Gemini AI to find headers, section titles and nested sub-chapters..."
      );
      
      // 2. Query server-side Gemini Proxy endpoint
      const response = await fetch("/api/gemini/bookmarks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pages: pagesToAnalyze, mode }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to parse document outline");
      }

      const data = await response.json();
      
      if (data.bookmarks && Array.isArray(data.bookmarks)) {
        const totalPagesCount = filesToUse.reduce((sum, f) => sum + f.pageCount, 0);
        const formattedBookmarks: FlatBookmark[] = data.bookmarks.map((b: any, index: number) => ({
          id: `gemini-bookmark-${index}-${Date.now()}`,
          title: b.title || `Section ${b.pageIndex + 1}`,
          pageIndex: Math.min(Math.max(0, Number(b.pageIndex)), totalPagesCount - 1),
          level: Math.min(Math.max(0, Number(b.level || 0)), 2),
        }));

        // Sort sequentially
        formattedBookmarks.sort((a, b) => a.pageIndex - b.pageIndex);
        setBookmarks(formattedBookmarks);
        setStatusMessage(
          mode === "sheet"
            ? "Gemini AI successfully auto-detected all Drawing Sheet Names!"
            : mode === "page_titles"
            ? "Gemini AI successfully extracted titles for each individual page!"
            : "Gemini AI successfully auto-generated professional hierarchical bookmarks!"
         );
        setTimeout(() => setStatusMessage(""), 4000);
      } else {
        throw new Error("Invalid output layout format received from smart analyzer");
      }
    } catch (err: any) {
      console.warn("Gemini AI key/network not found, running seamless offline fallback:", err);
      try {
        const fallbackResults = generateLocalHeuristicBookmarks(mode, filesToUse);
        setBookmarks(fallbackResults);
        setStatusMessage("Offline Graceful Fallback: Auto-Generated layout using offline text parser!");
        setTimeout(() => setStatusMessage(""), 5000);
      } catch (fallbackErr: any) {
        setErrorMessage("Offline fallback analysis failed: " + fallbackErr.message);
      }
    } finally {
      setIsAiGenerating(false);
      setAiStatusMessage("");
    }
  };

  // Modify individual bookmark fields inline
  const updateBookmarkField = (id: string, field: "title" | "pageIndex" | "level", value: any) => {
    setBookmarks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        
        let val = value;
        if (field === "pageIndex") {
          val = Math.min(Math.max(0, parseInt(value) || 0), mergedPages.length - 1);
        } else if (field === "level") {
          val = Math.min(Math.max(0, parseInt(value) || 0), 2);
        }
        
        return { ...b, [field]: val };
      }).sort((a, b) => {
        if (a.pageIndex !== b.pageIndex) {
          return a.pageIndex - b.pageIndex;
        }
        return a.level - b.level;
      })
    );
  };

  const removeBookmark = (id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  };

  const clearAllBookmarks = () => {
    setBookmarks([]);
  };

  const exportBookmarksToJSON = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(bookmarks, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", "pdf_bookmarks_config.json");
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setStatusMessage("Bookmarks successfully exported as JSON file!");
      setTimeout(() => setStatusMessage(""), 3000);
    } catch (err: any) {
      setErrorMessage("Failed to export configuration: " + err.message);
    }
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const resultStr = event.target?.result as string;
        const parsed = JSON.parse(resultStr);
        
        let importedList: any[] = [];
        if (Array.isArray(parsed)) {
          importedList = parsed;
        } else if (parsed && Array.isArray(parsed.bookmarks)) {
          importedList = parsed.bookmarks;
        } else {
          throw new Error("Invalid configuration format. Must contain a flat list of bookmarks.");
        }

        // Map and validate the elements
        const validated: FlatBookmark[] = importedList.map((item: any, idx: number) => {
          if (typeof item.title !== "string" || typeof item.pageIndex !== "number") {
            throw new Error(`Bookmark at index ${idx} is missing or has invalid "title" or "pageIndex" fields.`);
          }
          return {
            id: item.id || `imported-bookmark-${idx}-${Date.now()}`,
            title: item.title,
            pageIndex: parseInt(item.pageIndex) || 0,
            level: typeof item.level === "number" ? Math.min(Math.max(0, item.level), 2) : 0,
          };
        });

        setBookmarks(validated);
        setStatusMessage(`Successfully imported ${validated.length} bookmarks from JSON configuration!`);
        setTimeout(() => setStatusMessage(""), 4000);
      } catch (err: any) {
        setErrorMessage("Failed to import configuration: " + err.message);
      } finally {
        // Reset value to allow uploading the same file again
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  // Helper to copy config/terminal code to clipboard
  const handleCopyInstallerText = (text: string, key: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedText(key);
      setTimeout(() => setCopiedText(null), 3500);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  };

  // Automated client-side launcher downloads
  const downloadLocalInstallerScript = (type: "bat" | "sh" | "tauri" | "electron") => {
    try {
      let content = "";
      let filename = "";
      let mimeType = "text/plain";

      const currentOrigin = window.location.origin;

      if (type === "bat") {
        content = `@echo off\r\n` +
          `title PDF Merger & Auto Bookmarker Standalone Launcher\r\n` +
          `color 0B\r\n` +
          `echo =============================================================\r\n` +
          `echo   LAUNCHING OFFLINE CLIENT-SIDE PDF BOOKMARKER ON WINDOWS\r\n` +
          `echo =============================================================\r\n` +
          `echo.\n` +
          `echo Opening standalone workspace app window in Edge App frame...\r\n` +
          `start msedge --app="${currentOrigin}"\r\n` +
          `echo Done. A standalone native frame has loaded. Enjoy!\r\n` +
          `timeout /t 3 >nul\r\n` +
          `exit\r\n`;
        filename = "install_and_run_windows.bat";
        mimeType = "application/bat";
      } else if (type === "sh") {
        content = `#!/bin/bash\n` +
          `# Standalone application frame launcher for macOS & Linux\n` +
          `echo "============================================================="\n` +
          `echo "  LAUNCHING OFFLINE CLIENT-SIDE PDF BOOKMARKER ON macOS/LINUX"\n` +
          `echo "============================================================="\n` +
          `echo ""\n` +
          `echo "Detecting Google Chrome to open in Standalone Borderless Mode..."\n` +
          `if [ "$(uname)" == "Darwin" ]; then\n` +
          `  open -na "Google Chrome" --args --app="${currentOrigin}" || open "${currentOrigin}"\n` +
          `else\n` +
          `  google-chrome --app="${currentOrigin}" || xdg-open "${currentOrigin}"\n` +
          `fi\n` +
          `echo "Standalone desktop container launched successfully!"\n`;
        filename = "install_and_run_mac.sh";
        mimeType = "application/x-sh";
      } else if (type === "tauri") {
        const tauriConfig = {
          build: {
            beforeDevCommand: "npm run dev",
            beforeBuildCommand: "npm run build",
            devPath: "http://localhost:3001",
            distDir: "../dist"
          },
          package: {
            productName: "PDFBookmarker",
            version: "1.0.0"
          },
          tauri: {
            allowlist: {
              all: true
            },
            bundle: {
              active: true,
              category: "Office",
              icon: ["icons/128x128.png", "icons/512x512.png"],
              identifier: "com.pdfbookmarker.app",
              publisher: "LocalOfflineTools",
              targets: ["msi", "appimage", "dmg"]
            },
            windows: [
              {
                title: "PDF Merger & Auto Bookmarker Standalone",
                width: 1200,
                height: 800,
                resizable: true,
                fullscreen: false
              }
            ]
          }
        };
        content = JSON.stringify(tauriConfig, null, 2);
        filename = "tauri.conf.json";
        mimeType = "application/json";
      } else if (type === "electron") {
        content = `// Electron Desktop Entrypoint main.js\n` +
          `const { app, BrowserWindow } = require('electron');\n` +
          `const path = require('path');\n\n` +
          `function createWindow () {\n` +
          `  const win = new BrowserWindow({\n` +
          `    width: 1280,\n` +
          `    height: 850,\n` +
          `    title: "PDF Merger & Auto Bookmarker Client",\n` +
          `    webPreferences: {\n` +
          `      nodeIntegration: false,\n` +
          `      contextIsolation: true\n` +
          `    }\n` +
          `  });\n\n` +
          `  // Load the web app directly, completely bypass routing\n` +
          `  win.loadURL("${currentOrigin}");\n` +
          `  win.setMenu(null); // Clean menu bars\n` +
          `}\n\n` +
          `app.whenReady().then(() => {\n` +
          `  createWindow();\n` +
          `  app.on('activate', () => {\n` +
          `    if (BrowserWindow.getAllWindows().length === 0) createWindow();\n` +
          `  });\n` +
          `});\n\n` +
          `app.on('window-all-closed', () => {\n` +
          `  if (process.platform !== 'darwin') app.quit();\n` +
          `});\n`;
        filename = "electron-main.js";
        mimeType = "text/javascript";
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.setAttribute("href", url);
      anchor.setAttribute("download", filename);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      
      setStatusMessage(`Successfully downloaded ${filename} binary configuration!`);
      setTimeout(() => setStatusMessage(""), 3500);
    } catch (err: any) {
      setErrorMessage("Failed code export: " + err.message);
    }
  };

  // Merge & compile using pdf-lib client-side
  const compilePdfOutput = async () => {
    if (pdfFiles.length === 0) {
      setErrorMessage("Nothing to merge. Please select file inputs.");
      return;
    }

    setIsCompiling(true);
    setErrorMessage("");
    setStatusMessage("Compiling and injecting bookmark structures into binary PDF stream...");

    try {
      const mergedBytes = await mergeAndCompilePdf(pdfFiles, bookmarks);
      
      // Download file to user device directly
      const blob = new Blob([mergedBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      
      // Deduce download file name
      const firstFileName = pdfFiles[0].name.replace(/\.pdf$/i, "");
      const downloadName = pdfFiles.length > 1 
        ? `${firstFileName}_merged_with_bookmarks.pdf`
        : `${firstFileName}_bookmarked.pdf`;

      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setStatusMessage("Merged PDF successfully compiled and downloaded!");
      setTimeout(() => setStatusMessage(""), 4000);
    } catch (err: any) {
      console.error("Compilation error:", err);
      setErrorMessage("Merging error: " + (err.message || "Failed to package output binary stream."));
    } finally {
      setIsCompiling(false);
    }
  };

  return (
    <div id="root-dashboard-app" className="min-h-screen bg-[#FBFBFC] text-neutral-800 flex flex-col font-sans transition-colors duration-200">
      
      {/* Sleek Top Header Navigation */}
      <header id="app-header" className="sticky top-0 bg-white/90 backdrop-blur border-b border-neutral-200/80 z-20 px-6 py-4 transition-all shadow-sm">
        <div id="header-container" className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div id="header-branding" className="flex items-center space-x-3 select-none">
            <div id="logo-icon-container" className="bg-gradient-to-tr from-indigo-500 to-indigo-700 text-white p-2.5 rounded-xl shadow-md shadow-indigo-200">
              <Sparkles id="sparkles-logo" className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h1 id="app-title-display" className="text-xl font-bold tracking-tight text-neutral-900">
                PDF Merger & Auto Bookmarker
              </h1>
              <p id="app-subtitle-display" className="text-xs text-neutral-500 font-medium">
                Combine PDF documents and generate automated hierarchical outlines using Gemini AI
              </p>
            </div>
          </div>
          
          <div id="header-stats-badge" className="flex items-center gap-3">
            {pdfFiles.length > 0 && (
              <span id="badge-files-count" className="text-xs font-semibold px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100/50">
                {pdfFiles.length} {pdfFiles.length === 1 ? "File" : "Files"} ({mergedPages.length} Pages)
              </span>
            )}
            {bookmarks.length > 0 && (
              <span id="badge-bookmarks-count" className="text-xs font-semibold px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100/50">
                {bookmarks.length} Bookmarks Scheduled
              </span>
            )}
            <button
              id="header-btn-installer-hub"
              onClick={() => setShowInstallerPanel(!showInstallerPanel)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border shadow-sm transition-all cursor-pointer select-none ${
                showInstallerPanel
                  ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
                  : "bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100"
              }`}
              title="Open Windows, macOS, Android, & iOS standalone apps setup panel"
            >
              <Laptop className="w-3.5 h-3.5 animate-bounce" />
              <span>Install Offline Apps</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <main id="app-main-workspace" className="flex-grow max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Standalone Desktop & Mobile Installer Hub Panel */}
        <AnimatePresence>
          {showInstallerPanel && (
            <motion.div
              id="installer-hub-dashboard"
              initial={{ opacity: 0, scale: 0.98, height: 0 }}
              animate={{ opacity: 1, scale: 1, height: "auto" }}
              exit={{ opacity: 0, scale: 0.98, height: 0 }}
              className="lg:col-span-12 w-full bg-linear-to-b from-neutral-900 to-neutral-950 text-white rounded-3xl p-6 border border-neutral-800 shadow-xl overflow-hidden flex flex-col gap-6"
            >
              {/* Header Information */}
              <div id="inst-header" className="flex items-start justify-between flex-wrap gap-4 border-b border-neutral-800 pb-5">
                <div id="inst-header-left">
                  <div id="inst-title-badge" className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-400/20 rounded-full text-indigo-400 text-[10px] font-extrabold tracking-wider uppercase mb-2">
                    <Layers className="w-3 h-3 text-indigo-400" />
                    Multi-Platform Offline Ecosystem
                  </div>
                  <h2 id="inst-title" className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                    Standalone App Distribution & Installer Hub
                  </h2>
                  <p id="inst-desc" className="text-xs text-neutral-400 mt-1 max-w-[720px] leading-relaxed">
                    This PDF Bookmarker application runs **100% inside local browser storage**. It requires zero database servers, zero third-party cloud hosting, and can be easily installed on your local systems to operate completely offline.
                  </p>
                </div>
                <button
                  id="btn-close-inst-panel"
                  onClick={() => setShowInstallerPanel(false)}
                  className="px-3 py-1.5 text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-xl transition-all cursor-pointer select-none"
                >
                  Hide Settings
                </button>
              </div>

              {/* Platform Selector Grid Tabbed Menu */}
              <div id="inst-tabs-container" className="grid grid-cols-2 md:grid-cols-4 bg-neutral-900/50 p-1.5 rounded-2xl border border-neutral-800 gap-1.5">
                <button
                  id="tab-inst-windows"
                  onClick={() => setActivePlatform("windows")}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
                    activePlatform === "windows"
                      ? "bg-indigo-600 text-white shadow-md border border-indigo-400/20 scale-[1.01]"
                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40"
                  }`}
                >
                  <Monitor className="w-4 h-4 shrink-0" />
                  <span>Windows (.EXE / .BAT)</span>
                </button>
                <button
                  id="tab-inst-mac"
                  onClick={() => setActivePlatform("mac")}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
                    activePlatform === "mac"
                      ? "bg-indigo-600 text-white shadow-md border border-indigo-400/20 scale-[1.01]"
                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40"
                  }`}
                >
                  <Laptop className="w-4 h-4 shrink-0" />
                  <span>macOS / Linux (.SH)</span>
                </button>
                <button
                  id="tab-inst-android"
                  onClick={() => setActivePlatform("android")}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
                    activePlatform === "android"
                      ? "bg-indigo-600 text-white shadow-md border border-indigo-400/20 scale-[1.01]"
                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40"
                  }`}
                >
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <span>Android (.APK Wrapper)</span>
                </button>
                <button
                  id="tab-inst-ios"
                  onClick={() => setActivePlatform("ios")}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
                    activePlatform === "ios"
                      ? "bg-indigo-600 text-white shadow-md border border-indigo-400/20 scale-[1.01]"
                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40"
                  }`}
                >
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <span>iOS Safari PWA</span>
                </button>
              </div>

              {/* Dynamic Content Display */}
              <div id="inst-dynamic-display" className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-2xl">
                
                {activePlatform === "windows" && (
                  <div id="panel-windows" className="flex flex-col gap-6">
                    <div id="win-prime-method" className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
                      <div className="md:col-span-8">
                        <span className="text-[9px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full font-extrabold uppercase border border-emerald-500/20">Method 1 • Quick Standalone App</span>
                        <h3 className="font-extrabold text-base text-white mt-1.5 flex items-center gap-1.5">
                          Instant Desktop Window Launcher
                        </h3>
                        <p className="text-xs text-neutral-400 mt-1 max-w-[580px] leading-relaxed">
                          Creates a custom borderless Windows execution launcher. When double-clicked, it loads the PDF Bookmarker in a dedicated native window without any typical browser tabs, toolbars, or distractions.
                        </p>
                      </div>
                      <div className="md:col-span-4 flex justify-start md:justify-end">
                        <button
                          id="btn-dl-win-bat"
                          onClick={() => downloadLocalInstallerScript("bat")}
                          className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 bg-white text-neutral-900 hover:bg-neutral-100 rounded-xl text-xs font-extrabold transition-all cursor-pointer shadow-md select-none"
                        >
                          <Download className="w-4 h-4 text-neutral-800" />
                          <span>Download Windows Launcher (.BAT)</span>
                        </button>
                      </div>
                    </div>

                    <hr className="border-neutral-800" />

                    <div id="win-sec-method">
                      <span className="text-[9px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full font-extrabold uppercase border border-indigo-400/20">Method 2 • Tauri Compiler Code</span>
                      <h3 className="font-extrabold text-sm text-white mt-2 flex items-center gap-1.5">
                        Compile into standard native Desktop Installers (.msi / .exe)
                      </h3>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        To bundle this offline app into an official offline-run executable, you can use **Tauri** (the ultra-lightweight alternative to Electron). Follow these simple steps:
                      </p>

                      <ol className="list-decimal pl-4 mt-3 text-xs text-neutral-300 space-y-2.5">
                        <li>
                          Initialize tauri inside your current local web project folder:
                          <div className="bg-neutral-950 p-2.5 rounded-lg font-mono text-[11px] text-indigo-300 mt-1 border border-neutral-800 relative flex items-center justify-between">
                            <span>npm i -D @tauri-apps/cli</span>
                            <button
                              onClick={() => handleCopyInstallerText("npm i -D @tauri-apps/cli", "npm_tauri")}
                              className="text-[10px] px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded"
                            >
                              {copiedText === "npm_tauri" ? "Copied!" : "Copy"}
                            </button>
                          </div>
                        </li>
                        <li>
                          Click the button below to download the pre-built configuration template:
                          <div className="mt-2.5 flex items-center gap-2">
                            <button
                              id="btn-dl-tauri-json"
                              onClick={() => downloadLocalInstallerScript("tauri")}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-indigo-300 border border-neutral-700/60 rounded-lg text-xs font-bold transition-all cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download tauri.conf.json</span>
                            </button>
                            <span className="text-[10px] text-neutral-500 font-medium">Place this file inside a newly created <code className="text-indigo-400 font-mono">src-tauri/</code> folder.</span>
                          </div>
                        </li>
                        <li>
                          Compile your source code into a standalone lightweight Windows `.exe` installer setup (which is created under folder <code className="text-indigo-400 font-mono">src-tauri/target/bundle/msi/</code>):
                          <div className="bg-neutral-950 p-2.5 rounded-lg font-mono text-[11px] text-indigo-300 mt-1 border border-neutral-800 relative flex items-center justify-between">
                            <span>npx tauri build</span>
                            <button
                              onClick={() => handleCopyInstallerText("npx tauri build", "npx_tauri")}
                              className="text-[10px] px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded"
                            >
                              {copiedText === "npx_tauri" ? "Copied!" : "Copy"}
                            </button>
                          </div>
                        </li>
                      </ol>
                    </div>
                  </div>
                )}

                {activePlatform === "mac" && (
                  <div id="panel-mac" className="flex flex-col gap-6">
                    <div id="mac-prime-method" className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
                      <div className="md:col-span-8">
                        <span className="text-[9px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full font-extrabold uppercase border border-emerald-500/20">Method 1 • Quick UNIX Standalone App</span>
                        <h3 className="font-extrabold text-base text-white mt-1.5 flex items-center gap-1.5">
                          Instant Mac/Linux Shell Launcher
                        </h3>
                        <p className="text-xs text-neutral-400 mt-1 max-w-[580px] leading-relaxed">
                          Downloads a safe standalone script for Mac & Linux. When executed, it launches the web interface instantly in Apple Chrome's kiosk standalone frame mode.
                        </p>
                      </div>
                      <div className="md:col-span-4 flex justify-start md:justify-end">
                        <button
                          id="btn-dl-mac-sh"
                          onClick={() => downloadLocalInstallerScript("sh")}
                          className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 bg-white text-neutral-900 hover:bg-neutral-100 rounded-xl text-xs font-extrabold transition-all cursor-pointer shadow-md select-none"
                        >
                          <Download className="w-4 h-4 text-neutral-800" />
                          <span>Mac/Linux Launcher (.SH)</span>
                        </button>
                      </div>
                    </div>

                    <hr className="border-neutral-800" />

                    <div id="mac-sec-method">
                      <span className="text-[9px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full font-extrabold uppercase border border-indigo-400/20">Method 2 • Electron Compilation</span>
                      <h3 className="font-extrabold text-sm text-white mt-1.5 flex items-center gap-1.5">
                        Bundle into beautiful macOS .dmg or .app packages
                      </h3>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        Create an native Mac window wrapper using **Electron**. Execute the following local terminal steps inside your app repository:
                      </p>

                      <ol className="list-decimal pl-4 mt-3 text-xs text-neutral-300 space-y-2.5">
                        <li>
                          Install the electron dependencies inside your project:
                          <div className="bg-neutral-950 p-2.5 rounded-lg font-mono text-[11px] text-indigo-300 mt-1 border border-neutral-800 relative flex items-center justify-between">
                            <span>npm i --save-dev electron electron-builder</span>
                            <button
                              onClick={() => handleCopyInstallerText("npm i --save-dev electron electron-builder", "mac_npm")}
                              className="text-[10px] px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded"
                            >
                              {copiedText === "mac_npm" ? "Copied!" : "Copy"}
                            </button>
                          </div>
                        </li>
                        <li>
                          Click below to download the native Electron helper main script:
                          <div className="mt-2.5 flex items-center gap-2">
                            <button
                              id="btn-dl-mac-electron"
                              onClick={() => downloadLocalInstallerScript("electron")}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-indigo-300 border border-neutral-700/60 rounded-lg text-xs font-bold transition-all cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download electron-main.js</span>
                            </button>
                            <span className="text-[10px] text-neutral-500 font-medium">Keep this file at the root level of your project folders.</span>
                          </div>
                        </li>
                        <li>
                          Instantly trigger compilation packaging for Apple architectures:
                          <div className="bg-neutral-950 p-2.5 rounded-lg font-mono text-[11px] text-indigo-300 mt-1 border border-neutral-800 relative flex items-center justify-between">
                            <span>npx electron-builder build --mac</span>
                            <button
                              onClick={() => handleCopyInstallerText("npx electron-builder build --mac", "mac_compile")}
                              className="text-[10px] px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded"
                            >
                              {copiedText === "mac_compile" ? "Copied!" : "Copy"}
                            </button>
                          </div>
                        </li>
                      </ol>
                    </div>
                  </div>
                )}

                {activePlatform === "android" && (
                  <div id="panel-android" className="flex flex-col gap-6">
                    <div id="android-prime">
                      <span className="text-[9px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full font-extrabold uppercase border border-emerald-500/20">Method 1 • Quick Browser Home Screen Install</span>
                      <h3 className="font-extrabold text-base text-white mt-1.5 flex items-center gap-1.5">
                        Add Standalone Android App (Zero Downloads)
                      </h3>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        Because our PDF tool implements a modern, robust **Progressive Web App (PWA)** cache framework, you can install it instantly without using any App Stores or downloading foreign installer files!
                      </p>

                      <ul className="list-disc pl-4 mt-3 text-xs text-neutral-300 space-y-2">
                        <li>Open this URL inside the mobile <strong className="text-indigo-400">Google Chrome</strong> or <strong className="text-indigo-400">Microsoft Edge</strong> browser on your Android tablet or phone.</li>
                        <li>Click the browser menu (the three vertical dots <strong className="text-neutral-400">⁝</strong> at the top-right corner of the browser app).</li>
                        <li>Tap <strong className="text-indigo-300 font-bold">"Install app"</strong> or <strong className="text-indigo-300 font-bold">"Add to Home screen"</strong>.</li>
                        <li>A native launch icon is placed on your launcher screen, running in a full-screen hardware-accelerated standalone offline container!</li>
                      </ul>
                    </div>

                    <hr className="border-neutral-800" />

                    <div id="android-sec">
                      <span className="text-[9px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full font-extrabold uppercase border border-indigo-400/20">Method 2 • Capacitor Build Tools</span>
                      <h3 className="font-extrabold text-sm text-white mt-2">
                        Compile into standard native Android installer package (.apk)
                      </h3>
                      <p className="text-xs text-neutral-400 mt-1 max-w-[620px] leading-relaxed">
                        To build a highly customized binary installation package suitable for Android deployment, you can use **CapacitorJS**. Run the following commands:
                      </p>

                      <div className="bg-neutral-950 p-4 rounded-xl font-mono text-[11px] text-indigo-300 mt-3 border border-neutral-800 flex flex-col gap-2">
                        <div className="flex items-center justify-between border-b border-neutral-900 pb-1.5 mb-1.5">
                          <span className="text-neutral-500 font-bold text-[9px] uppercase tracking-wider">Capacitor Android Commands</span>
                          <button
                            onClick={() => handleCopyInstallerText("npm i @capacitor/core @capacitor/cli && npx cap init && npx cap add android && npx cap run android", "caps_android")}
                            className="bg-neutral-900 hover:bg-neutral-800 px-2 py-1 text-[10px] text-neutral-400 hover:text-white rounded transition-colors"
                          >
                            {copiedText === "caps_android" ? "Copied!" : "Copy Suite"}
                          </button>
                        </div>
                        <div># 1. Install Capacitor packages</div>
                        <div className="text-white">npm i @capacitor/core @capacitor/cli</div>
                        <div># 2. Setup your mobile app settings & bundle identifiers</div>
                        <div className="text-white">npx cap init</div>
                        <div># 3. Compile source code files, then inject platform targets</div>
                        <div className="text-white">npm run build && npx cap add android</div>
                        <div># 4. Open in Android Studio to build alignment and package .APK files!</div>
                        <div className="text-white">npx cap open android</div>
                      </div>
                    </div>
                  </div>
                )}

                {activePlatform === "ios" && (
                  <div id="panel-ios" className="flex flex-col gap-6">
                    <div id="ios-prime">
                      <span className="text-[9px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full font-extrabold uppercase border border-emerald-500/20">Primary Method • Safe iOS Native Standalone App</span>
                      <h3 className="font-extrabold text-base text-white mt-1.5 flex items-center gap-1.5">
                        Add to Home Screen in Safari
                      </h3>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        iOS Safari includes a built-in highly secure method to install single-page tools directly onto your home screen, without sandbox or App Store restrictions:
                      </p>

                      <ul className="list-disc pl-4 mt-3 text-xs text-neutral-300 space-y-2.5">
                        <li>Open this URL inside the native <strong className="text-indigo-400">Safari</strong> browser application on your iPhone, iPad, or iPod touch.</li>
                        <li>Tap the official App <strong className="text-indigo-300">"Share" button</strong> (represented by the square drawer icon with an arrow pointing upwards at the bottom menu header).</li>
                        <li>Scroll down through the item options list and tap the option labeled <strong className="text-indigo-400 font-extrabold">"Add to Home Screen"</strong>.</li>
                        <li>Specify your custom name and tap <strong className="text-indigo-400 font-bold">Add</strong>.</li>
                        <li>The PDF tool is now ready on your home screen, bypassing App Store limits, running with its own dedicated isolated local memory cache, offline compatibility, and borderless window frames!</li>
                      </ul>
                    </div>

                    <hr className="border-neutral-800" />

                    <div id="ios-sec">
                      <span className="text-[9px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full font-extrabold uppercase border border-indigo-400/20">Advanced Method • Capacitor Wrapper for iOS AppStore</span>
                      <h3 className="font-extrabold text-sm text-white mt-2">
                        Bundle into native iOS Xcode target (.ipa Package)
                      </h3>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        Create standard iOS targets by combining Capacitor configuration options locally with macOS Xcode tools:
                      </p>

                      <div className="bg-neutral-950 p-4 rounded-xl font-mono text-[11px] text-indigo-300 mt-3 border border-neutral-800 flex flex-col gap-2">
                        <div className="flex items-center justify-between border-b border-neutral-900 pb-1.5 mb-1.5">
                          <span className="text-neutral-500 font-bold text-[9px] uppercase tracking-wider">iOS Xcode Integration Commands</span>
                          <button
                            onClick={() => handleCopyInstallerText("npm i @capacitor/core @capacitor/cli && npx cap init && npx cap add ios && npx cap open ios", "caps_ios")}
                            className="bg-neutral-900 hover:bg-neutral-800 px-2 py-1 text-[10px] text-neutral-400 hover:text-white rounded transition-colors"
                          >
                            {copiedText === "caps_ios" ? "Copied!" : "Copy Suite"}
                          </button>
                        </div>
                        <div># 1. Install Capacitor</div>
                        <div className="text-white">npm i @capacitor/core @capacitor/cli</div>
                        <div># 2. Initialize and configure workspace inputs</div>
                        <div className="text-white">npx cap init</div>
                        <div># 3. Add Xcode platform target folder structure</div>
                        <div className="text-white">npm run build && npx cap add ios</div>
                        <div># 4. Launch Apple Xcode locally to test, run, and sign the application!</div>
                        <div className="text-white">npx cap open ios</div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Left Hand Workspace Frame: Input & Page Previews (lg:span-6) */}
        <section id="workspace-left-pane" className="lg:col-span-6 flex flex-col gap-6 w-full">
          
          {/* Drag & Drop File Loader Card */}
          <div
            id="drag-and-drop-stage-card"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className="border-2 border-dashed border-neutral-300 rounded-2xl p-6 bg-white flex flex-col items-center justify-center text-center hover:border-indigo-500 cursor-pointer transition-all shadow-sm hover:shadow-md h-[180px] relative overflow-hidden group"
          >
            <input
              id="file-hidden-input"
              type="file"
              multiple
              accept="application/pdf"
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleFileSelect}
            />
            <div id="upload-graphics" className="p-3 bg-neutral-50 rounded-full text-neutral-500 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-all mb-3">
              <Upload id="upload-icon" className="w-6 h-6" />
            </div>
            <p id="upload-txt-prime" className="text-sm font-semibold text-neutral-800">
              Drag & drop PDF files here, or <span className="text-indigo-600 group-hover:underline">browse files</span>
            </p>
            <p id="upload-txt-sec" className="text-xs text-neutral-400 mt-1">
              Supports loading multiple local documents
            </p>
          </div>

          {/* Loaded PDF Management Cards Section */}
          {pdfFiles.length > 0 && (
            <div id="sources-management-card" className="bg-white rounded-2xl p-5 border border-neutral-200/80 shadow-sm flex flex-col gap-4">
              <div id="sources-header" className="flex items-center justify-between border-b border-neutral-100 pb-3">
                <div id="sources-header-titles" className="flex flex-col">
                  <h3 id="sources-title" className="font-bold text-neutral-900 text-sm flex items-center gap-2">
                    <FileText id="sources-title-icon" className="w-4.5 h-4.5 text-neutral-500" />
                    Rearrange Document Order
                  </h3>
                  <span id="sources-caption" className="text-xs text-neutral-400 mt-0.5">
                    Merge sequence matches order below
                  </span>
                </div>
                
                <button
                  id="btn-sort-files-alphabetically"
                  onClick={sortFilesByName}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100/80 border border-indigo-100 rounded-lg transition-all cursor-pointer shadow-xs hover:shadow-xs shrink-0 select-none"
                  title="Arrange all loaded documents by filename order (A-Z)"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 shrink-0" />
                  <span>Arrange A-Z</span>
                </button>
              </div>

              <div id="sources-list" className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {pdfFiles.map((file, idx) => (
                    <motion.div
                      id={`file-card-${file.id}`}
                      key={file.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      draggable
                      onDragStart={() => {
                        setDraggedFileIndex(idx);
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnter={() => setDragOverFileIndex(idx)}
                      onDragEnd={() => {
                        setDraggedFileIndex(null);
                        setDragOverFileIndex(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggedFileIndex !== null && draggedFileIndex !== idx) {
                          handleDragReorder(draggedFileIndex, idx);
                        }
                        setDraggedFileIndex(null);
                        setDragOverFileIndex(null);
                      }}
                      className={`flex items-center justify-between p-3 bg-white border rounded-xl transition-all gap-2.5 cursor-grab active:cursor-grabbing select-none ${
                        draggedFileIndex === idx
                          ? "opacity-40 border-dashed border-indigo-400 bg-neutral-50"
                          : dragOverFileIndex === idx
                          ? "border-indigo-500 bg-indigo-50/40 scale-[1.01] shadow-xs"
                          : "border-neutral-200/80 hover:border-indigo-200/60 shadow-2xs hover:bg-indigo-50/10"
                      }`}
                    >
                      <div id={`file-grip-${file.id}`} className="text-neutral-400 hover:text-indigo-500 transition-colors shrink-0 flex items-center pointer-events-none">
                        <GripVertical id={`grip-icon-${file.id}`} className="w-4 h-4" />
                      </div>

                      <div id={`file-card-details-${file.id}`} className="min-w-0 flex-grow">
                        <div id={`file-card-meta-${file.id}`} className="flex items-center gap-2 mb-0.5">
                          <span id={`file-card-badge-${file.id}`} className="text-[10px] font-bold px-2 py-0.5 bg-orange-100 text-orange-800 rounded">
                            PDF
                          </span>
                          <span id={`file-card-name-${file.id}`} className="text-xs font-semibold text-neutral-800 truncate block">
                            {file.name}
                          </span>
                        </div>
                        <span id={`file-card-size-${file.id}`} className="text-[10px] text-neutral-400">
                          {(file.size / (1024 * 1024)).toFixed(2)} MB • {file.pageCount} {file.pageCount === 1 ? "page" : "pages"}
                        </span>
                      </div>

                      <div id={`file-card-controls-${file.id}`} className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          id={`btn-move-up-${file.id}`}
                          onClick={() => moveFile(idx, "up")}
                          disabled={idx === 0}
                          className="p-1 px-1.5 rounded bg-white hover:bg-neutral-100 border border-neutral-200 text-neutral-600 disabled:opacity-40 transition-all cursor-pointer"
                          title="Move up"
                        >
                          <ArrowUp id={`icon-up-${file.id}`} className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`btn-move-down-${file.id}`}
                          onClick={() => moveFile(idx, "down")}
                          disabled={idx === pdfFiles.length - 1}
                          className="p-1 px-1.5 rounded bg-white hover:bg-neutral-100 border border-neutral-200 text-neutral-600 disabled:opacity-40 transition-all cursor-pointer"
                          title="Move down"
                        >
                          <ArrowDown id={`icon-down-${file.id}`} className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`btn-remove-file-${file.id}`}
                          onClick={() => removeFile(file.id)}
                          className="p-1 px-1.5 rounded bg-red-50 hover:bg-red-100 border border-red-200/60 text-red-600 transition-all cursor-pointer"
                          title="Remove file"
                        >
                          <Trash2 id={`icon-remove-${file.id}`} className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Overall Pages visual layout grid */}
          {mergedPages.length > 0 && (
            <div id="pages-layout-stage" className="bg-white rounded-2xl p-5 border border-neutral-200/80 shadow-sm flex flex-col gap-4">
              <div id="pages-stage-header" className="flex items-center justify-between border-b border-neutral-100 pb-3">
                <h3 id="pages-stage-title" className="font-bold text-neutral-900 text-sm">
                  Document Page Layout Visualizer
                </h3>
                <span id="pages-stage-counter" className="text-xs text-indigo-600 font-semibold bg-indigo-50/50 px-2 py-0.5 rounded">
                  {mergedPages.length} Pages Total
                </span>
              </div>

              <div id="pages-scroller-grid" className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-h-[500px] overflow-y-auto p-1 bg-neutral-50/30 border border-neutral-100 rounded-xl">
                {mergedPages.map((pg) => {
                  const isPageBookmarked = bookmarks.some((b) => b.pageIndex === pg.overallIndex);
                  
                  return (
                    <div
                      id={`page-card-container-${pg.overallIndex}`}
                      key={pg.id}
                      className="relative border border-neutral-200 bg-white rounded-xl p-3 shadow-none hover:shadow-md hover:border-indigo-300 transition-all flex flex-col gap-2 text-center group"
                    >
                      {/* Page index badge */}
                      <span id={`page-badge-index-${pg.overallIndex}`} className="absolute top-2 left-2 text-[10px] font-bold bg-neutral-800 text-white w-6 h-5 flex items-center justify-center rounded">
                        #{pg.overallIndex + 1}
                      </span>

                      {/* Bookmark status trigger indicator */}
                      {isPageBookmarked && (
                        <div id={`page-bookmark-indicator-${pg.overallIndex}`} className="absolute top-2 right-2 p-1 bg-emerald-100 text-emerald-800 rounded shadow-sm" title="Already Bookmarked">
                          <Bookmark id={`indicator-icon-${pg.overallIndex}`} className="w-3 h-3 fill-emerald-800 text-emerald-800" />
                        </div>
                      )}

                      {/* Draw Page Thumbnail using Canvas loader */}
                      <PageThumbnail arrayBuffer={pg.arrayBuffer} pageNumber={pg.pageNumberInFile} />
                      
                      {/* Page Info */}
                      <div id={`page-card-meta-${pg.overallIndex}`} className="mt-1">
                        <span id={`page-meta-source-${pg.overallIndex}`} className="text-[10px] font-semibold text-neutral-600 block line-clamp-1 truncate" title={pg.fileName}>
                          {pg.fileName}
                        </span>
                        <span id={`page-meta-fileindex-${pg.overallIndex}`} className="text-[9px] text-neutral-400">
                          p.{pg.pageNumberInFile}
                        </span>
                      </div>

                      {/* Quick bookmark Hover Action Button */}
                      <button
                        id={`btn-hover-bookmark-${pg.overallIndex}`}
                        onClick={() => addBookmarkManual(`Section on Page ${pg.overallIndex + 1}`, pg.overallIndex, 1)}
                        className="opacity-0 group-hover:opacity-100 absolute inset-0 bg-neutral-900/60 transition-all flex flex-col items-center justify-center text-white rounded-xl"
                      >
                        <PlusCircle id={`hover-icon-bookmark-${pg.overallIndex}`} className="w-8 h-8 drop-shadow-md text-white fill-white/20 mb-1" />
                        <span id={`hover-txt-bookmark-${pg.overallIndex}`} className="text-[10px] font-bold tracking-wider uppercase">
                          Add Bookmark
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </section>

        {/* Right Hand Bookmark Builder Workspace Pane: Outlines and Actions (lg:span-6) */}
        <section id="workspace-right-pane" className="lg:col-span-6 flex flex-col gap-6 w-full">
          
          {/* Smart Automated Controls card */}
          <div id="ai-smart-actions-card" className="bg-white rounded-2xl p-5 border border-neutral-200/80 shadow-sm flex flex-col gap-4">
            <div id="ai-actions-header" className="flex items-center justify-between">
              <h3 id="ai-actions-title" className="font-bold text-neutral-900 text-sm flex items-center gap-2">
                <Sparkles id="ai-title-icon" className="w-4.5 h-4.5 text-indigo-600 fill-indigo-600/30 animate-pulse" />
                Automated Operations Tree
              </h3>
              <span id="ai-provider-badge" className={`text-[10px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded border ${
                outlineEngine === "smart"
                  ? "bg-violet-50 text-violet-700 border-violet-100"
                  : "bg-teal-50 text-teal-700 border-teal-100"
              }`}>
                {outlineEngine === "smart" ? "AI Powered" : "Offline Engine"}
              </span>
            </div>

            {/* Premium segmented control for Processing Engine */}
            <div id="ai-engine-selector-container" className="flex flex-col gap-1.5 bg-neutral-50/50 p-3 rounded-xl border border-neutral-200/60 shadow-2xs">
              <span id="ai-engine-label" className="text-xs font-bold text-neutral-800 flex items-center justify-between">
                <span>Outline Analysis Method</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-extrabold tracking-wide uppercase ${
                  outlineEngine === "smart" ? "bg-violet-100 text-violet-800" : "bg-teal-100 text-teal-800"
                }`}>
                  {outlineEngine === "smart" ? "Cloud AI" : "Local Rules"}
                </span>
              </span>
              <div id="ai-engine-switches" className="grid grid-cols-2 bg-neutral-100 p-1 rounded-lg gap-1 border border-neutral-200/40">
                <button
                  id="btn-engine-smart"
                  type="button"
                  onClick={() => setOutlineEngine("smart")}
                  className={`text-[11px] text-center py-1.5 font-extrabold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    outlineEngine === "smart"
                      ? "bg-white text-indigo-700 shadow-sm border border-neutral-200/30"
                      : "text-neutral-500 hover:text-neutral-800"
                  }`}
                >
                  <Sparkles className="w-3 h-3 text-indigo-600 fill-indigo-600/10 shrink-0" />
                  <span>Gemini Cloud AI</span>
                </button>
                <button
                  id="btn-engine-local"
                  type="button"
                  onClick={() => setOutlineEngine("local")}
                  className={`text-[11px] text-center py-1.5 font-extrabold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    outlineEngine === "local"
                      ? "bg-white text-teal-700 shadow-sm border border-neutral-200/30"
                      : "text-neutral-500 hover:text-neutral-800"
                  }`}
                >
                  <Hash className="w-3 h-3 text-teal-600 shrink-0" />
                  <span>Local Engine (Offline)</span>
                </button>
              </div>
              <p id="ai-engine-explain" className="text-[10px] text-neutral-400 font-medium leading-relaxed mt-0.5">
                {outlineEngine === "smart" 
                  ? "Uses cloud LLM processing to detect hierarchical bookmarks. Securely auto-falls back to local rules if unreachable." 
                  : "Uses zero-network offline heuristics checking page texts in-browser. Private, immediate, and needs no keys/internet."}
              </p>
            </div>

            {/* Premium segmented control for AI mode */}
            <div id="ai-mode-selector" className="grid grid-cols-3 bg-neutral-100 p-1 rounded-xl border border-neutral-200/50 gap-1">
              <button
                id="btn-mode-general"
                onClick={() => setAiMode("general")}
                className={`text-center py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  aiMode === "general"
                    ? "bg-white text-indigo-700 shadow-xs border border-neutral-200/30 font-extrabold"
                    : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Chapters</span>
                <span className="sm:hidden">Ch.</span>
              </button>
              <button
                id="btn-mode-sheet"
                onClick={() => setAiMode("sheet")}
                className={`text-center py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  aiMode === "sheet"
                    ? "bg-white text-indigo-700 shadow-xs border border-neutral-200/30 font-extrabold"
                    : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-indigo-600 animate-pulse shrink-0" />
                <span className="hidden sm:inline">Sheet Names</span>
                <span className="sm:hidden">CAD</span>
              </button>
              <button
                id="btn-mode-page-titles"
                onClick={() => setAiMode("page_titles")}
                className={`text-center py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  aiMode === "page_titles"
                    ? "bg-white text-indigo-700 shadow-xs border border-neutral-200/30 font-extrabold"
                    : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                <Bookmark className="w-3.5 h-3.5 text-indigo-600 fill-indigo-600/10 shrink-0" />
                <span className="hidden sm:inline">Page Titles</span>
                <span className="sm:hidden">Pages</span>
              </button>
            </div>

            {/* Description detailing what the current mode does */}
            <div id="ai-mode-description-container" className="bg-neutral-50 p-3 rounded-xl border border-neutral-100/80 text-xs text-neutral-600">
              {aiMode === "general" ? (
                <p id="desc-mode-general">
                  <strong>Chapters Mode:</strong> Sequential text flow analysis to discover main divisions, chapters, and sub-chapters.
                </p>
              ) : aiMode === "sheet" ? (
                <p id="desc-mode-sheet">
                  <strong>Drawing Sheet Bounds:</strong> Targets CAD plans, blueprints, or schedules to detect drawing indices (such as <em>A-101</em>, <em>E-201</em>) and titles.
                </p>
              ) : (
                <p id="desc-mode-page-titles">
                  <strong>Page Titles Mode:</strong> Ideal for single merged documents. Scans every page individually to extract its specific title, division header, or subject.
                </p>
              )}
            </div>

            {/* Auto-run toggle block */}
            <div id="ai-auto-run-banner" className="bg-indigo-50/50 p-3.5 rounded-xl border border-indigo-100/60 flex items-center justify-between gap-3 select-none">
              <div id="ai-auto-run-lbls" className="flex flex-col">
                <span id="ai-auto-run-lbl-primary" className="text-xs font-bold text-indigo-950 flex items-center gap-1.5 leading-none">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 fill-indigo-600/10" />
                  Auto-Run AI on Upload
                </span>
                <span id="ai-auto-run-lbl-secondary" className="text-[10px] text-indigo-600/70 mt-1 leading-snug">
                  Automatically extracts bookmarks/sheets and switches mode based on document content upon upload
                </span>
              </div>
              
              <button
                id="btn-toggle-auto-analyze"
                type="button"
                onClick={() => setAutoAnalyzeOnUpload(!autoAnalyzeOnUpload)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  autoAnalyzeOnUpload ? "bg-indigo-600" : "bg-neutral-200"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                    autoAnalyzeOnUpload ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            
            <div id="ai-actions-grid" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Trigger Gemini Smart AI & Offline Heuristics bookmarker */}
              <button
                id="btn-trigger-gemini-ai"
                onClick={() => generateSmartBookmarks(aiMode)}
                disabled={pdfFiles.length === 0 || isAiGenerating}
                className={`relative overflow-hidden flex items-center justify-center gap-2 p-3 rounded-xl text-white disabled:opacity-40 font-bold transition-all disabled:shadow-none group cursor-pointer text-xs ${
                  outlineEngine === "smart"
                    ? "bg-gradient-to-r from-indigo-600 to-violet-700 hover:from-indigo-700 hover:to-violet-800 shadow-md shadow-indigo-150 hover:shadow-indigo-200"
                    : "bg-teal-600 hover:bg-teal-700 shadow-md shadow-teal-100 hover:shadow-teal-150"
                }`}
              >
                {isAiGenerating ? (
                  <>
                    <Loader2 id="ai-loader-icon" className="w-4 h-4 animate-spin text-white" />
                    <span>{outlineEngine === "smart" ? "Processing with AI..." : "Running offline..."}</span>
                  </>
                ) : (
                  <>
                    {outlineEngine === "smart" ? (
                      <Sparkles id="ai-btn-icon" className="w-4 h-4 text-violet-100 fill-white/10 group-hover:scale-110 transition-transform" />
                    ) : (
                      <Hash id="local-btn-icon" className="w-4 h-4 text-teal-100 group-hover:scale-110 transition-transform" />
                    )}
                    <span>{outlineEngine === "smart" ? "Auto-Generate outline" : "Extract Local Outline"}</span>
                  </>
                )}
              </button>

              {/* Simple Document Boundaries separator bookmarker */}
              <button
                id="btn-boundary-bookmarks"
                onClick={generateBoundaryBookmarks}
                disabled={pdfFiles.length === 0}
                className="flex items-center justify-center gap-2 p-3 border border-neutral-200 hover:bg-neutral-50 rounded-xl text-neutral-700 font-bold transition-all disabled:opacity-50 cursor-pointer text-xs"
              >
                <BookOpen id="boundary-btn-icon" className="w-4 h-4 text-neutral-500" />
                <span>Boundary Bookmarker</span>
              </button>
            </div>

            {/* AI Status text visual overlays */}
            {isAiGenerating && (
              <div id="ai-status-alert" className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-800 flex items-center gap-2">
                <Loader2 id="ai-status-loader" className="w-4 h-4 animate-spin shrink-0 text-indigo-600" />
                <span id="ai-status-message-text" className="font-semibold animate-pulse">{aiStatusMessage}</span>
              </div>
            )}
          </div>

          {/* Layout of Active Bookmarks Tree Panel holds editable hierarchy */}
          <div id="bookmarks-tree-card" className="bg-white rounded-2xl p-5 border border-neutral-200/80 shadow-sm flex flex-col gap-4">
            
            <div id="tree-header" className="flex items-center justify-between border-b border-neutral-100 pb-3 flex-wrap gap-2">
              <div id="tree-title-group" className="min-w-[180px]">
                <h3 id="tree-title" className="font-bold text-neutral-900 text-sm">
                  Hierarchical Bookmarks Manager
                </h3>
                <span id="tree-subtitle" className="text-[10px] text-neutral-400 font-medium">
                  Configure titles, indents (levels), and page targets below or import/export configurations
                </span>
              </div>
              
              <div id="tree-action-btns" className="flex items-center gap-2 flex-wrap">
                <button
                  id="btn-import-bookmarks-json"
                  onClick={() => document.getElementById("import-json-hidden-input")?.click()}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 rounded-lg transition-all cursor-pointer select-none"
                  title="Import bookmarks from a saved JSON configuration"
                >
                  <Upload className="w-3 h-3.5 text-neutral-600" />
                  <span>Import JSON</span>
                </button>
                <input
                  id="import-json-hidden-input"
                  type="file"
                  accept=".json"
                  onChange={handleImportJSON}
                  className="hidden"
                />

                <button
                  id="btn-export-bookmarks-json"
                  onClick={exportBookmarksToJSON}
                  disabled={bookmarks.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-all cursor-pointer select-none"
                  title="Export current bookmarks folder config layout as a JSON file"
                >
                  <Download className="w-3 h-3.5 text-indigo-600" />
                  <span>Export JSON</span>
                </button>

                {bookmarks.length > 0 && (
                  <button
                    id="btn-clear-all-bookmarks"
                    onClick={clearAllBookmarks}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100/50 rounded-lg transition-all cursor-pointer select-none"
                    title="Delete all list bookmarks completely"
                  >
                    <Trash id="clear-icon" className="w-3 h-3 text-red-500" />
                    <span>Clear All</span>
                  </button>
                )}
              </div>
            </div>

            {/* Manual Append input panel */}
            {mergedPages.length > 0 && (
              <div id="manual-form-bar" className="p-3.5 bg-neutral-50 border border-neutral-100 rounded-xl flex flex-col sm:flex-row items-end gap-3">
                <div id="form-group-title" className="flex-grow min-w-0 w-full">
                  <label htmlFor="quick-title-input" className="block text-[10px] uppercase font-bold text-neutral-500 tracking-wider mb-1">
                    Bookmark Name
                  </label>
                  <input
                    id="quick-title-input"
                    type="text"
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                    placeholder="Chapter 1: Summary..."
                    className="w-full text-xs p-2 bg-white border border-neutral-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 placeholder-neutral-400 font-medium"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        addBookmarkManual(quickTitle, quickPage - 1, quickLevel);
                        setQuickTitle("");
                      }
                    }}
                  />
                </div>

                <div id="form-group-page" className="w-full sm:w-[90px] shrink-0">
                  <label htmlFor="quick-page-input" className="block text-[10px] uppercase font-bold text-neutral-500 tracking-wider mb-1">
                    Page Index
                  </label>
                  <input
                    id="quick-page-input"
                    type="number"
                    min={1}
                    max={mergedPages.length}
                    value={quickPage}
                    onChange={(e) => setQuickPage(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full text-xs p-2 bg-white border border-neutral-200 rounded-lg focus:outline-none focus:border-indigo-500 font-medium"
                  />
                </div>

                <div id="form-group-level" className="w-full sm:w-[130px] shrink-0">
                  <label htmlFor="quick-level-selector" className="block text-[10px] uppercase font-bold text-neutral-500 tracking-wider mb-1">
                    Indent Level
                  </label>
                  <select
                    id="quick-level-selector"
                    value={quickLevel}
                    onChange={(e) => setQuickLevel(Number(e.target.value))}
                    className="w-full text-xs p-2 bg-white border border-neutral-200 rounded-lg focus:outline-none focus:border-indigo-500 font-medium"
                  >
                    <option value={0}>Main Chapter</option>
                    <option value={1}>Subheading (L1)</option>
                    <option value={2}>Section Detail (L2)</option>
                  </select>
                </div>

                <button
                  id="btn-add-quick-bookmark"
                  onClick={() => {
                    addBookmarkManual(quickTitle, quickPage - 1, quickLevel);
                    setQuickTitle("");
                  }}
                  className="w-full sm:w-auto p-2 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all text-xs"
                >
                  <Plus id="add-quick-icon" className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
            )}

            {/* List of bookmarks with level offset indents */}
            <div id="tree-viewport" className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto pr-1">
              {bookmarks.length === 0 ? (
                <div id="empty-bookmarks" className="p-8 text-center bg-neutral-50/50 rounded-2xl border border-neutral-100 flex flex-col items-center justify-center text-neutral-400">
                  <Bookmark id="empty-icon" className="w-10 h-10 text-neutral-300 mb-2" />
                  <p id="empty-p-prime" className="text-sm font-semibold text-neutral-800">No Bookmarks Generated Yet</p>
                  <p id="empty-p-sec" className="text-xs text-neutral-400 mt-1 max-w-[320px]">
                    Drop source documents and click <span className="text-indigo-600 font-medium">Auto-Outline</span> to trigger AI categorization of section headings!
                  </p>
                </div>
              ) : (
                <div id="bookmarks-active-list" className="flex flex-col gap-1 bg-neutral-50/50 p-2 rounded-xl border border-neutral-100/50">
                  <AnimatePresence initial={false}>
                    {bookmarks.map((bm) => {
                      // Determine indent level classes
                      const levelPadding = bm.level === 1 ? "pl-6 sm:pl-8" : bm.level === 2 ? "pl-12 sm:pl-16" : "pl-2";
                      
                      return (
                        <motion.div
                          id={`bookmark-item-node-${bm.id}`}
                          key={bm.id}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.92 }}
                          className={`flex items-center gap-2 group transition-all duration-150 ${levelPadding}`}
                        >
                          {/* visual bookmark hierarchy icon based on level */}
                          <div id={`level-visualizer-${bm.id}`} className="shrink-0 text-neutral-400">
                            {bm.level === 0 ? (
                              <BookOpen id={`icon-l0-${bm.id}`} className="w-4 h-4 text-indigo-500" />
                            ) : bm.level === 1 ? (
                              <FolderOpen id={`icon-l1-${bm.id}`} className="w-3.5 h-3.5 text-neutral-400" />
                            ) : (
                              <Hash id={`icon-l2-${bm.id}`} className="w-3 h-3 text-neutral-400" />
                            )}
                          </div>

                          <div id={`node-form-${bm.id}`} className="flex-grow flex items-center gap-1.5 p-1 px-2 rounded-lg bg-white border border-neutral-200/80 hover:border-neutral-300 hover:shadow-xs transition-all">
                            {/* Inline Bookmark Title edit */}
                            <input
                              id={`node-title-input-${bm.id}`}
                              type="text"
                              value={bm.title}
                              onChange={(e) => updateBookmarkField(bm.id, "title", e.target.value)}
                              className="text-xs font-semibold text-neutral-800 bg-transparent py-1 border-b border-transparent focus:border-indigo-400 focus:outline-none flex-grow min-w-0"
                            />

                            {/* Nesting Indent-Outdent Tools */}
                            <div id={`level-scroller-${bm.id}`} className="flex items-center gap-0.5 shrink-0 pl-1">
                              <button
                                id={`btn-outdent-${bm.id}`}
                                onClick={() => updateBookmarkField(bm.id, "level", bm.level - 1)}
                                disabled={bm.level === 0}
                                className="p-1 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-30 transition-all"
                                title="Outdent"
                              >
                                <ChevronLeft id={`icon-outdent-${bm.id}`} className="w-3 h-3" />
                              </button>
                              <button
                                id={`btn-indent-${bm.id}`}
                                onClick={() => updateBookmarkField(bm.id, "level", bm.level + 1)}
                                disabled={bm.level === 2}
                                className="p-1 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-30 transition-all"
                                title="Indent"
                              >
                                <ChevronRight id={`icon-indent-${bm.id}`} className="w-3 h-3" />
                              </button>
                            </div>

                            {/* Destination Page index adjustment */}
                            <div id={`page-selector-group-${bm.id}`} className="flex items-center shrink-0 border-l border-neutral-100 pl-1.5 gap-1">
                              <span className="text-[10px] text-neutral-400">p.</span>
                              <input
                                id={`node-page-input-${bm.id}`}
                                type="number"
                                min={1}
                                max={mergedPages.length}
                                value={bm.pageIndex + 1}
                                onChange={(e) => updateBookmarkField(bm.id, "pageIndex", (parseInt(e.target.value) || 1) - 1)}
                                className="w-10 text-xs text-center font-bold text-neutral-800 bg-neutral-100/50 focus:bg-white rounded py-0.5 border border-transparent focus:border-indigo-400 focus:outline-none"
                              />
                            </div>

                            {/* Drop node */}
                            <button
                              id={`btn-remove-node-${bm.id}`}
                              onClick={() => removeBookmark(bm.id)}
                              className="p-1 rounded hover:bg-red-50 text-neutral-400 hover:text-red-500 transition-colors ml-1"
                              title="Delete bookmark"
                            >
                              <Trash2 id={`icon-trash-${bm.id}`} className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

        </section>
      </main>

      {/* Floating Application compilation block bottom banner */}
      <footer id="app-footer-stage" className="bg-white border-t border-neutral-200/80 p-5 sticky bottom-0 z-10 shadow-lg">
        <div id="footer-container" className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          
          <div id="status-alerts-console" className="flex-grow min-w-0">
            {errorMessage ? (
              <p id="console-error" className="text-xs font-semibold text-red-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse shrink-0"></span>
                {errorMessage}
              </p>
            ) : statusMessage ? (
              <p id="console-info" className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">
                {isProcessingFiles || isCompiling ? (
                  <Loader2 id="console-loader" className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                ) : (
                  <Check id="console-check" className="w-3.5 h-3.5 text-emerald-600" />
                )}
                {statusMessage}
              </p>
            ) : pdfFiles.length > 0 ? (
              <p id="console-idle" className="text-xs text-neutral-500 font-medium">
                Workspace is ready. All merging and metadata compilation takes place directly inside browser memory. Click compiled bundle triggers below to download output.
              </p>
            ) : (
              <p id="console-empty" className="text-xs text-neutral-400">
                Awaiting input documents...
              </p>
            )}
          </div>

          <button
            id="btn-trigger-pack-download"
            onClick={compilePdfOutput}
            disabled={pdfFiles.length === 0 || isCompiling || isProcessingFiles}
            className="w-full md:w-auto shrink-0 px-8 py-3.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white font-bold text-sm tracking-wide transition-all shadow-md shadow-neutral-300 disabled:shadow-none hover:shadow-neutral-400 flex items-center justify-center gap-2 cursor-pointer"
          >
            {isCompiling ? (
              <>
                <Loader2 id="download-spinner-loader" className="w-4 h-4 animate-spin text-white" />
                <span>Compiling & Packaging PDF...</span>
              </>
            ) : (
              <>
                <Download id="download-btn-icon" className="w-4 h-4" />
                <span>Merge & Download Bookmarked PDF</span>
              </>
            )}
          </button>

        </div>
      </footer>

    </div>
  );
}
