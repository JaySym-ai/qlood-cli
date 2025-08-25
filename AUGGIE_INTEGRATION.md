# Auggie Integration Documentation

## Overview

The qlood-cli project has been enhanced with Auggie integration to provide AI-powered code analysis and file operations. This integration allows users to leverage Auggie's capabilities directly from the qlood CLI, enabling seamless project analysis, file operations, and context gathering.

The integration consists of:
- A dedicated `auggie-integration.js` module that handles all Auggie CLI interactions
- Two new CLI commands (`auggie-check` and `auggie-context`) for direct Auggie operations
- Automatic Auggie CLI installation and updates to ensure the latest version is always available
- Comprehensive error handling and timeout management

## The auggie-integration.js Module

### Core Class: AuggieIntegration

The `AuggieIntegration` class provides a comprehensive interface for interacting with the Auggie CLI tool.

#### Constructor Options
```javascript
const auggie = new AuggieIntegration({
  auggieCommand: 'auggie',     // Command to execute Auggie
  timeout: 30000,              // Default timeout in milliseconds
  maxBuffer: 1024 * 1024 * 10  // Maximum buffer size (10MB)
});
```

#### Key Methods

**`ensureAuggieUpToDate()`**
- Automatically checks if Auggie CLI is installed
- Installs Auggie globally via npm if not present
- Updates to the latest version using `@augmentcode/auggie@latest`
- Returns version information and status

**`readFile(filePath, options)`**
- Reads file contents using Auggie CLI
- Supports custom prompts and context
- Returns structured response with success status and content

**`writeFile(filePath, content, options)`**
- Creates new files using Auggie CLI
- Supports custom prompts and additional context
- Handles file creation with AI assistance

**`updateFile(filePath, instructions, options)`**
- Updates existing files using natural language instructions
- Leverages Auggie's understanding of code context
- Provides intelligent file modifications

**`getProjectContext(options)`**
- Analyzes entire project structure
- Provides comprehensive codebase overview
- Uses Auggie's `--print` format for detailed analysis
- Extended timeout (2 minutes) for thorough analysis

**`executeCustomPrompt(prompt, options)`**
- Executes arbitrary Auggie commands with custom prompts
- Flexible interface for advanced Auggie operations
- Supports both legacy and modern Auggie command formats

### Convenience Functions

The module exports convenience functions for direct use:
```javascript
import { 
  ensureAuggieUpToDate, 
  readFile, 
  writeFile, 
  updateFile, 
  getProjectContext, 
  executeCustomPrompt 
} from './src/auggie-integration.js';
```

## CLI Commands

### `qlood auggie-check`

**Purpose**: Ensures Auggie CLI is installed and up-to-date

**Behavior**:
- Checks if Auggie is installed on the system
- Automatically installs Auggie if not present
- Updates to the latest version
- Displays current version information
- Exits with error code 1 if any step fails

**Example Output**:
```
$ qlood auggie-check
Checking Auggie CLI status...
✓ Auggie CLI is up-to-date
  Version: 1.2.3
```

### `qlood auggie-context`

**Purpose**: Analyzes the current project and provides comprehensive context

**Behavior**:
- Uses Auggie's project analysis capabilities
- Provides overview of codebase structure
- Identifies main files, dependencies, and project purpose
- Uses extended timeout for thorough analysis

**Example Output**:
```
$ qlood auggie-context
Gathering project context with Auggie...

--- Project Context ---
This is a Node.js CLI application called qlood-cli that provides AI-driven browser automation for web application testing...
[Detailed project analysis follows]
```

## Usage Examples

### Basic Project Analysis
```bash
# Check Auggie status and update if needed
qlood auggie-check

# Get comprehensive project overview
qlood auggie-context
```

### Programmatic Usage
```javascript
import { AuggieIntegration } from './src/auggie-integration.js';

const auggie = new AuggieIntegration();

// Ensure Auggie is ready
const status = await auggie.ensureAuggieUpToDate();
if (!status.success) {
  console.error('Failed to setup Auggie:', status.message);
  return;
}

// Get project context
const context = await auggie.getProjectContext();
if (context.success) {
  console.log('Project Analysis:', context.context);
}

// Update a file with natural language instructions
const result = await auggie.updateFile(
  'src/example.js',
  'Add error handling to the main function and include proper JSDoc comments'
);
```

### Advanced Custom Prompts
```javascript
// Execute custom analysis
const analysis = await auggie.executeCustomPrompt(
  'Analyze the security implications of the authentication system',
  { 
    usePrintFormat: true,
    timeout: 60000 
  }
);
```

## Ensuring Auggie is Always Up-to-Date

The integration includes several mechanisms to ensure Auggie CLI is always current:

### Automatic Installation
- The `ensureAuggieUpToDate()` function first checks if Auggie is installed
- If not found, it automatically runs `npm install -g @augmentcode/auggie`
- Uses extended timeout (2 minutes) to handle npm installation delays

### Automatic Updates
- Every call to `ensureAuggieUpToDate()` runs `npm install -g @augmentcode/auggie@latest`
- This ensures the latest version is always installed
- Version information is retrieved and displayed after updates

### Error Handling
- Comprehensive error handling for installation failures
- Clear error messages for troubleshooting
- Graceful fallbacks when operations fail

### Integration Points
- The `auggie-check` command can be run independently to verify status
- All Auggie operations internally call update checks
- Version information is always displayed for transparency

### Best Practices
1. Run `qlood auggie-check` before starting intensive Auggie operations
2. The integration handles updates automatically, but manual checks ensure reliability
3. Extended timeouts accommodate slower network connections during updates
4. Error messages provide actionable information for troubleshooting

## Technical Implementation Details

### Command Execution
- Uses Node.js `child_process` with promisified `exec`
- Implements proper timeout handling and buffer management
- Supports both synchronous and background process execution

### Error Management
- Structured error responses with success flags
- Detailed error messages for debugging
- Proper exit code handling for CLI operations

### Security Considerations
- Uses npm's global installation mechanism
- Respects system permissions for global package installation
- Implements proper argument escaping for shell commands

This integration makes Auggie's powerful AI capabilities seamlessly available within the qlood-cli ecosystem, enhancing the tool's ability to understand and work with codebases intelligently.
