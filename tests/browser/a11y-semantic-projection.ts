const SKIP_LINK_TEXT = "К основному содержимому";
const SKIP_LINK_FRAGMENT = "<sha256:0c1923dd7ec27396>";
const SKIP_LINK_WRAPPER_CLASSES = new Set([
  "layout-wrapper layout-static p-ripple-disabled",
  "layout-wrapper layout-static layout-mobile-active p-ripple-disabled",
  "layout-wrapper layout-static layout-static-inactive p-ripple-disabled",
]);

const cabinetHeadings = new Map<string, string | null>([
  ["Профиль", null],
  ["Промокод", null],
  ["Детали подписки", null],
  ["Поддержка", null],
  ["Устройства", "cabinet-devices-title"],
  ["История платежей", "cabinet-payments-title"],
]);

const primeAriaEnglishToRussian = new Map<string, string>([
  ["Cancel Edit", "Отменить редактирование"],
  ["Close", "Закрыть"],
  ["Collapse", "Свернуть"],
  ["Row Collapsed", "Строка свёрнута"],
  ["Edit Row", "Редактировать строку"],
  ["Expand", "Развернуть"],
  ["Row Expanded", "Строка развёрнута"],
  ["False", "Нет"],
  ["Filter Constraint", "Условие фильтра"],
  ["Filter Operator", "Оператор фильтра"],
  ["First Page", "Первая страница"],
  ["Grid View", "Вид сеткой"],
  ["Hide Filter Menu", "Скрыть меню фильтра"],
  ["Jump to Page Dropdown", "Выбор страницы"],
  ["Jump to Page Input", "Номер страницы"],
  ["Last Page", "Последняя страница"],
  ["Option List", "Список вариантов"],
  ["List View", "Вид списком"],
  ["Move All to Source", "Переместить всё в исходный список"],
  ["Move All to Target", "Переместить всё в целевой список"],
  ["Move Bottom", "Переместить в конец"],
  ["Move Down", "Переместить вниз"],
  ["Move to Source", "Переместить в исходный список"],
  ["Move to Target", "Переместить в целевой список"],
  ["Move Top", "Переместить в начало"],
  ["Move Up", "Переместить вверх"],
  ["Navigation", "Навигация"],
  ["Next", "Далее"],
  ["Next Page", "Следующая страница"],
  ["Not Selected", "Не выбрано"],
  ["Previous", "Назад"],
  ["Previous Page", "Предыдущая страница"],
  ["Remove", "Удалить"],
  ["Rotate Left", "Повернуть влево"],
  ["Rotate Right", "Повернуть вправо"],
  ["Rows per page", "Строк на странице"],
  ["Save Edit", "Сохранить изменения"],
  ["Scroll Top", "Прокрутить вверх"],
  ["All items selected", "Все элементы выбраны"],
  ["Select", "Выбрать"],
  ["Row Selected", "Строка выбрана"],
  ["Show Filter Menu", "Показать меню фильтра"],
  ["Slide", "Слайд"],
  ["1 star", "1 звезда"],
  ["True", "Да"],
  ["All items unselected", "Выбор всех элементов отменён"],
  ["Unselect", "Отменить выбор"],
  ["Row Unselected", "Выбор строки отменён"],
  ["Zoom Image", "Увеличить изображение"],
  ["Zoom In", "Приблизить"],
  ["Zoom Out", "Отдалить"],
  ["Hide Password", "Скрыть пароль"],
  ["Show Password", "Показать пароль"],
]);

const primeAriaRussianToEnglish = new Map(
  [...primeAriaEnglishToRussian].map(([english, russian]) => [russian, english]),
);

type DomEntry = {
  node: Record<string, unknown>;
  parent: Record<string, unknown> | null;
  path: string;
};

