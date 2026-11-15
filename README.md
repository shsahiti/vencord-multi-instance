# MultiInstance

A Vencord user plugin that lets you run multiple Discord instances at once, each logged into a different account.

## How it works

There are two ways to run another account:

### Open (account window, recommended)

Opens the account as a window inside the Discord you already have running. The window loads the Discord web
client (`discord.com/app`) in its own isolated session, so its cookies, storage and login are kept separate.
It shares the running Discord's main, GPU and network processes, so it only costs one extra renderer and uses
far less RAM than a second instance.

- Discord links stay in the window; other links open in your default browser.
- Zoom with Ctrl `+` / `-` / `0` or Ctrl + scroll. The level is remembered per profile.
- Because it's the web client, desktop-only features (e.g. game activity, some screen share and keybind
  features) aren't available. Use **New instance** if you need those.

### New instance (separate Discord)

Discord only allows one running instance per user-data directory, and your login lives in that directory.
When Discord is started with `--vc-profile=<name>`, this plugin points that instance's user-data directory at
`%APPDATA%\DiscordProfiles\<name>\`, giving it its own lock and its own login. Without the flag, Discord behaves normally.

New instances start in low-memory mode by default (no GPU acceleration, leaner Chromium/V8 settings). Turn off
**Low memory mode** in the plugin settings, or add `--vc-full` to a shortcut, to run one with full features.

An account window and a new instance for the same profile name keep **separate** logins.

## Install

User plugins must be built into Vencord from source:

```sh
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile
git clone https://github.com/shsahiti/vencord-multi-instance src/userplugins/multiInstance
pnpm build
pnpm inject
```

Restart Discord and enable **MultiInstance** in Settings → Vencord → Plugins.

## Usage

- Open the plugin's settings and list profile names (e.g. `alt1, alt2`).
- Click **Open** to open that account as a window inside this Discord, or **New instance** to start a
  separate Discord for it. Log into a different account in each.
- For a profile you don't want to keep in the list, type its name in the one-off box and click **Open** or **New instance**.
- **Copy shortcut** gives a command (for **New instance**) that you can use as a desktop shortcut target, e.g.
  `"%LOCALAPPDATA%\Discord\Update.exe" --processStart Discord.exe --process-start-args "--vc-profile=alt1"`
- Each window's title is prefixed with `[profile]` (toggleable for new instances).
- To remove a profile, close it, then delete `%APPDATA%\DiscordProfiles\<name>` (new instance login and saved zoom)
  and `%APPDATA%\discord\Partitions\vc-account-<name>` (account window login).
