import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as TreeSitter from "web-tree-sitter";

const require = createRequire(import.meta.url);

let parserPromise: Promise<TreeSitter.Parser> | null = null;

function resolvePackageFile(packageName: string, fileName: string): string {
  let directory = path.dirname(require.resolve(packageName));
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(directory, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return path.join(path.dirname(require.resolve(packageName)), fileName);
}

function resolveWebTreeSitterFile(fileName: string): string {
  return resolvePackageFile("web-tree-sitter", fileName);
}

function resolveBashWasmPath(): string {
  return resolvePackageFile("tree-sitter-bash", "tree-sitter-bash.wasm");
}

async function loadParser(): Promise<TreeSitter.Parser> {
  await TreeSitter.Parser.init({
    locateFile: resolveWebTreeSitterFile,
  });
  const language = await TreeSitter.Language.load(resolveBashWasmPath());
  const parser = new TreeSitter.Parser();
  parser.setLanguage(language);
  return parser;
}

export function getBashParserForCommandExplanation(): Promise<TreeSitter.Parser> {
  parserPromise ??= loadParser();
  return parserPromise;
}

export async function parseBashForCommandExplanation(source: string): Promise<TreeSitter.Tree> {
  const parser = await getBashParserForCommandExplanation();
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error("tree-sitter-bash returned no parse tree");
  }
  return tree;
}
