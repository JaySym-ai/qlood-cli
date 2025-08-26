// Workflow prompt composer
// Builds a prompt for Auggie to analyze the project and produce a Playwright-oriented test plan

export function buildWorkflowPrompt(description = '') {
  const trimmed = String(description || '').trim();
  const goal = trimmed || 'End-to-end scenario';

  return `You are generating a Playwright-oriented end-to-end testing workflow for this repository.

Analyze the local project (code, routes, pages, API, auth) and produce a concise, actionable, step-by-step guide for how Playwright should act to perform the desired test.

Scenario:
"""
${goal}
"""

Requirements:
- Base your plan on THIS project: infer base URL, key routes, forms, auth, and data flows from the codebase and any ./.qlood context.
- Prefer stable selectors (data-testid, role/name) and resilient strategies over brittle CSS.
- Include clear preconditions, setup, and test data assumptions.
- Provide numbered steps that a human or a test runner can follow directly.
- At each important step, specify what to assert (UI state, text, navigation, network status, storage state).
- Include cleanup/teardown if the flow creates data or sessions.
- Avoid environment-specific paths unless they are clearly part of this project.
- Keep it Markdown only. No tool-call logs. No extraneous commentary.

Format:
- H1 title summarizing the test.
- Optional short context section (what this test covers, prerequisites).
- A "Steps" section with numbered actions and expected assertions.
- An "Acceptance Criteria" section summarizing success conditions.

Output strictly as Markdown.`;
}

export default buildWorkflowPrompt;

