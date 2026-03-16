# Remote Access Setup

Use this when you want to open T3 Code from another device (phone, tablet, another laptop).

## CLI ↔ Env option map

The T3 Code CLI accepts the following configuration options, available either as CLI flags or environment variables:

| CLI flag                | Env var                   | Notes                              |
| ----------------------- | ------------------------- | ---------------------------------- |
| `--mode <web\|desktop>` | `T3CODE_MODE`             | Runtime mode.                      |
| `--port <number>`       | `T3CODE_PORT`             | HTTP/WebSocket port.               |
| `--host <address>`      | `T3CODE_HOST`             | Bind interface/address.            |
| `--additional-hosts`    | `T3CODE_ADDITIONAL_HOSTS` | Extra bind interfaces.             |
| `--state-dir <path>`    | `T3CODE_STATE_DIR`        | State directory.                   |
| `--dev-url <url>`       | `VITE_DEV_SERVER_URL`     | Dev web URL redirect/proxy target. |
| `--no-browser`          | `T3CODE_NO_BROWSER`       | Disable auto-open browser.         |
| `--auth-token <token>`  | `T3CODE_AUTH_TOKEN`       | WebSocket auth token.              |

> TIP: Use the `--help` flag to see all available options and their descriptions.

## Security First

- Always set `--auth-token` before exposing the server outside localhost.
- Treat the token like a password.
- Prefer binding to trusted interfaces (LAN IP or Tailnet IP) instead of opening all interfaces unless needed.

## 1) Build + run server for remote access

Remote access should use the built web app (not local Vite redirect mode).

```bash
bun run build
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/server start -- --host 0.0.0.0 --port 3773 --auth-token "$TOKEN" --no-browser
```

Then open on your phone:

`http://<your-machine-ip>:3773`

Example:

`http://192.168.1.42:3773`

Notes:

- `--host 0.0.0.0` listens on all IPv4 interfaces.
- `--no-browser` prevents local auto-open, which is usually better for headless/remote sessions.
- Ensure your OS firewall allows inbound TCP on the selected port.
- Once the server is reachable, open T3 Code on any client, go to `Settings -> Server Connections`,
  save a profile, and connect to the remote URL from inside the app.

## 2) Tailnet / Tailscale access

If you use Tailscale, you can bind directly to your Tailnet address.

```bash
TAILNET_IP="$(tailscale ip -4)"
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/server start -- --host "$(tailscale ip -4)" --port 3773 --auth-token "$TOKEN" --no-browser
```

Open from any device in your tailnet:

`http://<tailnet-ip>:3773`

You can also bind `--host 0.0.0.0` and connect through the Tailnet IP, but binding directly to the Tailnet IP limits exposure.

## 3) Add the remote server inside the app

Both the browser app and the desktop app can switch between the local bundled server and saved
remote profiles.

Desktop remote access is disabled by default. Enable it from
`Settings -> Server Connections -> Remote access`.

When enabled, the desktop app:

- keeps its own local loopback listener for the app itself
- prefers one Tailscale IPv4 endpoint when available
- otherwise falls back to one private LAN IPv4 endpoint
- shows the exact `Server URL` and `Auth token` to copy into another T3 Code app
- probes `http://<selected-ip>:3773/api/healthz` so the UI can tell you whether the remote bind is
  actually reachable

Accepted profile inputs:

- `192.168.1.42:3773`
- `ws://192.168.1.42:3773`
- `wss://tailnet-host:3773`
- `http://192.168.1.42:3773`
- `https://tailnet-host`

The app normalizes these to a WebSocket root URL.

Recommended flow:

1. On the remote desktop app, enable `Settings -> Server Connections -> Remote access`.
2. Wait for the status to become `Reachable`.
3. Copy the shown `Server URL` and `Auth token`.
4. On the client app, go to `Settings -> Server Connections`.
5. Add a profile with the copied host or URL and the same token.
6. Press `Connect`.

If a remote host is reachable but missing a token, the app allows the connection but shows a
warning. For anything beyond localhost, use a token.

If `http://<tailnet-ip>:3773/api/healthz` times out from another machine, the problem is network
reachability or the macOS firewall, not websocket token auth. Allow incoming connections for
T3 Code and verify Tailscale is connected on both devices.
