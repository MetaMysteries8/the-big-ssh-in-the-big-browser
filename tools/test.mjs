import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const env = { ...process.env, GOCACHE: join(root, '.bigssh/go-cache'), GOMODCACHE: join(root, '.bigssh/go-mod'), BIGSSH_TEST_LOOPBACK_ONLY: '1' };
for (const [command, args] of [['go', ['test', './internal/...', './experiments/preflight/native-control']], ['node', ['--test', 'tests/policy.test.mjs', 'tests/pcap.test.mjs', 'tests/ssh-observer.test.mjs']]]) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
