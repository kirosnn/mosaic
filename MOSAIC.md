# Mosaic CLI - Project Context

## Project Overview

Mosaic is an open-source AI-powered CLI coding agent built with Bun and React. It provides a terminal-based interface using OpenTUI to render React components directly in the terminal, offering seamless interaction with AI coding assistants through a modern, responsive interface.

**Key Features:**
- Multi-Provider AI Support: OpenAI, Anthropic, Google, Mistral, XAI, and Ollama
- Terminal-First UI: Modern React-based interface rendered directly in the terminal
- Powerful Tool Integration: Built-in tools for file operations, code search, and terminal commands
- Slash Commands: Quick access to common operations
- Workspace Context: Project-specific context files for better AI understanding

## Architecture

### Core Components

1. **CLI Layer** (`src/cli.ts`)
   - Command-line argument parsing and help system
   - Directory management and workspace handling
   - Uninstall functionality with interactive prompts
   - First-run detection and setup flow

2. **Terminal UI** (`src/components/`)
   - React-based terminal interface using OpenTUI
   - Three main screens: Welcome, Setup, and Main
   - Modal dialogs for shortcuts and commands
   - Notification system for user feedback
   - Keyboard shortcuts and event handling

3. **AI Agent** (`src/agent/`)
   - Core agent logic and message handling
   - Multi-provider support with unified interface
   - Tool execution and approval workflows
   - Context management and system prompts

4. **Tools System** (`src/agent/tools/`)
   - File operations: read, write, edit, list, glob, grep
   - Terminal command execution with safety checks
   - User approval system for sensitive operations
   - Path validation and workspace boundaries

5. **Configuration** (`src/utils/config.ts`)
   - User preferences and provider settings
   - First-run state management
   - Approval requirements and behavior flags

### Key Architectural Patterns

1. **Provider Pattern**: Unified interface for multiple AI providers
2. **Tool System**: Modular, extensible tool architecture
3. **Approval Workflow**: User confirmation for sensitive operations
4. **Workspace Isolation**: Strict path validation to prevent directory traversal
5. **Event-Driven UI**: Keyboard event handling and state management

### Design Decisions

- **Bun Runtime**: Chosen for performance and modern JavaScript features
- **OpenTUI**: Terminal UI framework that renders React components
- **Vercel AI SDK**: Standardized AI provider integration
- **Strict Workspace Boundaries**: Security-focused path validation
- **User Approval System**: Safety mechanism for file modifications

## Development Guidelines

### Coding Standards

- **TypeScript**: Strict typing with comprehensive type definitions
- **React Functional Components**: Hooks-based component architecture
- **Error Handling**: Comprehensive try-catch blocks with meaningful error messages
- **Security**: Path validation, input sanitization, and workspace isolation
- **Performance**: Caching mechanisms for path validation and glob patterns

### Naming Conventions

- **Files**: kebab-case (e.g., `file-operations.ts`)
- **Components**: PascalCase (e.g., `Main.tsx`, `Welcome.tsx`)
- **Functions**: camelCase (e.g., `executeTool()`, `validatePath()`)
- **Interfaces**: PascalCase with `I` prefix (e.g., `IToolResult`)
- **Constants**: UPPER_CASE (e.g., `EXCLUDED_DIRECTORIES`)

### Best Practices

1. **Workspace Safety**: Always validate paths against workspace boundaries
2. **User Feedback**: Provide clear notifications and error messages
3. **Tool Approvals**: Require user approval for destructive operations
4. **Error Recovery**: Graceful handling of command failures and timeouts
5. **Cross-Platform**: Support Windows, macOS, and Linux environments

## Key Files & Directories

### Root Files

- `package.json`: Project metadata, dependencies, and scripts
- `tsconfig.json`: TypeScript configuration with strict settings
- `README.md`: User-facing documentation and installation instructions
- `MOSAIC.md`: This file - AI context for the project

### Source Structure

- `src/index.tsx`: Main entry point and CLI renderer
- `src/cli.ts`: Command-line interface and argument parsing
- `src/components/`: React components for terminal UI
  - `App.tsx`: Main application component and state management
  - `Main.tsx`: Primary interface with chat and workspace views
  - `Setup.tsx`: First-run configuration and provider setup
  - `Welcome.tsx`: Initial welcome screen
- `src/agent/`: AI agent core functionality
  - `Agent.ts`: Main agent class and message handling
  - `types.ts`: Type definitions for agent events and messages
  - `provider/`: AI provider implementations
  - `tools/`: Tool implementations and executors
  - `prompts/`: System prompts and tool descriptions
- `src/utils/`: Utility functions and helpers
  - `config.ts`: Configuration management
  - `approvalBridge.ts`: User approval system
  - `diff.ts`: File difference generation
  - `commands/`: CLI command implementations

### Important Utilities

- `src/utils/approvalBridge.ts`: Handles user approval requests for tool operations
- `src/utils/config.ts`: Manages user configuration and preferences
- `src/utils/diff.ts`: Generates and formats file differences
- `src/utils/terminalUtils.ts`: Terminal-specific utilities

## Common Tasks

### Adding a New AI Provider

1. Create a new provider class in `src/agent/provider/`
2. Implement the `Provider` interface with `sendMessage()` method
3. Add the provider to the `createProvider()` method in `Agent.ts`
4. Update configuration options in `src/utils/config.ts`
5. Add provider-specific UI options in `src/components/Setup.tsx`

### Adding a New Tool

1. Create a new tool implementation in `src/agent/tools/`
2. Add the tool to the `getTools()` function in `src/agent/tools/definitions.ts`
3. Implement the tool logic in `src/agent/tools/executor.ts`
4. Add appropriate type definitions in `src/agent/types.ts`
5. Update the system prompt to include the new tool description

### Modifying the UI

1. Create or modify React components in `src/components/`
2. Update state management in `src/components/App.tsx`
3. Add keyboard shortcuts in the main App component
4. Test with different terminal sizes and environments

### Handling User Approvals

1. Check if operation requires approval using `shouldRequireApprovals()`
2. Generate a preview of the operation using `generatePreview()`
3. Request user approval via `requestApproval()`
4. Handle rejection with appropriate error messages and recovery

### Debugging Common Issues

- **Path Validation Errors**: Check workspace boundaries and path resolution
- **Tool Execution Failures**: Verify tool arguments and error handling
- **UI Rendering Issues**: Test with different terminal sizes and platforms
- **Provider Connection Problems**: Check API keys and network connectivity

## Development Workflow

### Setup

```bash
bun install
bun link
```

### Running

```bash
bun run dev          # Development mode with auto-reload
bun run start        # Production mode
mosaic               # Run from any directory after linking
```

### Testing

- Test with different AI providers and models
- Verify workspace isolation and path validation
- Test user approval workflows for all tools
- Validate cross-platform compatibility

### Building

The project uses Bun for both development and production builds. No separate build step is required as Bun handles TypeScript compilation on-the-fly.

## Important Notes

1. **Workspace Safety**: All file operations are validated against workspace boundaries
2. **User Approvals**: Sensitive operations require explicit user confirmation
3. **Error Handling**: Comprehensive error handling throughout the codebase
4. **Cross-Platform**: Designed to work on Windows, macOS, and Linux
5. **Performance**: Caching mechanisms for frequently used operations

This MOSAIC.md file provides the context needed for AI agents to effectively work with the Mosaic CLI codebase, understanding its architecture, conventions, and workflows.