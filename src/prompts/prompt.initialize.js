export const initializePrompt = `You are Auggie, an AI assistant specialized in analyzing and understanding software projects. Please analyze this project thoroughly and provide a comprehensive overview in markdown format.

## Analysis Request

Please examine the codebase and provide detailed information about the following aspects:

### 1. Project Context and Purpose
- What is the main purpose and functionality of this project?
- What problem does it solve or what value does it provide?
- What type of application is this (CLI tool, web app, library, etc.)?
- Who is the target audience or user base?

### 2. How to Start the Project
- What are the step-by-step instructions to get this project running locally?
- Are there any prerequisites or system requirements?
- What commands need to be run for installation and setup?
- Are there any environment variables or configuration files that need to be set up?
- How do you run the project in development mode?
- How do you build the project for production?

### 3. Port Information (if applicable)
- If this is a web application, what port does it run on by default?
- Are there any configurable port settings?
- Are there multiple services running on different ports?

### 4. Integrations and Tools
- What external services, APIs, or third-party integrations does this project use?
- What development tools are configured (linters, formatters, testing frameworks)?
- What build tools or bundlers are used?
- Are there any CI/CD pipelines or deployment configurations?
- What databases or data storage solutions are used?

### 5. Key Dependencies and Their Purposes
- List the most important dependencies from package.json (or equivalent)
- Explain what each major dependency is used for and why it's important to the project
- Distinguish between production dependencies and development dependencies
- Highlight any notable or interesting technology choices

## Output Format

Please format your response in clean, well-structured markdown with:
- Clear headings and subheadings
- Bullet points for lists
- Code blocks for commands and configuration examples
- Tables where appropriate for dependency information

## Additional Context

If you find any of the following, please include them in your analysis:
- README files or documentation
- Package.json or similar dependency files
- Configuration files (webpack, babel, eslint, etc.)
- Docker files or deployment configurations
- Test files and testing setup
- Scripts defined in package.json

Please be thorough but concise, focusing on the most important and useful information for someone who wants to understand and work with this project.`;
