import { expect, test } from "@playwright/test";

import { projectCharacterizationManifestForComparison } from "./comparison-projection";
import { canonicalDom, sanitizeAriaUrls } from "./page-characterization";

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

    for (const wrapperClass of [
      "layout-wrapper layout-static layout-mobile-active p-ripple-disabled",
      "layout-wrapper layout-static layout-static-inactive p-ripple-disabled",
    ]) {
      const baselineState = routeManifest("/tariffs", layoutDom(false, wrapperClass), {
        ariaSnapshot: "- main:",
      });
      const candidateState = routeManifest("/tariffs", layoutDom(true, wrapperClass), {
        ariaSnapshot: candidateSkip.ariaSnapshot,
        computedStyles: [skipLinkComputedStyle()],
        interactiveElements: [skipLinkInteractive()],
      });
      expect(project(candidateState), wrapperClass).toEqual(project(baselineState));
    }

    for (const logo of logoCases()) {
      expect(project(logo.candidate), logo.name).toEqual(project(logo.baseline));
    }

    const cssFreeAuth = structuredClone(logoCases()[0]!);
    setDomAttribute(cssFreeAuth.candidate, "img", "alt", "Clean Pay");
    setDomAttribute(cssFreeAuth.candidate, "img", "aria-hidden", "true");
    expect(project(cssFreeAuth.candidate)).toEqual(project(cssFreeAuth.baseline));
    const shellPair = logoCases()[1]!;
    const realBrowserShell = structuredClone(shellPair.candidate);
    realBrowserShell.ariaSnapshot = [
      "- banner:",
      '  - link "Clean Pay":',
      '    - /url: {"origin":"<app-origin>","pathname":"/","query":[],"fragment":null}',
      "- contentinfo: Clean Pay Версия 0.1.1",
    ].join("\n");
    expect(project(realBrowserShell)).toEqual(project(shellPair.baseline));

    const baselineHeading = routeManifest(
      "/cabinet",
      documentWith(element("div", { class: "card" }, [
        element("h5", {}, [text("Профиль")]),
      ])),
      {
        ariaSnapshot: [
          "- main:",
          "  - region:",
          '    - heading "Профиль" [level=5]',
        ].join("\n"),
      },
    );
    const candidateHeading = routeManifest(
      "/cabinet",
      documentWith(element("div", { class: "card" }, [
        element("h2", { class: "text-xl" }, [text("Профиль")]),
      ])),
      {
        ariaSnapshot: [
          "- main:",
          "  - region:",
          '    - heading "Профиль" [level=2]',
        ].join("\n"),
        computedStyles: [cabinetHeadingComputedStyle()],
      },
    );
    expect(project(candidateHeading)).toEqual(project(baselineHeading));

    const duplicateNestedHeading = structuredClone(candidateHeading);
    duplicateNestedHeading.ariaSnapshot += '\n    - heading "Профиль" [level=2]';
    expect(project(duplicateNestedHeading)).not.toEqual(project(baselineHeading));

    const suffixedNestedHeading = structuredClone(candidateHeading);
    suffixedNestedHeading.ariaSnapshot = suffixedNestedHeading.ariaSnapshot.replace(
      '[level=2]',
      '[level=2] unexpected',
    );
    expect(project(suffixedNestedHeading)).not.toEqual(project(baselineHeading));
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

    for (const passwordCase of [
      {
        baselineLabel: "Show Password",
        candidateLabel: "Показать введённые символы",
        fieldLabel: "Пароль",
        inputName: "password",
        pathname: "/login",
        state: "show",
      },
      {
        baselineLabel: "Hide Password",
        candidateLabel: "Скрыть введённые символы",
        fieldLabel: "Пароль личного кабинета",
        inputName: "password",
        pathname: "/link-account",
        state: "hide",
      },
      {
        baselineLabel: "Show Password",
        candidateLabel: "Показать повторно введённые символы",
        fieldLabel: "Повторите новый пароль",
        inputName: "passwordConfirmation",
        pathname: "/register",
        state: "show",
      },
      {
        baselineLabel: "Hide Password",
        candidateLabel: "Скрыть повторно введённые символы",
        fieldLabel: "Повторите пароль",
        inputName: "confirmPassword",
        pathname: "/link-account",
        state: "hide",
      },
      {
        baselineLabel: "Show Password",
        candidateLabel: "Показать текущее введённое значение",
        fieldLabel: "Текущий пароль",
        inputName: "currentPassword",
        pathname: "/profile",
        state: "show",
      },
      {
        baselineLabel: "Hide Password",
        candidateLabel: "Скрыть текущее введённое значение",
        fieldLabel: "Текущий пароль",
        inputName: "currentPassword",
        pathname: "/profile",
        state: "hide",
      },
      {
        baselineLabel: "Show Password",
        candidateLabel: "Показать новое введённое значение",
        fieldLabel: "Новый пароль",
        inputName: "newPassword",
        pathname: "/profile",
        state: "show",
      },
      {
        baselineLabel: "Hide Password",
        candidateLabel: "Скрыть новое введённое значение",
        fieldLabel: "Новый пароль",
        inputName: "newPassword",
        pathname: "/profile",
        state: "hide",
      },
    ] as const) {
      const contextualBaseline = passwordToggleManifest({
        ...passwordCase,
        toggleLabel: passwordCase.baselineLabel,
      });
      const contextualCandidate = passwordToggleManifest({
        ...passwordCase,
        toggleLabel: passwordCase.candidateLabel,
      });
      expect(project(contextualCandidate), passwordCase.candidateLabel)
        .toEqual(project(contextualBaseline));
    }

    expect(project(passwordProfileManifest(
      "Показать текущее введённое значение",
      "Показать новое введённое значение",
    ))).toEqual(project(passwordProfileManifest(
      "Show Password",
      "Show Password",
    )));
    expect(project(passwordProfileManifest(
      "Показать новое введённое значение",
      "Показать текущее введённое значение",
    ))).not.toEqual(project(passwordProfileManifest(
      "Show Password",
      "Show Password",
    )));

    for (const nearMiss of [
      {
        candidateLabel: "Показать новое введённое значение",
        fieldLabel: "Текущий пароль",
        inputName: "currentPassword",
        pathname: "/profile",
        state: "show",
      },
      {
        candidateLabel: "Показать введённые символы",
        fieldLabel: "Повторите новый пароль",
        inputName: "passwordConfirmation",
        pathname: "/register",
        state: "show",
      },
      {
        candidateLabel: "Показать текущее введённое значение",
        fieldLabel: "Текущий пароль",
        inputName: "currentPassword",
        pathname: "/support",
        state: "show",
      },
      {
        candidateLabel: "Показать текущее введённое значение",
        fieldLabel: "Текущий пароль",
        inputName: "unexpectedPassword",
        pathname: "/profile",
        state: "show",
      },
      {
        candidateLabel: "Показать текущее введённое значение",
        fieldLabel: "Неверная метка",
        inputName: "currentPassword",
        pathname: "/profile",
        state: "show",
      },
      {
        candidateLabel: "Показать текущее введённое значение",
        fieldLabel: "Текущий пароль",
        inputName: "currentPassword",
        pathname: "/profile",
        state: "hide",
      },
    ] as const) {
      const baselineLabel = nearMiss.candidateLabel.startsWith("Показать")
        ? "Show Password"
        : "Hide Password";
      expect(project(passwordToggleManifest({
        ...nearMiss,
        toggleLabel: nearMiss.candidateLabel,
      })), JSON.stringify(nearMiss)).not.toEqual(project(passwordToggleManifest({
        ...nearMiss,
        toggleLabel: baselineLabel,
      })));
    }

    const incompleteBaseline = passwordToggleManifest({
      fieldLabel: "Текущий пароль",
      inputName: "currentPassword",
      pathname: "/profile",
      state: "show",
      toggleLabel: "Show Password",
    });
    const incompleteCandidate = passwordToggleManifest({
      fieldLabel: "Текущий пароль",
      inputName: "currentPassword",
      pathname: "/profile",
      state: "show",
      toggleLabel: "Показать текущее введённое значение",
    });
    incompleteBaseline.ariaSnapshot = '- switch "Show Password" [checked]';
    incompleteCandidate.ariaSnapshot = '- switch "Показать текущее введённое значение" [checked]';
    const projectedIncompleteCandidate = project(incompleteCandidate) as {
      ariaSnapshot: string;
    };
    expect(projectedIncompleteCandidate.ariaSnapshot)
      .toContain('- switch "Показать текущее введённое значение" [checked]');
    expect(projectedIncompleteCandidate).not.toEqual(project(incompleteBaseline));

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

    for (const wrapperClass of [
      "layout-wrapper layout-static layout-mobile-active p-ripple-disabled extra",
      "layout-wrapper layout-static p-ripple-disabled layout-mobile-active",
      "layout-wrapper layout-static layout-mobile-active layout-static-inactive p-ripple-disabled",
      "layout-wrapper layout-overlay p-ripple-disabled",
    ]) {
      const wrongWrapper = routeManifest("/tariffs", layoutDom(true, wrapperClass), {
        ariaSnapshot: candidateSkipAria("/tariffs"),
        computedStyles: [skipLinkComputedStyle()],
        interactiveElements: [skipLinkInteractive()],
      });
      expect(project(wrongWrapper), wrapperClass).not.toEqual(project(baselineSkip));
    }

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

    const visibleCssFreeLogo = structuredClone(auth.candidate);
    setDomAttribute(visibleCssFreeLogo, "img", "alt", "Clean Pay");
    setDomAttribute(visibleCssFreeLogo, "img", "aria-hidden", "false");
    expect(project(visibleCssFreeLogo)).not.toEqual(project(auth.baseline));

    const shell = logoCases()[1]!;
    for (const ariaSnapshot of [
      `${shell.candidate.ariaSnapshot}\n    - button "Unexpected"`,
      shell.candidate.ariaSnapshot.replace("Версия 0.1.1", "Версия latest"),
      shell.candidate.ariaSnapshot.replace("    - text: Clean Pay", "    - text: Different"),
    ]) {
      const wrongAria = structuredClone(shell.candidate);
      wrongAria.ariaSnapshot = ariaSnapshot;
      expect(project(wrongAria)).not.toEqual(project(shell.baseline));
    }

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

