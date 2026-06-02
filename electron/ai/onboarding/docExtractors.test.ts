import { describe, expect, it } from "vitest";
import { extractTables, extractCurlExamples, extractCodeBlocks, htmlToMarkdown } from "./docExtractors";

describe("docExtractors.extractTables", () => {
  it("extracts simple parameter table", () => {
    const html = `
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Required</th></tr></thead>
        <tbody>
          <tr><td>prompt</td><td>string</td><td>yes</td></tr>
          <tr><td>duration</td><td>number</td><td>no</td></tr>
        </tbody>
      </table>
    `;
    const tables = extractTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(["Field", "Type", "Required"]);
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[0].rows[0]).toEqual(["prompt", "string", "yes"]);
  });

  it("handles tables without thead", () => {
    const html = `
      <table>
        <tr><th>Param</th><th>Default</th></tr>
        <tr><td>size</td><td>1024x1024</td></tr>
      </table>
    `;
    const tables = extractTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(1);
    expect(tables[0].rows[0]).toEqual(["size", "1024x1024"]);
  });

  it("decodes HTML entities", () => {
    const html = "<table><tr><th>Name &amp; tag</th></tr></table>";
    const tables = extractTables(html);
    expect(tables[0].headers[0]).toBe("Name & tag");
  });
});

describe("docExtractors.extractCurlExamples", () => {
  it("extracts curl with URL and method", () => {
    const html = `
      <pre><code class="language-bash">curl -X POST https://api.example.com/v1/task \\
  -H "Authorization: Bearer xxx" \\
  -d '{"prompt": "hello", "duration": 5}'</code></pre>
    `;
    const curls = extractCurlExamples(html);
    expect(curls).toHaveLength(1);
    expect(curls[0].url).toBe("https://api.example.com/v1/task");
    expect(curls[0].method).toBe("POST");
    expect(curls[0].body).toEqual({ prompt: "hello", duration: 5 });
  });

  it("skips non-curl code blocks", () => {
    const html = `
      <pre><code>import openai</code></pre>
      <pre><code>curl https://api.example.com/list</code></pre>
    `;
    const curls = extractCurlExamples(html);
    expect(curls).toHaveLength(1);
    expect(curls[0].url).toBe("https://api.example.com/list");
  });

  it("decodes hex numeric entities (&#x27;) so the URL isn't polluted", () => {
    // Apidog renders curl quotes as &#x27; — if left undecoded the parsed URL
    // swallows a trailing &#x27; and the live test call 404s on a bad path.
    const html =
      "<pre><code>curl --location &#x27;https://api.kie.ai/api/v1/jobs/createTask&#x27; \\\n" +
      "--header &#x27;Content-Type: application/json&#x27; \\\n" +
      "--data &#x27;{&#x22;prompt&#x22;: &#x22;hi&#x22;}&#x27;</code></pre>";
    const curls = extractCurlExamples(html);
    expect(curls).toHaveLength(1);
    expect(curls[0].url).toBe("https://api.kie.ai/api/v1/jobs/createTask");
    expect(curls[0].command).not.toContain("&#x");
    expect(curls[0].body).toEqual({ prompt: "hi" });
  });
});

describe("docExtractors.extractCodeBlocks", () => {
  it("captures language from class", () => {
    const html = `<pre><code class="language-python">import requests</code></pre>`;
    const blocks = extractCodeBlocks(html);
    expect(blocks[0].language).toBe("python");
    expect(blocks[0].content).toContain("import requests");
  });

  it("falls back to 'unknown' for no class", () => {
    const html = `<pre><code>some code</code></pre>`;
    const blocks = extractCodeBlocks(html);
    expect(blocks[0].language).toBe("unknown");
  });
});

describe("docExtractors.htmlToMarkdown", () => {
  it("strips scripts and styles", () => {
    const html = `<p>visible</p><script>secret</script><style>css</style>`;
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("secret");
    expect(md).not.toContain("css");
    expect(md).toContain("visible");
  });

  it("preserves headings as markdown", () => {
    const html = `<h1>Title</h1><h2>Sub</h2>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).toContain("## Sub");
  });
});
