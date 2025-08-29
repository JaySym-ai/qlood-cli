export function buildDuplicateFinderPrompt() {
  return `You are a senior software engineer and code quality analyst.

Goal: Analyze the entire repository to identify:
- Duplicate or near-duplicate functions that perform the same task (across files/languages).
- Duplicate or near-duplicate pages/routes/views (framework pages or templates that replicate functionality).
- Unreferenced (dead) code: functions, files, or pages that are never imported, exported, routed to, or otherwise used.

Scope and rules:
- Focus on source files only (e.g., .js, .jsx, .ts, .tsx, .vue, .svelte, .py, .rb, .go, .rs, .java, .cs, .php, .html, .css, .scss, .json config if relevant to routes).
- Ignore third-party, build, cache, and generated directories: node_modules, .git, .qlood, .augment, dist, build, .next, .nuxt, coverage, .cache, out, tmp, .turbo, .vercel, vendor.
- Use best-effort static analysis and filename/AST heuristics to infer duplicates and references. Be conservative with dead-code claims; include brief evidence.
- Prefer grouping results by high-confidence similarity first.
- Do NOT include narration or tool call logs. Output only the report.

Output format (Markdown only):
# Duplicate & Dead Code Report

## Summary
- Duplicated functions: <count>
- Duplicated pages/routes: <count>
- Likely unreferenced files/functions: <count>
- Short notes on methodology/limits (1–2 bullets)

## Duplicate Functions
For each detected group (limit ~20 groups):
- Group: <short description>
- Signatures/locations:
  - <relative/path>:<line or symbol> — <function name or export>
  - ...
- Evidence: <1–2 bullets on similarity (name, tokens, structure)>
- Recommendation: <dedupe strategy or canonicalization>

## Duplicate Pages/Routes
For each suspected duplicate page or route (limit ~15):
- Pages:
  - <relative/path>
  - <relative/path>
- Evidence: <URL path similarity, identical components/templates, near-identical content>
- Recommendation: <merge, redirect, or delete>

## Likely Unreferenced Code
List files/functions with no inbound references (limit ~30):
- <relative/path> — <symbol (if applicable)> — evidence: <no imports/exports/route matches>

## Notes
- Outline any risky assumptions or items to manually verify.

Only output the Markdown report.`;
}

