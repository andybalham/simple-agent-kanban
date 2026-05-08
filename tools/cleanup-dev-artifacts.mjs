import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pidPath = resolve(workspaceRoot, '.dev-server.pid');
const defaultRegistryPath = resolve(workspaceRoot, 'local-agent-kanban-registry.sqlite');
const defaultPorts = [4000, 5173];

const args = parseArgs(process.argv.slice(2));
const registryPath = resolve(workspaceRoot, args.registry ?? defaultRegistryPath);
const ports = args.skipPorts ? [] : defaultPorts;

/**
 * Dev cleanup is intentionally a small operational script, not application
 * behavior. It exists because Windows keeps SQLite files locked while the Node
 * API process is alive. Killing the whole dev process tree before deleting the
 * generated registry makes cleanup repeatable instead of a manual process hunt.
 */
main();

function main() {
  stopRecordedDevProcess();
  stopPortOwners(ports);

  removeSqliteFamily(registryPath);
  removeFile(pidPath);
  removeFile(resolve(workspaceRoot, 'dev-server.out.log'));
  removeFile(resolve(workspaceRoot, 'dev-server.err.log'));

  for (const repoPath of args.repos) {
    removeSmokeRepo(repoPath);
  }
}

function stopRecordedDevProcess() {
  if (!existsSync(pidPath)) {
    return;
  }

  const rawPid = readFileSync(pidPath, 'utf8').trim();
  const pid = Number(rawPid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  killProcessTree(pid);
}

function stopPortOwners(portsToStop) {
  for (const port of portsToStop) {
    for (const pid of listeningPidsForPort(port)) {
      killProcessTree(pid);
    }
  }
}

function listeningPidsForPort(port) {
  if (process.platform === 'win32') {
    const output = runOptional('netstat', ['-ano', '-p', 'tcp']);
    return unique(
      output
        .split(/\r?\n/)
        .filter((line) => line.includes(`:${port}`) && line.toUpperCase().includes('LISTENING'))
        .map((line) => Number(line.trim().split(/\s+/).at(-1)))
        .filter((pid) => Number.isInteger(pid) && pid > 0),
    );
  }

  const output = runOptional('lsof', ['-ti', `tcp:${port}`]);
  return unique(
    output
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  );
}

function killProcessTree(pid) {
  if (pid === process.pid) {
    return;
  }

  if (process.platform === 'win32') {
    runOptional('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }

  runOptional('kill', ['-TERM', String(pid)]);
}

function removeSqliteFamily(sqlitePath) {
  // SQLite can create sidecar files depending on journaling mode. Removing the
  // family prevents a later smoke run from inheriting stale WAL/SHM state.
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    removeFile(`${sqlitePath}${suffix}`);
  }
}

function removeSmokeRepo(repoPath) {
  const target = resolve(repoPath);
  const projectDb = resolve(target, '.local-agent-kanban', 'project.sqlite');
  const isTempKanbanRepo = target.startsWith(resolve('C:/tmp')) && target.includes('local-agent-kanban');
  if (!isTempKanbanRepo || !existsSync(projectDb)) {
    throw new Error(`Refusing to remove repo path outside the expected temp smoke shape: ${target}`);
  }

  rmSync(target, { force: true, recursive: true });
}

function removeFile(path) {
  rmSync(path, { force: true });
}

function runOptional(command, commandArgs) {
  try {
    return execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function unique(values) {
  return [...new Set(values)];
}

function parseArgs(rawArgs) {
  const parsed = { registry: undefined, repos: [], skipPorts: false };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--registry') {
      parsed.registry = rawArgs[++index];
      continue;
    }
    if (arg === '--repo') {
      parsed.repos.push(rawArgs[++index]);
      continue;
    }
    if (arg === '--skip-ports') {
      parsed.skipPorts = true;
      continue;
    }
    throw new Error(`Unknown cleanup argument: ${arg}`);
  }

  return parsed;
}
