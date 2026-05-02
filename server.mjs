import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createAppPaths, loadState, saveManagedConfig, saveState, sanitizeState } from "./backend/state-store.mjs";
import { renderConfig, validateState } from "./backend/config-renderer.mjs";
import {
  banIp,
  getHealth,
  getLiveStatus,
  reloadFail2ban,
  restartFail2banContainer,
  scanAvailableJails,
  tailLogs,
  unbanIp
} from "./backend/fail2ban.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

const appConfig = {
  port: Number(process.env.PORT ?? 8080),
  configDir: process.env.FAIL2BAN_CONFIG_DIR ?? "/data/fail2ban",
  containerName: process.env.FAIL2BAN_CONTAINER_NAME ?? "fail2ban",
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock",
  managedConfigName: process.env.MANAGED_CONFIG_NAME ?? "zz-fail2ban-studio.local",
  uiStateName: process.env.UI_STATE_NAME ?? "fail2ban-studio-state.json"
};

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function text(response, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType
  });
  response.end(payload);
}

async function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function staticContentType(filePath) {
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }

  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  return "text/html; charset=utf-8";
}

async function readPublicFile(filePath) {
  return readFile(path.join(publicDir, filePath));
}

async function buildState() {
  const availableJails = await scanAvailableJails(appConfig.configDir);
  const state = await loadState({
    configDir: appConfig.configDir,
    managedConfigName: appConfig.managedConfigName,
    uiStateName: appConfig.uiStateName,
    containerName: appConfig.containerName,
    dockerSocketPath: appConfig.dockerSocketPath,
    availableJails: availableJails.names
  });
  const paths = createAppPaths(appConfig.configDir, appConfig.managedConfigName, appConfig.uiStateName);
  const { health, containers, selectedContainerInspect } = await getHealth({
    configDir: appConfig.configDir,
    socketPath: appConfig.dockerSocketPath,
    containerName: state.setup.containerName,
    managedConfigPath: paths.managedConfigPath
  });
  const live = await getLiveStatus({
    socketPath: appConfig.dockerSocketPath,
    containerName: state.setup.containerName
  });

  return {
    app: {
      title: "Fail2ban Studio",
      version: "0.1.0",
      ...paths
    },
    state,
    health,
    live,
    containers,
    selectedContainerInspect: selectedContainerInspect
      ? {
          name: selectedContainerInspect.summary.name,
          image: selectedContainerInspect.summary.image,
          networkMode: selectedContainerInspect?.HostConfig?.NetworkMode ?? "",
          configMount: selectedContainerInspect?.Mounts?.find((mount) => mount.Destination === "/config") ?? null,
          mounts: selectedContainerInspect?.Mounts ?? []
        }
      : null,
    availableJails: availableJails.choices,
    generatedConfig: renderConfig(state)
  };
}

async function persistState(rawState) {
  const availableJails = await scanAvailableJails(appConfig.configDir);
  const fallbackState = await loadState({
    configDir: appConfig.configDir,
    managedConfigName: appConfig.managedConfigName,
    uiStateName: appConfig.uiStateName,
    containerName: appConfig.containerName,
    dockerSocketPath: appConfig.dockerSocketPath,
    availableJails: availableJails.names
  });
  const state = sanitizeState(rawState, fallbackState);
  const issues = validateState(state);

  if (issues.length > 0) {
    const error = new Error("Validation failed.");
    error.issues = issues;
    throw error;
  }

  const generatedConfig = renderConfig(state);
  await saveState(appConfig.configDir, appConfig.managedConfigName, appConfig.uiStateName, state);
  await saveManagedConfig(appConfig.configDir, appConfig.managedConfigName, generatedConfig);

  return {
    state,
    generatedConfig
  };
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/state") {
      json(response, 200, await buildState());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/logs") {
      const state = await loadState({
        configDir: appConfig.configDir,
        managedConfigName: appConfig.managedConfigName,
        uiStateName: appConfig.uiStateName,
        containerName: appConfig.containerName,
        dockerSocketPath: appConfig.dockerSocketPath,
        availableJails: (await scanAvailableJails(appConfig.configDir)).names
      });

      json(
        response,
        200,
        await tailLogs({
          socketPath: appConfig.dockerSocketPath,
          containerName: state.setup.containerName,
          lines: url.searchParams.get("lines") ?? "120"
        })
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/save") {
      const body = await parseBody(request);
      const saved = await persistState(body.state ?? body);
      json(response, 200, {
        ok: true,
        ...saved
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/apply") {
      const body = await parseBody(request);
      const saved = await persistState(body.state ?? body);
      const shouldReload = body.reload ?? saved.state.setup.autoReloadOnApply;
      let actionResult = "Configuration saved.";

      if (shouldReload) {
        actionResult = await reloadFail2ban(appConfig.dockerSocketPath, saved.state.setup.containerName);
      }

      json(response, 200, {
        ok: true,
        actionResult,
        ...saved
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/actions/reload") {
      const body = await parseBody(request);
      json(response, 200, {
        ok: true,
        message: await reloadFail2ban(appConfig.dockerSocketPath, body.containerName || appConfig.containerName)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/actions/restart") {
      const body = await parseBody(request);
      json(response, 200, {
        ok: true,
        message: await restartFail2banContainer(
          appConfig.dockerSocketPath,
          body.containerName || appConfig.containerName
        )
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/actions/ban") {
      const body = await parseBody(request);
      json(response, 200, {
        ok: true,
        message: await banIp(appConfig.dockerSocketPath, body.containerName, body.jail, body.ip)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/actions/unban") {
      const body = await parseBody(request);
      json(response, 200, {
        ok: true,
        message: await unbanIp(appConfig.dockerSocketPath, body.containerName, body.jail, body.ip)
      });
      return;
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      text(response, 200, await readPublicFile("index.html"), "text/html; charset=utf-8");
      return;
    }

    if (request.method === "GET") {
      const filePath = url.pathname.replace(/^\/+/, "");
      try {
        text(response, 200, await readPublicFile(filePath), staticContentType(filePath));
        return;
      } catch (error) {
        json(response, 404, { ok: false, message: "Not found." });
        return;
      }
    }

    json(response, 404, { ok: false, message: "Not found." });
  } catch (error) {
    json(response, error.issues ? 400 : 500, {
      ok: false,
      message: error.message,
      issues: error.issues ?? []
    });
  }
});

server.listen(appConfig.port, () => {
  console.log(`Fail2ban Studio listening on http://0.0.0.0:${appConfig.port}`);
});
