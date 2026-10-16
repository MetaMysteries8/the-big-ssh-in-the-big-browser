// Trusted, build-time JavaScript configuration. This is not an untrusted-script sandbox.
// Credentials deliberately do not belong in this file.
export default {
  name: 'My workspace',
  connection: { host: '', port: 22, username: '' },
  startup: { connect: false, command: '' },
  terminal: { fontSize: 14, scrollback: 5000 },
};
