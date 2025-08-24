// Prompt templates registry
// Usage: getPrompt('default' | 'tool-call' | 'context' | 'testing')

import defaultPrompt from './prompt.default.js';
import toolCallPrompt from './prompt.tool-call.js';
import contextPrompt from './prompt.context.js';
import testingPrompt from './prompt.testing.js';

const registry = {
  default: defaultPrompt,
  'tool-call': toolCallPrompt,
  context: contextPrompt,
  testing: testingPrompt,
};

export function getPrompt(useCase = 'default') {
  const key = String(useCase).toLowerCase();
  return registry[key] || registry.default;
}

export function listPrompts() {
  return Object.keys(registry);
}

// Compose a concise, de-duplicated guidelines block combining all prompts
export function composeGuidelines() {
  const parts = [defaultPrompt, contextPrompt, toolCallPrompt, testingPrompt]
    .map(s => String(s || ''));
  const seen = new Set();
  const lines = [];
  for (const s of parts) {
    for (const raw of s.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines.join('\n');
}

