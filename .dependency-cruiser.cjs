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
      name: "controllers-do-not-depend-on-domain-entities",
      severity: "error",
      from: {
        path: "^packages/agents/src/.+/controllers/",
      },
      to: {
        path: "^packages/domain/entities/",
      },
    },
    {
      name: "controllers-do-not-depend-on-repositories",
      severity: "error",
      from: {
        path: "^packages/agents/src/.+/controllers/",
      },
      to: {
        path: "^packages/agents/src/repositories/",
      },
    },
    {
      name: "services-do-not-depend-on-repositories",
      severity: "error",
      from: {
        path: "^packages/agents/src/services/",
      },
      to: {
        path: "^packages/agents/src/repositories/",
      },
    },
    {
      name: "repositories-do-not-depend-on-controllers",
      severity: "error",
      from: {
        path: "^packages/agents/src/repositories/",
      },
      to: {
        path: "^packages/agents/src/.+/controllers/",
      },
    },
    {
      name: "repositories-do-not-depend-on-services",
      severity: "error",
      from: {
        path: "^packages/agents/src/repositories/",
      },
      to: {
        path: "^packages/agents/src/services/",
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
