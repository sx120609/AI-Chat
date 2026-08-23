import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWebSearchSources,
  mergeWebSearchSources,
  parseWebSourcesJson
} from "./web-search";

test("extracts and deduplicates Sub2API Responses web search sources", () => {
  const sources = extractWebSearchSources({
    type: "response.completed",
    response: {
      output: [
        {
          type: "web_search_call",
          action: {
            sources: [
              { type: "url", url: "https://example.com/news", title: "Example News" },
              { type: "url", url: "https://example.com/news", title: "Duplicate" }
            ]
          }
        },
        {
          content: [
            {
              annotations: [
                {
                  type: "url_citation",
                  url: "https://docs.example.org/page",
                  title: "Documentation"
                }
              ]
            }
          ]
        }
      ]
    }
  });

  assert.deepEqual(
    sources.map((source) => [source.title, source.url]),
    [
      ["Example News", "https://example.com/news"],
      ["Documentation", "https://docs.example.org/page"]
    ]
  );
});

test("merges richer source metadata and rejects unsafe URLs", () => {
  const merged = mergeWebSearchSources(
    [{ displayUrl: "example.com", snippet: "", title: "example.com", url: "https://example.com/" }],
    [
      { displayUrl: "example.com", snippet: "Summary", title: "Example", url: "https://example.com/" },
      { displayUrl: "local", snippet: "", title: "Unsafe", url: "file:///etc/passwd" }
    ]
  );

  assert.deepEqual(merged, [
    {
      displayUrl: "example.com",
      snippet: "Summary",
      title: "Example",
      url: "https://example.com/"
    }
  ]);
  assert.equal(parseWebSourcesJson('[{"url":"javascript:alert(1)"}]').length, 0);
});
