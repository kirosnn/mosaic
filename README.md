<p align="center">
  <img src="docs/mosaic.png" width="200" />
</p>

# Mosaic CLI

**Version 0.0.6.01**

Mosaic is an open-source AI-powered CLI coding agent built with Bun and React. It provides a terminal-based interface using OpenTUI to render React components directly in your terminal, offering seamless interaction with AI coding assistants through a modern, responsive interface.

## Features

- **Multi-Provider AI Support**: Compatible with OpenAI, Anthropic, Google, Mistral, XAI, and Ollama
- **Terminal-First UI**: Modern React-based interface rendered directly in the terminal
- **Powerful Tool Integration**: Built-in tools for file operations, code search, and terminal commands
- **Slash Commands**: Quick access to common operations
- **Workspace Context**: Project-specific context files for better AI understanding

## Prerequisites

- [Bun](https://bun.sh) - Fast all-in-one JavaScript runtime

## Installation

```bash
git clone https://github.com/yourusername/mosaic-cli.git
cd mosaic-cli
bun install
bun link
```

After linking, you can run Mosaic from any directory:

```bash
mosaic
```

## Usage

### First Run

On first run, Mosaic will:
1. Display a welcome screen
2. Create a configuration directory at `~/.mosaic/`
3. Guide you through AI provider setup

### Initializing a Project

Initialize Mosaic context in your project workspace:

```bash
/init
```

This command creates:
- `MOSAIC.md` - A context file that helps the AI understand your project structure, patterns, and conventions
- `.mosaic/` - Project-specific configuration directory

The AI will automatically analyze your codebase and generate a comprehensive MOSAIC.md file tailored to your project.

### Basic Usage

```bash
mosaic                       # Start in current directory
mosaic ./my-project          # Start in specific directory
mosaic run "fix the bug"     # Launch with a task
mosaic --help                # Show help
```

### Uninstalling

```bash
mosaic uninstall             # Interactive uninstall
mosaic uninstall --force     # Remove all data without prompts
```

### Slash Commands

Available commands within Mosaic:

- `/init` or `/i` - Initialize workspace with MOSAIC.md context file
- `/help` or `/h` - Show available commands
- `/echo <text>` - Echo text back (testing)

## Development

```bash
bun run dev              # Run with auto-reload
bun run start            # Run normally
```

## Configuration

Mosaic stores its configuration in `~/.mosaic/`:
- `mosaic.jsonc` - Tracks first run status and version information

## Technical Stack

- **Runtime**: Bun
- **UI**: OpenTUI with React
- **AI Integration**: Vercel AI SDK
- **Language**: TypeScript
- **Database**: Better SQLite 3

## Supported AI Providers

Mosaic supports multiple AI providers through the Vercel AI SDK:

- **OpenAI**: GPT-4, GPT-3.5-turbo and other models
- **Anthropic**: Claude models (Opus, Sonnet, Haiku)
- **Google**: Gemini models
- **Mistral**: Mistral and Mixtral models
- **xAI**: Grok models
- **Ollama**: Local and cloud models with automatic service management

## How It Works

Mosaic provides AI agents with powerful tools:

- **File Operations**: Read, write, and edit files
- **Directory Management**: List and navigate project structure
- **Code Search**: Regex-powered grep across the entire project
- **Terminal Integration**: Execute shell commands
- **User Interaction**: Ask questions for clarification

The MOSAIC.md context file helps the AI understand your project's architecture, conventions, and patterns, making it more effective at completing tasks.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT