import { describe, expect, it } from "vitest";
import { explainShellCommand } from "./extract.js";
import { parseBashForCommandExplanation } from "./tree-sitter-runtime.js";

describe("command explainer tree-sitter runtime", () => {
  it("loads tree-sitter bash and parses a simple command", async () => {
    const tree = await parseBashForCommandExplanation("ls | grep stuff");

    expect(tree.rootNode.type).toBe("program");
    expect(tree.rootNode.toString()).toContain("pipeline");
  });

  it("explains a pipeline with python inline eval", async () => {
    const explanation = await explainShellCommand('ls | grep "stuff" | python -c \'print("hi")\'');

    expect(explanation.ok).toBe(true);
    expect(explanation.shapes).toContain("pipeline");
    expect(explanation.topLevelCommands.map((step) => step.executable)).toEqual([
      "ls",
      "grep",
      "python",
    ]);
    expect(explanation.topLevelCommands[2]?.argv).toEqual(["python", "-c", 'print("hi")']);
    expect(explanation.nestedCommands).toEqual([]);
    expect(explanation.topLevelCommands[2]?.span).toEqual(
      expect.objectContaining({ startIndex: expect.any(Number), endIndex: expect.any(Number) }),
    );
    expect(explanation.risks).toContainEqual(
      expect.objectContaining({
        kind: "inline-eval",
        command: "python",
        flag: "-c",
        text: "python -c 'print(\"hi\")'",
      }),
    );
  });

  it("separates command substitution in an argument", async () => {
    const explanation = await explainShellCommand("echo $(whoami)");

    expect(explanation.topLevelCommands.map((step) => step.executable)).toEqual(["echo"]);
    expect(explanation.nestedCommands).toEqual([
      expect.objectContaining({ context: "command-substitution", executable: "whoami" }),
    ]);
    expect(explanation.risks).toContainEqual(
      expect.objectContaining({ kind: "command-substitution", text: "$(whoami)" }),
    );
  });

  it("marks command substitution in executable position as dynamic", async () => {
    const explanation = await explainShellCommand("$(whoami) --help");

    expect(explanation.topLevelCommands).toEqual([]);
    expect(explanation.nestedCommands).toEqual([
      expect.objectContaining({ context: "command-substitution", executable: "whoami" }),
    ]);
    expect(explanation.risks).toContainEqual(
      expect.objectContaining({ kind: "dynamic-executable", text: "$(whoami)" }),
    );
  });

  it("separates process substitution commands", async () => {
    const explanation = await explainShellCommand("diff <(ls a) <(ls b)");

    expect(explanation.topLevelCommands.map((step) => step.executable)).toEqual(["diff"]);
    expect(explanation.nestedCommands.map((step) => `${step.context}:${step.executable}`)).toEqual([
      "process-substitution:ls",
      "process-substitution:ls",
    ]);
    expect(explanation.risks.map((risk) => risk.kind)).toContain("process-substitution");
  });

  it("detects AND OR and sequence shapes", async () => {
    const explanation = await explainShellCommand("pnpm test && pnpm build || echo failed; pwd");

    expect(explanation.shapes).toEqual(expect.arrayContaining(["and", "or", "sequence"]));
    expect(explanation.topLevelCommands.map((step) => step.executable)).toEqual([
      "pnpm",
      "pnpm",
      "echo",
      "pwd",
    ]);
  });

  it("detects conditionals", async () => {
    const explanation = await explainShellCommand(
      "if test -f package.json; then pnpm test; else echo missing; fi",
    );

    expect(explanation.shapes).toContain("if");
    expect(explanation.topLevelCommands.map((step) => step.executable)).toEqual([
      "test",
      "pnpm",
      "echo",
    ]);
  });

  it("detects shell wrappers", async () => {
    const explanation = await explainShellCommand('bash -lc "echo hi | wc -c"');

    expect(explanation.topLevelCommands.map((step) => step.executable)).toEqual(["bash"]);
    expect(explanation.risks).toContainEqual(
      expect.objectContaining({
        kind: "shell-wrapper",
        executable: "bash",
        flag: "-lc",
        payload: "echo hi | wc -c",
        text: 'bash -lc "echo hi | wc -c"',
      }),
    );

    const combinedFlags = await explainShellCommand('bash -euxc "echo hi"');
    expect(combinedFlags.risks).toContainEqual(
      expect.objectContaining({
        kind: "shell-wrapper",
        executable: "bash",
        flag: "-euxc",
        payload: "echo hi",
      }),
    );
  });

  it("detects command carriers", async () => {
    const find = await explainShellCommand('find . -name "*.ts" -exec grep -n TODO {} +');
    expect(find.risks).toContainEqual(
      expect.objectContaining({ kind: "command-carrier", command: "find", flag: "-exec" }),
    );

    const xargs = await explainShellCommand('printf "%s\\n" a b | xargs -I{} sh -c "echo {}"');
    expect(xargs.risks).toContainEqual(
      expect.objectContaining({ kind: "command-carrier", command: "xargs" }),
    );
  });

  it("detects eval and sudo shell wrappers", async () => {
    const evalCommand = await explainShellCommand('eval "$OPENCLAW_CMD"');
    expect(evalCommand.risks).toContainEqual(expect.objectContaining({ kind: "eval" }));

    const sudoShell = await explainShellCommand('sudo sh -c "id && whoami"');
    expect(sudoShell.risks).toContainEqual(
      expect.objectContaining({ kind: "shell-wrapper-through-carrier", command: "sudo" }),
    );

    const sudoCombinedFlags = await explainShellCommand('sudo bash -euxc "id && whoami"');
    expect(sudoCombinedFlags.risks).toContainEqual(
      expect.objectContaining({ kind: "shell-wrapper-through-carrier", command: "sudo" }),
    );
  });

  it("does not treat literal operator text as command shapes", async () => {
    const quotedSemicolon = await explainShellCommand('echo ";"');
    expect(quotedSemicolon.shapes).not.toContain("sequence");

    const heredoc = await explainShellCommand("cat <<EOF\n;\nEOF");
    expect(heredoc.shapes).not.toContain("sequence");
  });

  it("marks redirects heredocs and here-strings as risks", async () => {
    const redirect = await explainShellCommand("echo hi > out.txt");
    const redirectRisks = redirect.risks.filter((risk) => risk.kind === "redirect");
    expect(redirectRisks).toEqual([expect.objectContaining({ text: "> out.txt" })]);

    const heredoc = await explainShellCommand("cat <<EOF\nhello\nEOF");
    expect(heredoc.risks).toContainEqual(expect.objectContaining({ kind: "heredoc" }));

    const hereString = await explainShellCommand('cat <<< "hello"');
    expect(hereString.risks).toContainEqual(expect.objectContaining({ kind: "here-string" }));
  });

  it("reports syntax errors with source spans", async () => {
    const explanation = await explainShellCommand("echo 'unterminated");

    expect(explanation.ok).toBe(false);
    expect(explanation.risks).toContainEqual(
      expect.objectContaining({
        kind: "syntax-error",
        span: expect.objectContaining({
          startIndex: expect.any(Number),
          endIndex: expect.any(Number),
        }),
      }),
    );
  });

  it("parses and extracts a small approval-sized corpus quickly", async () => {
    const corpus = [
      'ls | grep "stuff" | python -c \'print("hi")\'',
      "echo $(whoami)",
      "diff <(ls a) <(ls b)",
      'find . -name "*.ts" -exec grep -n TODO {} +',
      'bash -lc "echo hi | wc -c"',
    ];
    const iterations = 100;
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      for (const command of corpus) {
        await explainShellCommand(command);
      }
    }
    const elapsedMs = performance.now() - start;
    expect(elapsedMs / (iterations * corpus.length)).toBeLessThan(5);
  });
});
