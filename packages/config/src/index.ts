import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

export interface ProxyConfig {
  port: number;
}

export interface ConvAgentConfig {
  port: number;
}

export interface KbCurateAgentConfig {
  port: number;
}

export interface PlanningAgentConfig {
  port: number;
}

interface ThothConfig {
  proxy: ProxyConfig;
  convAgent: ConvAgentConfig;
  kbCurateAgent: KbCurateAgentConfig;
  planningAgent: PlanningAgentConfig;
}

let cachedConfig: ThothConfig | null = null;

function getThothConfig(): ThothConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configFile = process.env.CONFIG_FILE;

  if (!configFile) {
    throw new Error("CONFIG_FILE is required.");
  }

  const resolvedPath = resolve(process.cwd(), configFile);
  const rawConfig = readFileSync(resolvedPath, "utf8");
  const parsedConfig = parse(rawConfig);

  cachedConfig = parseConfig(parsedConfig);

  return cachedConfig;
}

export function getProxyConfig(): ProxyConfig {
  return getThothConfig().proxy;
}

export function getConvAgentConfig(): ConvAgentConfig {
  return getThothConfig().convAgent;
}

export function getKbCurateAgentConfig(): KbCurateAgentConfig {
  return getThothConfig().kbCurateAgent;
}

export function getPlanningAgentConfig(): PlanningAgentConfig {
  return getThothConfig().planningAgent;
}

function parseConfig(value: unknown): ThothConfig {
  const config = requireObject(value, "config");
  const proxy = requireObject(config.proxy, "proxy");
  const convAgent = requireObject(config.convAgent, "convAgent");
  const kbCurateAgent = requireObject(config.kbCurateAgent, "kbCurateAgent");
  const planningAgent = requireObject(config.planningAgent, "planningAgent");

  return {
    proxy: {
      port: requireNumber(proxy.port, "proxy.port"),
    },
    convAgent: {
      port: requireNumber(convAgent.port, "convAgent.port"),
    },
    kbCurateAgent: {
      port: requireNumber(kbCurateAgent.port, "kbCurateAgent.port"),
    },
    planningAgent: {
      port: requireNumber(planningAgent.port, "planningAgent.port"),
    },
  };
}

function requireObject(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }

  return value;
}
