import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

type BumpKind = "patch" | "minor" | "major";

type Options = {
  version?: string;
  bump?: BumpKind;
  dryRun: boolean;
  noPublish: boolean;
  tag?: string;
};

const ignoredDirs = new Set([
  "node_modules",
  ".git",
  ".mosaic",
  ".claude",
  "nul",
]);

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, noPublish: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--version" || arg === "-v") {
      options.version = argv[++i];
      continue;
    }
    if (arg === "--bump") {
      const value = argv[++i] as BumpKind | undefined;
      if (!value || !["patch", "minor", "major"].includes(value)) {
        throw new Error("Invalid --bump value. Use patch, minor, or major.");
      }
      options.bump = value;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--no-publish") {
      options.noPublish = true;
      continue;
    }
    if (arg === "--tag") {
      options.tag = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function parseSemver(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(
      "Invalid version format. Use --version x.y.z or --bump with a base x.y.z.",
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function bumpVersion(version: string, bump: BumpKind): string {
  const [major, minor, patch] = parseSemver(version);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function listFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      await listFiles(fullPath, acc);
    } else if (entry.isFile()) {
      acc.push(fullPath);
    }
  }
  return acc;
}

async function replaceVersionInFiles(
  root: string,
  oldVersion: string,
  newVersion: string,
): Promise<string[]> {
  const files = await listFiles(root);
  const changed: string[] = [];
  for (const filePath of files) {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    if (!content.includes(oldVersion)) continue;
    if (content.includes("\u0000")) continue;
    const nextContent = content.split(oldVersion).join(newVersion);
    if (nextContent !== content) {
      await fs.writeFile(filePath, nextContent, "utf8");
      changed.push(path.relative(root, filePath));
    }
  }
  return changed;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: true });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkgPath = path.join(process.cwd(), "package.json");
  const pkgRaw = await fs.readFile(pkgPath, "utf8");
  const pkg = JSON.parse(pkgRaw) as { version?: string };
  const oldVersion = pkg.version;
  if (!oldVersion) {
    throw new Error("package.json has no version field.");
  }
  let newVersion = options.version;
  if (!newVersion && options.bump) {
    newVersion = bumpVersion(oldVersion, options.bump);
  }
  if (!newVersion) {
    throw new Error("Provide --version x.y.z or --bump patch|minor|major.");
  }
  if (newVersion === oldVersion) {
    throw new Error("New version is the same as the current version.");
  }

  const changed = await replaceVersionInFiles(
    process.cwd(),
    oldVersion,
    newVersion,
  );

  if (changed.length === 0) {
    throw new Error("No files updated. Old version was not found.");
  }

  if (!options.noPublish) {
    const args = ["publish"];
    if (options.tag) {
      args.push("--tag", options.tag);
    }
    if (options.dryRun) {
      args.push("--dry-run");
    }
    await run("npm", args);
  }

  process.stdout.write(
    `Version updated from ${oldVersion} to ${newVersion}.\n`,
  );
  process.stdout.write(`Files updated (${changed.length}):\n`);
  process.stdout.write(`${changed.join("\n")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});