# Contributing to Patchloom for VS Code

Thank you for considering contributing! This document covers the practical
steps for getting a change merged. For project conventions and architecture,
see [AGENTS.md](AGENTS.md).

## Quick start

```bash
git clone https://github.com/patchloom/patchloom-vscode.git
cd patchloom-vscode
npm install
npm run compile
npm test
```

**Requirements:** Node.js 20+ and VS Code 1.90+.

## Development workflow

1. Fork the repo and create a feature branch from `main`.
2. Make your changes.
3. Run `npm run check` before committing. This is the full CI gate:
   compile, unit tests, extension tests, and packaging.
4. Commit with a [DCO sign-off](#dco-sign-off).
5. Open a pull request against `main`.

### Useful scripts

| Script | Purpose |
|--------|---------|
| `npm run check` | Full CI gate (run before every commit) |
| `npm run compile` | Compile extension source |
| `npm run compile-tests` | Compile test source |
| `npm test` | Compile + run all tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:extension` | VS Code extension integration tests |
| `npm run package` | Package the `.vsix` |

### Running in VS Code

Open the repo in VS Code and press `F5` to launch the Extension Development
Host with the extension loaded for manual testing.

## Writing tests

- Unit tests go in `test/unit/` using `node:test`.
- VS Code integration tests go in `test/suite/` using `@vscode/test-electron`.
- Use dependency injection for I/O (file reads, shell commands) so unit tests
  stay fast and deterministic.
- Tests compile to `out-test/` via `tsconfig.test.json`.

## Coding standards

- TypeScript strict mode is enabled.
- No `any` types without justification.
- Pure helper functions with injected I/O for testability.
- Keep `extension.ts` thin; business logic lives in submodules.

## DCO sign-off

All commits must include a `Signed-off-by` line (Developer Certificate of
Origin). Use `git commit -s` to add it automatically.

This certifies that you wrote (or have the right to submit) the code under
the project's license terms. See [developercertificate.org](https://developercertificate.org/)
for details.

## Pull request guidelines

- One logical change per PR.
- Include tests for new functionality and bug fixes.
- Update documentation if your change affects user-facing behavior.
- CI must pass before requesting review.

## Reporting issues

Use [GitHub Issues](https://github.com/patchloom/patchloom-vscode/issues).
Include the output of `Patchloom: Show Status` and your VS Code version.

For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under
the same terms as the project: [MIT](LICENSE).
