import { startBackground } from "../../extension/src/background/runtime";
import { createDiagnosticHandler } from "./handlers";
startBackground(createDiagnosticHandler());
