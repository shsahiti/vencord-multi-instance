/*
 * MultiInstance - run several Discord instances side by side, each logged into a different account.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { copyToClipboard } from "@utils/clipboard";
import { showToast, TextInput, useEffect, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.MultiInstance as PluginNative<typeof import("./native")>;

function parseProfiles(value: string) {
    return value.split(",").map(p => p.trim()).filter(Boolean);
}

async function launch(name: string) {
    const res = await Native.launchProfile(name);
    if (res.ok) showToast({ text: `Launching profile "${name}"...`, variant: "success" });
    else showToast({ text: res.error ?? "Failed to launch", variant: "critical" });
}

async function copyShortcut(name: string) {
    await copyToClipboard(await Native.getShortcutInfo(name));
    showToast({ text: "Shortcut command copied", variant: "success" });
}

function ProfileLauncher() {
    const { profiles } = settings.use(["profiles"]);
    const [current, setCurrent] = useState<string | null>(null);
    const [custom, setCustom] = useState("");

    useEffect(() => { Native.getCurrentProfile().then(setCurrent); }, []);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Paragraph>
                This window is running {current ? <b>profile "{current}"</b> : <b>the default profile</b>}.
                Each profile has its own login, so log into a different account in each one.
            </Paragraph>

            {parseProfiles(profiles).map(name => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Paragraph style={{ flex: 1 }}>{name}</Paragraph>
                    <Button size="small" disabled={name === current} onClick={() => launch(name)}>
                        {name === current ? "Running here" : "Launch"}
                    </Button>
                    <Button size="small" variant="secondary" onClick={() => copyShortcut(name)}>
                        Copy shortcut
                    </Button>
                </div>
            ))}

            <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                    <TextInput placeholder="One-off profile name" value={custom} onChange={setCustom} />
                </div>
                <Button disabled={!custom.trim()} onClick={() => launch(custom)}>Launch</Button>
            </div>
        </div>
    );
}

const settings = definePluginSettings({
    profiles: {
        type: OptionType.STRING,
        description: "Comma-separated list of profile names (letters, numbers, - and _)",
        default: "alt1, alt2"
    },
    launcher: {
        type: OptionType.COMPONENT,
        description: "Launch profiles",
        component: ProfileLauncher
    },
    showProfileInTitle: {
        type: OptionType.BOOLEAN,
        description: "Prefix the window title with the profile name, so you can tell instances apart",
        default: true
    }
});

let titleObserver: MutationObserver | null = null;

export default definePlugin({
    name: "MultiInstance",
    description: "Run multiple Discord instances at once, each signed into a different account",
    authors: [{ name: "shsahiti", id: 0n }],
    settings,

    async start() {
        const profile = await Native.getCurrentProfile();
        if (!profile || !settings.store.showProfileInTitle) return;

        const prefix = `[${profile}] `;
        const applyPrefix = () => {
            if (!document.title.startsWith(prefix)) document.title = prefix + document.title;
        };
        applyPrefix();

        const titleEl = document.querySelector("title");
        if (titleEl) {
            titleObserver = new MutationObserver(applyPrefix);
            titleObserver.observe(titleEl, { childList: true });
        }
    },

    stop() {
        titleObserver?.disconnect();
        titleObserver = null;
    }
});
