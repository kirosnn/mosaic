# MOSAIC.md - Mosaic CLI Context Guide

This file provides essential context for AI agents working in the Mosaic CLI codebase. It's designed to help AI assistants understand the project structure, architecture, and development patterns.

## Project Overview

**Mosaic CLI** is an open-source AI-powered terminal-based coding assistant built with Bun, React, and OpenTUI. It provides a modern, responsive interface rendered directly in the terminal for seamless interaction with AI coding assistants.

### Key Features
- **Multi-Provider AI Support**: OpenAI, Anthropic, Google, Mistral, XAI, and Ollama
- **Terminal-First UI**: React components rendered in terminal using OpenTUI
- **Powerful Tool Integration**: File operations, terminal commands, code search, and more
- **Slash Commands**: Quick access to common operations
- **Workspace Context**: Intelligent project understanding
- **Memory System**: Persistent context retention (in development)

### Core Purpose
Mosaic bridges the gap between AI capabilities and terminal-based development workflows, providing a unified interface for code assistance, file manipulation, and project management directly from the command line.

## Architecture

### Dual-Mode Architecture
1. **CLI Mode**: Handles command-line arguments and directory navigation
2. **Interactive Mode**: Launches OpenTUI React interface for AI-assisted development

### Core Components

#### 1. Agent System (`src/agent/`)
- **Agent.ts**: Main agent class managing message history and provider integration
- **Provider System**: Individual provider implementations (OpenAI, Anthropic, Google, Mistral, XAI, Ollama)
- **Tools System**: File operations, terminal commands, code search capabilities
- **Context Management**: Workspace-aware conversation history

#### 2. UI System (`src/components/`)
- **App.tsx**: Main application entry point
- **Main.tsx**: Core UI structure and navigation
- **ChatPage.tsx**: Chat interface for AI interaction
- **Setup.tsx**: Initial configuration and provider setup
- **OpenTUI Integration**: Terminal-based React rendering

#### 3. CLI System (`src/cli.ts`)
- Command parsing and argument handling
- Help system and usage information
- Uninstall functionality
- Directory management

#### 4. Utility System (`src/utils/`)
- Configuration management
- Markdown rendering
- Terminal utilities
- Command system (slash commands)
- History management

### Key Design Decisions

1. **Terminal-First Approach**: Uses OpenTUI to render React components in terminal
2. **Multi-Provider Architecture**: Abstracted provider interface for easy integration
3. **Tool-Based Workflow**: AI agents use tools (read, write, edit, grep, bash, etc.) for code manipulation
4. **Workspace Context**: Automatic understanding of project structure and technologies
5. **Persistent Configuration**: User preferences stored in `~/.mosaic/`

## Development Guidelines

### Coding Standards

#### TypeScript
- **Strict Mode**: TypeScript strict mode enabled
- **Type Safety**: Strong typing throughout the codebase
- **Modern Syntax**: Uses ES6+ features and modern TypeScript patterns

#### React Patterns
- **Functional Components**: All components use functional style with hooks
- **OpenTUI Integration**: Components designed for terminal rendering
- **State Management**: Local state management with React hooks

#### Error Handling
- **Graceful Degradation**: Error boundaries and fallback UIs
- **User Feedback**: Clear error messages and notifications
- **Process Management**: Proper cleanup on exit signals

### Naming Conventions

#### Files and Directories
- **PascalCase**: Component files (e.g., `App.tsx`, `ChatPage.tsx`)
- **camelCase**: Utility files (e.g., `config.ts`, `terminalUtils.ts`)
- **kebab-case**: Configuration files (e.g., `package.json`, `tsconfig.json`)

#### Variables and Functions
- **camelCase**: Variables and functions (e.g., `messageHistory`, `sendMessage()`)
- **PascalCase**: Classes and types (e.g., `Agent`, `ProviderConfig`)
- **UPPER_CASE**: Constants (e.g., `VERSION`, `DEFAULT_SYSTEM_PROMPT`)

#### Types and Interfaces
- **Suffix**: All type definitions use `Type` or `Interface` suffix
- **Organization**: Types grouped by functionality in dedicated files

### Best Practices

1. **Terminal Compatibility**: Always test UI changes in terminal environment
2. **Error Recovery**: Implement proper cleanup for terminal operations
3. **Performance**: Optimize for terminal rendering performance
4. **User Experience**: Provide clear feedback for all operations
5. **Configuration**: Respect user preferences and settings

## Key Files & Directories

