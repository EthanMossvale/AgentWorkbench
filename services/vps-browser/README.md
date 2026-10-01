# Remote browser integration

Adapted with the owner's explicit request from `<private-reference>/remote-browser`:
`remote_browser.py` and `configure_browser_root.py`. These are user-owned
scripts, not imported third-party source. Browser profiles and the existing
`jp-browser` installation are reused. Their credentials never leave the VPS.

One interactive SSH channel supervises the native Claude login. A separate
restricted loopback SSH forward exposes the existing noVNC viewer. The viewer
shows the remote browser; it does not perform local OAuth authentication.
The renderer only receives a loopback viewer URL and public lifecycle status.
Native authorization URLs remain remote. A fallback authorization code is
forwarded once to the native PTY, never persisted or sent to translation.

The browser supervisor holds the original profile-manager lock. It refuses to
take over an already-running Chrome and preserves pre-existing display/bridge
processes. EOF, heartbeat expiry, cancellation and the absolute deadline close
only processes created by the login flow, checking PID birth identity. Profile
deletion refuses a running browser and explicitly requires the selected key.

CLI authentication is verified with the native runtime's public status API.
Successful web navigation alone is not a login receipt. Browser cleanup and
native CLI cleanup are reported separately from authentication success.
