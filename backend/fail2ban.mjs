import { access, readdir, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { describeJail, getKnownJailNames, listAvailableChoices } from "./presets.mjs";
import {
  dockerPing,
  execInContainer,
  findContainer,
  inspectContainer,
  listContainers,
  restartContainer
} from "./docker-api.mjs";

const SECTION_PATTERN = /^\s*\[([^\]]+)\]\s*$/gm;

function unique(values) {
  return [...new Set(values)];
}

function sortByName(items) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function parseSectionNames(text) {
  const matches = [];

  for (const match of text.matchAll(SECTION_PATTERN)) {
    const name = match[1].trim();

    if (!name || ["DEFAULT", "INCLUDES", "Init", "Definition"].includes(name)) {
      continue;
    }

    matches.push(name);
  }

  return matches;
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    return "";
  }
}

export async function scanAvailableJails(configDir) {
  const discovered = [];

  discovered.push(...parseSectionNames(await readOptionalFile(path.join(configDir, "jail.conf"))));
  discovered.push(...parseSectionNames(await readOptionalFile(path.join(configDir, "jail.local"))));

  try {
    const jailDirectory = path.join(configDir, "jail.d");
    const files = (await readdir(jailDirectory)).filter((name) => name.endsWith(".conf") || name.endsWith(".local"));

    for (const file of files) {
      discovered.push(...parseSectionNames(await readOptionalFile(path.join(jailDirectory, file))));
    }
  } catch (error) {
    // No jail.d directory yet is fine.
  }

  const names = unique([...getKnownJailNames(), ...discovered]).sort((left, right) => left.localeCompare(right));
  return {
    names,
    choices: listAvailableChoices(names)
  };
}

