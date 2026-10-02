import { resolve } from "node:path";
import { runProductSuite } from "./browser/run-product";
import { runDiagnosticSuite } from "./browser/run-diagnostics";
if (!process.argv.includes("--diagnostic-only"))
  await runProductSuite(
    resolve(process.env.CULVERIN_EXTENSION_DIR ?? "extension/dist"),
  );
if (!process.argv.includes("--product-only"))
  await runDiagnosticSuite(resolve(".bun/test-extension"));
