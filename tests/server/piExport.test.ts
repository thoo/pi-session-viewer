import { describe, expect, it } from "vitest";
import {
  ansi256ToHex,
  patchExportHtml,
  resolveThemeColorValue,
} from "../../server/piExportCore";

describe("server/piExport", () => {
  it("converts ANSI palette values to hex", () => {
    expect(ansi256ToHex(1)).toBe("#800000");
    expect(ansi256ToHex(21)).toBe("#0000ff");
    expect(ansi256ToHex(232)).toBe("#080808");
  });

  it("resolves nested theme variables", () => {
    const vars = {
      surface: "$panel",
      panel: 21,
      accent: "#ff00ff",
    };

    expect(resolveThemeColorValue("$surface", vars)).toBe(
      "#0000ff",
    );
    expect(resolveThemeColorValue("accent", vars)).toBe("#ff00ff");
    expect(resolveThemeColorValue("rgba(0, 0, 0, 0.5)", vars)).toBe(
      "rgba(0, 0, 0, 0.5)",
    );
  });

  it("patches exported HTML with theme overrides", () => {
    const html = "<html><head></head><body>Hello</body></html>";
    const patched = patchExportHtml(html, {
      pageBg: "#111111",
      cardBg: "#222222",
      infoBg: "#333333",
    });

    expect(patched).toContain("--exportPageBg: #111111;");
    expect(patched).toContain("--container-bg: #222222;");
    expect(patched).toContain("--info-bg: #333333;");
    expect(patched).toContain("<!-- pi-session-viewer-theme-override:end -->");
    expect(patched).toContain("</head><body>Hello</body></html>");
  });

  it("replaces an existing theme override block", () => {
    const html = [
      "<html><head>",
      "<!-- pi-session-viewer-theme-override:start -->",
      '<style id="pi-session-viewer-theme-override">old</style>',
      "<!-- pi-session-viewer-theme-override:end -->",
      "</head><body>Hello</body></html>",
    ].join("\n");

    const patched = patchExportHtml(html, { pageBg: "#abcdef" });

    expect(
      patched.match(/pi-session-viewer-theme-override:start/g),
    ).toHaveLength(1);
    expect(patched).toContain("--exportPageBg: #abcdef;");
    expect(patched).not.toContain(">old</style>");
  });
});
