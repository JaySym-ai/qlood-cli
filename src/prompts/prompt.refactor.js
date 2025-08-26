export function buildRefactorPrompt() {
  return `You are a senior software engineer.

Goal: Analyze the repository and identify files that are relatively large or complex and would benefit from being refactored into smaller, more focused parts. Only produce a concise refactoring plan.

Scope and rules:
- Consider source files only (e.g., .js, .jsx, .ts, .tsx, .vue, .svelte, .py, .rb, .go, .rs, .java, .cs, .php, etc.).
- Ignore third-party, build, cache, and generated directories (e.g., node_modules, .git, .qlood, .augment, dist, build, .next, .nuxt, coverage, .cache).
- Use best-effort heuristics (lines of code, function length, number of responsibilities) to flag candidates.
- Do NOT include any narration of steps, tool calls, or thinking process. Output only the result.

Output format (Markdown only, no extra commentary):
# Refactor Plan

For each candidate file (limit to ~20):
- File: <relative/path>
- Size: ~<lines of code> LOC (approx)
- Symptoms: <short bullet list of why it’s too large/complex>
- Proposed refactor: <bullet list of concrete splits into modules/components/functions, with tentative names>
- Estimated effort: S/M/L

At the end include a short prioritized list:
## Priority Order
1. <relative/path> — reason
2. ...

Do not include any additional sections besides the plan. Only output the plan in Markdown.`;
}

