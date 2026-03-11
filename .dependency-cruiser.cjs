/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "domain-does-not-depend-on-adapters",
      severity: "error",
      from: {
        path: "^packages/domain/",
      },
      to: {
        path: "^packages/(agents|config|message-proxy|mobile|web)/",
      },
    },
    {
      name: "inbound-does-not-depend-on-domain",
      severity: "error",
      from: {
        path: "^packages/agents/src/.+/inbound/",
      },
      to: {
        path: "^packages/domain/entities/",
      },
    },
    {
      name: "inbound-does-not-depend-on-outbound",
      severity: "error",
      from: {
        path: "^packages/agents/src/.+/inbound/",
      },
      to: {
        path: "^packages/agents/src/.+/outbound/",
      },
    },
    {
      name: "application-does-not-depend-on-inbound",
      severity: "error",
      from: {
        path: "^packages/agents/src/.+/application/",
      },
      to: {
        path: "^packages/agents/src/.+/inbound/",
      },
    },
    {
      name: "application-does-not-depend-on-outbound",
      severity: "error",
      from: {
        path: "^packages/agents/src/.+/application/",
      },
      to: {
        path: "^packages/agents/src/.+/outbound/",
      },
    },
    {
      name: "outbound-does-not-depend-on-inbound",
      severity: "error",
      from: {
        path: "^packages/agents/src/.+/outbound/",
      },
      to: {
        path: "^packages/agents/src/.+/inbound/",
      },
    },
  ],
  options: {
    tsConfig: {
      fileName: "./tsconfig.json",
    },
    combinedDependencies: true,
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "\\.test\\.(ts|tsx)$",
    },
    includeOnly: "^packages",
  },
};