type ProjectionContext = {
  finalUrl: Record<string, unknown> | null;
  routePathname: string | null;
  skipLinkPath: string | null;
  skipLinkHref: string | null;
  headingPaths: Map<string, string>;
  candidateHeadingPaths: Set<string>;
  headingNames: Map<string, number>;
  primeLabelsByPath: Map<string, string>;
  primeSnapshotLabels: Map<string, { count: number; normalized: string }>;
  passkeyPaths: Set<string>;
  passkeySnapshotLabels: Map<string, number>;
  authLogo: boolean;
  topbarLogo: boolean;
  footerLogo: boolean;
};

/** Applies only the explicitly approved semantic-only baseline differences. */
export function projectAllowlistedA11ySemantics(
  manifest: Record<string, unknown>,
) {
  const context = createContext(manifest);
  const entries = collectDomElements(manifest.dom);
  projectDom(entries, context);
  projectComputedStyles(manifest, context);
  projectInteractiveElements(manifest, context);
  projectAriaSnapshot(manifest, context);
}

function createContext(manifest: Record<string, unknown>): ProjectionContext {
  const route = manifest.route;
  const requested = isRecord(route) && isRecord(route.requested)
    ? route.requested
    : null;
  const finalUrl = isRecord(route) && isRecord(route.final) ? route.final : null;
  return {
    finalUrl,
    routePathname: typeof requested?.pathname === "string" ? requested.pathname : null,
    skipLinkPath: null,
    skipLinkHref: finalUrl ? canonicalDomHref(finalUrl) : null,
    headingPaths: new Map(),
    candidateHeadingPaths: new Set(),
    headingNames: new Map(),
    primeLabelsByPath: new Map(),
    primeSnapshotLabels: new Map(),
    passkeyPaths: new Set(),
    passkeySnapshotLabels: new Map(),
    authLogo: false,
    topbarLogo: false,
    footerLogo: false,
  };
}

function projectDom(entries: DomEntry[], context: ProjectionContext) {
  for (const entry of entries) {
    if (isExactSkipLink(entry, context)) {
      context.skipLinkPath = entry.path;
      removeChild(entry.parent, entry.node);
      continue;
    }
    projectMainTarget(entry);
    projectDecorativeLogo(entry, context);
    projectCabinetHeading(entry, context);
    projectPrimeAriaLabel(entry, context);
    projectPasskeyDeleteName(entry, context);
  }
}

function isExactSkipLink(entry: DomEntry, context: ProjectionContext) {
  return context.skipLinkHref !== null
    && entry.node.tag === "a"
    && /^html > body > div(?::nth-of-type\(\d+\))? > a$/.test(entry.path)
    && SKIP_LINK_WRAPPER_CLASSES.has(getAttribute(entry.parent, "class") ?? "")
    && hasExactAttributes(entry.node, {
      class: "skip-link",
      href: context.skipLinkHref,
    })
    && hasExactText(entry.node, SKIP_LINK_TEXT);
}

function projectMainTarget(entry: DomEntry) {
  if (
    entry.node.tag === "main"
    && getAttribute(entry.parent, "class") === "layout-main-container"
    && hasExactAttributes(entry.node, {
      class: "layout-main",
      id: "main-content",
      tabindex: "-1",
    })
  ) {
    entry.node.attributes = [{ name: "class", value: "layout-main" }];
  }
}

function projectDecorativeLogo(entry: DomEntry, context: ProjectionContext) {
  if (entry.node.tag !== "img") return;
  const alt = getAttribute(entry.node, "alt");
  const src = getAttribute(entry.node, "src");
  if (src !== "/clean-pay-logo.png") return;

  const parentClass = getAttribute(entry.parent, "class");
  const auth = parentClass === "text-center mb-4"
    && getAttribute(entry.node, "class") === "mb-3 flex-shrink-0 clean-auth-logo"
    && getAttribute(entry.node, "height") === "68"
    && getAttribute(entry.node, "width") === "68"
    && (alt === "Clean Pay" || alt === "");
  const topbar = entry.parent?.tag === "a"
    && parentClass === "layout-topbar-logo"
    && getAttribute(entry.node, "height") === "40"
    && getAttribute(entry.node, "width") === "40"
    && (alt === "Clean Pay logo" || alt === "");
  const footer = entry.parent?.tag === "footer"
    && parentClass === "layout-footer flex align-items-center"
    && getAttribute(entry.node, "class") === "mr-2"
    && getAttribute(entry.node, "height") === "14"
    && getAttribute(entry.node, "width") === "14"
    && (alt === "Clean Pay logo" || alt === "");
  if (!auth && !topbar && !footer) return;
  setAttribute(entry.node, "alt", "");
  context.authLogo ||= auth;
  context.topbarLogo ||= topbar;
  context.footerLogo ||= footer;
}

