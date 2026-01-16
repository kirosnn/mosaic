<p align="center">
  <img src="docs/mosaic.png" width="200" />
</p>

# Mosaic CLI

**Version 0.0.6.00**

Mosaic is an open-source AI-powered CLI coding agent built with Bun and React. It provides a terminal-based interface using OpenTUI to render React components directly in your terminal, offering seamless interaction with AI coding assistants through a modern, responsive interface.

## Features

- **Multi-Provider AI Support**: Compatible with OpenAI, Anthropic, Google, Mistral, XAI, and Ollama
- **Terminal-First UI**: Modern React-based interface rendered directly in the terminal using OpenTUI
- **Powerful Tool Integration**: Built-in tools for file operations, code search, terminal commands, and more
- **Slash Commands**: Quick access to common operations and workflows
- **Workspace Context**: Intelligent understanding of your project structure and conventions
- **Memory System**: Persistent context retention across sessions (in development)

## Prerequisites

- [Bun](https://bun.sh) - Fast all-in-one JavaScript runtime

## Installation

### Global Installation (Recommended)

Install Mosaic globally to use it from anywhere:

```bash
cd mosaic
bun link
```

After linking, you can run Mosaic from any directory:

```bash
mosaic
mosaic --help
```

### Local Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/yourusername/mosaic-cli.git
cd mosaic-cli
bun install
```

## Usage

### First Run

When you run Mosaic for the first time, it will:
1. Display a welcome screen with setup instructions
2. Create a configuration directory at `~/.mosaic/`
3. Guide you through provider and API key configuration
4. Initialize the workspace context

After the first run, Mosaic will remember your configuration and go directly to the main interface.

### Running Mosaic

```bash
mosaic                    # Start Mosaic in current directory
mosaic ./my-project       # Start Mosaic in a specific directory
mosaic --help             # Display help message
```

### Uninstalling Mosaic

Mosaic can be uninstalled using the uninstall command. This will remove the global installation and optionally clean up configuration and history files.

```bash
mosaic uninstall             # Interactive uninstall with prompts
mosaic uninstall --force     # Force uninstall (removes all data)
```

The interactive uninstall will ask you whether to keep:
- Conversation history
- Configuration files

The `--force` option removes everything without prompts, including:
- Configuration directory (`~/.mosaic/`)
- Project-specific files (`.mosaic/` directories and `MOSAIC.md` files)

### Available Options

- `--help`, `-h` - Show help message with usage information and exit
- `--directory`, `-d <path>` - Open Mosaic in the specified directory
- `--force` - Force uninstall without prompts (removes all data)
- `[directory]` - Optional directory path (positional argument, alternative to `-d`)

Options can be combined in any order:
```bash
mosaic -d ./src           # Start in ./src directory
mosaic uninstall --force  # Force uninstall
```

### Interface Features

Once running, Mosaic provides:

- **Chat Interface**: Natural language interaction with your AI coding assistant
- **File Operations**: Direct file reading, editing, and creation through AI
- **Terminal Integration**: Execute shell commands and see results in real-time
- **Code Search**: Powerful grep-based code searching across your project
- **Context Awareness**: Automatic understanding of your project's structure and technologies

## Development

### Running in Development Mode

```bash
bun run dev              # Run with auto-reload on file changes
bun run start            # Run the CLI normally
bun run mosaic           # Alternative way to run the CLI
```

### Direct Execution

```bash
bun run src/index.tsx    # Execute directly with Bun
```

## Configuration

Mosaic stores its configuration in `~/.mosaic/`:
- `config.json` - Tracks first run status and version information

## Technical Stack

- **Runtime**: [Bun](https://bun.sh) - Fast all-in-one JavaScript runtime
- **UI Framework**: [OpenTUI](https://github.com/opentui/opentui) - Terminal UI with React
  - `@opentui/core@^0.1.69` - Core terminal rendering engine
  - `@opentui/react@^0.1.69` - React bindings for OpenTUI
- **AI Integration**: [AI SDK](https://github.com/vercel/ai) - Unified AI provider interface
  - Support for OpenAI, Anthropic, Google, Mistral, XAI, and Ollama
- **Language**: TypeScript with strict mode enabled
- **React**: Version 19.2.3
- **Database**: Better SQLite 3 for local data storage
- **Validation**: Zod for runtime type validation

## Supported AI Providers

Mosaic supports multiple AI providers through the Vercel AI SDK:

- **OpenAI**: GPT-4, GPT-3.5-turbo and other models
- **Anthropic**: Claude models (Opus, Sonnet, Haiku)
- **Google**: Gemini models
- **Mistral**: Mistral and Mixtral models
- **xAI**: Grok models
- **Ollama**: Local models with automatic service management

## Architecture

Mosaic uses a dual-mode architecture:

1. **CLI Mode**: When arguments are provided, the CLI parser handles commands and directory navigation
2. **Interactive Mode**: Without arguments, launches the OpenTUI React interface for AI-assisted development

### Core Components

- **Agent System**: Multi-provider AI integration with tool calling capabilities
- **Tool Integration**: File operations (read, write, edit), terminal commands, code search, and directory listing
- **Context Management**: Workspace-aware conversation history and project understanding
- **Command System**: Slash commands for quick access to common operations
- **Configuration**: Persistent settings stored in `~/.mosaic/`

The application leverages OpenTUI to render React components in the terminal using a flexbox-based layout system, similar to React Native, providing a responsive and modern user experience.

## Available Tools

Mosaic provides the AI agent with powerful tools for code assistance:

- **File Operations**: `read`, `write`, `edit` - Complete file manipulation capabilities
- **Directory Management**: `list` - Browse and understand project structure
- **Code Search**: `grep` - Fast, regex-powered code searching across the entire project
- **Terminal Integration**: `bash` - Execute shell commands with real-time output
- **Question Answering**: `question` - Direct Q&A capabilities for clarification

These tools enable the AI to understand your codebase, make changes, run tests, and perform complex development tasks autonomously.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT