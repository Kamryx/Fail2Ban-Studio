# Fail2ban Studio

Fail2ban Studio is a companion web UI for Docker-based Fail2ban setups, especially the common Unraid pattern where Fail2ban already lives in its own container.

It is designed for the exact problem you described:

- no hand-editing `jail.local`
- no memorizing `fail2ban-client` commands
- one place to see active jails, current bans, defaults, and logs
- a clean managed `jail.d` file instead of overwriting the image's shipped config

## What It Does

- Writes a dedicated managed file at `jail.d/zz-fail2ban-studio.local`
- Stores UI state separately in `ui/fail2ban-studio-state.json`
- Discovers common and image-provided jails from your mounted Fail2ban config
- Lets you tune global defaults like `ignoreip`, `bantime`, `findtime`, and `maxretry`
- Lets you enable, disable, and override jail settings without touching raw files
- Can reload Fail2ban, restart the container, ban IPs, and unban IPs when the Docker socket is mounted
- Shows live jail status and recent Fail2ban logs

## Compatibility Assumption

This project is built around the common Unraid-style Fail2ban container layout where:

- the Fail2ban container exposes a writable `/config`
- custom overrides are expected to live in `*.local` files

That matches the current LinuxServer Fail2ban documentation, which recommends putting customizations in `*.local` files rather than editing shipped `*.conf` files directly:

- [LinuxServer Fail2ban image docs](https://hub.docker.com/r/linuxserver/fail2ban)
- [LinuxServer configuration README](https://github.com/linuxserver/fail2ban-confs/blob/master/README.md)

If your Community Apps container uses a different image, the UI can still work as long as you mount the real Fail2ban config directory into this app and the target container has `fail2ban-client` available.

## Why This Is Safe

Fail2ban Studio does not overwrite `jail.conf`.

Instead it generates a dedicated local override file:

- `jail.d/zz-fail2ban-studio.local`

That keeps the app's changes isolated and easier to remove or inspect later.

## Unraid Setup

### Easiest Ongoing Workflow

Once the image is built and added in Unraid, everyday use is GUI-only:

1. Open the app in your browser.
2. Pick your existing Fail2ban container from the Setup tab.
3. Enable the jails you want.
4. Save and reload from the UI.

### Container Mappings You Want

For the Fail2ban Studio container:

- map the same host folder your Fail2ban container uses for `/config` to `/data/fail2ban`
- optionally map `/var/run/docker.sock` to `/var/run/docker.sock`
- expose port `8080`

If the Docker socket is not mounted:

- the app can still write config
- live status, ban/unban, reload, and restart buttons will be unavailable
- after saving, you can restart the Fail2ban container from the normal Unraid Docker page

### Typical Unraid Example

If your Fail2ban container already uses:

- `/mnt/user/appdata/fail2ban -> /config`

Then mount this in Fail2ban Studio as:

- `/mnt/user/appdata/fail2ban -> /data/fail2ban`

And optionally:

- `/var/run/docker.sock -> /var/run/docker.sock`

### Included Unraid Template

A starter Unraid template is included here:

- [unraid/fail2ban-studio.xml](/Users/kylem/Documents/New project/unraid/fail2ban-studio.xml)

You will want to replace the placeholder repository URLs with your own image location if you publish the image.


## Publish to GitHub Container Registry (GHCR)

This repo includes a GitHub Actions workflow at `.github/workflows/publish-image.yml` that automatically builds and publishes a Docker image to GHCR.

### One-time setup

1. Push this repository to GitHub.
2. In GitHub, open **Settings -> Actions -> General** and keep the default `GITHUB_TOKEN` permissions enabled for workflow runs.
3. Make sure your default branch is `main` (or update the workflow trigger).

### How publishing works

- Push to `main`: publishes `ghcr.io/<owner>/<repo>:latest` and `ghcr.io/<owner>/<repo>:sha-<shortsha>`
- Push a Git tag like `v1.0.0`: publishes a matching tag such as `ghcr.io/<owner>/<repo>:v1.0.0`
- Manual run: use **Actions -> Publish Docker image -> Run workflow**

### Use in Unraid

In Unraid **Docker -> Add Container**, set:

- **Repository:** `ghcr.io/<owner>/<repo>:latest`
- **Host Port -> Container Port:** `8098 -> 8080`
- **Config mount:** your Fail2ban `/config` host folder -> `/data/fail2ban`
- **Socket mount (optional):** `/var/run/docker.sock -> /var/run/docker.sock`
- **Env:** `FAIL2BAN_CONTAINER_NAME=<your-fail2ban-container-name>`

If your package visibility in GitHub is private, Unraid will need registry credentials to pull the image.

## Running It

### Local Docker Build

If you want to build it yourself:

```bash
docker build -t fail2ban-studio:latest .
```

Then add the container in Unraid using:

- image: `fail2ban-studio:latest`
- container port: `8080`
- config path: same host folder as your Fail2ban `/config`, mounted to `/data/fail2ban`
- optional socket path: `/var/run/docker.sock`
- env var: `FAIL2BAN_CONTAINER_NAME=fail2ban` or whatever your actual Fail2ban container is named

### Plain Node

This project intentionally has no third-party runtime dependencies.

You can run it with:

```bash
node server.mjs
```

Optional environment variables:

- `PORT`
- `FAIL2BAN_CONFIG_DIR`
- `FAIL2BAN_CONTAINER_NAME`
- `DOCKER_SOCKET_PATH`
- `MANAGED_CONFIG_NAME`
- `UI_STATE_NAME`

## Recommended First Configuration

For a typical Unraid setup:

1. Add your LAN subnet and your personal public IP to `ignoreip`.
2. Start with `sshd` if you expose SSH on the host.
3. Add `nginx-http-auth`, `nginx-badbots`, and `nginx-botsearch` if you run SWAG or another nginx-based reverse proxy.
4. Use `INPUT` for host services like SSH.
5. Use `DOCKER-USER` for Docker-exposed services and reverse proxies.

That chain guidance matches the LinuxServer Fail2ban documentation for host vs Docker traffic handling.

## Project Layout

- [server.mjs](/Users/kylem/Documents/New project/server.mjs)
- [backend/fail2ban.mjs](/Users/kylem/Documents/New project/backend/fail2ban.mjs)
- [backend/config-renderer.mjs](/Users/kylem/Documents/New project/backend/config-renderer.mjs)
- [public/app.js](/Users/kylem/Documents/New project/public/app.js)
- [public/styles.css](/Users/kylem/Documents/New project/public/styles.css)

## Good Next Step

If you want this to become truly one-click on your box, the best next move would be:

1. publish the image somewhere Unraid can pull it from
2. point the included Unraid template at that image

If you want, I can take this one step further and adapt it into either:

- a more production-ready published Docker image layout
- an Unraid-native plugin approach instead of a companion container
