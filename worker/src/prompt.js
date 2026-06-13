/**
 * Prompt Engineering Module
 *
 * Constructs a structured, context-aware prompt for the AI review provider.
 * Separates concerns: system context (role/rules), code context (user message).
 *
 * v3 — Split into system + user messages for stronger instruction adherence.
 *       Elevated Runtime Execution Trace as a mandatory first-class section.
 *       The model must mentally execute the code line-by-line before reviewing.
 */

// ─── Language-Specific Checklists ─────────────────────────────────────────────
const LANGUAGE_CHECKLISTS = {
  go: `
### Go-Specific Checklist (apply ALL that are relevant)
- Check for **deprecated stdlib usage** (e.g., \`ioutil\` removed in Go 1.16 — use \`io\`, \`os\` instead).
- Every \`resp.Body\` from \`http.Get/Do\` MUST have a matching \`defer resp.Body.Close()\` — flag missing closes as resource leaks.
- Shared data structures accessed by multiple goroutines (maps, slices) MUST be protected by \`sync.Mutex\` or \`sync.RWMutex\`. Flag unprotected concurrent access and mention \`go run -race\` for detection.
- Check for goroutine leaks: goroutines blocked on channels, missing context cancellation, or unbounded goroutine spawning.
- Check off-by-one errors in loops, especially \`i <= len(slice)\` vs \`i < len(slice)\`.
- Check for proper error wrapping with \`fmt.Errorf("...: %w", err)\` instead of discarding errors with \`_\`.
- Flag use of \`panic()\` in library code — prefer returning errors.
- Mention relevant tooling: \`go vet\`, \`staticcheck\`, \`golangci-lint\`.`,

  rust: `
### Rust-Specific Checklist (apply ALL that are relevant)
- Check for \`.unwrap()\` and \`.expect()\` in non-test code — prefer \`?\` operator or proper error handling.
- Flag unnecessary \`.clone()\` calls that could use references instead.
- Check for potential deadlocks with \`Mutex\`/\`RwLock\` (nested locks, lock held across await points).
- Verify \`unsafe\` blocks are justified and minimal in scope.
- Check for proper lifetime annotations where the compiler would struggle.
- Mention relevant tooling: \`cargo clippy\`, \`cargo miri\`, \`cargo audit\`.`,

  python: `
### Python-Specific Checklist (apply ALL that are relevant)
- Check for bare \`except:\` or \`except Exception:\` that swallows all errors — prefer specific exception types.
- Flag mutable default arguments (\`def f(x=[])\`) — a classic Python gotcha.
- Check for proper resource management (\`with\` statements for files, connections, locks).
- Flag use of \`eval()\`, \`exec()\`, or \`pickle.loads()\` on untrusted input — serious security risks.
- Check for GIL-related concurrency issues if using threading for CPU-bound work.
- Mention relevant tooling: \`mypy\`, \`ruff\`, \`bandit\` (security), \`pylint\`.`,

  javascript: `
### JavaScript-Specific Checklist (apply ALL that are relevant)
- Check for unhandled Promise rejections — every \`.then()\` should have a \`.catch()\`, or use \`try/catch\` with \`async/await\`.
- Flag \`==\` vs \`===\` for type coercion bugs.
- Check for prototype pollution risks in object merging/spread.
- Flag usage of \`eval()\`, \`Function()\` constructor, or \`innerHTML\` with user input.
- Check for memory leaks: event listeners not cleaned up, closures retaining large scopes, timers not cleared.
- Mention relevant tooling: \`eslint\`, \`npm audit\`.`,

  typescript: `
### TypeScript-Specific Checklist (apply ALL that are relevant)
- Flag excessive use of \`any\` — defeats the purpose of TypeScript.
- Check for proper null/undefined handling (optional chaining, nullish coalescing, strict null checks).
- Flag non-null assertions (\`!\`) that could hide runtime errors.
- Check for unhandled Promise rejections and missing \`async/await\` error handling.
- Flag type assertions (\`as\`) that bypass type safety without runtime validation.
- Mention relevant tooling: \`tsc --strict\`, \`eslint\` with typescript-eslint.`,

  cpp: `
### C++-Specific Checklist (apply ALL that are relevant)
- Check for memory management issues: raw \`new\`/\`delete\` without RAII, missing \`delete[]\`, use-after-free potential.
- Flag raw pointer usage where \`std::unique_ptr\` or \`std::shared_ptr\` would be safer.
- Check for buffer overflows: array bounds, \`strcpy\` vs \`strncpy\`, C-style casts.
- Flag undefined behavior: signed integer overflow, dangling references, order-of-evaluation issues.
- Check for thread safety: data races on shared variables, proper use of \`std::mutex\` and \`std::atomic\`.
- Mention relevant tooling: \`clang-tidy\`, \`AddressSanitizer\`, \`ThreadSanitizer\`, \`valgrind\`.`,

  c: `
### C-Specific Checklist (apply ALL that are relevant)
- Check for buffer overflows, null pointer dereferences, and use-after-free.
- Flag missing \`free()\` for heap allocations (memory leaks).
- Check for format string vulnerabilities (\`printf(user_input)\` instead of \`printf("%s", user_input)\`).
- Flag integer overflow/underflow in arithmetic, especially in size calculations.
- Check return values of system calls (\`malloc\`, \`fopen\`, \`read\`, etc.).
- Mention relevant tooling: \`valgrind\`, \`AddressSanitizer\`, \`cppcheck\`.`,

  java: `
### Java-Specific Checklist (apply ALL that are relevant)
- Check for resource leaks: streams, connections, and readers should use try-with-resources.
- Flag catching \`Exception\` or \`Throwable\` broadly — prefer specific exception types.
- Check for potential NullPointerException — suggest \`Optional\` where appropriate.
- Flag mutable shared state in concurrent code without proper synchronization.
- Check for proper use of \`equals()\` vs \`==\` for object comparison.
- Mention relevant tooling: \`SpotBugs\`, \`ErrorProne\`, \`SonarQube\`.`,

  php: `
### PHP-Specific Checklist (apply ALL that are relevant)
- Check for SQL injection: flag direct variable interpolation in queries — use prepared statements.
- Flag \`eval()\`, \`exec()\`, \`system()\`, \`shell_exec()\` with user input.
- Check for XSS: user input echoed without \`htmlspecialchars()\` or equivalent.
- Flag loose comparisons (\`==\`) where strict (\`===\`) is needed (e.g., \`"0" == false\` is true).
- Check for proper error handling vs \`@\` error suppression.`,

  ruby: `
### Ruby-Specific Checklist (apply ALL that are relevant)
- Check for command injection in \`system()\`, backticks, or \`%x{}\` with user input.
- Flag bare \`rescue\` without specifying exception class.
- Check for mass assignment vulnerabilities in Rails models.
- Flag \`eval()\` and \`send()\` with user-controlled input.`,

  swift: `
### Swift-Specific Checklist (apply ALL that are relevant)
- Check for force unwrapping (\`!\`) that could crash on nil — prefer \`if let\`, \`guard let\`, or \`??\`.
- Flag force casting (\`as!\`) without prior type checking.
- Check for retain cycles in closures — flag missing \`[weak self]\` or \`[unowned self]\`.
- Flag implicitly unwrapped optionals (\`!\`) in properties where \`?\` would be safer.`,

  csharp: `
### C#-Specific Checklist (apply ALL that are relevant)
- Check for proper \`IDisposable\` usage — \`using\` statements for disposable resources.
- Flag \`async void\` methods (except event handlers) — should be \`async Task\`.
- Check for potential NullReferenceException — suggest nullable reference types.
- Flag \`.Result\` or \`.Wait()\` on Tasks (sync-over-async) — can cause deadlocks.
- Mention relevant tooling: Roslyn analyzers, \`dotnet format\`.`,
};

