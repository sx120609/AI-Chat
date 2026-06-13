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

export function prepareMarkdownForRendering(value: string) {
  const normalized = value
    .split(/((?:^|\n)(?:```|~~~)[\s\S]*?(?:\n(?:```|~~~)(?=\n|$)|$))/g)
    .map((part) =>
      /^(?:\n)?(?:```|~~~)/.test(part) ? part : normalizeMathInMarkdownText(part)
    )
    .join("");

  return closeUnfinishedCodeFence(normalized);
}
