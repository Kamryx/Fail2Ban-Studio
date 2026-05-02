import http from "node:http";

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function requestDocker({
  socketPath,
  method = "GET",
  path,
  body,
  headers = {}
}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const request = http.request(
      {
        socketPath,
        path,
        method,
        headers: {
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": payload.byteLength
              }
            : {}),
          ...headers
        }
      },
      async (response) => {
        try {
          const raw = await collectStream(response);
          const text = raw.toString("utf8");
          const ok = response.statusCode >= 200 && response.statusCode < 300;
          const contentType = response.headers["content-type"] ?? "";
          const parsed = contentType.includes("application/json") && text ? JSON.parse(text) : text;

          if (!ok) {
            const error = new Error(
              typeof parsed === "string" && parsed.trim()
                ? parsed.trim()
                : `Docker API request failed with ${response.statusCode}`
            );
            error.statusCode = response.statusCode;
            throw error;
          }

          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      }
    );

    request.on("error", reject);

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

function normalizeContainer(container) {
  const names = (container.Names ?? []).map((name) => name.replace(/^\//, ""));

  return {
    id: container.Id,
    image: container.Image,
    names,
    name: names[0] ?? container.Id.slice(0, 12),
    state: container.State,
    status: container.Status
  };
}

export async function dockerPing(socketPath) {
  return requestDocker({
    socketPath,
    path: "/_ping"
  });
}

export async function listContainers(socketPath) {
  const containers = await requestDocker({
    socketPath,
    path: "/containers/json?all=1"
  });

  return containers.map(normalizeContainer);
}

export async function inspectContainer(socketPath, containerId) {
  return requestDocker({
    socketPath,
    path: `/containers/${encodeURIComponent(containerId)}/json`
  });
}

export async function findContainer(socketPath, nameOrId) {
  const containers = await listContainers(socketPath);
  const exact = containers.find(
    (container) =>
      container.id === nameOrId ||
      container.name === nameOrId ||
      container.names.includes(nameOrId)
  );

  if (exact) {
    return exact;
  }

  const fuzzy = containers.find(
    (container) =>
      container.id.startsWith(nameOrId) ||
      container.names.some((name) => name.includes(nameOrId)) ||
      container.image.includes(nameOrId)
  );

  return fuzzy ?? null;
}

export async function restartContainer(socketPath, containerId) {
  await requestDocker({
    socketPath,
    method: "POST",
    path: `/containers/${encodeURIComponent(containerId)}/restart?t=10`
  });

  return { ok: true };
}

export async function execInContainer(socketPath, containerIdOrName, command) {
  const container = await findContainer(socketPath, containerIdOrName);

  if (!container) {
    throw new Error(`Could not find container "${containerIdOrName}".`);
  }

  if (container.state !== "running") {
    throw new Error(`Container "${container.name}" is not running.`);
  }

  const exec = await requestDocker({
    socketPath,
    method: "POST",
    path: `/containers/${encodeURIComponent(container.id)}/exec`,
    body: {
      AttachStderr: true,
      AttachStdout: true,
      Cmd: command,
      Tty: true
    }
  });

  const output = await requestDocker({
    socketPath,
    method: "POST",
    path: `/exec/${encodeURIComponent(exec.Id)}/start`,
    body: {
      Detach: false,
      Tty: true
    },
    headers: {
      Accept: "text/plain"
    }
  });

  return {
    container,
    output: typeof output === "string" ? output : JSON.stringify(output)
  };
}
