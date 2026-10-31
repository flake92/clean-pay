import { describe, expect, it } from "vitest";

import { decodeEntities, parseTelegramHtml, safeHref } from "@/frontend/lib/telegram-html";

describe("Telegram HTML", () => {
  it("keeps the Telegram subset and line breaks", () => {
    expect(parseTelegramHtml('<b>Новый <i>тариф</i></b>\n<a href="https://example.com/a?b=1&amp;c=2">Ссылка</a>'))
      .toEqual([
        {
          kind: "element",
          tag: "b",
          children: [
            { kind: "text", text: "Новый " },
            { kind: "element", tag: "i", children: [{ kind: "text", text: "тариф" }] },
          ],
        },
        { kind: "text", text: "\n" },
        {
          kind: "element",
          tag: "a",
          href: "https://example.com/a?b=1&c=2",
          children: [{ kind: "text", text: "Ссылка" }],
        },
      ]);
  });

  it("reduces unknown tags to their text and never produces live markup", () => {
    expect(parseTelegramHtml('<tg-emoji emoji-id="1">🔥</tg-emoji><script>alert(1)</script>'))
      .toEqual([
        { kind: "text", text: "🔥" },
        { kind: "text", text: "alert(1)" },
      ]);
    expect(parseTelegramHtml('<a href="javascript:alert(1)">x</a>')).toEqual([
      { kind: "element", tag: "a", children: [{ kind: "text", text: "x" }] },
    ]);
    expect(parseTelegramHtml("&lt;b&gt;")).toEqual([{ kind: "text", text: "<b>" }]);
  });

  it("survives unbalanced tags", () => {
    expect(parseTelegramHtml("<b>a</i>b</b>c<br/>d")).toEqual([
      {
        kind: "element",
        tag: "b",
        children: [{ kind: "text", text: "a" }, { kind: "text", text: "b" }],
      },
      { kind: "text", text: "c" },
      { kind: "text", text: "\n" },
      { kind: "text", text: "d" },
    ]);
    expect(parseTelegramHtml("</b><blockquote>q").at(0)).toMatchObject({ tag: "blockquote" });
  });

  it("decodes entities and validates links", () => {
    expect(decodeEntities("&#128293; &#x41; &amp; &unknown; &#0;")).toBe("🔥 A & &unknown; &#0;");
    expect(safeHref("/extend")).toBe("/extend");
    expect(safeHref("//evil.example")).toBeUndefined();
    expect(safeHref("https://t.me/support")).toBe("https://t.me/support");
    expect(safeHref("data:text/html,x")).toBeUndefined();
    expect(safeHref("not a url")).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});
