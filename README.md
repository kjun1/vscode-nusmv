# NuSMV for VS Code (LiCRuM)

This personal fork of [LiamWalsh98/vscode-nusmv](https://github.com/LiamWalsh98/vscode-nusmv)
adds support for local model includes. It installs from a VSIX as
`licrum.vscode-nusmv`. See the [extension guide](langium-nusmv/README.md) for usage.

[現在使える機能と、次に検討する編集支援（日本語）](docs/features.md)

## Development

Run `npm ci` and `npm test` from [langium-nusmv/](langium-nusmv/).
The [extension tests](langium-nusmv/tests/extension/) cover the manifest and
runner; the [language tests](langium-nusmv/tests/language/) cover parsing,
diagnostics, and editor features. Shared NuSMV models live in
[tests/fixtures/](langium-nusmv/tests/fixtures/).
