import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { prepareMarkdownForRendering, remarkCjkFriendlyStrong } from "./markdown";

function renderMarkdown(value: string) {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkCjkFriendlyStrong]}>
      {prepareMarkdownForRendering(value)}
    </ReactMarkdown>
  );
}

test("renders strong emphasis ending in punctuation before CJK text", () => {
  const html = renderMarkdown(
    "接受一种**有限、明确标注为“记忆模拟”**的方式。**我愿意保留回忆。**慰藉来自经历。"
  );

  assert.match(html, /接受一种<strong>有限、明确标注为“记忆模拟”<\/strong>的方式。/);
  assert.match(html, /<strong>我愿意保留回忆。<\/strong>慰藉来自经历。/);
  assert.doesNotMatch(html, /\*\*/);
});

test("keeps standard Markdown strong emphasis working", () => {
  const html = renderMarkdown("形式的**真实关系**，仍然重要。\n\n- **明确同意**，再继续。"
  );

  assert.match(html, /形式的<strong>真实关系<\/strong>，仍然重要。/);
  assert.match(html, /<li><strong>明确同意<\/strong>，再继续。<\/li>/);
});

test("does not reinterpret strong markers inside code", () => {
  const html = renderMarkdown("`**原样。**后文`\n\n```txt\n**原样。**后文\n```");

  assert.match(html, /<code>\*\*原样。\*\*后文<\/code>/);
  assert.doesNotMatch(html, /<strong>/);
});
