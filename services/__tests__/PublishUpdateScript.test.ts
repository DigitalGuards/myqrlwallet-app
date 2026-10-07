import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(__dirname, '../../scripts/publish-update.sh');
const dirs: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

/** A repo with a bare origin, stub npm scripts and fake gpg/npx that log their calls. */
function makeRepo(opts: { failGate?: string } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'publish-update-'));
  dirs.push(base);
  const origin = join(base, 'origin.git');
  const repo = join(base, 'repo');
  const bin = join(base, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  git(base, 'init', '--bare', '-b', 'main', origin);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  const gates = ['lint', 'typecheck', 'test:ci', 'verify:embedded-web'];
  const scripts = Object.fromEntries(
    gates.map((g) => [g, g === opts.failGate ? 'exit 1' : 'true']),
  );
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', scripts }));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', 'origin', 'main');

  const calls = join(base, 'calls.log');
  writeFileSync(
    join(bin, 'gpg'),
    `#!/bin/sh\necho "gpg $*" >> "${calls}"\necho FAKE-KEY\n`,
  );
  writeFileSync(
    join(bin, 'eas'),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "eas-cli/\${FAKE_EAS_VERSION-21}.4.0 linux-x64 node-v22"; exit 0; fi\n` +
      `echo "eas $* env=$EXPO_PUBLIC_WEB_SOURCE/\${APP_VARIANT-unset}/$EAS_UPDATE_SKIP_ENVIRONMENT_CHECK/$EXPO_NO_DOTENV" >> "${calls}"\n` +
      `if [ -n "$FAKE_EAS_OUT" ]; then echo "$FAKE_EAS_OUT"; else echo '[{"group":"group-android"},{"group":"group-ios"}]'; fi\n`,
  );
  const realNpm = execFileSync('which', ['npm'], { encoding: 'utf8' }).trim();
  writeFileSync(
    join(bin, 'npm'),
    `#!/bin/sh\nif [ "$1" = "ci" ]; then echo "npm ci" >> "${calls}"; exit 0; fi\nexec "${realNpm}" "$@"\n`,
  );
  chmodSync(join(bin, 'eas'), 0o755);
  chmodSync(join(bin, 'npm'), 0o755);
  chmodSync(join(bin, 'gpg'), 0o755);
  return { repo, bin, calls };
}

function run(ctx: { repo: string; bin: string }, args: string[], env: Record<string, string> = {}) {
  const keyfile = join(ctx.repo, '..', 'key.gpg');
  writeFileSync(keyfile, 'encrypted');
  return spawnSync('bash', [script, ...args], {
    cwd: ctx.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${ctx.bin}:${process.env.PATH}`,
      UPDATE_SIGNING_KEY_GPG: keyfile,
      APP_VARIANT: 'embedded-dev',
      ...env,
    },
  });
}

function loggedCalls(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('scripts/publish-update.sh', () => {
  it('requires a channel and a message', () => {
    const ctx = makeRepo();
    expect(run(ctx, ['--message', 'm']).status).not.toBe(0);
    expect(run(ctx, ['--channel', 'production']).status).not.toBe(0);
    expect(run(ctx, ['--channel', 'staging', '--message', 'm']).status).not.toBe(0);
  });

  it('dry run passes the checks, prints the command and touches no key', () => {
    const ctx = makeRepo();
    const result = run(ctx, ['--channel', 'production', '--message', 'm', '--dry-run']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--channel production');
    expect(result.stdout).toContain('--private-key-path');
    expect(loggedCalls(ctx.calls)).not.toMatch(/gpg|eas /);
  });

  it('refuses a dirty tree', () => {
    const ctx = makeRepo();
    writeFileSync(join(ctx.repo, 'dirty.txt'), 'x');
    const result = run(ctx, ['--channel', 'preview', '--message', 'm', '--dry-run']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not clean');
  });

  it('refuses a HEAD that is not pushed', () => {
    const ctx = makeRepo();
    git(ctx.repo, 'commit', '--allow-empty', '-m', 'local only');
    const result = run(ctx, ['--channel', 'preview', '--message', 'm', '--dry-run']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not pushed');
  });

  it('refuses production from a branch other than main or dev', () => {
    const ctx = makeRepo();
    git(ctx.repo, 'checkout', '-b', 'feature');
    git(ctx.repo, 'push', 'origin', 'feature');
    const production = run(ctx, ['--channel', 'production', '--message', 'm', '--dry-run']);
    expect(production.status).not.toBe(0);
    expect(production.stderr).toContain('main or dev');
    expect(run(ctx, ['--channel', 'preview', '--message', 'm', '--dry-run']).status).toBe(0);
  });

  it('stops on a failing gate', () => {
    const ctx = makeRepo({ failGate: 'typecheck' });
    const result = run(ctx, ['--channel', 'preview', '--message', 'm']);
    expect(result.status).not.toBe(0);
    expect(loggedCalls(ctx.calls)).not.toMatch(/gpg|eas /);
  });

  it('publishes with the production bundle environment and reports the group id', () => {
    const ctx = makeRepo();
    const result = run(ctx, ['--channel', 'production', '--message', 'fix']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('published update group: group-android');
    expect(result.stdout).toContain('published update group: group-ios');
    expect(result.stdout + result.stderr).not.toContain('FAKE-KEY');
    const calls = readFileSync(ctx.calls, 'utf8');
    expect(calls).toContain('gpg --decrypt');
    expect(calls).toMatch(/eas update --channel production --message fix --clear-cache --non-interactive/);
    expect(calls).not.toContain('--environment');
    expect(calls.indexOf('npm ci')).toBeGreaterThanOrEqual(0);
    const keyPath = /--private-key-path (\S+)/.exec(calls)?.[1];
    expect(keyPath).toMatch(/^\//);
    expect(existsSync(keyPath as string)).toBe(false);
    expect(calls).toContain('env=embedded/unset/1/1');
  });

  it('refuses an eas-cli of another major version', () => {
    const ctx = makeRepo();
    const result = run(ctx, ['--channel', 'preview', '--message', 'm'], { FAKE_EAS_VERSION: '20' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('eas-cli 21.x');
    expect(loggedCalls(ctx.calls)).not.toContain('gpg');
  });
});
