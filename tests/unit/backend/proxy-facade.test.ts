import { describe, expect, it } from "vitest";

import * as proxyFacade from "@/proxy";

describe("proxy facade", () => {
  it("keeps only the public proxy and config exports", () => {
    expect(Object.keys(proxyFacade).sort()).toEqual(["config", "proxy"]);
    expect(proxyFacade.proxy).toEqual(expect.any(Function));
  });

  it("preserves the exact matcher", () => {
    expect(proxyFacade.config).toEqual({
      matcher: [
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|map|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$).*)",
      ],
    });
  });
});
