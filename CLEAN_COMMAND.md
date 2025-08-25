# Clean Command Documentation

## Overview
The `clean` command removes the `./.qlood/` directory from your project, forcing a complete reinitialization on the next run.

## Usage

```bash
# Using qlood directly
qlood clean

# Or using node
node bin/qlood.js clean
```

## What It Does

1. **Checks for .qlood directory** - Verifies if the `.qlood` directory exists in the current project
2. **Removes the directory** - Completely removes the `.qlood` directory and all its contents
3. **Confirms success** - Displays a success message and informs that the project will be reinitialized

## When to Use

- **Fresh start needed** - When you want to completely reset the qlood configuration
- **Configuration issues** - If the project configuration is corrupted or outdated
- **Testing initialization** - When testing the initialization process
- **Project structure changes** - After major changes to project structure that require fresh detection

## What Gets Removed

When you run `qlood clean`, the following are removed:

- `./.qlood/qlood.json` - Project configuration
- `./.qlood/project-structure.json` - Cached project structure
- `./.qlood/workflows/` - All workflow definitions
- `./.qlood/notes/context.md` - Auggie-generated project context
- `./.qlood/runs/` - Test run history
- `./.qlood/screenshots/` - Captured screenshots
- `./.qlood/debug/` - Debug logs

## Reinitialization

After running `qlood clean`, the next time you run qlood:

1. You'll be prompted to initialize the project
2. Project configuration will be auto-detected
3. Basic workflows will be created
4. **Auggie will automatically generate a new project context** with loading animation
5. Fresh project structure will be scanned and saved

## Example Output

### When .qlood exists:
```
$ qlood clean
Removing /path/to/project/.qlood...
✓ Successfully removed .qlood directory
The project will be reinitialized on the next run.
```

### When .qlood doesn't exist:
```
$ qlood clean
No .qlood directory found in the current project.
```

## Notes

- The command uses Node.js built-in `fs.rm` with recursive option for safe directory removal
- Works cross-platform (Windows, macOS, Linux)
- No additional dependencies required (uses native Node.js fs/promises module)
