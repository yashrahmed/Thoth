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
