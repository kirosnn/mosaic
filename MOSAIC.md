# Mosaic CLI - Project Context

## Project Overview

Mosaic is an open-source, AI-powered coding agent for the terminal that combines a React-based TUI with a tool-driven agent architecture. It provides both terminal and web interfaces for software development tasks, enabling developers to interact with their codebase through natural language commands.

**Key Features:**
- Multi-provider AI support (OpenAI, Anthropic, Google, Mistral, xAI, Ollama)
- Tool-driven agent architecture with 12+ tools
- React-based TUI using OpenTUI framework
- Web interface option for browser-based usage
- Project context management via MOSAIC.md files
- Safety features including user approvals and workspace validation

## Architecture

### Core Architecture Pattern
Mosaic follows a modular, layered architecture with clear separation of concerns:

```
CLI Layer → Agent Layer → UI Layer → Utility Layer
```

### Key Architectural Components

#### 1. CLI Layer (`src/index.tsx`)
- Entry point for terminal usage
- Argument parsing and routing
- Command-line interface management

#### 2. Agent Layer (`src/agent/`)
- **Agent Core**: Main agent class with message handling (`Agent.ts`)
- **Providers**: AI provider implementations (OpenAI, Anthropic, Google, etc.)
- **Tools System**: 12+ tools for file operations, search, and execution
- **Prompts**: System prompts defining agent behavior and capabilities

#### 3. UI Layer (`src/components/`, `src/web/`)
- **Terminal UI**: React components using OpenTUI framework
- **Web Interface**: Web server and browser-based UI
- **Modals & Dialogs**: User interaction components

#### 4. Utility Layer (`src/utils/`)
- Configuration management
- User approval system
- File change tracking
- Exploration bridges
- Diff generation

### Design Decisions

1. **Tool-Driven Architecture**: All operations are performed through a well-defined tool registry, ensuring consistency and safety
2. **Multi-Provider Support**: Abstracted AI provider interface allows easy addition of new providers
3. **Dual Interface**: Single codebase supports both terminal and web interfaces
4. **Safety First**: User approvals for destructive operations, workspace validation, and rate limiting
5. **Context Management**: MOSAIC.md files provide project-specific context for better AI understanding

## Development Guidelines

### Coding Standards

- **Language**: TypeScript (strict mode)
- **Framework**: React for UI components
- **Runtime**: Bun (required for development)
- **Code Style**: Follow existing patterns in the codebase

### Naming Conventions

- **Files**: `camelCase.ts` for most files, `PascalCase.tsx` for React components
- **Functions**: `camelCase()` for regular functions, `PascalCase()` for React components
- **Variables**: `camelCase` for variables and constants
- **Types/Interfaces**: `PascalCase` for type definitions
- **Tools**: Lowercase tool names (`read`, `write`, `edit`, etc.)

### Best Practices

1. **Tool Usage**: Always use the appropriate tool for the task
2. **File Operations**: Read files before modifying them
3. **User Approval**: Request approval for destructive operations
4. **Error Handling**: Implement robust error handling and recovery
5. **Documentation**: Keep system prompts and MOSAIC.md files updated

### Common Patterns

```typescript
// Tool definition pattern
const toolName = {
  name: 'toolName',
  description: 'What the tool does',
  parameters: { /* parameter schema */ },
  execute: async (params) => { /* implementation */ }
}

// Agent interaction pattern
const result = await agent.executeTool('toolName', { param: value })

// User approval pattern
const approved = await requestUserApproval('action description')
if (!approved) return
```

## Key Files & Directories

### Root Directory Structure

```
.
├── bin/                  # CLI entry point
├── docs/                 # Documentation assets
├── src/                  # Main source code
│   ├── agent/            # Core AI agent functionality
│   ├── components/       # React TUI components
│   ├── utils/            # Utility functions
│   ├── web/              # Web interface
│   └── index.tsx         # CLI entry point
├── package.json          # Project configuration
├── README.md             # User documentation
├── tsconfig.json         # TypeScript configuration
└── MOSAIC.md             # Project context (this file)
```

### Critical Files

#### Entry Points
- `src/index.tsx` - CLI entry point with argument parsing
- `src/web/server.tsx` - Web server entry point

#### Agent Core
- `src/agent/Agent.ts` - Main agent class
- `src/agent/types.ts` - Type definitions
- `src/agent/context.ts` - Context management
- `src/agent/index.ts` - Agent exports

#### Tools System
- `src/agent/tools/definitions.ts` - Tool registry
- `src/agent/tools/executor.ts` - Tool execution engine
- `src/agent/tools/explore.ts` - Exploration tool
- `src/agent/tools/exploreExecutor.ts` - Exploration execution
- Individual tool files: `bash.ts`, `read.ts`, `write.ts`, `edit.ts`, `list.ts`, `glob.ts`, `grep.ts`, `question.ts`, `fetch.ts`, `plan.ts`

#### Providers
- `src/agent/provider/` - AI provider implementations
  - `anthropic.ts`, `google.ts`, `mistral.ts`, `ollama.ts`, `openai.ts`, `xai.ts`
  - `rateLimit.ts` - Rate limiting logic
  - `reasoning.ts` - Reasoning capabilities

#### Prompts
- `src/agent/prompts/systemPrompt.ts` - Main system prompt
- `src/agent/prompts/toolsPrompt.ts` - Tools documentation

