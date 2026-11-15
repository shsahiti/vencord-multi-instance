# MultiInstance

A Vencord user plugin that lets you run multiple Discord instances at once, each logged into a different account.

## How it works

Discord only allows one running instance per user-data directory, and your login lives in that directory.
When Discord is started with `--vc-profile=<name>`, this plugin points that instance's user-data directory at
`%APPDATA%\DiscordProfiles\<name>\`, giving it its own lock and its own login. Without the flag, Discord behaves normally.

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

- Open the plugin's settings and list profile names (e.g. `alt1, alt2`), then click **Launch**.
- **Copy shortcut** gives a command you can use as a desktop shortcut target, e.g.
  `"%LOCALAPPDATA%\Discord\Update.exe" --processStart Discord.exe --process-start-args "--vc-profile=alt1"`
- Each instance's window title is prefixed with `[profile]` (toggleable).
- To remove a profile, close it and delete `%APPDATA%\DiscordProfiles\<name>`.
