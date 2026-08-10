# Install the Patchloom CLI

Patchloom needs the CLI binary to work. Prefer channels that track
GitHub Releases promptly (same day as the tag).

## Managed Install (Recommended on all platforms)

Click **Install Patchloom** above to download and install the CLI
automatically. The extension handles download, checksum verification,
and installation from GitHub Releases.

To upgrade later, run **Patchloom: Update Patchloom** (managed install
only). That path always pulls the latest GitHub release.

## Scoop (preferred Windows PATH install)

```bash
scoop bucket add patchloom https://github.com/patchloom/scoop-bucket
scoop install patchloom
scoop update patchloom
```

Scoop tracks the project release bucket. Use it when you want the CLI on
`PATH` yourself. Avoid winget and Chocolatey for install or upgrade:
both lag GitHub Releases and often leave you on an old version.

## Homebrew (macOS / Linux)

```bash
brew install patchloom/tap/patchloom
brew upgrade patchloom
```

## npm

```bash
npm install -g patchloom
# or one-shot: npx patchloom --version
```

## Cargo

```bash
cargo install patchloom
```

## Shell Script

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/patchloom/patchloom/releases/latest/download/patchloom-installer.sh | sh
```

After installation, the status bar shows a green checkmark when the CLI
is detected.