#### Components
- `src/components/App.tsx` - Main application component
- `src/components/Main.tsx` - Main interface
- `src/components/Setup.tsx` - Setup interface
- `src/components/Welcome.tsx` - Welcome screen

#### Utilities
- `src/utils/config.ts` - Configuration management
- `src/utils/approvalBridge.ts` - User approval system
- `src/utils/diff.ts` - Diff generation
- `src/utils/fileChangeTracker.ts` - File change tracking
- `src/utils/exploreBridge.ts` - Exploration communication

## Common Tasks

### Starting the CLI

```bash
# From source
bun run src/index.tsx

# Using npx
npx mosaic-cli

# With arguments
bun run src/index.tsx --help
```

### Starting the Web Interface

```bash
# Start web server
bun run src/web/server.tsx

# Access at http://localhost:3000
```

### Adding a New Tool

1. Create new tool file in `src/agent/tools/`
2. Define tool schema and execution logic
3. Register tool in `src/agent/tools/definitions.ts`
4. Update `src/agent/prompts/toolsPrompt.ts` with documentation
5. Test tool functionality

### Adding a New AI Provider

1. Create provider file in `src/agent/provider/`
2. Implement provider interface methods
3. Register provider in agent configuration
4. Update documentation

### Running Tests

```bash
# Check for test files
bun test

# Run specific tests
bun test src/agent/tools/*.test.ts
```

### Building the Project

```bash
# Build for production
bun build

# Build with specific target
bun build --target node
```

### Updating Documentation

1. Update `README.md` for user-facing documentation
2. Update `MOSAIC.md` for project context
3. Update system prompts in `src/agent/prompts/` for agent behavior
4. Update tool documentation in `src/agent/prompts/toolsPrompt.ts`

## Development Workflow

### Typical Development Cycle

1. **Understand**: Use `explore` tool to understand codebase context
2. **Plan**: Use `plan` tool to outline development steps
3. **Implement**: Make code changes using appropriate tools
4. **Test**: Verify changes work as expected
5. **Document**: Update MOSAIC.md and other documentation

### Best Practices for Changes

- Always read files before modifying them
- Use targeted edits rather than full rewrites when possible
- Request user approval for destructive operations
- Update MOSAIC.md when adding new features or patterns
- Keep system prompts updated with new capabilities

## Technologies Used

### Core Stack
- **Runtime**: Bun (required)
- **Language**: TypeScript
- **UI Framework**: React with OpenTUI
- **AI SDK**: Vercel AI SDK

### Key Dependencies
- `@ai-sdk/*`: AI provider SDKs
- `@opentui/core`, `@opentui/react`: Terminal UI
- `better-sqlite3`: Database
- `linkedom`: HTML parsing
- `react-markdown`: Markdown rendering
- `turndown`: HTML to Markdown conversion
- `zod`: Schema validation
- `react-syntax-highlighter`: Code syntax highlighting

### AI Providers Supported
- OpenAI (GPT models)
- Anthropic (Claude models)
- Google (Gemini models)
- Mistral (Mistral/Mixtral models)
- xAI (Grok)
- Ollama (local models)

## Configuration

### Configuration Files
- Global: `~/.mosaic/mosaic.jsonc`
- Project: `.mosaic/` directory
- Context: `MOSAIC.md` files

### Configuration Management
- Use `src/utils/config.ts` for configuration operations
- Configuration is automatically loaded and validated
- Supports JSONC format for comments

## Safety Features

### Workspace Validation
- Prevents path traversal attacks
- Validates all file operations
- Restricts operations to workspace directory

### User Approval System
- Requires approval for destructive operations
- Uses `src/utils/approvalBridge.ts`
- Clear user prompts for critical actions

### Rate Limiting
- Implemented in `src/agent/provider/rateLimit.ts`
- Prevents API abuse
- Configurable limits per provider

### Error Handling
- Comprehensive error handling throughout
- Graceful degradation on failures
- User-friendly error messages

## Project Context Management

### MOSAIC.md Files
- Provide project-specific context for AI agents
- Help agents understand codebase structure and conventions
- Should be updated when new features or patterns are added
- Located in project root or relevant subdirectories

### System Prompts
- Define agent behavior and capabilities
- Located in `src/agent/prompts/`
- Should be updated when new tools or features are added
- Serve as both documentation and runtime configuration

## Troubleshooting

### Common Issues

1. **Bun not installed**: Install Bun runtime
2. **Missing dependencies**: Run `bun install`
3. **Configuration errors**: Check `~/.mosaic/mosaic.jsonc`
4. **Tool failures**: Check tool parameters and permissions
5. **AI provider issues**: Check API keys and rate limits

### Debugging Tips

- Use `bun run src/index.tsx --debug` for debug mode
- Check logs in `~/.mosaic/logs/`
- Use `explore` tool to understand codebase context
- Review system prompts for expected behavior

## Future Enhancements

### Potential Improvements
- Additional AI provider support
- Enhanced tool capabilities
- Improved error recovery
- Better performance optimization
- Additional safety features
- Expanded documentation

### Contribution Guidelines
- Follow existing code patterns
- Update MOSAIC.md with new features
- Add tests for new functionality
- Update system prompts as needed
- Document new tools and capabilities