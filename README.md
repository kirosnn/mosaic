<p align="center">
  <img src="docs/mosaic.png" width="200" />
</p>

# Mosaic CLI

**Version 0.0.6.00**

Mosaic is an open-source AI-powered CLI coding agent built with Bun and React. It provides a terminal-based interface using OpenTUI to render React components directly in your terminal.

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
1. Display a welcome screen
2. Create a configuration directory at `~/.mosaic/`
3. Wait for you to press Enter to continue

After the first run, Mosaic will remember that you've completed the setup and go directly to the main screen.

### Running Mosaic

```bash
mosaic                    # Start Mosaic in current directory
mosaic ./my-project       # Start Mosaic in a specific directory
mosaic --help             # Display help message
```

### Available Options

- `--help`, `-h` - Show help message with usage information and exit
- `--directory`, `-d <path>` - Open Mosaic in the specified directory
- `[directory]` - Optional directory path (positional argument, alternative to `-d`)

Options can be combined in any order:
```bash
mosaic -d ./src -v           # Order doesn't matter
```

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

## Project Structure

```
mosaic/
├── src/
│   ├── index.tsx           # Application entry point
│   ├── cli.ts              # Command-line interface system
│   ├── components/
│   │   ├── App.tsx         # Main application router
│   │   ├── Welcome.tsx     # First-run welcome screen
│   │   └── Main.tsx        # Main application screen
│   └── utils/
│       ├── version.ts      # Version information
│       └── config.ts       # Configuration management
├── package.json
├── tsconfig.json
└── README.md
```

## Technical Stack

- **Runtime**: [Bun](https://bun.sh) - Fast JavaScript runtime
- **UI Framework**: [OpenTUI](https://github.com/opentui/opentui) - Terminal UI with React
  - `@opentui/core` - Core terminal rendering engine
  - `@opentui/react` - React bindings for OpenTUI
- **Language**: TypeScript with strict mode enabled
- **React**: Version 19.2.3

## Architecture

Mosaic uses a dual-mode architecture:

1. **CLI Mode**: When arguments are provided, the CLI parser handles commands
2. **Interactive Mode**: Without arguments, launches the OpenTUI React interface

The application leverages OpenTUI to render React components in the terminal using a flexbox-based layout system, similar to React Native.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT