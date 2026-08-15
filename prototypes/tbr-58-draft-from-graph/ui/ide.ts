// PROTOTYPE — THROWAWAY. TBR-58.
// Opening a source path in the user's editor. OPEN SPEC DECISION (TBR-59): the scheme
// differs per IDE and the link needs an ABSOLUTE path, which only the companion knows
// (GraphStamp.checkoutPath). A real implementation needs this as a per-user setting.

// `abs` always begins with "/", so the scheme takes no trailing slash of its own —
// `vscode://file/` + `/Users/…` yields a broken `vscode://file//Users/…`.
export const IDE_SCHEMES = {
  vscode: (abs: string, line: string) => `vscode://file${abs}:${line}`,
  cursor: (abs: string, line: string) => `cursor://file${abs}:${line}`,
  zed: (abs: string, line: string) => `zed://file${abs}:${line}`,
  // JetBrains needs its built-in web server (port 63342) rather than a URL scheme.
  jetbrains: (abs: string, line: string) => `http://localhost:63342/api/file${abs}:${line}`,
} as const

export type IdeId = keyof typeof IDE_SCHEMES

/**
 * `sourceFile` is repo-relative (the companion resolves graphify's own root for us),
 * so the absolute path is simply checkout + sourceFile.
 */
export function ideHref(
  ide: IdeId,
  checkoutPath: string,
  sourceFile: string,
  sourceLocation: string
) {
  const line = sourceLocation.replace(/^L/, "") || "1"
  return IDE_SCHEMES[ide](`${checkoutPath}/${sourceFile}`, line)
}
