export const simpleInitializePrompt = `You are Auggie, an AI assistant. Please analyze this project and provide a brief overview in markdown format.

## Analysis Request

Please examine the codebase and provide:

### 1. Project Summary
- What is this project? (1-2 sentences)
- What type of application is it?

### 2. Getting Started
- How to install dependencies
- How to run the project locally
- Default port (if applicable)

### 3. Key Technologies
- Main programming language/framework
- Important dependencies (top 3-5)

## Output Format

Please format your response in clean markdown with:
- Clear headings
- Bullet points for lists
- Code blocks for commands

Keep the analysis concise but informative, focusing on the essentials for getting started with the project.`;
