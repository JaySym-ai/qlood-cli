// Builds a prompt to condense raw project context into a testing-focused summary
// Focus on: stack, pages/routes, utilities/helpers, how to start the project, and test-relevant details

export function buildTestingContextSummaryPrompt({ rawContext = '', structure = '', config = '' } = {}) {
  // Limit sizes to avoid E2BIG when passing prompt as CLI arg
  const MAX_SUM_CONTEXT = Number(process.env.QLOOD_MAX_SUM_CONTEXT || 12000);
  const MAX_SUM_STRUCTURE = Number(process.env.QLOOD_MAX_SUM_STRUCTURE || 12000);
  const MAX_SUM_CONFIG = Number(process.env.QLOOD_MAX_SUM_CONFIG || 6000);

  function trunc(s, n) {
    const str = String(s || '').trim();
    if (str.length <= n) return str;
    return str.slice(0, n) + `\n\n...[truncated ${str.length - n} chars]`;
  }

  const rc = trunc(rawContext, MAX_SUM_CONTEXT);
  const ps = trunc(structure, MAX_SUM_STRUCTURE);
  const cfg = trunc(config, MAX_SUM_CONFIG);

  return `You are a testing-focused assistant. Rewrite the provided project context into a concise, actionable summary specifically for end-to-end testing.

INPUT A: Original context (may include verbose analysis)
"""
${rc}
"""

${ps ? `INPUT B: Project structure (JSON)
"""
${ps}
"""
` : ''}${cfg ? `INPUT C: Qlood test config (JSON)
"""
${cfg}
"""
` : ''}

STRICT GOALS:
- Remove any thinking steps, narration, or meta commentary (e.g., "I'll scan", "Here are results").
- Keep it short and dense; prioritize what testers need to know.
- Do NOT invent details — derive from inputs.

Output format (Markdown only, no preambles or explanations outside the sections below):

# Testing Context Summary

## Tech Stack
- Framework(s) and runtime
- Key libraries (routing, state, auth, forms, UI)

## How to Run Locally
- Install command(s)
- Start command(s)
- Dev URL and default port
- Any required env vars or setup

## Pages/Routes Overview
- Bullet list of key routes/pages (derive from structure and context)
- Note auth-protected areas if evident

## Test-Relevant Utilities
- Reusable helpers (API clients, fixtures, factories, seeds)
- Data-testids or selector patterns if mentioned
- Auth flows/components

## Existing Tests/Configs
- Testing frameworks detected (Playwright/Cypress/Jest)
- Config and folder locations if present

## Notes for E2E Scenarios
- Typical user flows (1–3 bullets)
- Known constraints or setup quirks

Only output the sections above. No chain-of-thought, no tool logs, no meta commentary.`;
}

export default buildTestingContextSummaryPrompt;