function projectCabinetHeading(entry: DomEntry, context: ProjectionContext) {
  if (context.routePathname !== "/cabinet") return;
  const name = exactText(entry.node);
  const expectedId = name ? cabinetHeadings.get(name) : undefined;
  if (expectedId === undefined || (entry.node.tag !== "h5" && entry.node.tag !== "h2")) {
    return;
  }
  const parentIsCard = getAttribute(entry.parent, "class") === "card";
  const parentIsDevices = expectedId === "cabinet-devices-title"
    && entry.parent?.tag === "section"
    && getAttribute(entry.parent, "class") === "card cabinet-devices-section"
    && getAttribute(entry.parent, "aria-labelledby") === expectedId;
  const parentIsPayments = expectedId === "cabinet-payments-title"
    && entry.parent?.tag === "section"
    && parentIsCard
    && getAttribute(entry.parent, "aria-labelledby") === expectedId;
  if (!(expectedId === null ? parentIsCard : parentIsDevices || parentIsPayments)) return;

  const baselineAttributes: Record<string, string> = expectedId === null
    ? {}
    : { id: expectedId };
  const candidateAttributes: Record<string, string> = expectedId === null
    ? { class: "text-xl" }
    : { class: "text-xl", id: expectedId };
  if (
    !hasExactAttributes(entry.node, baselineAttributes)
    && !hasExactAttributes(entry.node, candidateAttributes)
  ) {
    return;
  }
  const candidateHeading = entry.node.tag === "h2";
  const normalizedPath = entry.path.replace(/h[25](?::nth-of-type\(\d+\))?$/, "h2");
  context.headingPaths.set(entry.path, normalizedPath);
  if (candidateHeading) context.candidateHeadingPaths.add(entry.path);
  incrementCount(context.headingNames, name as string);
  entry.node.tag = "h2";
  entry.node.attributes = Object.entries(candidateAttributes)
    .map(([attributeName, value]) => ({ name: attributeName, value }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function projectPrimeAriaLabel(entry: DomEntry, context: ProjectionContext) {
  const current = getAttribute(entry.node, "aria-label");
  if (current === null || !hasPrimeComponentSignature(entry.node)) return;
  const normalized = normalizePrimeAriaLabel(current);
  if (normalized === null) return;
  setAttribute(entry.node, "aria-label", normalized);
  context.primeLabelsByPath.set(entry.path, normalized);
  const snapshotLabel = context.primeSnapshotLabels.get(current);
  context.primeSnapshotLabels.set(current, {
    count: (snapshotLabel?.count ?? 0) + 1,
    normalized,
  });
}

function projectPasskeyDeleteName(entry: DomEntry, context: ProjectionContext) {
  if (
    context.routePathname !== "/link-account"
    || entry.node.tag !== "button"
    || getAttribute(entry.parent, "class") !== "passkey-list-item"
    || !hasDescendantClass(entry.node, "pi pi-trash")
  ) {
    return;
  }
  const label = getAttribute(entry.node, "aria-label");
  if (label !== "Удалить ключ" && !/^Удалить ключ .+ [1-9]\d*$/.test(label ?? "")) {
    return;
  }
  setAttribute(entry.node, "aria-label", "Удалить ключ");
  context.passkeyPaths.add(entry.path);
  incrementCount(context.passkeySnapshotLabels, label as string);
}

function projectComputedStyles(
  manifest: Record<string, unknown>,
  context: ProjectionContext,
) {
  if (!Array.isArray(manifest.computedStyles)) return;
  const computedStyles = manifest.computedStyles.filter((value) => {
    if (!isRecord(value)) return true;
    if (value.path === context.skipLinkPath && isExactSkipLinkStyle(value)) {
      return false;
    }
    // h5 was deliberately absent from the original computed-style selector.
    // The allowlisted h5 -> h2 semantic correction makes the candidate h2
    // newly selectable, so remove that extra record only after proving its
    // complete captured style is the exact visual equivalent of the old h5.
    return !(
      typeof value.path === "string"
      && context.candidateHeadingPaths.has(value.path)
      && isExactCandidateCabinetHeadingStyle(value)
    );
  });
  manifest.computedStyles = computedStyles;
  for (const value of computedStyles) {
    if (!isRecord(value) || typeof value.path !== "string") continue;
    const normalizedPath = context.headingPaths.get(value.path);
    if (!normalizedPath || (value.tag !== "h5" && value.tag !== "h2")) continue;
    value.path = normalizedPath;
    value.tag = "h2";
  }
}

const exactCabinetHeadingStyle: Record<string, string> = {
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
  "font-weight": "500",
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
};

function isExactCandidateCabinetHeadingStyle(value: Record<string, unknown>) {
  return value.tag === "h2"
    && value.visible === true
    && isRecord(value.box)
    && typeof value.box.width === "number"
    && value.box.width > 0
    && value.box.height === 24
    && isRecord(value.style)
    && hasExactStringRecord(value.style, exactCabinetHeadingStyle);
}

function isExactSkipLinkStyle(value: Record<string, unknown>) {
  const style = value.style;
  return value.tag === "a"
    && value.visible === true
    && isRecord(value.box)
    && typeof value.box.y === "number"
    && value.box.y < 0
    && isRecord(style)
    && style["background-color"] === "rgb(255, 255, 255)"
    && style["border-top-color"] === "rgb(99, 102, 241)"
    && style["border-top-style"] === "solid"
    && style["border-top-width"] === "2px"
    && style.color === "rgb(49, 46, 129)"
    && style["font-weight"] === "700"
    && style.position === "fixed"
    && style["z-index"] === "10000";
}

function projectInteractiveElements(
  manifest: Record<string, unknown>,
  context: ProjectionContext,
) {
  if (!Array.isArray(manifest.interactiveElements)) return;
  const interactiveElements = manifest.interactiveElements.filter((value) => (
    !isExactSkipInteractive(value, context)
  ));
  manifest.interactiveElements = interactiveElements;
  for (const value of interactiveElements) {
    if (!isRecord(value) || typeof value.path !== "string") continue;
    const primeLabel = context.primeLabelsByPath.get(value.path);
    if (primeLabel && (value.ariaLabel === primeLabel || normalizePrimeAriaLabel(
      typeof value.ariaLabel === "string" ? value.ariaLabel : "",
    ) === primeLabel)) {
      value.ariaLabel = primeLabel;
    }
    if (
      context.passkeyPaths.has(value.path)
      && value.tag === "button"
      && (value.ariaLabel === "Удалить ключ"
        || /^Удалить ключ .+ [1-9]\d*$/.test(String(value.ariaLabel)))
    ) {
      value.ariaLabel = "Удалить ключ";
    }
  }
}

function isExactSkipInteractive(value: unknown, context: ProjectionContext) {
  return isRecord(value)
    && value.path === context.skipLinkPath
    && value.tag === "a"
    && value.role === null
    && value.text === SKIP_LINK_TEXT
    && value.ariaLabel === null
    && value.href === context.skipLinkHref
    && value.visible === true
    && value.disabled === false
    && value.loading === false;
}

function projectAriaSnapshot(
  manifest: Record<string, unknown>,
  context: ProjectionContext,
) {
  if (typeof manifest.ariaSnapshot !== "string") return;
  let lines = manifest.ariaSnapshot.split("\n");
  lines = removeExactSkipLinkAria(lines, context);
  lines = projectExactLogoAria(lines, context);
  const eligibleHeadings = eligibleHeadingSnapshotNames(lines, context);
  const eligiblePrimeLabels = eligiblePrimeSnapshotLabels(lines, context);
  const eligiblePasskeyLabels = eligiblePasskeySnapshotLabels(lines, context);
  lines = lines.map((line) => projectAriaLine(
    line,
    context,
    eligibleHeadings,
    eligiblePrimeLabels,
    eligiblePasskeyLabels,
  ));
  manifest.ariaSnapshot = lines.join("\n");
}

function projectExactLogoAria(lines: string[], context: ProjectionContext) {
  const projected = [...lines];
  if (context.authLogo) {
    const main = projected.indexOf("- main:");
    if (main >= 0 && projected[main + 1] === '  - img "Clean Pay"') {
      projected.splice(main + 1, 1);
    }
  }
  if (context.topbarLogo) {
    for (let index = 0; index < projected.length - 3; index += 1) {
      if (
        projected[index] === '  - link "Clean Pay logo Clean Pay":'
        && projected[index + 1]
          === '    - /url: {"origin":"<app-origin>","pathname":"/","query":[],"fragment":null}'
        && projected[index + 2] === '    - img "Clean Pay logo"'
        && projected[index + 3] === "    - text: Clean Pay"
      ) {
        projected[index] = '  - link "Clean Pay":';
        projected.splice(index + 2, 2);
        break;
      }
      if (
        projected[index] === '  - link "Clean Pay":'
        && projected[index + 1]
          === '    - /url: {"origin":"<app-origin>","pathname":"/","query":[],"fragment":null}'
        && projected[index + 2] === "    - text: Clean Pay"
      ) {
        projected.splice(index + 2, 1);
        break;
      }
    }
  }
  if (context.footerLogo) {
    for (let index = 0; index < projected.length; index += 1) {
      if (projected[index] !== "- contentinfo:") continue;
      const hasLogo = projected[index + 1] === '  - img "Clean Pay logo"';
      const textIndex = index + (hasLogo ? 2 : 1);
      const version = exactFooterVersion(projected[textIndex]);
      if (!version) continue;
      projected[index] = `- contentinfo: Clean Pay Версия ${version}`;
      projected.splice(index + 1, hasLogo ? 2 : 1);
      break;
    }
  }
  return projected;
}

function exactFooterVersion(line: string | undefined) {
  const match = /^  - text: Clean Pay Версия ([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/.exec(
    line ?? "",
  );
  return match?.[1] ?? null;
}

function removeExactSkipLinkAria(
  lines: string[],
  context: ProjectionContext,
) {
  if (!context.skipLinkPath || !context.finalUrl) return lines;
  const result: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== `- link "${SKIP_LINK_TEXT}":`) {
      result.push(lines[index] as string);
      continue;
    }
    const next = lines[index + 1];
    const rawUrl = next?.startsWith("  - /url: ") ? next.slice(10) : null;
    if (!rawUrl || !isExactSkipLinkAriaUrl(rawUrl, context.finalUrl)) {
      result.push(lines[index] as string);
      continue;
    }
    index += 1;
  }
  return result;
}

function isExactSkipLinkAriaUrl(raw: string, finalUrl: Record<string, unknown>) {
  try {
    const url: unknown = JSON.parse(raw);
    return isRecord(url)
      && url.origin === "<app-origin>"
      && url.pathname === finalUrl.pathname
      && JSON.stringify(url.query) === JSON.stringify(finalUrl.query)
      && url.fragment === SKIP_LINK_FRAGMENT;
  } catch {
    return false;
  }
}

function projectAriaLine(
  line: string,
  context: ProjectionContext,
  eligibleHeadings: Set<string>,
  eligiblePrimeLabels: Map<string, string>,
  eligiblePasskeyLabels: Set<string>,
) {
  if (context.routePathname === "/cabinet") {
    for (const name of eligibleHeadings) {
      if (line === `  - heading "${name}" [level=5]`) {
        return `  - heading "${name}" [level=2]`;
      }
    }
  }
  if (
    context.routePathname === "/link-account"
    && context.passkeyPaths.size > 0
    && /^\s*- button "([^\"]+)"$/.test(line)
  ) {
    const label = /^\s*- button "([^\"]+)"$/.exec(line)?.[1];
    if (label && eligiblePasskeyLabels.has(label)) {
      return line.replace(`"${label}"`, '"Удалить ключ"');
    }
  }
  const roleMatch = /^(\s*- [a-z]+ )"([^"]+)"(.*)$/.exec(line);
  if (!roleMatch) return line;
  const [, prefix, label, suffix] = roleMatch;
  const normalized = eligiblePrimeLabels.get(label as string);
  return normalized ? `${prefix}"${normalized}"${suffix}` : line;
}

function eligibleHeadingSnapshotNames(
  lines: string[],
  context: ProjectionContext,
) {
  const result = new Set<string>();
  for (const [name, expectedCount] of context.headingNames) {
    const actualCount = lines.filter((line) => (
      line === `  - heading "${name}" [level=5]`
      || line === `  - heading "${name}" [level=2]`
    )).length;
    if (actualCount === expectedCount) result.add(name);
  }
  return result;
}

function eligiblePrimeSnapshotLabels(
  lines: string[],
  context: ProjectionContext,
) {
  const result = new Map<string, string>();
  for (const [source, entry] of context.primeSnapshotLabels) {
    const actualCount = lines.filter((line) => {
      const match = /^(\s*- [a-z]+ )"([^"]+)"(.*)$/.exec(line);
      return match?.[2] === source;
    }).length;
    if (actualCount === entry.count) result.set(source, entry.normalized);
  }
  return result;
}

