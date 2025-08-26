// Workflow prompt composer
// Builds a prompt for Auggie to analyze the project and produce a Playwright-oriented test plan

import fs from 'fs';
import path from 'path';
import { getProjectDir } from '../project.js';

function getProjectContext(cwd = process.cwd()) {
  const projectDir = getProjectDir(cwd);
  const contextPath = path.join(projectDir, 'notes', 'context.md');
  const structurePath = path.join(projectDir, 'project-structure.json');
  const configPath = path.join(projectDir, 'qlood.json');
  
  let context = '';
  let structure = '';
  let config = '';
  
  try {
    if (fs.existsSync(contextPath)) {
      context = fs.readFileSync(contextPath, 'utf-8');
    }
  } catch (e) {
    // ignore
  }
  
  try {
    if (fs.existsSync(structurePath)) {
      structure = fs.readFileSync(structurePath, 'utf-8');
    }
  } catch (e) {
    // ignore
  }
  
  try {
    if (fs.existsSync(configPath)) {
      config = fs.readFileSync(configPath, 'utf-8');
    }
  } catch (e) {
    // ignore
  }
  
  return { context, structure, config };
}

export function buildWorkflowPrompt(description = '', cwd = process.cwd()) {
  const trimmed = String(description || '').trim();
  const goal = trimmed || 'End-to-end scenario';
  
  const { context, structure, config } = getProjectContext(cwd);

  return `You are generating a detailed, step-by-step Playwright-oriented end-to-end testing workflow for this specific repository.

IMPORTANT: You must analyze the actual codebase files to create specific, actionable steps with exact selectors, routes, and UI elements.

Scenario to Test:
"""
${goal}
"""

Project Context (use this to understand the application):
${context ? `
=== Project Overview ===
${context}
` : ''}
${structure ? `
=== Project Structure ===
${structure}
` : ''}
${config ? `
=== Configuration ===
${config}
` : ''}

CRITICAL REQUIREMENTS:
1. **Analyze the actual codebase**: Look at components, routes, forms, authentication flows, and API endpoints
2. **Identify specific UI elements**: Find actual button text, form field names, links, and their selectors
3. **Map out the user journey**: Based on the code structure, determine the exact pages and navigation flow
4. **Use precise selectors**: Reference actual data-testid attributes, form names, button text, or role/name combinations
5. **Include authentication details**: If auth is involved, specify the login process, form fields, and success indicators
6. **Add network assertions**: Check for API calls, form submissions, and data loading states
7. **Specify test data**: Define what data needs to be created/used for the test scenario
8. **Include error scenarios**: Consider what could go wrong and how to handle it

Output a comprehensive workflow that includes:

# [Descriptive Test Title]

## Context
- Brief description of what this test validates
- Prerequisites (user accounts, test data, environment setup)
- Expected test duration

## Setup
1. Navigate to [specific URL based on project config]
2. Set initial state (clear cookies, set viewport, etc.)
3. Prepare any test data needed

## Test Steps
[Provide 10-20+ detailed steps with:]
- Exact action to perform
- Specific selector to use (preferably data-testid or role-based)
- Expected result after each action
- Network requests to verify
- UI state changes to assert

## Assertions
- List all the verification points throughout the test
- Include both UI and data validations
- Specify success criteria for each step

## Cleanup
- Steps to reset application state
- Data cleanup if needed
- Session cleanup

## Edge Cases to Consider
- Error scenarios and how to handle them
- Alternative paths through the application

Format as Markdown only. Be extremely specific and actionable.`;
}

export default buildWorkflowPrompt;

