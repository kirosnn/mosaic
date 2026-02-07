import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { FIXTURES, type FixtureName } from "./fixtures.js";

const BENCH_SECRET_PLACEHOLDER = "__BENCH_SECRET__";

export interface WorkspaceInfo {
  path: string;
  benchSecret: string;
}

export class WorkspaceManager {
  private activeDirs: string[] = [];

  create(fixtureName: FixtureName): WorkspaceInfo {
    const dir = join(tmpdir(), `mosaic-bench-${fixtureName}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const benchSecret = randomUUID();
    const fixture = FIXTURES[fixtureName];
    for (const [relativePath, content] of Object.entries(fixture)) {
      const filePath = join(dir, relativePath);
      const fileDir = join(filePath, "..");
      if (!existsSync(fileDir)) {
        mkdirSync(fileDir, { recursive: true });
      }
      const resolved = content.replaceAll(BENCH_SECRET_PLACEHOLDER, benchSecret);
      writeFileSync(filePath, resolved, "utf-8");
    }

    this.activeDirs.push(dir);
    return { path: dir, benchSecret };
  }

  cleanup(): void {
    for (const dir of this.activeDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    this.activeDirs = [];
  }
}
