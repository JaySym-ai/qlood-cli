export function buildReviewPrompt(title, checklist) {
  return `You are a senior application security engineer. Perform a focused repository review for the category: ${title}.

Scope: Only use information available in the working directory; do not invent. Be concise and actionable.

Checklist to evaluate (mark each with [x] or [ ] and provide short evidence/paths):
${checklist}

Output format (Markdown):
# ${title} Review

## Summary
- Overall risk: low/medium/high and 1–3 bullets why

## Findings
- Bullet findings with concrete evidence (paths/snippets)

## Recommendations
- Bullet, ordered by priority, with specific steps

## Checklist
- Reprint the checklist with [x]/[ ] and 1-line notes each
`;
}

