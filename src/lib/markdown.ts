function convertMathDelimiters(value: string) {
  return value
    .replace(/\\{1,2}\[([\s\S]*?)\\{1,2}\]/g, (_match, math: string) => {
      const trimmed = math.trim();
      return trimmed ? `\n\n$$\n${trimmed}\n$$\n\n` : "";
    })
    .replace(/\\{1,2}\(([\s\S]*?)\\{1,2}\)/g, (_match, math: string) => {
      const trimmed = math.trim();
      return trimmed ? `$${trimmed}$` : "";
    });
}

function normalizeMathInMarkdownText(value: string) {
  return value
    .split(/(`+[^`\n]*?`+)/g)
    .map((part) => (part.startsWith("`") ? part : convertMathDelimiters(part)))
    .join("");
}

function closeUnfinishedCodeFence(value: string) {
  const lines = value.split("\n");
  let openFence: "```" | "~~~" | null = null;

  for (const line of lines) {
    const fence = line.match(/^(\s*)(```|~~~)/)?.[2] as "```" | "~~~" | undefined;

    if (!fence) {
      continue;
    }

    if (!openFence) {
      openFence = fence;
      continue;
    }

    if (openFence === fence) {
      openFence = null;
    }
  }

  return openFence ? `${value}\n${openFence}` : value;
}

type MarkdownAstNode = {
  children?: MarkdownAstNode[];
  type: string;
  value?: string;
};

const cjkFriendlyStrongPattern = /(?<![\\*])\*\*(?!\*)(?=\S)([^\n]*?\S)(?<![\\*])\*\*(?!\*)/g;

function splitUnparsedStrongText(value: string): MarkdownAstNode[] {
  const nodes: MarkdownAstNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(cjkFriendlyStrongPattern)) {
    const start = match.index;
    const content = match[1];

    if (start > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, start) });
    }

    nodes.push({
      children: [{ type: "text", value: content }],
      type: "strong"
    });
    cursor = start + match[0].length;
  }

  if (cursor === 0) {
    return [{ type: "text", value }];
  }

  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }

  return nodes;
}

function restoreUnparsedStrongNodes(node: MarkdownAstNode) {
  if (!node.children || node.type === "code" || node.type === "inlineCode") {
    return;
  }

  const children: MarkdownAstNode[] = [];

  for (const child of node.children) {
    if (child.type === "text" && child.value?.includes("**")) {
      children.push(...splitUnparsedStrongText(child.value));
      continue;
    }

    restoreUnparsedStrongNodes(child);
    children.push(child);
  }

  node.children = children;
}

/**
 * CommonMark leaves strong emphasis unparsed when its closing marker is between
 * punctuation and a CJK letter, for example `**重点。**后文`. Model output uses
 * this form frequently, so restore only the leftover `**...**` text nodes after
 * the standard parser has handled valid Markdown. Code nodes remain untouched.
 */
export function remarkCjkFriendlyStrong() {
  return (tree: MarkdownAstNode) => {
    restoreUnparsedStrongNodes(tree);
  };
}

export function prepareMarkdownForRendering(value: string) {
  const normalized = value
    .split(/((?:^|\n)(?:```|~~~)[\s\S]*?(?:\n(?:```|~~~)(?=\n|$)|$))/g)
    .map((part) =>
      /^(?:\n)?(?:```|~~~)/.test(part) ? part : normalizeMathInMarkdownText(part)
    )
    .join("");

  return closeUnfinishedCodeFence(normalized);
}
