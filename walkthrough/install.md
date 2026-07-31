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

## Scoop (Windows)

```bash
scoop bucket add patchloom https://github.com/patchloom/scoop-bucket
scoop install patchloom
```

## Chocolatey (Windows)

```bash
choco install patchloom
```

First listing on the community repository may wait on Chocolatey moderation.

## WinGet (Windows)

```bash
winget install Patchloom.Patchloom
```

Available after the community package PR is approved.

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
