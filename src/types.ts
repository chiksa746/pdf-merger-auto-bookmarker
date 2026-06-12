export interface PDFFile {
  id: string;
  name: string;
  size: number;
  arrayBuffer: ArrayBuffer;
  pageCount: number;
  pages: {
    pageNumber: number; // 1-based page number within this file
    textSample: string;
  }[];
}

export interface FlatBookmark {
  id: string;
  title: string;
  pageIndex: number; // 0-based index in the fully merged document
  level: number; // 0 for main heading, 1 for level 1 subheading, etc.
}

export interface BookmarkNode {
  title: string;
  pageIndex: number;
  children?: BookmarkNode[];
}

/**
 * Converts a list of flat bookmarks (sorted by pageIndex) into a nested BookmarkNode tree.
 * Slices up by levels sequentially to preserve proper PDF outlines order.
 */
export function nestBookmarks(flatList: FlatBookmark[]): BookmarkNode[] {
  const root: BookmarkNode[] = [];
  const stack: { node: BookmarkNode; level: number }[] = [];

  // Sort by pageIndex first to preserve document chronological order
  const sorted = [...flatList].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) {
      return a.pageIndex - b.pageIndex;
    }
    return a.level - b.level;
  });

  for (const item of sorted) {
    const node: BookmarkNode = {
      title: item.title,
      pageIndex: item.pageIndex,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      const parent = stack[stack.length - 1].node;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }

    stack.push({ node, level: item.level });
  }

  // Clean empty children arrays
  function clean(nodes: BookmarkNode[]) {
    for (const n of nodes) {
      if (n.children && n.children.length === 0) {
        delete n.children;
      } else if (n.children) {
        clean(n.children);
      }
    }
  }
  clean(root);

  return root;
}
