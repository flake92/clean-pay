// Telegram's HTML subset as a tree. Only this allowlist ever reaches the page:
// a message is rendered as React elements, so no markup from a translation or
// an admin broadcast can become live HTML.
export type TelegramNode =
  | { kind: "text"; text: string }
  | { kind: "element"; tag: TelegramTag; href?: string; children: TelegramNode[] };

export type TelegramTag = "b" | "i" | "u" | "s" | "code" | "pre" | "blockquote" | "spoiler" | "a";

const TAGS: Record<string, TelegramTag> = {
  b: "b",
  strong: "b",
  i: "i",
  em: "i",
  u: "u",
  ins: "u",
  s: "s",
  strike: "s",
  del: "s",
  code: "code",
  pre: "pre",
  blockquote: "blockquote",
  "tg-spoiler": "spoiler",
  a: "a",
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function safeHref(value: string | undefined) {
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:", "tg:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function hrefOf(attributes: string) {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
  return safeHref(decodeEntities(match?.[1] ?? match?.[2] ?? ""));
}

export function parseTelegramHtml(source: string): TelegramNode[] {
  const root: TelegramNode[] = [];
  const stack: Array<{ tag: string; children: TelegramNode[] }> = [{ tag: "", children: root }];
  const pattern = /<(\/?)([a-z][a-z0-9-]*)((?:\s[^<>]*)?)\/?>/gi;
  let position = 0;

  const addText = (raw: string) => {
    if (raw) stack.at(-1)!.children.push({ kind: "text", text: decodeEntities(raw) });
  };

  for (const match of source.matchAll(pattern)) {
    addText(source.slice(position, match.index));
    position = match.index + match[0].length;
    const name = match[2]!.toLowerCase();

    if (match[1]) {
      // Unknown tags were never pushed, so their closing tags find nothing here.
      const open = stack.findLastIndex((entry, index) => index > 0 && entry.tag === name);
      if (open > 0) stack.length = open;
      continue;
    }
    if (name === "br") {
      addText("\n");
      continue;
    }
    const tag = TAGS[name];
    // tg-emoji, span and anything else keep only their text.
    if (!tag) continue;
    const children: TelegramNode[] = [];
    const href = tag === "a" ? hrefOf(match[3] ?? "") : undefined;
    stack.at(-1)!.children.push({
      kind: "element",
      tag,
      ...(href ? { href } : {}),
      children,
    });
    stack.push({ tag: name, children });
  }
  addText(source.slice(position));
  return root;
}