function eligiblePasskeySnapshotLabels(
  lines: string[],
  context: ProjectionContext,
) {
  const result = new Set<string>();
  let matchedTotal = 0;
  for (const [source, expectedCount] of context.passkeySnapshotLabels) {
    const actualCount = lines.filter((line) => (
      /^\s*- button "([^\"]+)"$/.exec(line)?.[1] === source
    )).length;
    if (actualCount !== expectedCount) return new Set<string>();
    matchedTotal += actualCount;
    result.add(source);
  }
  return matchedTotal === context.passkeyPaths.size ? result : new Set<string>();
}

function normalizePrimeAriaLabel(value: string) {
  if (primeAriaEnglishToRussian.has(value)) return value;
  const staticEnglish = primeAriaRussianToEnglish.get(value);
  if (staticEnglish) return staticEnglish;
  const dynamicPairs: Array<[RegExp, (match: RegExpExecArray) => string]> = [
    [/^Please enter one time password character ([1-9]\d*)$/, (match) => match[0]],
    [/^Введите символ ([1-9]\d*) одноразового пароля$/, (match) => (
      `Please enter one time password character ${match[1]}`
    )],
    [/^Page ([1-9]\d*)$/, (match) => match[0]],
    [/^Страница ([1-9]\d*)$/, (match) => `Page ${match[1]}`],
    [/^[1-9]\d*$/, (match) => match[0]],
    [/^Слайд ([1-9]\d*)$/, (match) => match[1] as string],
    [/^([2-9]|[1-9]\d+) stars$/, (match) => match[0]],
    [/^Звёзд: ([2-9]|[1-9]\d+)$/, (match) => `${match[1]} stars`],
  ];
  for (const [pattern, normalize] of dynamicPairs) {
    const match = pattern.exec(value);
    if (match) return normalize(match);
  }
  return null;
}

