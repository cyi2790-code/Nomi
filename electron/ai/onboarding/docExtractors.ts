/**
 * Structured extractors for API documentation pages.
 *
 * Don't feed raw HTML to the LLM — preprocess to high signal-to-noise:
 *  - extractTables: <table> elements (parameter tables = the gold standard)
 *  - extractCurlExamples: <pre><code> with curl (ground truth via examples)
 *  - extractCodeBlocks: all code blocks (for SDK / curl / json examples)
 *  - htmlToMarkdown: fallback when nothing structured found
 *
 * Pure functions — input HTML string, output structured data. Easy to test.
 */

export type ExtractedTable = {
  headers: string[];
  rows: string[][];
  caption?: string;
  /** Position in the doc — helps agent cite "Table 3" etc. */
  index: number;
};

export type ExtractedCurl = {
  command: string;
  /** URL parsed out (best effort) */
  url?: string;
  /** Method parsed out */
  method?: string;
  /** JSON body parsed out (best effort) */
  body?: unknown;
  index: number;
};

export type ExtractedCode = {
  language: string;
  content: string;
  index: number;
};

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return (
    value
      // Numeric entities FIRST (named pass must not re-mangle them). Apidog and
      // many SPA renderers emit hex entities like &#x27; (apostrophe) and &#x22;
      // (quote) inside curl examples — if these survive, the parsed request URL
      // swallows the trailing `&#x27;` and the test call 404s on a bad path.
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      // &amp; LAST so it can't double-decode an entity that was itself encoded.
      .replace(/&amp;/g, "&")
  );
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Extract all <table> elements as structured rows. */
export function extractTables(html: string): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = tableRegex.exec(html)) !== null) {
    const inner = match[1];
    const captionMatch = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(inner);
    const caption = captionMatch ? decodeEntities(stripHtmlTags(captionMatch[1])) : undefined;

    // headers
    const theadMatch = /<thead[^>]*>([\s\S]*?)<\/thead>/i.exec(inner);
    const headerRowSrc = theadMatch
      ? theadMatch[1]
      : /<tr[^>]*>([\s\S]*?)<\/tr>/i.exec(inner)?.[1] || "";
    const headers = Array.from(headerRowSrc.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi))
      .map((m) => decodeEntities(stripHtmlTags(m[1])));

    // body rows
    const bodySrc = inner.replace(theadMatch?.[0] || "", "");
    const rows: string[][] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    let firstRow = true;
    while ((rowMatch = rowRegex.exec(bodySrc)) !== null) {
      // skip if this was the header row already captured
      if (!theadMatch && firstRow) { firstRow = false; continue; }
      const cells = Array.from(rowMatch[1].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi))
        .map((m) => decodeEntities(stripHtmlTags(m[1])));
      if (cells.length > 0) rows.push(cells);
    }

    if (headers.length > 0 || rows.length > 0) {
      tables.push({ headers, rows, ...(caption ? { caption } : {}), index });
      index += 1;
    }
  }
  return tables;
}

/** Extract <pre><code> blocks looking like curl commands. */
export function extractCurlExamples(html: string): ExtractedCurl[] {
  const blocks = extractCodeBlocks(html);
  const curls: ExtractedCurl[] = [];
  let index = 0;
  for (const block of blocks) {
    if (!/^\s*curl\b/i.test(block.content)) continue;
    const command = block.content.trim();
    const urlMatch = command.match(/curl[^\n]*?(?:--request\s+\w+\s+)?['"]?(https?:\/\/[^\s'"\\]+)['"]?/i)
      || command.match(/['"](https?:\/\/[^'"]+)['"]/);
    const url = urlMatch?.[1];
    const methodMatch = command.match(/-X\s+(\w+)\b/i) || command.match(/--request\s+(\w+)\b/i);
    const method = methodMatch?.[1]?.toUpperCase();
    // Body — find -d / --data with JSON
    let body: unknown;
    const dataMatch = command.match(/(?:-d|--data(?:-raw)?)\s+['"]([\s\S]*?)['"]\s*(?:\\|\n|$)/);
    if (dataMatch) {
      const raw = dataMatch[1].trim();
      try { body = JSON.parse(raw); } catch { body = raw; }
    }
    curls.push({
      command,
      ...(url ? { url } : {}),
      ...(method ? { method } : {}),
      ...(body !== undefined ? { body } : {}),
      index,
    });
    index += 1;
  }
  return curls;
}

/** Extract all <pre><code> blocks. */
export function extractCodeBlocks(html: string): ExtractedCode[] {
  const blocks: ExtractedCode[] = [];
  const regex = /<pre[^>]*>\s*<code(?:\s+class=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = regex.exec(html)) !== null) {
    const classAttr = match[1] || "";
    const langMatch = classAttr.match(/language-(\w+)/i) || classAttr.match(/lang-(\w+)/i);
    const language = langMatch?.[1] || "unknown";
    const content = decodeEntities(match[2].replace(/<[^>]+>/g, ""));
    blocks.push({ language, content, index });
    index += 1;
  }

  // also support bare <pre> blocks without <code>
  const bareRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let bareMatch: RegExpExecArray | null;
  while ((bareMatch = bareRegex.exec(html)) !== null) {
    // skip if already captured as <pre><code>
    if (/<code/i.test(bareMatch[1])) continue;
    const content = decodeEntities(bareMatch[1].replace(/<[^>]+>/g, ""));
    blocks.push({ language: "unknown", content, index });
    index += 1;
  }
  return blocks;
}

/** Convert HTML to markdown-ish plain text, preserving structure. */
export function htmlToMarkdown(html: string): string {
  let text = html;
  // strip script + style first
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // h1-h6
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    const prefix = "#".repeat(Number(level));
    return `\n${prefix} ${stripHtmlTags(content)}\n`;
  });
  // lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  // breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  // tables — keep raw for now (extractTables handles them)
  // strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
