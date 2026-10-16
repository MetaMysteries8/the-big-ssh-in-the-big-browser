import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const env = { ...process.env, GOCACHE: join(root, '.bigssh/go-cache'), GOMODCACHE: join(root, '.bigssh/go-mod') };
function run(args, extra = {}) {
  const result = spawnSync('go', args, { cwd: root, env: { ...env, ...extra }, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`go ${args.join(' ')} failed.`);
}
const assets = join(root, '.bigssh/web-assets');
await mkdir(assets, { recursive: true });
await mkdir(join(root, 'dist/connector'), { recursive: true });
run(['build', '-trimpath', '-o', join(root, 'dist/connector', process.platform === 'win32' ? 'bigssh-connector.exe' : 'bigssh-connector'), './cmd/connector']);
run(['build', '-trimpath', '-o', join(assets, 'ssh.wasm'), './cmd/sshwasm'], { GOOS: 'js', GOARCH: 'wasm', CGO_ENABLED: '0' });
const goroot = spawnSync('go', ['env', 'GOROOT'], { env, encoding: 'utf8' }).stdout.trim();
await cp(join(goroot, 'lib/wasm/wasm_exec.js'), join(assets, 'wasm_exec.js'));
await cp(join(root, 'apps/web/engine-worker.js'), join(assets, 'engine-worker.js'));
await cp(join(root, 'apps/extension'), join(root, 'dist/extension'), { recursive: true });
await mkdir(join(root, 'dist/licenses'), { recursive: true });
for (const [source, name] of [
  [join(goroot, 'LICENSE'), 'GO-LICENSE'],
  [join(env.GOMODCACHE, 'golang.org/x/crypto@v0.58.0/LICENSE'), 'X-CRYPTO-LICENSE'],
  [join(env.GOMODCACHE, 'golang.org/x/sys@v0.49.0/LICENSE'), 'X-SYS-LICENSE'],
  [join(root, 'node_modules/@xterm/xterm/LICENSE'), 'XTERM-LICENSE'],
  [join(root, 'node_modules/@xterm/addon-fit/LICENSE'), 'XTERM-FIT-LICENSE'],
  [join(root, 'node_modules/@xterm/addon-web-links/LICENSE'), 'XTERM-WEB-LINKS-LICENSE'],
]) await cp(source, join(root, 'dist/licenses', name));
await build({ configFile: join(root, 'vite.config.js') });
const manifest = JSON.parse(await readFile(join(root, 'apps/extension/manifest.json'), 'utf8'));
await writeFile(join(root, 'dist/BUILD.json'), JSON.stringify({ version: '0.1.0', extensionVersion: manifest.version, components: ['web', 'connector', 'extension'] }, null, 2) + '\n');
console.log('Built dist/web, dist/extension, and dist/connector. No network service was deployed.');
