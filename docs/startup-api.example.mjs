/**
 * DESIGN SKETCH ONLY. No runtime or SDK implements this API yet.
 *
 * Ordinary-tab edition: evaluate in the planned capability-restricted recipe VM.
 * IWA edition: executable hooks must be bundled at build time, not sideloaded.
 * Credentials are references, never embedded passwords or private keys.
 */
export default {
  schemaVersion: 1,
  name: "home-workspace",

  profiles: {
    home: {
      host: "server.example.com",
      port: 22,
      username: "your-user",
      credential: "vault:home-key",

      // Aspirational direct mode must fail honestly when unavailable.
      // Select a separately configured BYO relay explicitly for compatibility.
      transport: "ordinary-tab-direct",
      fallback: "none",
      hostKeyPolicy: "ask-first-use-reject-changes",
    },
  },

  permissions: {
    profiles: ["home"],
    actions: ["connect", "open-terminal", "remote-exec"],
    privateKeyExport: false,
  },

  startup: {
    layout: "single-terminal",
    connect: ["home"],
    reconnect: {
      enabled: true,
      maxAttempts: 4,
      initialDelayMs: 1000,
      maxDelayMs: 15000,
    },
  },

  hooks: {
    async onPtyReady(ctx, event) {
      if (event.profile !== "home") return;

      // Run only for the initial successful connection. Reconnect is distinct.
      if (event.connectionReason !== "initial") return;

      // This is an explicit remote shell action, authorized by this recipe.
      // A real implementation must preserve an "outcome unknown" state on loss
      // of connection and must not automatically replay the command.
      await ctx.remote.exec({
        sessionId: event.sessionId,
        shell: "posix",
        command: "uname -a",
        retry: "manual-if-outcome-unknown",
      });
    },
  },
};
