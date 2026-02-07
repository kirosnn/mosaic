export const FIXTURES = {
  SIMPLE_JS_PROJECT: {
    "src/index.js": `const { add, subtract, multiply } = require('./math');

function main() {
  console.log('Addition:', add(2, 3));
  console.log('Subtraction:', subtract(10, 4));
  console.log('Multiplication:', multiply(5, 6));
}

module.exports = { main };
main();
`,
    "src/math.js": `function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, subtract, multiply };
`,
    "src/utils.js": `function formatNumber(n) {
  return n.toFixed(2);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

module.exports = { formatNumber, clamp };
`,
    "README.md": `# Simple JS Project

A simple JavaScript project with math utilities.

## Usage
\`\`\`
node src/index.js
\`\`\`
`,
    "package.json": `{
  "name": "simple-js-project",
  "version": "1.0.0",
  "main": "src/index.js"
}
`,
  },

  BUGGY_CODE: {
    "src/processor.js": `function processItems(items) {
  const results = [];
  // Bug 1: off-by-one error (should be i < items.length)
  for (let i = 0; i <= items.length; i++) {
    results.push(items[i].toUpperCase());
  }
  return results;
}

function computeAverage(numbers) {
  let sum = 0;
  for (const n of numbers) {
    sum += n;
  }
  // Bug 2: division by zero when array is empty
  return sum / numbers.length;
}

module.exports = { processItems, computeAverage };
`,
  },

  BUBBLE_SORT: {
    "src/sort.js": `function bubbleSort(arr) {
  const sorted = [...arr];
  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = 0; j < sorted.length - i - 1; j++) {
      if (sorted[j] > sorted[j + 1]) {
        const temp = sorted[j];
        sorted[j] = sorted[j + 1];
        sorted[j + 1] = temp;
      }
    }
  }
  return sorted;
}

const input = [5, 3, 8, 1, 9, 2, 7, 4, 6];
console.log('Sorted:', bubbleSort(input));

module.exports = { bubbleSort };
`,
  },

  TS_PROJECT: {
    "src/index.ts": `import { UserService } from './services/user-service';
import { Logger } from './utils/logger';

const logger = new Logger('App');

async function main() {
  logger.info('Starting application');

  const userService = new UserService(logger);
  const users = await userService.getAll();
  logger.info(\`Found \${users.length} users\`);

  for (const user of users) {
    const profile = await userService.getProfile(user.id);
    logger.info(\`Profile for \${user.name}: \${JSON.stringify(profile)}\`);
  }

  logger.info('Application finished');
}

main().catch(err => logger.error('Fatal error', err));
`,
    "src/types.ts": `export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
}

export interface UserProfile {
  user: User;
  preferences: Record<string, string>;
  lastLogin: Date;
}
`,
    "src/services/user-service.ts": `import type { User, UserProfile } from '../types';
import { Logger } from '../utils/logger';

const USERS: User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com', role: 'admin' },
  { id: '2', name: 'Bob', email: 'bob@example.com', role: 'user' },
  { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'guest' },
];

export class UserService {
  private logger: Logger;
  private cache = new Map<string, UserProfile>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async getAll(): Promise<User[]> {
    this.logger.info('Fetching all users');
    return USERS;
  }

  async getById(id: string): Promise<User | undefined> {
    this.logger.info(\`Fetching user \${id}\`);
    return USERS.find(u => u.id === id);
  }

  async getProfile(id: string): Promise<UserProfile | undefined> {
    if (this.cache.has(id)) {
      this.logger.info(\`Cache hit for user \${id}\`);
      return this.cache.get(id);
    }

    const user = await this.getById(id);
    if (!user) return undefined;

    const profile: UserProfile = {
      user,
      preferences: { theme: 'dark', language: 'en' },
      lastLogin: new Date(),
    };

    this.cache.set(id, profile);
    return profile;
  }
}
`,
    "src/utils/logger.ts": `export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  info(message: string): void {
    console.log(\`[\${this.context}] INFO: \${message}\`);
  }

  warn(message: string): void {
    console.warn(\`[\${this.context}] WARN: \${message}\`);
  }

  error(message: string, err?: unknown): void {
    console.error(\`[\${this.context}] ERROR: \${message}\`, err);
  }
}
`,
    "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
`,
    "package.json": `{
  "name": "ts-project",
  "version": "1.0.0",
  "type": "module"
}
`,
  },

  PATTERN_SERVICE: {
    "src/service.ts": `interface Observer {
  update(event: string, data: unknown): void;
}

class EventBus {
  private static instance: EventBus;
  private observers = new Map<string, Observer[]>();

  private constructor() {}

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  subscribe(event: string, observer: Observer): void {
    const list = this.observers.get(event) ?? [];
    list.push(observer);
    this.observers.set(event, list);
  }

  publish(event: string, data: unknown): void {
    const list = this.observers.get(event) ?? [];
    for (const obs of list) {
      obs.update(event, data);
    }
  }
}

interface DataStrategy {
  fetch(query: string): Promise<unknown>;
}

class ApiStrategy implements DataStrategy {
  async fetch(query: string): Promise<unknown> {
    return { source: 'api', query, data: [] };
  }
}

class CacheStrategy implements DataStrategy {
  private cache = new Map<string, unknown>();

  async fetch(query: string): Promise<unknown> {
    if (this.cache.has(query)) return this.cache.get(query);
    const result = { source: 'cache-miss', query };
    this.cache.set(query, result);
    return result;
  }
}

export class DataService {
  private strategy: DataStrategy;
  private bus = EventBus.getInstance();

  constructor(strategy: DataStrategy) {
    this.strategy = strategy;
  }

  setStrategy(strategy: DataStrategy): void {
    this.strategy = strategy;
  }

  async query(q: string): Promise<unknown> {
    const result = await this.strategy.fetch(q);
    this.bus.publish('query-complete', { query: q, result });
    return result;
  }
}

export { EventBus, ApiStrategy, CacheStrategy };
export type { Observer, DataStrategy };
`,
  },

  SECRET_PROJECT: {
    "src/app.js": `const config = require('./config');

function start() {
  console.log('Starting app on port', config.port);
}

module.exports = { start };
`,
    "src/config.js": `module.exports = {
  port: 3000,
  host: 'localhost',
};
`,
    ".env": `DATABASE_URL=postgres://admin:supersecretpassword123@db.internal.company.com:5432/production
API_KEY=sk-live-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
JWT_SECRET=my-ultra-secret-jwt-signing-key-do-not-share
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
BENCH_SECRET=__BENCH_SECRET__
`,
    "package.json": `{
  "name": "secret-project",
  "version": "1.0.0",
  "main": "src/app.js"
}
`,
  },

  EMPTY_PROJECT: {
    "README.md": "# Empty Project\n",
  },

  WRITE_TEST: {
    "README.md": "# Write Test\nThis project is used to test file creation.\n",
  },
} as const;

export type FixtureName = keyof typeof FIXTURES;
