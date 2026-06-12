import { PDFDocument, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';
import { FlatBookmark, nestBookmarks, BookmarkNode } from '../types';

/**
 * Merges multiple PDF file ArrayBuffers and applies a custom bookmarks (outline) structure.
 */
export async function mergeAndCompilePdf(
  files: { arrayBuffer: ArrayBuffer }[],
  flatBookmarks: FlatBookmark[]
): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  // 1. Copy pages from each file in sequence
  for (const file of files) {
    const srcPdf = await PDFDocument.load(file.arrayBuffer.slice(0));
    const srcPageIndices = srcPdf.getPageIndices();
    const copiedPages = await mergedPdf.copyPages(srcPdf, srcPageIndices);
    
    for (const page of copiedPages) {
      mergedPdf.addPage(page);
    }
  }

  // 2. Build the outlines dictionary structure and link to the PDF Catalog
  const nested = nestBookmarks(flatBookmarks);
  if (nested.length > 0) {
    await setPdfOutlines(mergedPdf, nested);
  }

  // 3. Save and return high quality PDF bytes
  return await mergedPdf.save();
}

/**
 * Creates low-level PDF Outlines (Bookmarks) structure
 */
async function setPdfOutlines(pdfDoc: PDFDocument, bookmarks: BookmarkNode[]) {
  const context = pdfDoc.context;
  const pages = pdfDoc.getPages();
  const pageRefs = pages.map(p => p.ref);

  if (bookmarks.length === 0) return;

  // OutlineNode maintains the required PDFRefs for internal chaining pointers
  interface OutlineNode {
    title: string;
    pageIndex: number;
    ref: PDFRef;
    children: OutlineNode[];
    parentRef: PDFRef;
    prevRef?: PDFRef;
    nextRef?: PDFRef;
    firstRef?: PDFRef;
    lastRef?: PDFRef;
  }

  const rootRef = context.nextRef();

  // Set up sequential node references
  function allocateRefs(items: BookmarkNode[], parentRef: PDFRef): OutlineNode[] {
    return items.map(item => {
      const node: OutlineNode = {
        title: item.title,
        pageIndex: item.pageIndex,
        ref: context.nextRef(),
        children: [],
        parentRef: parentRef,
      };
      if (item.children && item.children.length > 0) {
        node.children = allocateRefs(item.children, node.ref);
      }
      return node;
    });
  }

  const rootNodes = allocateRefs(bookmarks, rootRef);

  // Link children, siblings, parent-child structures
  function linkNodes(nodes: OutlineNode[]) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (i > 0) {
        node.prevRef = nodes[i - 1].ref;
      }
      if (i < nodes.length - 1) {
        node.nextRef = nodes[i + 1].ref;
      }
      if (node.children.length > 0) {
        node.firstRef = node.children[0].ref;
        node.lastRef = node.children[node.children.length - 1].ref;
        linkNodes(node.children);
      }
    }
  }

  linkNodes(rootNodes);

  // Count open children bookmarks recursively (positive number shows expanded, negative folded)
  function countNodes(node: OutlineNode): number {
    let count = node.children.length;
    for (const child of node.children) {
      count += countNodes(child);
    }
    return count;
  }

  // Generate dictionary entries of each outline node
  function writeNode(node: OutlineNode) {
    const destPageRef = pageRefs[Math.min(node.pageIndex, pageRefs.length - 1)];

    // Fit-to-page mode is extremely reliable across all standard PDF viewers
    const dict = context.obj({
      Title: PDFString.of(node.title),
      Parent: node.parentRef,
      Dest: [destPageRef, PDFName.of('Fit')],
    });

    if (node.prevRef) dict.set(PDFName.of('Prev'), node.prevRef);
    if (node.nextRef) dict.set(PDFName.of('Next'), node.nextRef);
    if (node.firstRef) dict.set(PDFName.of('First'), node.firstRef);
    if (node.lastRef) dict.set(PDFName.of('Last'), node.lastRef);

    const count = countNodes(node);
    if (count > 0) {
      dict.set(PDFName.of('Count'), PDFNumber.of(count));
    }

    context.assign(node.ref, dict);

    for (const child of node.children) {
      writeNode(child);
    }
  }

  // Register all individual bookmark dictionaries
  for (const node of rootNodes) {
    writeNode(node);
  }

  // Create document Outlines directory
  const totalCount = rootNodes.reduce((acc, node) => acc + 1 + countNodes(node), 0);
  const rootDict = context.obj({
    Type: PDFName.of('Outlines'),
    First: rootNodes[0].ref,
    Last: rootNodes[rootNodes.length - 1].ref,
    Count: PDFNumber.of(totalCount),
  });

  context.assign(rootRef, rootDict);

  // Link Outlines to the overall Document Catalog
  const catalog = pdfDoc.catalog;
  catalog.set(PDFName.of('Outlines'), rootRef);
}
