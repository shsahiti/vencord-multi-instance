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
import { app, BrowserWindow, IpcMainInvokeEvent, session, shell } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";

const FLAG = "--vc-profile=";
// Opt out of low-memory mode for a profile (e.g. one you stream from)
const FULL_FLAG = "--vc-full";
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

    if (!process.argv.includes(FULL_FLAG)) applyLowMemoryMode();
}

/**
 * Every profile is a full extra Discord (browser + GPU + renderer processes), so trim what Chromium and V8
 * allocate. This has to run before the app is ready, which it does since this file loads before Discord's code.
 */
function applyLowMemoryMode() {
    // No GPU compositing: drops most of the GPU process's memory (screen share/video get a bit choppier)
    app.disableHardwareAcceleration();

    const sw = (name: string, value?: string) => app.commandLine.appendSwitch(name, value);
    // Chromium's low-RAM profile: smaller caches, more aggressive discarding
    sw("enable-low-end-device-mode");
    // Have V8 favour a small heap over speed and collect more eagerly
    sw("js-flags", "--optimize-for-size --memory-reducer");
    // Don't keep a warm spare renderer around, and share renderers instead of spawning new ones
    sw("disable-features", "SpareRendererForSitePerProcess,CalculateNativeWinOcclusion,HardwareMediaKeyHandling,MediaSessionService");
    sw("renderer-process-limit", "1");
    sw("process-per-site");
    // Unused in Discord but still spun up per instance
    sw("disable-speech-api");
    sw("disable-gpu-shader-disk-cache");
}

export function getCurrentProfile(_: IpcMainInvokeEvent) {
    return currentProfile;
}

function profileArgs(name: string, lowMemory: boolean) {
    return lowMemory ? [`${FLAG}${name}`] : [`${FLAG}${name}`, FULL_FLAG];
}

export function launchProfile(_: IpcMainInvokeEvent, name: string, lowMemory = true) {
    name = name.trim();
    if (!PROFILE_NAME.test(name))
        return { ok: false, error: "Profile names may only contain letters, numbers, - and _ (max 32 chars)." };

    // Don't leak our own Electron/Discord env tweaks into the new instance
    const env = { ...process.env };
    delete env.DISCORD_USER_DATA_DIR;
    delete env.ELECTRON_RUN_AS_NODE;

    try {
        const child = spawn(process.execPath, profileArgs(name, lowMemory), { detached: true, stdio: "ignore", env });
        child.unref();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

/*
 * Lightweight alternative to a second instance: open the account as a window inside THIS Discord, running the
 * Discord web client in its own isolated session (separate cookies/storage = separate login). It shares this
 * instance's main, GPU and network processes, so it only costs one extra renderer instead of a whole Discord.
 */
const accountWindows = new Map<string, BrowserWindow>();
const ALLOWED_PERMISSIONS = new Set(["notifications", "media", "clipboard-sanitized-write", "fullscreen", "display-capture"]);
const DISCORD_HOST = /^([\w-]+\.)?discord(app)?\.com$/;

function accountSession(name: string) {
    const ses = session.fromPartition(`persist:vc-account-${name}`);
    // Look like plain Chrome: with Electron's UA the web client assumes it's the desktop app and breaks
    ses.setUserAgent(app.userAgentFallback.replace(/\s(Electron|discord)\/\S+/gi, ""));
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
    return ses;
}

export function openAccountWindow(_: IpcMainInvokeEvent, name: string) {
    name = name.trim();
    if (!PROFILE_NAME.test(name))
        return { ok: false, error: "Profile names may only contain letters, numbers, - and _ (max 32 chars)." };

    const existing = accountWindows.get(name);
    if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) existing.restore();
        existing.focus();
        return { ok: true };
    }

    const title = `[${name}] Discord`;
    const win = new BrowserWindow({
        title,
        width: 1100,
        height: 750,
        autoHideMenuBar: true,
        backgroundColor: "#313338",
        webPreferences: {
            session: accountSession(name),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
            backgroundThrottling: true
        }
    });
    accountWindows.set(name, win);

    win.on("page-title-updated", e => {
        e.preventDefault();
        win.setTitle(`[${name}] ${win.webContents.getTitle()}`);
    });
    win.on("closed", () => accountWindows.delete(name));
    setupZoom(win, name);

    // Keep Discord links in the window, send everything else to the real browser
    const isDiscord = (url: string) => {
        try { return DISCORD_HOST.test(new URL(url).hostname); } catch { return false; }
    };
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isDiscord(url)) win.loadURL(url);
        else if (/^https?:/.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
        if (!isDiscord(url)) {
            e.preventDefault();
            if (/^https?:/.test(url)) shell.openExternal(url);
        }
    });

    win.loadURL("https://discord.com/app");
    return { ok: true };
}

/*
 * Zoom: the account window has no menu and none of Discord's desktop code, so nothing handles Ctrl +/-/0 or
 * Ctrl+scroll. Do it here and remember the level per profile.
 */
const ZOOM_MIN = -3, ZOOM_MAX = 5, ZOOM_STEP = 0.5;

function setupZoom(win: BrowserWindow, name: string) {
    const wc = win.webContents;
    const zoomFile = join(profileRoot(name), "zoom.json");
    let level = 0;
    try { level = Number(JSON.parse(readFileSync(zoomFile, "utf8")).level) || 0; } catch { }

    const apply = (next: number) => {
        level = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
        wc.setZoomLevel(level);
        try {
            mkdirSync(profileRoot(name), { recursive: true });
            writeFileSync(zoomFile, JSON.stringify({ level }));
        } catch { }
    };

    // Chromium resets zoom on navigation/reload, so reapply each time a page loads
    wc.on("did-finish-load", () => wc.setZoomLevel(level));

    wc.on("before-input-event", (e, input) => {
        if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
        if (input.key === "=" || input.key === "+") apply(level + ZOOM_STEP);
        else if (input.key === "-" || input.key === "_") apply(level - ZOOM_STEP);
        else if (input.key === "0") apply(0);
        else return;
        e.preventDefault();
    });

    // Ctrl + mouse wheel / trackpad pinch
    wc.on("zoom-changed", (_e, direction) => apply(level + (direction === "in" ? ZOOM_STEP : -ZOOM_STEP)));
}

export function getShortcutInfo(_: IpcMainInvokeEvent, name: string, lowMemory = true) {
    const args = profileArgs(name, lowMemory).join(" ");
    if (process.platform === "win32") {
        // Discord.exe lives in app-<version>\, so point shortcuts at Update.exe to survive updates
        const updateExe = join(process.execPath, "..", "..", "Update.exe");
        return `"${updateExe}" --processStart Discord.exe --process-start-args "${args}"`;
    }
    return `"${process.execPath}" ${args}`;
}
