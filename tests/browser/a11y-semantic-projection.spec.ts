import { expect, test } from "@playwright/test";

import { projectCharacterizationManifestForComparison } from "./comparison-projection";

test.describe("candidate-only accessibility semantic allowlist", () => {
  test("projects only the exact skip target, decorative logos, and cabinet heading", () => {
    const baselineSkip = routeManifest("/tariffs", layoutDom(false), {
      ariaSnapshot: "- main:",
    });
    const candidateSkip = routeManifest("/tariffs", layoutDom(true), {
      ariaSnapshot: [
        '- link "К основному содержимому":',
        '  - /url: {"origin":"<app-origin>","pathname":"/tariffs","query":[],"fragment":"<sha256:0c1923dd7ec27396>"}',
        "- main:",
      ].join("\n"),
      computedStyles: [skipLinkComputedStyle()],
      interactiveElements: [skipLinkInteractive()],
    });
    expect(project(candidateSkip)).toEqual(project(baselineSkip));

    for (const logo of logoCases()) {
      expect(project(logo.candidate), logo.name).toEqual(project(logo.baseline));
    }

    const baselineHeading = routeManifest(
      "/cabinet",
      documentWith(element("div", { class: "card" }, [
        element("h5", {}, [text("Профиль")]),
      ])),
      { ariaSnapshot: '- main:\n  - heading "Профиль" [level=5]' },
    );
    const candidateHeading = routeManifest(
      "/cabinet",
      documentWith(element("div", { class: "card" }, [
        element("h2", { class: "text-xl" }, [text("Профиль")]),
      ])),
      {
        ariaSnapshot: '- main:\n  - heading "Профиль" [level=2]',
        computedStyles: [cabinetHeadingComputedStyle()],
      },
    );
    expect(project(candidateHeading)).toEqual(project(baselineHeading));
  });

  test("projects only exact PrimeReact and passkey accessible-name changes", () => {
    const primeBaseline = routeManifest(
      "/login",
      documentWith(element("button", {
        "aria-label": "Show Password",
        class: "p-password-toggle-mask p-link",
      })),
      {
        ariaSnapshot: '- button "Show Password"',
        interactiveElements: [interactiveButton(
          "html > body > button",
          "Show Password",
        )],
      },
    );
    const primeCandidate = routeManifest(
      "/login",
      documentWith(element("button", {
        "aria-label": "Показать пароль",
        class: "p-password-toggle-mask p-link",
      })),
      {
        ariaSnapshot: '- button "Показать пароль"',
        interactiveElements: [interactiveButton(
          "html > body > button",
          "Показать пароль",
        )],
      },
    );
    expect(project(primeCandidate)).toEqual(project(primeBaseline));

    const baselinePasskey = passkeyManifest("Удалить ключ");
    const candidatePasskey = passkeyManifest("Удалить ключ Рабочий ноутбук 1");
    expect(project(candidatePasskey)).toEqual(project(baselinePasskey));
  });

  test("keeps every semantic allowlist near miss observable", () => {
    const baselineSkip = routeManifest("/tariffs", layoutDom(false), {
      ariaSnapshot: "- main:",
    });
    const wrongSkipHref = routeManifest("/tariffs", layoutDom(true), {
      ariaSnapshot: "- main:",
    });
    setDomAttribute(wrongSkipHref, "a", "href", "/support#<fragment>");
    expect(project(wrongSkipHref)).not.toEqual(project(baselineSkip));

    const wrongSkipStyle = routeManifest("/tariffs", layoutDom(true), {
      ariaSnapshot: [
        '- link "К основному содержимому":',
        '  - /url: {"origin":"<app-origin>","pathname":"/tariffs","query":[],"fragment":"<sha256:0c1923dd7ec27396>"}',
        "- main:",
      ].join("\n"),
      computedStyles: [skipLinkComputedStyle("9999")],
      interactiveElements: [skipLinkInteractive()],
    });
    expect(project(wrongSkipStyle)).not.toEqual(project(baselineSkip));

    const auth = logoCases()[0]!;
    const wrongLogo = structuredClone(auth.candidate);
    setDomAttribute(wrongLogo, "img", "src", "/different-logo.png");
    expect(project(wrongLogo)).not.toEqual(project(auth.baseline));

    const baselineHeading = routeManifest(
      "/cabinet",
      documentWith(element("div", { class: "card" }, [
        element("h5", {}, [text("Профиль")]),
      ])),
      { ariaSnapshot: '- main:\n  - heading "Профиль" [level=5]' },
    );
    const wrongHeadingStyle = routeManifest(
      "/cabinet",
      documentWith(element("div", { class: "card" }, [
        element("h2", { class: "text-xl" }, [text("Профиль")]),
      ])),
      {
        ariaSnapshot: '- main:\n  - heading "Профиль" [level=2]',
        computedStyles: [cabinetHeadingComputedStyle("600")],
      },
    );
    expect(project(wrongHeadingStyle)).not.toEqual(project(baselineHeading));

    const primeBaseline = routeManifest(
      "/login",
      documentWith(element("button", {
        "aria-label": "Show Password",
        class: "p-password-toggle-mask p-link",
      })),
      { ariaSnapshot: '- button "Show Password"' },
    );
    const wrongPrimeSignature = routeManifest(
      "/login",
      documentWith(element("button", {
        "aria-label": "Показать пароль",
        class: "password-toggle",
      })),
      { ariaSnapshot: '- button "Показать пароль"' },
    );
    expect(project(wrongPrimeSignature)).not.toEqual(project(primeBaseline));

    expect(project(passkeyManifest(
      "Удалить ключ Рабочий ноутбук 1",
      "/profile",
    ))).not.toEqual(project(passkeyManifest("Удалить ключ")));
  });
});