function parseJailList(output) {
  const jailLine = output.match(/Jail list:\s*(.*)$/m)?.[1] ?? "";
  return jailLine
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseSpaceSeparatedValues(raw) {
  return raw
    .trim()
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseJailStatus(name, output) {
  return {
    name,
    title: describeJail(name).title,
    currentlyFailed: Number(output.match(/Currently failed:\s*(\d+)/)?.[1] ?? 0),
    totalFailed: Number(output.match(/Total failed:\s*(\d+)/)?.[1] ?? 0),
    currentlyBanned: Number(output.match(/Currently banned:\s*(\d+)/)?.[1] ?? 0),
    totalBanned: Number(output.match(/Total banned:\s*(\d+)/)?.[1] ?? 0),
    bannedIps: parseSpaceSeparatedValues(output.match(/Banned IP list:\s*(.*)$/m)?.[1] ?? ""),
    fileList: parseSpaceSeparatedValues(output.match(/File list:\s*(.*)$/m)?.[1] ?? "")
  };
}

function capList(inspectData) {
  return unique(inspectData?.HostConfig?.CapAdd ?? []);
}

function configMount(inspectData) {
  return (inspectData?.Mounts ?? []).find((mount) => mount.Destination === "/config") ?? null;
}

export async function getDockerContext(socketPath, selectedContainerName) {
  const context = {
    socket: {
      ok: false,
      message: "Docker socket not available."
    },
    containers: [],
    selectedContainer: null
  };

  try {
    await dockerPing(socketPath);
    context.socket = {
      ok: true,
      message: "Docker socket reachable."
    };

    const containers = await listContainers(socketPath);
    context.containers = sortByName(containers);

    if (selectedContainerName) {
      const container = await findContainer(socketPath, selectedContainerName);

      if (container) {
        context.selectedContainer = {
          ...(await inspectContainer(socketPath, container.id)),
          summary: container
        };
      }
    }
  } catch (error) {
    context.socket = {
      ok: false,
      message: error.message
    };
  }

  return context;
}

export async function getHealth({ configDir, socketPath, containerName, managedConfigPath }) {
  const health = {
    configDir: {
      ok: false,
      path: configDir,
      message: "Config directory is not reachable."
    },
    managedConfig: {
      path: managedConfigPath,
      message: "Managed jail file will be written here."
    },
    dockerSocket: {
      ok: false,
      path: socketPath,
      message: "Docker socket unavailable."
    },
    container: {
      ok: false,
      name: containerName,
      running: false,
      networkMode: "",
      caps: [],
      configSource: ""
    }
  };

  try {
    await access(configDir, fsConstants.R_OK | fsConstants.W_OK);
    health.configDir = {
      ok: true,
      path: configDir,
      message: "Config mount is readable and writable."
    };
  } catch (error) {
    health.configDir.message = "Mount the Fail2ban config folder into this container and make it writable.";
  }

  const docker = await getDockerContext(socketPath, containerName);
  health.dockerSocket = {
    ok: docker.socket.ok,
    path: socketPath,
    message: docker.socket.message
  };

  if (docker.selectedContainer) {
    const inspectData = docker.selectedContainer;
    const mount = configMount(inspectData);
    const caps = capList(inspectData);

    health.container = {
      ok: true,
      name: inspectData.summary.name,
      running: inspectData.summary.state === "running",
      networkMode: inspectData?.HostConfig?.NetworkMode ?? "",
      caps,
      configSource: mount?.Source ?? "",
      message:
        inspectData.summary.state === "running"
          ? "Selected Fail2ban container is reachable."
          : "Selected container exists but is not running."
    };
  } else if (docker.socket.ok) {
    health.container.message = "Select the Fail2ban container to enable live actions and status.";
  }

  return {
    health,
    containers: docker.containers,
    selectedContainerInspect: docker.selectedContainer
  };
}

export async function getLiveStatus({ socketPath, containerName }) {
  if (!containerName) {
    return {
      ok: false,
      message: "No Fail2ban container is selected yet."
    };
  }

  try {
    const status = await execInContainer(socketPath, containerName, ["fail2ban-client", "status"]);
    const jailNames = parseJailList(status.output);
    const jails = [];

    for (const jailName of jailNames) {
      const details = await execInContainer(socketPath, containerName, ["fail2ban-client", "status", jailName]);
      jails.push(parseJailStatus(jailName, details.output));
    }

    return {
      ok: true,
      jailCount: jailNames.length,
      totalBanned: jails.reduce((sum, jail) => sum + jail.currentlyBanned, 0),
      jails
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message
    };
  }
}

export async function tailLogs({ socketPath, containerName, lines = 120 }) {
  const safeLines = Number.isFinite(Number(lines)) ? Math.max(20, Math.min(400, Number(lines))) : 120;

  try {
    const result = await execInContainer(socketPath, containerName, [
      "sh",
      "-lc",
      `tail -n ${safeLines} /config/log/fail2ban.log 2>/dev/null || tail -n ${safeLines} /var/log/fail2ban.log 2>/dev/null || tail -n ${safeLines} /config/fail2ban.log 2>/dev/null || echo "No fail2ban log file found inside the container."`
    ]);

    return {
      ok: true,
      lines: result.output.trim()
    };
  } catch (error) {
    return {
      ok: false,
      lines: "",
      message: error.message
    };
  }
}

export async function reloadFail2ban(socketPath, containerName) {
  const result = await execInContainer(socketPath, containerName, ["fail2ban-client", "reload"]);
  return result.output.trim();
}

export async function banIp(socketPath, containerName, jail, ip) {
  const result = await execInContainer(socketPath, containerName, ["fail2ban-client", "set", jail, "banip", ip]);
  return result.output.trim();
}

export async function unbanIp(socketPath, containerName, jail, ip) {
  const result = await execInContainer(socketPath, containerName, ["fail2ban-client", "set", jail, "unbanip", ip]);
  return result.output.trim();
}

export async function restartFail2banContainer(socketPath, containerName) {
  const container = await findContainer(socketPath, containerName);

  if (!container) {
    throw new Error(`Could not find container "${containerName}".`);
  }

  await restartContainer(socketPath, container.id);
  return `Restart requested for ${container.name}.`;
}
