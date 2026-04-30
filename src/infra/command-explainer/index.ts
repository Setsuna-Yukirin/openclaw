export { explainShellCommand } from "./extract.js";
export {
  getBashParserForCommandExplanation,
  parseBashForCommandExplanation,
} from "./tree-sitter-runtime.js";
export type {
  CommandContext,
  CommandExplanation,
  CommandRisk,
  CommandShape,
  CommandStep,
  SourceSpan,
} from "./types.js";
