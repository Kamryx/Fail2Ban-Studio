import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { COMMON_IGNORE_IPS, createStarterJails } from "./presets.mjs";

export function createAppPaths(configDir, managedConfigName, uiStateName) {
  return {
    configDir,
    managedConfigPath: path.join(configDir, "jail.d", managedConfigName),
    uiStatePath: path.join(configDir, "ui", uiStateName)
  };
}

export function defaultState({
  configDir,
  managedConfigName,
  uiStateName,
  containerName,
  dockerSocketPath,
  availableJails
}) {
  return {
    setup: {
      containerName,
      configDir,
      dockerSocketPath,
      managedConfigName,
      uiStateName,
      autoReloadOnApply: true
    },
    defaults: {
      ignoreip: COMMON_IGNORE_IPS,
      bantime: "1h",
      findtime: "10m",
      maxretry: "5",
      chain: "DOCKER-USER",
      action: "%(known/action)s",
      bantimeIncrement: true,
      bantimeMaxtime: "5w",
      bantimeFactor: "24"
    },
    jails: createStarterJails(availableJails),
    notes: ""
  };
}

function normalizeString(value, fallback = "") {
  return `${value ?? fallback}`.trim();
}

function normalizeList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((entry) => `${entry}`.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value === "true";
  }

  return fallback;
}

function normalizeJail(jail) {
  return {
    id: normalizeString(jail.id, crypto.randomUUID()),
    name: normalizeString(jail.name),
    source: normalizeString(jail.source, "preset") || "preset",
    enabled: normalizeBoolean(jail.enabled, false),
    target: normalizeString(jail.target, "docker") || "docker",
    chain: normalizeString(jail.chain, "DOCKER-USER"),
    action: normalizeString(jail.action, "%(known/action)s"),
    port: normalizeString(jail.port),
    filter: normalizeString(jail.filter),
    logpath: normalizeString(jail.logpath),
    backend: normalizeString(jail.backend),
    banaction: normalizeString(jail.banaction),
    mode: normalizeString(jail.mode),
    maxretry: normalizeString(jail.maxretry),
    findtime: normalizeString(jail.findtime),
    bantime: normalizeString(jail.bantime),
    notes: normalizeString(jail.notes)
  };
}

export function sanitizeState(rawState, fallbackState) {
  const setup = rawState?.setup ?? {};
  const defaults = rawState?.defaults ?? {};
  const fallbackSetup = fallbackState.setup;
  const fallbackDefaults = fallbackState.defaults;

  return {
    setup: {
      containerName: normalizeString(setup.containerName, fallbackSetup.containerName) || fallbackSetup.containerName,
      configDir: fallbackSetup.configDir,
      dockerSocketPath: fallbackSetup.dockerSocketPath,
      managedConfigName: fallbackSetup.managedConfigName,
      uiStateName: fallbackSetup.uiStateName,
      autoReloadOnApply: normalizeBoolean(setup.autoReloadOnApply, fallbackSetup.autoReloadOnApply)
    },
    defaults: {
      ignoreip: normalizeList(defaults.ignoreip, fallbackDefaults.ignoreip),
      bantime: normalizeString(defaults.bantime, fallbackDefaults.bantime) || fallbackDefaults.bantime,
      findtime: normalizeString(defaults.findtime, fallbackDefaults.findtime) || fallbackDefaults.findtime,
      maxretry: normalizeString(defaults.maxretry, fallbackDefaults.maxretry) || fallbackDefaults.maxretry,
      chain: normalizeString(defaults.chain, fallbackDefaults.chain) || fallbackDefaults.chain,
      action: normalizeString(defaults.action, fallbackDefaults.action) || fallbackDefaults.action,
      bantimeIncrement: normalizeBoolean(defaults.bantimeIncrement, fallbackDefaults.bantimeIncrement),
      bantimeMaxtime:
        normalizeString(defaults.bantimeMaxtime, fallbackDefaults.bantimeMaxtime) || fallbackDefaults.bantimeMaxtime,
      bantimeFactor:
        normalizeString(defaults.bantimeFactor, fallbackDefaults.bantimeFactor) || fallbackDefaults.bantimeFactor
    },
    jails: Array.isArray(rawState?.jails) ? rawState.jails.map(normalizeJail) : fallbackState.jails,
    notes: normalizeString(rawState?.notes)
  };
}

export async function loadState({
  configDir,
  managedConfigName,
  uiStateName,
  containerName,
  dockerSocketPath,
  availableJails
}) {
  const initial = defaultState({
    configDir,
    managedConfigName,
    uiStateName,
    containerName,
    dockerSocketPath,
    availableJails
  });
  const { uiStatePath } = createAppPaths(configDir, managedConfigName, uiStateName);

  try {
    const raw = await readFile(uiStatePath, "utf8");
    return sanitizeState(JSON.parse(raw), initial);
  } catch (error) {
    return initial;
  }
}

export async function saveState(configDir, managedConfigName, uiStateName, state) {
  const { uiStatePath } = createAppPaths(configDir, managedConfigName, uiStateName);
  await mkdir(path.dirname(uiStatePath), { recursive: true });
  await writeFile(uiStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function saveManagedConfig(configDir, managedConfigName, contents) {
  const { managedConfigPath } = createAppPaths(configDir, managedConfigName, "unused.json");
  await mkdir(path.dirname(managedConfigPath), { recursive: true });
  await writeFile(managedConfigPath, contents, "utf8");
}
