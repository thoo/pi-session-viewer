export interface ThemeExportColors {
  pageBg?: string;
  cardBg?: string;
  infoBg?: string;
}

export type ThemeColorValue = string | number | undefined;

const THEME_OVERRIDE_MARKER = "pi-session-viewer-theme-override";

export function resolveThemeColorValue(
  value: ThemeColorValue,
  vars: Record<string, ThemeColorValue>,
  seen = new Set<string>(),
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return ansi256ToHex(value);
  }

  const trimmed = value.trim();
  if (
    trimmed === "" ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("rgb(") ||
    trimmed.startsWith("rgba(") ||
    trimmed.startsWith("hsl(") ||
    trimmed.startsWith("hsla(")
  ) {
    return trimmed;
  }

  const key = trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;
  if (!(key in vars)) {
    return trimmed;
  }

  if (seen.has(key)) {
    throw new Error(`Circular theme variable reference: ${key}`);
  }

  seen.add(key);
  const resolved = resolveThemeColorValue(vars[key], vars, seen);
  seen.delete(key);
  return resolved;
}

export function ansi256ToHex(index: number): string {
  const basicColors = [
    "#000000",
    "#800000",
    "#008000",
    "#808000",
    "#000080",
    "#800080",
    "#008080",
    "#c0c0c0",
    "#808080",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#0000ff",
    "#ff00ff",
    "#00ffff",
    "#ffffff",
  ];

  if (index < 16) {
    return basicColors[index] ?? "#000000";
  }

  if (index < 232) {
    const cubeIndex = index - 16;
    const r = Math.floor(cubeIndex / 36);
    const g = Math.floor((cubeIndex % 36) / 6);
    const b = cubeIndex % 6;
    const toHex = (n: number) =>
      (n === 0 ? 0 : 55 + n * 40).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  const gray = 8 + (index - 232) * 10;
  const grayHex = gray.toString(16).padStart(2, "0");
  return `#${grayHex}${grayHex}${grayHex}`;
}

export function sanitizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

export function patchExportHtml(
  html: string,
  colors: ThemeExportColors,
): string {
  const declarations: string[] = [];

  if (colors.pageBg) {
    declarations.push(`--exportPageBg: ${colors.pageBg};`);
    declarations.push(`--body-bg: ${colors.pageBg};`);
  }
  if (colors.cardBg) {
    declarations.push(`--exportCardBg: ${colors.cardBg};`);
    declarations.push(`--container-bg: ${colors.cardBg};`);
  }
  if (colors.infoBg) {
    declarations.push(`--exportInfoBg: ${colors.infoBg};`);
    declarations.push(`--info-bg: ${colors.infoBg};`);
  }

  if (declarations.length === 0) {
    return html;
  }

  const overrideBlock = [
    `<!-- ${THEME_OVERRIDE_MARKER}:start -->`,
    `<style id="${THEME_OVERRIDE_MARKER}">`,
    ":root {",
    ...declarations.map((line) => `  ${line}`),
    "}",
    "</style>",
    `<!-- ${THEME_OVERRIDE_MARKER}:end -->`,
  ].join("\n");

  const existingBlock = new RegExp(
    `<!-- ${THEME_OVERRIDE_MARKER}:start -->[\\s\\S]*?<!-- ${THEME_OVERRIDE_MARKER}:end -->`,
  );

  if (html.includes(`<!-- ${THEME_OVERRIDE_MARKER}:start -->`)) {
    return html.replace(existingBlock, overrideBlock);
  }

  if (html.includes("</head>")) {
    return html.replace("</head>", `${overrideBlock}\n</head>`);
  }

  return `${overrideBlock}\n${html}`;
}