### Root Level
- **package.json**: Project configuration and dependencies
- **README.md**: User-facing documentation
- **MOSAIC.md**: AI context guide (this file)
- **tsconfig.json**: TypeScript configuration
- **bun.lock**: Dependency lock file

### Source Structure (`src/`)

#### Entry Points
- **index.tsx**: Main application entry with CLI/Interactive mode routing
- **cli.ts**: Command-line interface parser and handler

#### Agent System (`src/agent/`)
- **Agent.ts**: Core agent implementation
- **types.ts**: Type definitions for agent system
- **context.ts**: Context management utilities
- **provider/**: Individual provider implementations
- **prompts/**: System prompts and templates
- **tools/**: Tool implementations (bash, edit, grep, list, question, read, write)

#### UI Components (`src/components/`)
- **App.tsx**: Main application component
- **Main.tsx**: Core UI structure
- **Setup.tsx**: Initial setup and configuration
- **main/**: Main interface components (ChatPage, HomePage, etc.)
- **Modals**: Command and shortcut modals
- **Notifications**: User notification system

#### Utilities (`src/utils/`)
- **config.ts**: Configuration management
- **history.ts**: Conversation history
- **markdown.tsx**: Markdown rendering
- **terminalUtils.ts**: Terminal utilities
- **commands/**: Slash command system
- **toolFormatting.ts**: Tool output formatting

## Common Tasks

### Running the Application

```bash
# Development mode with auto-reload
bun run dev

# Production mode
bun run start

# Direct execution
bun run src/index.tsx
```

### Adding New Features

1. **New Tools**: Add to `src/agent/tools/` and register in `definitions.ts`
2. **New Commands**: Add to `src/utils/commands/` and register in `registry.ts`
3. **New UI Components**: Create in `src/components/` following existing patterns
4. **New Providers**: Implement in `src/agent/provider/` following provider interface

### Debugging

1. **Terminal Errors**: Check stderr filtering in `index.tsx`
2. **UI Issues**: Test with different terminal sizes and configurations
3. **Provider Issues**: Check API key configuration and network connectivity
4. **Tool Problems**: Verify tool implementations and error handling

### Configuration Management

- **User Config**: Stored in `~/.mosaic/config.json`
- **Workspace Context**: `.mosaic/` directory in project root
- **History**: Persistent conversation history in `~/.mosaic/history/`

### Testing

1. **Unit Testing**: Focus on core utilities and agent logic
2. **Integration Testing**: Test provider interactions and tool usage
3. **UI Testing**: Manual testing in various terminal environments
4. **End-to-End**: Test complete workflows from CLI to AI interaction

## Technical Stack

### Core Technologies
- **Runtime**: Bun (fast JavaScript runtime)
- **UI Framework**: OpenTUI (terminal UI with React)
- **AI Integration**: Vercel AI SDK
- **Language**: TypeScript 5+
- **React**: Version 19.2.3
- **Database**: Better SQLite 3
- **Validation**: Zod

### Key Dependencies
- `@opentui/core`, `@opentui/react`: Terminal rendering
- `@ai-sdk/*`: AI provider integrations
- `better-sqlite3`: Local data storage
- `zod`: Runtime type validation
- `ollama`: Local model support

## Workflow Patterns

### Agent Interaction Flow
1. User sends message through terminal interface
2. Agent processes message and determines required tools
3. Tools execute operations (file changes, terminal commands, etc.)
4. Results returned to user through terminal UI
5. Conversation history maintained for context

### Error Handling Flow
1. Error detection in operation execution
2. Graceful fallback to user interface
3. Clear error message display
4. Option to retry or continue
5. Proper cleanup of terminal state

### Configuration Flow
1. Check for existing configuration
2. If missing, launch setup interface
3. Guide user through provider selection
4. Validate API keys and settings
5. Persist configuration for future use

## Important Notes for AI Agents

1. **Terminal Environment**: All UI operations must work in terminal context
2. **Error Recovery**: Always implement proper cleanup for terminal operations
3. **User Context**: Maintain awareness of current workspace and project structure
4. **Tool Usage**: Prefer built-in tools (read, write, edit, grep, bash) for code manipulation
5. **Configuration**: Respect user preferences and existing settings
6. **Performance**: Optimize for terminal rendering and response times

This MOSAIC.md file provides the essential context needed to effectively work with the Mosaic CLI codebase. AI agents should refer to this guide when performing development tasks, debugging, or extending functionality.