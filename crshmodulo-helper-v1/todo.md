- Configure stuff from vscode settings or with commands. (preferably config from settings and toggles from commands with defaults in settings).
- Make compatible with vscode.dev (web-extension-host) by checking if in web, if so use `vscode.workspace.fs` to find cslib else use current.
  Add the 'browser' entryPoint to package.json.
  Use webpack to package path-browserify package and select that for usage when running on web.
- Make async to speed stuff up.