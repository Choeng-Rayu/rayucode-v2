/**
 * Browser- and Webview-safe entrypoint for `@rayu-dev/rayucode-sdk`.
 *
 * Exports only pure-TypeScript protocol definitions, error types, and Rayu
 * credits helpers with zero Node.js builtin imports (`node:net`, `node:fs`,
 * `node:child_process`, etc.) so Next.js client components and VS Code Webviews
 * can import it cleanly without Node polyfills.
 */

export * from "./protocol.js";
export * from "./rayuCredits.js";
export { HarnessError } from "./errors.js";
