/*
 * MultiInstance - run several Discord instances side by side, each logged into a different account.
 *
 * How it works: Discord only allows one running instance per user-data directory (Electron's single
 * instance lock is keyed on it), and your login token lives in that directory too. When Discord is
 * started with `--vc-profile=<name>`, this file (which Vencord evaluates in the main process before
 * Discord's own code loads) points the user-data directory at a separate per-profile folder. That gives
 * the instance its own lock and its own login, while the default instance keeps working as before.
 *
 * This code runs regardless of whether the plugin is toggled on, but does nothing unless the flag is passed.
 */

import { spawn } from "child_process";
import { app, IpcMainInvokeEvent } from "electron";
import { mkdirSync } from "fs";
import { basename, join, relative } from "path";

const FLAG = "--vc-profile=";
const PROFILE_NAME = /^[\w-]{1,32}$/;

function profileRoot(name: string) {
    return join(app.getPath("appData"), "DiscordProfiles", name);
}

const currentProfile = (() => {
    const arg = process.argv.find(a => a.startsWith(FLAG));
    const name = arg?.slice(FLAG.length).replace(/^"|"$/g, "");
    return name && PROFILE_NAME.test(name) ? name : null;
})();

if (currentProfile) {
    const root = profileRoot(currentProfile);
    const isInsideRoot = (p: string) => !relative(root, p).startsWith("..");
    mkdirSync(root, { recursive: true });

    // Discord's bootstrap builds its user-data path from this env var when it is set
    process.env.DISCORD_USER_DATA_DIR = root;

    // Belt and braces: if Discord ignores the env var and sets userData itself, redirect it into the profile
    const originalSetPath = app.setPath.bind(app);
    app.setPath = (name, path) => {
        if (name === "userData" && !isInsideRoot(path))
            path = join(root, basename(path));
        return originalSetPath(name, path);
    };

    // Apply immediately so the single instance lock is taken on the profile's directory
    app.setPath("userData", join(root, basename(app.getPath("userData"))));
}

export function getCurrentProfile(_: IpcMainInvokeEvent) {
    return currentProfile;
}

export function launchProfile(_: IpcMainInvokeEvent, name: string) {
    name = name.trim();
    if (!PROFILE_NAME.test(name))
        return { ok: false, error: "Profile names may only contain letters, numbers, - and _ (max 32 chars)." };

    // Don't leak our own Electron/Discord env tweaks into the new instance
    const env = { ...process.env };
    delete env.DISCORD_USER_DATA_DIR;
    delete env.ELECTRON_RUN_AS_NODE;

    try {
        const child = spawn(process.execPath, [`${FLAG}${name}`], { detached: true, stdio: "ignore", env });
        child.unref();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

export function getShortcutInfo(_: IpcMainInvokeEvent, name: string) {
    if (process.platform === "win32") {
        // Discord.exe lives in app-<version>\, so point shortcuts at Update.exe to survive updates
        const updateExe = join(process.execPath, "..", "..", "Update.exe");
        return `"${updateExe}" --processStart Discord.exe --process-start-args "${FLAG}${name}"`;
    }
    return `"${process.execPath}" ${FLAG}${name}`;
}
