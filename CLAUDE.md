# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mosaic is an open-source AI-powered CLI coding agent built with Bun and React. The project uses **OpenTUI** (`@opentui/core` and `@opentui/react`) to render React components in the terminal using a declarative JSX-based approach.

## Development Commands

### Running the Application
```bash
bun run mosaic          # Run the CLI
bun run start           # Alias for mosaic
bun run dev             # Run with auto-reload on file changes
```

### Direct Execution
```bash
bun run src/index.tsx [args]    # Run with optional CLI arguments
```

## Architecture

### Entry Point Flow
The application entry point is `src/index.tsx`, which handles two execution modes:

1. **CLI Mode**: When command-line arguments are provided (`args.length > 0`), the application parses them using the CLI command system
2. **Interactive Mode**: When no arguments are provided, it launches the OpenTUI React renderer and displays the welcome screen

### Core Components

**CLI System** (`src/cli.ts`):
- Implements a command registry pattern with the `CLI` class
- Commands are registered with names, descriptions, aliases, and handler functions
- Currently implements `--help` / `-h` for displaying usage information
- Extensible design allows new commands to be added via `addCommand()`

**React UI** (`src/components/App.tsx`):
- Uses OpenTUI's box layout system with flexbox-style props (`flexDirection`, `justifyContent`, `alignItems`, etc.)
- Renders text with `TextAttributes` (e.g., `BOLD`, `DIM`) for terminal styling
- Welcome screen displays ASCII art logo and version information

**Version Management** (`src/utils/version.ts`):
- Imports version directly from `package.json` to ensure single source of truth
- Used in CLI help output and welcome screen

### TypeScript Configuration

- **JSX Import Source**: Set to `@opentui/react` (not standard React)
- **Module System**: Uses `module: "Preserve"` with `moduleResolution: "bundler"`
- **Strict Mode**: Enabled with additional strictness flags (`noUncheckedIndexedAccess`, `noImplicitOverride`)
- **No Emit**: TypeScript is used only for type checking; Bun handles execution directly

### Key Dependencies

- **Runtime**: Bun (replaces Node.js)
- **UI Framework**: OpenTUI (`@opentui/core`, `@opentui/react`) - terminal-based React renderer
- **React Version**: 19.2.3

## Important Patterns

### Adding New CLI Commands
To add a new command, register it in the CLI constructor or initialization:
```typescript
cli.addCommand({
  name: '--command-name',
  description: 'Description of what it does',
  aliases: ['-c'],
  handler: (args) => {
    // Command implementation
  }
});
```

### Creating Terminal UI Components
Use OpenTUI's `box` and `text` elements with flexbox-style layout:
```tsx
<box flexDirection="column" alignItems="center">
  <text attributes={TextAttributes.BOLD}>Bold text</text>
  <text attributes={TextAttributes.DIM}>Dimmed text</text>
</box>
```

### Project Structure
```
src/
├── index.tsx           # Application entry point (CLI vs Interactive mode routing)
├── cli.ts              # Command-line interface system
├── components/
│   └── App.tsx         # Main OpenTUI React component (welcome screen)
└── utils/
    └── version.ts      # Version information from package.json
```
