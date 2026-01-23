# MOSAIC.md - Mosaic CLI Context File

This file provides contextual information about the Mosaic CLI project to help AI agents understand the codebase structure, patterns, and conventions.

## Project Overview

**Mosaic CLI** is an open-source AI-powered coding agent built with Bun and React. It provides a terminal-based interface using OpenTUI to render React components directly in the terminal, offering seamless interaction with AI coding assistants.

**Key Features:**
- Multi-provider AI support (OpenAI, Anthropic, Google, Mistral, XAI, Ollama)
- Terminal-first UI with React components rendered via OpenTUI
- Web interface option on http://127.0.0.1:8192
- Built-in tools for file operations, code search, and terminal commands
- Slash commands for quick operations
- Workspace context via MOSAIC.md files

## Architecture

### Core Architecture Patterns

1. **Modular Design**: The codebase is organized into clear modules:
   - `src/agent/` - AI agent core logic and tools
   - `src/components/` - React UI components
   - `src/utils/` - Utility functions and helpers
   - `src/web/` - Web interface components

2. **Tool-Based System**: The AI agent uses a tool-based approach where each capability is implemented as a separate tool (read, write, edit, bash, grep, etc.)

3. **Provider Abstraction**: AI providers are abstracted behind a common interface, allowing easy switching between different AI models

4. **Event-Driven UI**: The terminal interface uses React with OpenTUI for rendering, creating a responsive terminal experience

### Key Design Decisions

- **Bun Runtime**: Uses Bun for fast execution and modern JavaScript features
- **TypeScript**: Entire codebase is written in TypeScript for type safety
- **Functional Components**: React components use functional style with hooks
- **Tool Registry**: Tools are registered and managed through a central registry system
- **Context Management**: MOSAIC.md files provide project-specific context to AI agents

## Development Guidelines

### Coding Standards

- **TypeScript**: All code must be TypeScript with strict type checking
- **React Functional Components**: Use functional components with hooks
- **File Organization**: Group related files in subdirectories (e.g., agent tools, web components)
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Async/Await**: Use async/await for asynchronous operations

### Naming Conventions

- **Files**: PascalCase for components (App.tsx), camelCase for utilities (config.ts)
- **Variables**: camelCase for variables and functions
- **Constants**: UPPER_CASE for constants
- **Types/Interfaces**: PascalCase for type names
- **Components**: PascalCase component names (e.g., `<App />`)

### Best Practices

- **Tool Development**: New tools should follow the existing pattern in `src/agent/tools/`
- **Provider Integration**: New AI providers should implement the standard interface
- **Error Filtering**: Filter out common React/terminal errors in stderr/stdout
- **Configuration**: Use the config system for persistent settings
- **Undo/Redo**: Implement undo/redo functionality for file operations

## Key Files & Directories

### Root Files

- `package.json` - Project configuration and dependencies
- `tsconfig.json` - TypeScript configuration
- `README.md` - User documentation
- `MOSAIC.md` - This context file for AI agents

### Source Structure

#### `src/`
- **index.tsx** - Main entry point and CLI parser
- **components/` - React UI components for terminal interface
- **agent/` - AI agent core functionality
- **utils/` - Utility functions and helpers
- **web/` - Web interface components and server

#### `src/agent/`
- **Agent.ts** - Main agent class
- **context.ts** - Context management
- **types.ts** - Type definitions
- **prompts/` - Prompt templates
- **provider/` - AI provider implementations
- **tools/` - Tool implementations (file operations, bash, etc.)

#### `src/components/`
- **App.tsx** - Main application component
- **Main.tsx** - Main UI container
- **CustomInput.tsx** - Custom input component
- **main/` - Main page components (ChatPage, HomePage, etc.)

#### `src/utils/`
- **config.ts** - Configuration management
- **history.ts** - Chat history
- **undoRedo.ts** - Undo/redo functionality
- **commands/` - Slash command implementations

#### `src/web/`
- **app.tsx** - Web application entry point
- **server.tsx** - Web server implementation
- **components/` - Web UI components
- **assets/` - Static assets (CSS, fonts, images)

## Common Tasks

### Adding a New Tool

1. Create a new file in `src/agent/tools/` following the existing pattern
2. Implement the tool function with proper TypeScript types
3. Register the tool in the tool registry
4. Add appropriate error handling and validation

### Adding a New AI Provider

1. Create a new provider file in `src/agent/provider/`
2. Implement the standard provider interface
3. Add provider-specific configuration options
4. Update the provider selection logic

### Creating a New Slash Command

1. Create a new command file in `src/utils/commands/`
2. Implement the command handler function
3. Register the command in the command registry
4. Add command documentation

### Building the Web Interface

1. Develop components in `src/web/components/`
2. Add styles in `src/web/assets/css/`
3. Update the web app entry point in `src/web/app.tsx`
4. Ensure the server handles new routes in `src/web/server.tsx`

### Running the Project

```bash
# Development mode with auto-reload
bun run dev

# Production mode
bun run start

# Web interface
mosaic web
```

### Testing Tools

The project includes various tools that can be tested:
- File operations (read, write, edit)
- Directory listing and filtering
- Code search with grep
- Terminal command execution
- User interaction via questions

## Technical Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **UI Framework**: React with OpenTUI
- **AI Integration**: Vercel AI SDK
- **Database**: Better SQLite 3
- **Build System**: Bun

## AI Provider Support

Mosaic supports multiple AI providers:
- OpenAI (GPT models)
- Anthropic (Claude models)
- Google (Gemini models)
- Mistral (Mistral/Mixtral models)
- XAI (Grok models)
- Ollama (local/cloud models)

## Important Notes

- The project uses a custom error filtering system to suppress common React/terminal errors
- Configuration is stored in `~/.mosaic/` directory
- MOSAIC.md files are automatically created/updated in project directories
- The system includes comprehensive undo/redo functionality for file operations
- Web interface runs on port 8192 by default
