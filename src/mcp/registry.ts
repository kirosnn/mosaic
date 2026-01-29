export interface McpRegistryEntry {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, { description: string; required: boolean }>;
  prompts?: { key: string; question: string; argIndex?: number }[];
}

export const MCP_REGISTRY: McpRegistryEntry[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read/write access to the local filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '{path}'],
    prompts: [{ key: 'path', question: 'Directory path to expose', argIndex: 2 }],
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent knowledge graph memory for the agent',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Fetch and convert web content to markdown',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via Brave Search API',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: { description: 'Brave Search API key', required: true } },
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub API access (repos, issues, PRs, etc.)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: { description: 'GitHub personal access token', required: true } },
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'GitLab API access (repos, issues, MRs, etc.)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    env: {
      GITLAB_PERSONAL_ACCESS_TOKEN: { description: 'GitLab personal access token', required: true },
      GITLAB_API_URL: { description: 'GitLab API URL (for self-hosted)', required: false },
    },
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    description: 'Google Maps geocoding, directions, places, and elevation',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-maps'],
    env: { GOOGLE_MAPS_API_KEY: { description: 'Google Maps API key', required: true } },
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Slack workspace access (channels, messages, users)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: {
      SLACK_BOT_TOKEN: { description: 'Slack bot token (xoxb-...)', required: true },
      SLACK_TEAM_ID: { description: 'Slack workspace/team ID', required: true },
    },
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Read-only access to a PostgreSQL database',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '{connection_string}'],
    prompts: [{ key: 'connection_string', question: 'PostgreSQL connection string (postgresql://...)', argIndex: 2 }],
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Read/write access to a SQLite database',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '{db_path}'],
    prompts: [{ key: 'db_path', question: 'Path to the SQLite database file', argIndex: 3 }],
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation and web scraping via Puppeteer',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Dynamic problem-solving through structured sequential thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  {
    id: 'everything',
    name: 'Everything',
    description: 'MCP test server with sample tools, resources, and prompts',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
  },
  {
    id: 'browser-use',
    name: 'Browser Use',
    description: 'AI-powered browser automation, web search, and data extraction',
    command: 'npx',
    args: ['-y', 'browser-use-mcp'],
    env: { BROWSER_USE_API_KEY: { description: 'Browser Use API key (from cloud.browser-use.com)', required: true } },
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Sentry error tracking access',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sentry'],
    env: { SENTRY_AUTH_TOKEN: { description: 'Sentry auth token', required: true } },
  },
];

export function findRegistryEntry(nameOrId: string): McpRegistryEntry | null {
  const lower = nameOrId.toLowerCase().replace(/\s+/g, '-');
  return MCP_REGISTRY.find(e =>
    e.id === lower ||
    e.name.toLowerCase() === nameOrId.toLowerCase() ||
    e.name.toLowerCase().replace(/\s+/g, '-') === lower
  ) || null;
}

export function searchRegistry(query: string): McpRegistryEntry[] {
  const lower = query.toLowerCase();
  return MCP_REGISTRY.filter(e =>
    e.id.includes(lower) ||
    e.name.toLowerCase().includes(lower) ||
    e.description.toLowerCase().includes(lower)
  );
}