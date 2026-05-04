import { cpSync, existsSync, rmSync, statSync, type Stats } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const bundleRoot = join(projectRoot, "src-tauri", "target");
const applicationsDir = resolve(process.env.APPLICATIONS_DIR ?? "/Applications");
const appName = "YouTube AI Brief.app";
const legacyAppNames = ["YouTube Transcript Exporter.app"];

const appPath = findBuiltApp(bundleRoot, appName);
const destinationPath = join(applicationsDir, basename(appPath));

if (!destinationPath.startsWith(`${applicationsDir}/`)) {
  throw new Error(`Refusing to copy outside of ${applicationsDir}: ${destinationPath}`);
}

if (existsSync(destinationPath)) {
  rmSync(destinationPath, { force: true, recursive: true });
}

cpSync(appPath, destinationPath, { recursive: true });

for (const legacyAppName of legacyAppNames) {
  const legacyPath = join(applicationsDir, legacyAppName);
  if (legacyPath !== destinationPath && existsSync(legacyPath)) {
    rmSync(legacyPath, { force: true, recursive: true });
    console.log(`Removed legacy app ${legacyPath}`);
  }
}

console.log(`Installed ${appPath}`);
console.log(`Copied to ${destinationPath}`);

function findBuiltApp(root: string, name: string) {
  const candidates = [
    join(root, "release", "bundle", "macos", name),
    ...findApps(root, name)
  ].filter((path, index, paths) => paths.indexOf(path) === index && existsSync(path));

  if (candidates.length === 0) {
    throw new Error(`Built app was not found. Run "bun run package" first.`);
  }

  return candidates.sort((left, right) => {
    return (safeStat(right)?.mtimeMs ?? 0) - (safeStat(left)?.mtimeMs ?? 0);
  })[0];
}

function findApps(root: string, name: string) {
  if (!existsSync(root)) {
    return [];
  }

  const found: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    const stats = safeStat(current);
    if (!stats?.isDirectory()) {
      continue;
    }

    if (basename(current) === name) {
      found.push(current);
      continue;
    }

    const entries = scanDirectoryEntries(current);
    for (const entry of entries) {
      pending.push(join(current, entry));
    }
  }

  return found;
}

function safeStat(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function scanDirectoryEntries(path: string) {
  try {
    return Array.from(new Bun.Glob("*").scanSync({ cwd: path, onlyFiles: false }));
  } catch {
    return [];
  }
}
