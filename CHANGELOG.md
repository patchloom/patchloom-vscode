# Changelog

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