function hasPrimeComponentSignature(node: Record<string, unknown>) {
  const attributes = attributeMap(node);
  return [...attributes.keys()].some((name) => name.startsWith("data-pc-"))
    || /(?:^|\s)p-[a-z0-9-]+(?:\s|$)/i.test(attributes.get("class") ?? "");
}

function canonicalDomHref(url: Record<string, unknown>) {
  if (
    url.origin !== "<app-origin>"
    || typeof url.pathname !== "string"
    || !Array.isArray(url.query)
  ) {
    return null;
  }
  const query = url.query.map((entry) => {
    if (!isRecord(entry) || typeof entry.key !== "string") return null;
    return `${encodeURIComponent(entry.key)}=<value>`;
  });
  if (query.some((entry) => entry === null)) return null;
  return `${url.pathname}${query.length ? `?${query.join("&")}` : ""}#<fragment>`;
}

function collectDomElements(root: unknown) {
  const result: DomEntry[] = [];
  function visit(
    node: unknown,
    parent: Record<string, unknown> | null,
    path: string,
  ) {
    if (!isDomElement(node)) return;
    result.push({ node, parent, path });
    const children = Array.isArray(node.children) ? node.children : [];
    const elements = children.filter(isDomElement);
    for (const child of elements) {
      const sameTag = elements.filter((candidate) => candidate.tag === child.tag);
      const position = sameTag.length > 1
        ? `:nth-of-type(${sameTag.indexOf(child) + 1})`
        : "";
      visit(child, node, `${path} > ${child.tag}${position}`);
    }
  }
  if (isDomElement(root)) visit(root, null, root.tag as string);
  return result;
}

