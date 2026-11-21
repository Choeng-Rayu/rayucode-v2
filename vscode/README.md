# Rayucode for VS Code

This preview connects the Rayucode sidebar to the RayuCode v2 Rust runtime. It supports streaming chat, stopping a turn, switching among sessions created by the extension in the current workspace, and restoring the selected session after a reload. The runtime handles model selection, credentials, and transcript storage.

## Start the preview

1. Install the RayuCode v2 CLI and sign in using the CLI.
2. On Linux, start the Harness API bridge in a terminal and leave it running:

   ```sh
   rayu --no-update api-bridge
   ```

3. Use **Extensions → Install from VSIX** in VS Code to install the preview.
4. Open a trusted local folder and choose **Rayucode** in the Activity Bar.

The extension uses the CLI's Harness socket by default. If you start the bridge with a custom `--api-socket`, set the same absolute path in the machine-scoped **Rayucode › Runtime: Socket Path** setting. Use **Reconnect** in the sidebar after changing it or restarting the bridge.

Sessions created in the sidebar are visible to the Rust CLI. The preview session picker shows sessions created by this extension in the current VS Code workspace. In a multi-root workspace, creating a session prompts you to choose its working folder.

File edits, shell tools, and MCP tools are disabled for preview turns. Use the CLI to manage accounts and credentials. Linux is the verified preview platform.

## Build from source

Use Node.js 22 or later from the repository root.

```sh
npm ci
npm run package:vscode
npm test --workspace @rayu-dev/rayucode-vscode
```

The VSIX is staged at `vscode/dist/rayucode-vscode-preview.vsix`. For an Extension Development Host, run:

```sh
code --extensionDevelopmentPath="$PWD/vscode/dist/extension" /path/to/workspace
```

See the [VS Code developer guide](../docs/PRODUCT_VSCODE_DEV.md) for the host and Webview boundary.
