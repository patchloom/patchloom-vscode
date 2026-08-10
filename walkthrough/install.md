# Install the Patchloom CLI

Patchloom needs the CLI binary to work. Choose one of these methods:

## Managed Install (Recommended)

Click **Install Patchloom** above to download and install the CLI
automatically. The extension handles download, checksum verification,
and installation.

## Homebrew

```bash
brew install patchloom/tap/patchloom
```

## npm

```bash
npm install -g patchloom
# or one-shot: npx patchloom --version
```

## Scoop (Windows, preferred)

```bash
scoop bucket add patchloom https://github.com/patchloom/scoop-bucket
scoop install patchloom
```

Scoop tracks GitHub Releases promptly. Prefer it when you manage Windows installs yourself.

## WinGet (Windows)

```bash
winget install Patchloom.Patchloom
```

After a new release, you may need `winget source update` before the package appears. Microsoft publish can lag the GitHub tag by a short window.

## Chocolatey (Windows)

```bash
choco install patchloom
```

Community moderation often lags Scoop and GitHub portable assets.

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
