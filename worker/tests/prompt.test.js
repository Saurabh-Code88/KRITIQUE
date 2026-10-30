const { buildReviewPrompt } = require("../src/prompt");

describe("buildReviewPrompt", () => {
  const sampleCode = `function add(a, b) { return a + b; }`;

  test("includes the language in the prompt", () => {
    const { user } = buildReviewPrompt(sampleCode, "javascript");
    expect(user).toContain("javascript");
  });

  test("includes the code verbatim", () => {
    const { user } = buildReviewPrompt(sampleCode, "javascript");
    expect(user).toContain(sampleCode);
  });

  test("includes all required review sections", () => {
    const { system } = buildReviewPrompt(sampleCode, "python");
    expect(system).toContain("Summary");
    expect(system).toContain("Strengths");
    expect(system).toContain("Issues Found");
    expect(system).toContain("Performance");
    expect(system).toContain("Security");
    expect(system).toContain("Score");
  });

  test("includes severity levels", () => {
    const { system } = buildReviewPrompt(sampleCode, "python");
    expect(system).toContain("Critical");
    expect(system).toContain("Major");
    expect(system).toContain("Minor");
  });

  test("wraps code in a code block", () => {
    const { user } = buildReviewPrompt(sampleCode, "go");
    expect(user).toContain("```go");
    expect(user).toContain("```");
  });

  test("handles multi-line code", () => {
    const multiLine = `function foo() {\n  const x = 1;\n  return x;\n}`;
    const { user } = buildReviewPrompt(multiLine, "javascript");
    expect(user).toContain(multiLine);
  });

  test("handles different languages without error", () => {
    const langs = ["typescript", "python", "go", "rust", "java", "cpp"];
    langs.forEach((lang) => {
      expect(buildReviewPrompt(sampleCode, lang)).toEqual({
        system: expect.any(String),
        user: expect.any(String),
      });
    });
  });
});