function isDomElement(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.type === "element" && typeof value.tag === "string";
}

function removeChild(parent: Record<string, unknown> | null, child: unknown) {
  if (!parent || !Array.isArray(parent.children)) return;
  parent.children = parent.children.filter((candidate) => candidate !== child);
}

function attributeMap(node: Record<string, unknown> | null) {
  const result = new Map<string, string>();
  if (!node || !Array.isArray(node.attributes)) return result;
  for (const attribute of node.attributes) {
    if (
      isRecord(attribute)
      && typeof attribute.name === "string"
      && typeof attribute.value === "string"
    ) {
      result.set(attribute.name, attribute.value);
    }
  }
  return result;
}

function getAttribute(node: Record<string, unknown> | null, name: string) {
  return attributeMap(node).get(name) ?? null;
}

function setAttribute(node: Record<string, unknown>, name: string, value: string) {
  if (!Array.isArray(node.attributes)) return;
  const attribute = node.attributes.find(
    (candidate) => isRecord(candidate) && candidate.name === name,
  );
  if (isRecord(attribute)) attribute.value = value;
}

function hasExactAttributes(
  node: Record<string, unknown>,
  expected: Record<string, string>,
) {
  const actual = attributeMap(node);
  return actual.size === Object.keys(expected).length
    && Object.entries(expected).every(([name, value]) => actual.get(name) === value);
}

function hasExactStringRecord(
  actual: Record<string, unknown>,
  expected: Record<string, string>,
) {
  const keys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index])
    && expectedKeys.every((key) => actual[key] === expected[key]);
}

function incrementCount(counts: Map<string, number>, value: string) {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function hasExactText(node: Record<string, unknown>, expected: string) {
  return exactText(node) === expected;
}

function exactText(node: Record<string, unknown>) {
  if (!Array.isArray(node.children) || node.children.length !== 1) return null;
  const child = node.children[0];
  return isRecord(child) && child.type === "text" && typeof child.value === "string"
    ? child.value
    : null;
}

function hasDescendantClass(node: Record<string, unknown>, expected: string): boolean {
  if (!Array.isArray(node.children)) return false;
  return node.children.some((child) => isRecord(child) && (
    getAttribute(child, "class") === expected || hasDescendantClass(child, expected)
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