type DomNode = {
  type: "element" | "text";
  tag?: string;
  attributes?: Array<{ name: string; value: string }>;
  children?: DomNode[];
  value?: string;
};

function project(value: unknown) {
  return projectCharacterizationManifestForComparison(value);
}

function routeManifest(
  pathname: string,
  dom: DomNode,
  extra: Record<string, unknown> = {},
) {
  return {
    route: {
      requested: { origin: "<app-origin>", pathname, query: [], fragment: null },
      final: { origin: "<app-origin>", pathname, query: [], fragment: null },
    },
    dom,
    computedStyles: [],
    interactiveElements: [],
    ariaSnapshot: "",
    ...extra,
  };
}

function layoutDom(candidate: boolean) {
  const children = [
    element("div", { class: "layout-main-container" }, [
      element("main", candidate
        ? { class: "layout-main", id: "main-content", tabindex: "-1" }
        : { class: "layout-main" }),
    ]),
  ];
  if (candidate) {
    children.unshift(element("a", {
      class: "skip-link",
      href: "/tariffs#<fragment>",
    }, [text("К основному содержимому")]));
  }
  return documentWith(element(
    "div",
    { class: "layout-wrapper layout-static p-ripple-disabled" },
    children,
  ));
}

function logoCases() {
  const authBaseline = routeManifest(
    "/login",
    documentWith(element("main", {}, [
      element("div", { class: "text-center mb-4" }, [
        logo("Clean Pay", { class: "mb-3 flex-shrink-0 clean-auth-logo", height: "68", width: "68" }),
      ]),
    ])),
    { ariaSnapshot: '- main:\n  - img "Clean Pay"' },
  );
  const authCandidate = routeManifest(
    "/login",
    documentWith(element("main", {}, [
      element("div", { class: "text-center mb-4" }, [
        logo("", { class: "mb-3 flex-shrink-0 clean-auth-logo", height: "68", width: "68" }),
      ]),
    ])),
    { ariaSnapshot: "- main:" },
  );

  const shell = (candidate: boolean) => documentWith(element("div", {}, [
    element("header", {}, [
      element("a", { class: "layout-topbar-logo", href: "/" }, [
        logo(candidate ? "" : "Clean Pay logo", { height: "40", width: "40" }),
        text("Clean Pay"),
      ]),
    ]),
    element("footer", { class: "layout-footer flex align-items-center" }, [
      logo(candidate ? "" : "Clean Pay logo", { class: "mr-2", height: "14", width: "14" }),
      text("Clean Pay Версия 0.1.1"),
    ]),
  ]));
  const shellBaseline = routeManifest("/tariffs", shell(false), {
    ariaSnapshot: [
      "- banner:",
      '  - link "Clean Pay logo Clean Pay":',
      '    - /url: {"origin":"<app-origin>","pathname":"/","query":[],"fragment":null}',
      '    - img "Clean Pay logo"',
      "    - text: Clean Pay",
      "- contentinfo:",
      '  - img "Clean Pay logo"',
      "  - text: Clean Pay Версия 0.1.1",
    ].join("\n"),
  });
  const shellCandidate = routeManifest("/tariffs", shell(true), {
    ariaSnapshot: [
      "- banner:",
      '  - link "Clean Pay":',
      '    - /url: {"origin":"<app-origin>","pathname":"/","query":[],"fragment":null}',
      "    - text: Clean Pay",
      "- contentinfo:",
      "  - text: Clean Pay Версия 0.1.1",
    ].join("\n"),
  });
  return [
    { name: "auth logo", baseline: authBaseline, candidate: authCandidate },
    { name: "topbar and footer logos", baseline: shellBaseline, candidate: shellCandidate },
  ];
}

