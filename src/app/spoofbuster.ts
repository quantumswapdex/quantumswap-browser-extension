// Anti-spoofing "Spoof Buster Words".
//
// A dApp can open a look-alike window that imitates the approval popup, but a
// fake window cannot read this extension's localStorage. Three secret words
// are generated during onboarding, stored UNENCRYPTED (they gate nothing
// cryptographic - they only let the user tell a genuine extension window from
// a spoofed one), re-shown on every unlock, and confirmed by the user at the
// start of every dApp approval (src/approval/dapp.ts).
//
// Only the WORDS are secret. They are rendered as colorful chips in a fixed,
// position-based palette (word 1/2/3 each has its own foreground+background
// color, identical for all users) purely as a readability/recognition aid.
import { el, t } from "../ui/dom";
import { storageGetItem, storageSetItem } from "../lib/storage";
import { SPOOF_WORDLIST } from "./spoofbuster-wordlist";

export const SPOOF_BUSTER_STORAGE_KEY = "SpoofBusterWords";
export const SPOOF_WORD_COUNT = 3;

// Uniform random integer in [0, maxExclusive) via rejection sampling, so the
// word choice has no modulo bias.
export function spoofRandomInt(maxExclusive: number): number {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    for (;;) {
        crypto.getRandomValues(buf);
        if (buf[0] < limit) return buf[0] % maxExclusive;
    }
}

function pickDistinct<T>(pool: readonly T[], count: number, exclude?: Set<T>): T[] {
    const out: T[] = [];
    const taken = new Set<T>(exclude);
    while (out.length < count) {
        const candidate = pool[spoofRandomInt(pool.length)];
        if (taken.has(candidate)) continue;
        taken.add(candidate);
        out.push(candidate);
    }
    return out;
}

// 3 distinct random words.
export function generateSpoofBusterWords(): string[] {
    return pickDistinct(SPOOF_WORDLIST, SPOOF_WORD_COUNT);
}

// Random words excluding the given real words. Used for the onboarding quiz
// decoy sets and the approval training round.
export function pickDecoyWords(exclude: string[], count: number): string[] {
    return pickDistinct(SPOOF_WORDLIST, count, new Set(exclude));
}

export function parseSpoofBusterWords(json: string | null): string[] | null {
    if (json == null || json === "") return null;
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed) || parsed.length !== SPOOF_WORD_COUNT) return null;
        for (const entry of parsed) {
            if (typeof entry !== "string" || entry === "") return null;
        }
        return parsed as string[];
    } catch {
        return null;
    }
}

export async function spoofBusterSave(words: string[]): Promise<boolean> {
    return await storageSetItem(SPOOF_BUSTER_STORAGE_KEY, JSON.stringify(words));
}

export async function spoofBusterLoad(): Promise<string[] | null> {
    try {
        return parseSpoofBusterWords(await storageGetItem(SPOOF_BUSTER_STORAGE_KEY));
    } catch {
        return null;
    }
}

// Three colorful word chips appended to `container` (cleared first). The chip
// color comes from the word's POSITION (.spoof-style-0/1/2, fixed palette in
// styles.css). Reused by the onboarding panel, the unlock slider and the
// approval spoof gate.
export function renderSpoofBusterWords(container: HTMLElement, words: string[]): void {
    container.replaceChildren();
    words.forEach((word, i) => {
        container.appendChild(
            el("span", { class: "spoof-word spoof-style-" + i }, [word]),
        );
    });
}

const SPOOF_WORDS_DIALOG_ID = "modalSpoofWords";

// Settings > "Spoof Buster Words": modal showing the stored words. Built on
// demand and removed on close (no static markup / initDialogs wiring needed).
export async function showSpoofWordsDialog(): Promise<void> {
    const words = await spoofBusterLoad();
    document.getElementById(SPOOF_WORDS_DIALOG_ID)?.remove();

    const wordsRow = el("div", { class: "spoof-words-row" });
    if (words != null) renderSpoofBusterWords(wordsRow, words);

    const dialog = el("dialog", { id: SPOOF_WORDS_DIALOG_ID, class: "modal", tabindex: "-1", role: "dialog" }, [
        el("div", { class: "modal-content" }, [
            el("div", { class: "heading bold medium" }, [t("spoof-onboarding-title")]),
            words != null ? wordsRow : el("p", {}, [t("spoof-settings-none")]),
            el("div", { style: "display:flex; justify-content:flex-end; margin-top:16px;" }, [
                el("button", { class: "proceed", role: "button", tabindex: "1", onclick: () => close() }, [t("ok")]),
            ]),
        ]),
    ]);
    document.body.appendChild(dialog);
    dialog.style.display = "block";
    // Covers the Ok button and the native Escape-key close alike.
    dialog.addEventListener("close", () => dialog.remove());
    try { dialog.showModal(); } catch { /* already open */ }

    function close(): void {
        try { dialog.close(); } catch { /* not open */ }
        dialog.remove();
    }
}

const UNLOCK_SLIDER_ID = "divSpoofUnlockSlider";
const UNLOCK_SLIDER_AUTO_DISMISS_MS = 8000;

// Bottom slide-up banner re-showing the words after every successful unlock,
// so the user keeps them fresh in memory. No-op if no words are stored.
export async function showSpoofUnlockSlider(): Promise<void> {
    const words = await spoofBusterLoad();
    if (words == null) return;

    document.getElementById(UNLOCK_SLIDER_ID)?.remove();

    const wordsRow = el("div", { class: "spoof-words-row" });
    renderSpoofBusterWords(wordsRow, words);
    const slider = el("div", { class: "spoof-unlock-slider", id: UNLOCK_SLIDER_ID }, [
        el("button", { class: "spoof-slider-close", type: "button", "aria-label": "Close", onclick: () => dismiss() }, ["\u00d7"]),
        el("div", { class: "spoof-slider-title heading medium" }, [t("spoof-unlock-slider-title")]),
        wordsRow,
    ]);
    document.body.appendChild(slider);

    const timer = window.setTimeout(() => dismiss(), UNLOCK_SLIDER_AUTO_DISMISS_MS);
    function dismiss(): void {
        window.clearTimeout(timer);
        slider.remove();
    }
}