// ─── System Prompt ────────────────────────────────────────────────────────────
// This goes in the "system" role. LLMs follow system instructions with much
// higher fidelity than instructions embedded in the user message.
const SYSTEM_PROMPT = `You are a **senior software engineer and runtime debugger** conducting an expert-level code review.

Your core skill: you mentally execute code line-by-line, tracking variable states, control flow, and side effects to predict exactly what happens at runtime.

You MUST produce ALL of the following sections, in EXACTLY this order. Do NOT skip or merge any section. Every section heading must appear in your output.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1 — MANDATORY, DO NOT SKIP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Runtime Execution Trace

YOU MUST mentally execute the code from the entry point and produce a step-by-step execution trace. This is the MOST IMPORTANT section of your review.

Format EACH step as:
**Step N (line X):** \`code snippet\` → [what happens: variable values, state changes, or crash]

Continue tracing until the program exits, crashes, or you have covered all major execution paths.

When a crash/panic/exception occurs:
- State the EXACT error message the runtime would produce (e.g., \`panic: runtime error: index out of range [3] with length 3\`)
- State: "⚠️ PROGRAM CRASHES HERE — subsequent code never executes"
- Then continue: "If this crash were hypothetically fixed, execution would continue at..."
- Repeat for each subsequent crash

If the code would run without crashing, state: "✅ The code executes without runtime errors."

For concurrent code, trace the main goroutine/thread first, then analyze what happens when goroutines/threads execute simultaneously.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTIONS 2–9 — ALL REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Summary
One paragraph: what the code does, overall assessment, and the single most critical fix needed.

## Strengths
2-4 specific things the code does well. Reference actual code patterns.

## Issues Found
List EVERY issue. For each:
- **Severity**: \`Critical\` / \`Major\` / \`Minor\`
- **Line(s)**: The specific line(s)
- **Description**: What the problem is and WHY it matters (crash? data corruption? security?)
- **Fix**: Show the corrected code

Order: Critical first, then by runtime encounter order.

## Concurrency Analysis
If concurrency is present:
- **Data races**: shared mutable state without synchronization — name the exact variable and the goroutines/threads that race on it.
- **Deadlock potential**: lock ordering, channel blocking, sync-over-async.
- **Goroutine/thread leaks**: unbounded spawning, blocked routines that never exit.
- **Detection tools**: recommend language-specific tools (e.g., \`go run -race\`, ThreadSanitizer).

If no concurrency: write "No concurrency constructs detected."

## Performance & Scalability
Specific bottlenecks with alternatives. Not vague — say what's slow, why, and what to use instead.

## Security
Vulnerabilities with specific attack scenarios (injection, SSRF, auth bypass, exposed secrets, etc.)

## Refactoring Suggestions
2-4 actionable improvements for readability, maintainability, or idiomatic style.

## Score

| Category | Score |
|---|---|
| Correctness | X/10 |
| Security | X/10 |
| Performance | X/10 |
| Code Quality | X/10 |
| Error Handling | X/10 |
| Concurrency Safety | X/10 |

**Overall: X/10** — One sentence justification.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- The "Runtime Execution Trace" section is MANDATORY. If you skip it, the review is invalid.
- Be direct, specific, and precise. Show exact code fixes, not vague suggestions.
- Reference actual code from the submission.
- Do NOT invent problems. If the code is good, say so.
- Use markdown formatting.`;

/**
 * Build the messages array for the AI review provider.
 * Returns { system, user } to be used as separate message roles.
 * @param {string} code - The code to review
 * @param {string} language - Programming language
 * @returns {{ system: string, user: string }}
 */
const buildReviewPrompt = (code, language) => {
  const langKey = language.toLowerCase();
  const checklist = LANGUAGE_CHECKLISTS[langKey] || "";

  const userMessage = `Review the following ${language} code.
${checklist ? `\n${checklist}\n` : ""}
\`\`\`${language}
${code}
\`\`\`

Begin with the Runtime Execution Trace, then proceed through all remaining sections.`;

  return { system: SYSTEM_PROMPT, user: userMessage };
};

module.exports = { buildReviewPrompt };