function logo(alt: string, attributes: Record<string, string>) {
  return element("img", { alt, src: "/clean-pay-logo.png", ...attributes });
}

function passkeyManifest(label: string, pathname = "/link-account") {
  const path = "html > body > div > button";
  return routeManifest(
    pathname,
    documentWith(element("div", { class: "passkey-list-item" }, [
      element("button", { "aria-label": label, type: "button" }, [
        element("span", { class: "pi pi-trash" }),
      ]),
    ])),
    {
      ariaSnapshot: `- button "${label}"`,
      interactiveElements: [interactiveButton(path, label)],
    },
  );
}

function skipLinkComputedStyle(zIndex = "10000") {
  return {
    path: "html > body > div > a",
    tag: "a",
    visible: true,
    box: { x: 0, y: -32, width: 160, height: 32 },
    style: {
      "background-color": "rgb(255, 255, 255)",
      "border-top-color": "rgb(99, 102, 241)",
      "border-top-style": "solid",
      "border-top-width": "2px",
      color: "rgb(49, 46, 129)",
      "font-weight": "700",
      position: "fixed",
      "z-index": zIndex,
    },
  };
}

function skipLinkInteractive() {
  return {
    path: "html > body > div > a",
    tag: "a",
    role: null,
    text: "К основному содержимому",
    ariaLabel: null,
    href: "/tariffs#<fragment>",
    visible: true,
    disabled: false,
    loading: false,
  };
}

function interactiveButton(path: string, ariaLabel: string) {
  return {
    path,
    tag: "button",
    role: null,
    text: "",
    ariaLabel,
    href: null,
    visible: true,
    disabled: false,
    loading: false,
  };
}

function cabinetHeadingComputedStyle(fontWeight = "500") {
  return {
    path: "html > body > div > h2",
    tag: "h2",
    visible: true,
    box: { x: 32, y: 32, width: 320, height: 24 },
    style: {
      "align-items": "normal",
      "background-color": "rgba(0, 0, 0, 0)",
      "border-bottom-color": "rgb(17, 24, 39)",
      "border-bottom-left-radius": "0px",
      "border-bottom-right-radius": "0px",
      "border-bottom-style": "none",
      "border-bottom-width": "0px",
      "border-left-color": "rgb(17, 24, 39)",
      "border-left-style": "none",
      "border-left-width": "0px",
      "border-right-color": "rgb(17, 24, 39)",
      "border-right-style": "none",
      "border-right-width": "0px",
      "border-top-color": "rgb(17, 24, 39)",
      "border-top-left-radius": "0px",
      "border-top-right-radius": "0px",
      "border-top-style": "none",
      "border-top-width": "0px",
      "box-shadow": "none",
      color: "rgb(17, 24, 39)",
      display: "block",
      "flex-direction": "row",
      "font-family": "\"Inter var\", sans-serif",
      "font-size": "20px",
      "font-weight": fontWeight,
      gap: "normal",
      "justify-content": "normal",
      "line-height": "24px",
      "margin-bottom": "16px",
      "margin-left": "0px",
      "margin-right": "0px",
      "margin-top": "0px",
      "max-width": "none",
      "min-height": "0px",
      opacity: "1",
      overflow: "visible",
      "padding-bottom": "0px",
      "padding-left": "0px",
      "padding-right": "0px",
      "padding-top": "0px",
      position: "static",
      "text-align": "start",
      visibility: "visible",
      "white-space": "normal",
      "z-index": "auto",
    },
  };
}

function documentWith(...children: DomNode[]) {
  return element("html", {}, [element("body", {}, children)]);
}

function element(
  tag: string,
  attributes: Record<string, string> = {},
  children: DomNode[] = [],
): DomNode {
  return {
    type: "element",
    tag,
    attributes: Object.entries(attributes)
      .map(([name, value]) => ({ name, value }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    children,
  };
}

function text(value: string): DomNode {
  return { type: "text", value };
}

function setDomAttribute(
  manifest: Record<string, unknown>,
  tag: string,
  name: string,
  value: string,
) {
  const dom = manifest.dom as DomNode;
  const node = findDomElement(dom, tag);
  const attribute = node?.attributes?.find((entry) => entry.name === name);
  if (attribute) attribute.value = value;
}

function findDomElement(node: DomNode, tag: string): DomNode | null {
  if (node.tag === tag) return node;
  for (const child of node.children ?? []) {
    const found = findDomElement(child, tag);
    if (found) return found;
  }
  return null;
}
