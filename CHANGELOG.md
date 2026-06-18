# Changelog

## [0.0.4](https://github.com/patchloom/patchloom-vscode/compare/patchloom-v0.0.3...patchloom-v0.0.4) (2026-06-18)


### Features

* align extension with patchloom CLI v0.2.0 and improve docs ([#130](https://github.com/patchloom/patchloom-vscode/issues/130)) ([cb58a47](https://github.com/patchloom/patchloom-vscode/commit/cb58a474453dd427943b62519aba7af15e5e2790))


### Bug Fixes

* managed install archive extraction path mismatch + e2e MCP tests ([#136](https://github.com/patchloom/patchloom-vscode/issues/136)) ([1e946a0](https://github.com/patchloom/patchloom-vscode/commit/1e946a0332a2c1d3b5d04615e950c3b1e5609e05))

## [0.0.3](https://github.com/patchloom/patchloom-vscode/compare/patchloom-v0.0.2...patchloom-v0.0.3) (2026-06-07)


### Features

* expand Quick Actions with markdown, doc mutations, and undo ([#117](https://github.com/patchloom/patchloom-vscode/issues/117)) ([3be2018](https://github.com/patchloom/patchloom-vscode/commit/3be20184f5cb96984d6237b325c352b5fd64b2d9)), closes [#114](https://github.com/patchloom/patchloom-vscode/issues/114) [#115](https://github.com/patchloom/patchloom-vscode/issues/115) [#116](https://github.com/patchloom/patchloom-vscode/issues/116)
* expose remaining medium-priority CLI commands as Quick Actions ([#122](https://github.com/patchloom/patchloom-vscode/issues/122)) ([cf652a2](https://github.com/patchloom/patchloom-vscode/commit/cf652a28ba2144dcf3b7b1f30c5242616126f6e9)), closes [#120](https://github.com/patchloom/patchloom-vscode/issues/120)


### Bug Fixes

* exclude .patchloom/ from git tracking and VSIX package ([#121](https://github.com/patchloom/patchloom-vscode/issues/121)) ([84060fb](https://github.com/patchloom/patchloom-vscode/commit/84060fbe4837abee18e8e149e2090a7f1faaccc7)), closes [#119](https://github.com/patchloom/patchloom-vscode/issues/119)

## [0.0.2](https://github.com/patchloom/patchloom-vscode/compare/patchloom-v0.0.1...patchloom-v0.0.2) (2026-06-07)


### Features

* add dynamic code coverage badge ([#87](https://github.com/patchloom/patchloom-vscode/issues/87)) ([73c7231](https://github.com/patchloom/patchloom-vscode/commit/73c72311f655611408846d4f8a031280b5fa3c95))
* cache VS Code Marketplace version badge via Gist ([#88](https://github.com/patchloom/patchloom-vscode/issues/88)) ([e24a3cc](https://github.com/patchloom/patchloom-vscode/commit/e24a3ccfeff67fee5dff3d31625a20cafb747a99))
* managed install fix + 10 competitive gap improvements ([#113](https://github.com/patchloom/patchloom-vscode/issues/113)) ([ea7fcfc](https://github.com/patchloom/patchloom-vscode/commit/ea7fcfc2425fb52f79bff2a9f256f466e0f281a3))
* MCP-aware status bar, per-editor breakdown, verify command ([#94](https://github.com/patchloom/patchloom-vscode/issues/94)) ([21fb8e8](https://github.com/patchloom/patchloom-vscode/commit/21fb8e85fcb0e292e24fbba23946a5f72858d845))
* use GitHub App token for release-please identity separation ([#89](https://github.com/patchloom/patchloom-vscode/issues/89)) ([dfb58f1](https://github.com/patchloom/patchloom-vscode/commit/dfb58f12c933d96e6c567baad9b592867e01be90)), closes [#77](https://github.com/patchloom/patchloom-vscode/issues/77)


### Bug Fixes

* align release tag format and batch template with patchloom CLI ([#98](https://github.com/patchloom/patchloom-vscode/issues/98)) ([623f60f](https://github.com/patchloom/patchloom-vscode/commit/623f60f402ce54662b597bf21fba87ca876bcdf8)), closes [#97](https://github.com/patchloom/patchloom-vscode/issues/97)
* migrate app-id to client-id in workflow app tokens ([#92](https://github.com/patchloom/patchloom-vscode/issues/92)) ([68b9fc8](https://github.com/patchloom/patchloom-vscode/commit/68b9fc85ef737b389ddbde5db8bcdb67762be876))
* replace retired shields.io Marketplace badges ([#82](https://github.com/patchloom/patchloom-vscode/issues/82)) ([00257de](https://github.com/patchloom/patchloom-vscode/commit/00257de684a68aeb814f8035a8173040a2c5781b))
* resolve CodeQL and AI code quality findings ([#100](https://github.com/patchloom/patchloom-vscode/issues/100)) ([6cf1a64](https://github.com/patchloom/patchloom-vscode/commit/6cf1a643a60f9ad5582c5bdcad37fe4ffe4dd83e))
* skip auto-merge for release PRs ([#90](https://github.com/patchloom/patchloom-vscode/issues/90)) ([6613770](https://github.com/patchloom/patchloom-vscode/commit/6613770bdda40007712eb81c951c96ae61759764))
* trim README badges to 7 dynamic essentials ([#83](https://github.com/patchloom/patchloom-vscode/issues/83)) ([8e20298](https://github.com/patchloom/patchloom-vscode/commit/8e20298d410ea28b1ac550336c9d9569967b0eed))
* update MCP test to use newline-delimited JSON-RPC ([#102](https://github.com/patchloom/patchloom-vscode/issues/102)) ([eda9e6b](https://github.com/patchloom/patchloom-vscode/commit/eda9e6ba591b03df848d4abf5f3ff0215e89cae8)), closes [#101](https://github.com/patchloom/patchloom-vscode/issues/101)
* update release URL tag format and README for patchloom v0.1.4 ([#99](https://github.com/patchloom/patchloom-vscode/issues/99)) ([f69d011](https://github.com/patchloom/patchloom-vscode/commit/f69d011fae71493eb4cf9f4979c8aa4156ac3976))
* use App token for auto-merge to unblock post-merge events ([#91](https://github.com/patchloom/patchloom-vscode/issues/91)) ([4ed6802](https://github.com/patchloom/patchloom-vscode/commit/4ed6802fc70c08e734fb58cc5c62af652ae96554))

## [0.0.1](https://github.com/patchloom/patchloom-vscode/compare/patchloom-v0.0.0...patchloom-v0.0.1) (2026-06-05)


### Features

* add output channel, search/create/doc-get actions, and batch apply ([e451e03](https://github.com/patchloom/patchloom-vscode/commit/e451e03d1d20cd57dd927acd5c26847673f74bf6)), closes [#27](https://github.com/patchloom/patchloom-vscode/issues/27) [#28](https://github.com/patchloom/patchloom-vscode/issues/28) [#29](https://github.com/patchloom/patchloom-vscode/issues/29)
* implement managed Patchloom binary install, update, and reinstall ([d272511](https://github.com/patchloom/patchloom-vscode/commit/d27251104baf73649e82a7f8ea080826913cdc97)), closes [#9](https://github.com/patchloom/patchloom-vscode/issues/9)
* log CLI invocation details in generateAgentRules ([9d0095a](https://github.com/patchloom/patchloom-vscode/commit/9d0095a4c06095797b8ba139a2b3a5c3ccfd1ff9))


### Bug Fixes

* add missing .js extension to re-export in showStatus ([2764301](https://github.com/patchloom/patchloom-vscode/commit/276430183ff2a93ed49015c5d793c9b5ef01dfbf))
* **ci:** exclude private patchloom URLs from lychee ([0277fb2](https://github.com/patchloom/patchloom-vscode/commit/0277fb23e402831cfc83c4a498c3cacdca2bdbd0))
* **ci:** fix lychee config syntax and FOSSA job gate ([a86c8c8](https://github.com/patchloom/patchloom-vscode/commit/a86c8c87d7d1097f96c571e8bc69356a85f551d4))
* **ci:** use self-hosted runner for unit tests (private repo) ([29e343c](https://github.com/patchloom/patchloom-vscode/commit/29e343c9e8e3d2106a07b9e66317bcc27a81d782))
* correct release-please-action SHA pin ([#68](https://github.com/patchloom/patchloom-vscode/issues/68)) ([de77c2f](https://github.com/patchloom/patchloom-vscode/commit/de77c2f46be8a600dc0461b3ca58149f0904d452))
* harden managed install download and cleanup ([54b061c](https://github.com/patchloom/patchloom-vscode/commit/54b061c7bdb516e879f558a28c25d70445b12bc3))
* include workspace name and log errors in generateAgentRules ([b194ce4](https://github.com/patchloom/patchloom-vscode/commit/b194ce43afff2c9321985df71c5f87b58a0cdfbc)), closes [#38](https://github.com/patchloom/patchloom-vscode/issues/38)
* make all unit tests cross-platform for Windows ([#39](https://github.com/patchloom/patchloom-vscode/issues/39)) ([2d82279](https://github.com/patchloom/patchloom-vscode/commit/2d8227986c25000195dbd445c460fddcfc73ca7e))
* make dedup test platform-aware for Windows PATHEXT ([cf8512d](https://github.com/patchloom/patchloom-vscode/commit/cf8512dd7076a42ccc22601c2c51930bd30111f0))
* patch test VS Code after download to suppress macOS windows ([7549763](https://github.com/patchloom/patchloom-vscode/commit/7549763963f24e158ba232a2391d92088d6eda32))
* re-sign VS Code app bundle after LSUIElement patch ([c010b30](https://github.com/patchloom/patchloom-vscode/commit/c010b30698de4d85d2a50e90ccab864c1f9319f3))
* remove placeholder screenshots from README ([#66](https://github.com/patchloom/patchloom-vscode/issues/66)) ([b29bbce](https://github.com/patchloom/patchloom-vscode/commit/b29bbce95e70535dd48e7d1b8b04cadb44d64279))
* resolve code quality alerts and improve Scorecard ([#54](https://github.com/patchloom/patchloom-vscode/issues/54)) ([cf5aeb0](https://github.com/patchloom/patchloom-vscode/commit/cf5aeb0896f64f1bf24ccb730de238887cb2b4d2))
* resolve npm audit vulnerabilities via overrides ([c3801a9](https://github.com/patchloom/patchloom-vscode/commit/c3801a91b30a84578473aa8cc64afaf62dc771d9)), closes [#37](https://github.com/patchloom/patchloom-vscode/issues/37)
* revert cross-platform CI matrix and use self-hosted for security ([93d21a2](https://github.com/patchloom/patchloom-vscode/commit/93d21a2b8dbbe21dd40a5445587c1ade3a19bddc))
* update integration test for 12 registered commands ([b58f606](https://github.com/patchloom/patchloom-vscode/commit/b58f6068333ee86a1e27e2bdb923f360879dce79))
* update integration test to expect 9 commands ([7e5b78e](https://github.com/patchloom/patchloom-vscode/commit/7e5b78e2d647d5b7ceae1ea5b2d4e5c1be8a35f6))
* validate create action path stays inside workspace folder ([d107a3b](https://github.com/patchloom/patchloom-vscode/commit/d107a3bbacca0f816ccb5d8714f746788c95797d))
