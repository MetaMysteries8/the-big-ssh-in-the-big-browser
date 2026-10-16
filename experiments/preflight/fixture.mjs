import { spawn, spawnSync } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { packets } from '../direct-tab/pcap.mjs';
import { inspectServer } from './ssh-observer.mjs';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function docker(args, includeStderr = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Docker failed: ${result.stderr}`);
  return (result.stdout + (includeStderr ? result.stderr : '')).trim();
}

export async function requireFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(2225, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}

export async function nativeProbe(data) {
  if (data.length > 16384) throw new Error('Synthetic request exceeds the local fixture bound.');
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port: 2225 });
    let seen = Buffer.alloc(0), finished = false, quiet;
    const timer = setTimeout(() => done('timeout'), 1800);
    function done(outcome, error) {
      if (finished) return; finished = true; clearTimeout(timer); clearTimeout(quiet); socket.destroy();
      resolve({ outcome, ...(error ? { error } : {}), bytesReceived: seen.length, ...inspectServer(seen) });
    }
    socket.once('connect', () => socket.write(data));
    socket.on('data', chunk => {
      if (seen.length + chunk.length > 65536) { done('capture-bound'); return; }
      seen = Buffer.concat([seen, chunk]);
      if (inspectServer(seen).messageTypes.includes(20)) { clearTimeout(quiet); quiet = setTimeout(() => done('kexinit'), 300); }
    });
    socket.once('error', error => done('socket-error', error.code));
    socket.once('close', () => done('closed'));
  });
}

export async function waitSSH() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = await nativeProbe(Buffer.from('SSH-2.0-BigSSH_Control\r\n'));
    if (result.banner?.startsWith('SSH-2.0-')) return result;
    await sleep(100);
  }
  throw new Error('Owned SSH fixture failed its identification/KEXINIT control.');
}

export async function observe(container) {
  const chunks = []; let size = 0, failure, closing = false;
  const process = spawn('docker', ['exec', '-i', container, 'tcpdump', '--immediate-mode', '-i', 'eth0', '-U', '-s', '4096', '-w', '-', 'tcp port 22'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.on('data', data => {
    if (size + data.length > 8 * 1024 * 1024) { failure = new Error('Owned capture exceeded 8 MiB.'); return; }
    chunks.push(data); size += data.length;
  });
  process.on('error', error => { failure = error; });
  process.on('exit', code => { if (!closing && code) failure = new Error(`Observer exited: ${code}`); });
  try {
    await new Promise((resolve, reject) => {
      let diagnostics = '';
      const timer = setTimeout(() => reject(new Error('Observer did not start: ' + diagnostics)), 5000);
      process.stderr.on('data', data => { diagnostics += data.toString(); if (diagnostics.includes('listening on eth0')) { clearTimeout(timer); resolve(); } });
      process.once('error', error => { clearTimeout(timer); reject(error); });
      process.once('exit', code => { clearTimeout(timer); reject(new Error(`Observer exited before readiness: ${code}`)); });
    });
  } catch (error) { closing = true; process.kill(); throw error; }
  return {
    packets() { if (failure) throw failure; return packets(Buffer.concat(chunks, size)); },
    raw() { return Buffer.concat(chunks, size); },
    stop() { closing = true; process.kill(); },
  };
}