test.describe("route-relative browser evidence", () => {
  test("resolves fragment-only DOM links against the current route", async ({ page }) => {
    await page.route("http://canonical.test/**", async (route) => {
      await route.fulfill({
        body: '<!doctype html><html><body><a href="#main-content">Skip</a></body></html>',
        contentType: "text/html",
      });
    });
    await page.goto("http://canonical.test/tariffs");

    const dom = await canonicalDom(page);
    const anchor = dom ? findDomElement(dom, "a") : null;
    expect(anchor?.attributes?.find((entry) => entry.name === "href")?.value)
      .toBe("/tariffs#<fragment>");
  });

  test("decodes ARIA URL scalars before route-relative canonicalization", () => {
    const origin = "https://pay.ci.clean-pay.dev";
    const documentUrl = `${origin}/tariffs`;
    const snapshot = [
      '- link "К основному содержимому":',
      '  - /url: "#main-content"',
    ].join("\n");
    const expected = [
      '- link "К основному содержимому":',
      '  - /url: {"origin":"<app-origin>","pathname":"/tariffs","query":[],"fragment":"<sha256:0c1923dd7ec27396>"}',
    ].join("\n");

    expect(sanitizeAriaUrls(snapshot, origin, documentUrl)).toBe(expected);
    for (const nearMiss of [
      snapshot.replace("#main-content", "#different-target"),
      snapshot.replace('"#main-content"', '"#main-content'),
      snapshot.replace('"#main-content"', "42"),
      snapshot.replace('"#main-content"', '"https://outside.invalid/main"'),
    ]) {
      expect(sanitizeAriaUrls(nearMiss, origin, documentUrl)).not.toBe(expected);
    }
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

function layoutDom(
  candidate: boolean,
  wrapperClass = "layout-wrapper layout-static p-ripple-disabled",
) {
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
    { class: wrapperClass },
    children,
  ));
}

function candidateSkipAria(pathname: string) {
  return [
    '- link "К основному содержимому":',
    `  - /url: {"origin":"<app-origin>","pathname":"${pathname}","query":[],"fragment":"<sha256:0c1923dd7ec27396>"}`,
    "- main:",
  ].join("\n");
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

function passwordToggleManifest({
  fieldLabel,
  inputName,
  pathname,
  state,
  toggleLabel,
}: {
  fieldLabel: string;
  inputName: string;
  pathname: string;
  state: "hide" | "show";
  toggleLabel: string;
}) {
  const togglePath = "html > body > label > div > div > span > svg";
  return routeManifest(
    pathname,
    documentWith(passwordFieldDom({ fieldLabel, inputName, state, toggleLabel })),
    {
      ariaSnapshot: [
        `- textbox "${fieldLabel} ${toggleLabel}"`,
        `- switch "${toggleLabel}"${state === "show" ? " [checked]" : ""}`,
      ].join("\n"),
      interactiveElements: [{
        ...interactiveButton(togglePath, toggleLabel),
        role: "switch",
        tag: "svg",
      }],
    },
  );
}

function passwordProfileManifest(currentLabel: string, nextLabel: string) {
  const controls = [
    {
      fieldLabel: "Текущий пароль",
      inputName: "currentPassword",
      toggleLabel: currentLabel,
    },
    {
      fieldLabel: "Новый пароль",
      inputName: "newPassword",
      toggleLabel: nextLabel,
    },
  ];
  return routeManifest(
    "/profile",
    documentWith(...controls.map((control) => passwordFieldDom({
      ...control,
      state: "show",
    }))),
    {
      ariaSnapshot: controls.flatMap((control) => [
        `- textbox "${control.fieldLabel} ${control.toggleLabel}"`,
        `- switch "${control.toggleLabel}" [checked]`,
      ]).join("\n"),
      interactiveElements: controls.map((control, index) => ({
        ...interactiveButton(
          `html > body > label:nth-of-type(${index + 1}) > div > div > span > svg`,
          control.toggleLabel,
        ),
        role: "switch",
        tag: "svg",
      })),
    },
  );
}

function passwordFieldDom({
  fieldLabel,
  inputName,
  state,
  toggleLabel,
}: {
  fieldLabel: string;
  inputName: string;
  state: "hide" | "show";
  toggleLabel: string;
}) {
  return element("label", { class: "flex flex-column gap-2" }, [
    element("span", { class: "text-sm font-medium text-700" }, [
      text(fieldLabel),
    ]),
    element("div", {
      class: "w-full p-password p-component p-inputwrapper p-input-icon-right",
      "data-pc-name": "password",
      "data-pc-section": "root",
    }, [
      element("div", {
        class: "p-icon-field p-icon-field-right",
        "data-pc-name": "iconfield",
        "data-pc-section": "root",
      }, [
        element("input", {
          class: "w-full p-password-input p-inputtext p-component",
          "data-pc-name": "inputtext",
          "data-pc-section": "root",
          name: inputName,
          type: state === "show" ? "password" : "text",
        }),
        element("span", {
          class: "p-input-icon",
          "data-pc-name": "inputicon",
          "data-pc-section": "root",
        }, [
          element("svg", {
            "aria-checked": state === "show" ? "true" : "false",
            "aria-label": toggleLabel,
            class: `p-icon p-password-${state}-icon`,
            "data-pc-section": `${state}icon`,
            role: "switch",
          }),
        ]),
      ]),
    ]),
  ]);
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
  if (attribute) {
    attribute.value = value;
    return;
  }
  node?.attributes?.push({ name, value });
  node?.attributes?.sort((left, right) => left.name.localeCompare(right.name));
}

function findDomElement(node: DomNode, tag: string): DomNode | null {
  if (node.tag === tag) return node;
  for (const child of node.children ?? []) {
    const found = findDomElement(child, tag);
    if (found) return found;
  }
  return null;
}
