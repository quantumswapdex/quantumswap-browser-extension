import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/storage", () => ({
    storageGetItem: vi.fn(),
    storageSetItem: vi.fn(async () => true),
}));

import { storageGetItem, storageSetItem } from "../lib/storage";
import {
    SPOOF_BUSTER_STORAGE_KEY,
    SPOOF_WORD_COUNT,
    generateSpoofBusterWords,
    parseSpoofBusterWords,
    pickDecoyWords,
    renderSpoofBusterWords,
    spoofBusterLoad,
    spoofBusterSave,
    spoofRandomInt,
} from "./spoofbuster";
import { SPOOF_WORDLIST } from "./spoofbuster-wordlist";

describe("SPOOF_WORDLIST", () => {
    it("is the 2048-word BIP-39 English list", () => {
        expect(SPOOF_WORDLIST.length).toBe(2048);
        expect(SPOOF_WORDLIST[0]).toBe("abandon");
        expect(SPOOF_WORDLIST[2047]).toBe("zoo");
        expect(new Set(SPOOF_WORDLIST).size).toBe(2048);
    });
});

describe("spoofRandomInt", () => {
    it("stays within [0, max)", () => {
        for (let i = 0; i < 200; i++) {
            const n = spoofRandomInt(6);
            expect(n).toBeGreaterThanOrEqual(0);
            expect(n).toBeLessThan(6);
        }
    });
});

describe("generateSpoofBusterWords", () => {
    it("returns 3 distinct wordlist words", () => {
        for (let i = 0; i < 50; i++) {
            const words = generateSpoofBusterWords();
            expect(words.length).toBe(SPOOF_WORD_COUNT);
            expect(new Set(words).size).toBe(SPOOF_WORD_COUNT);
            for (const w of words) {
                expect(SPOOF_WORDLIST).toContain(w);
            }
        }
    });
});

describe("pickDecoyWords", () => {
    it("never returns any of the excluded (real) words", () => {
        const real = generateSpoofBusterWords();
        for (let i = 0; i < 50; i++) {
            const decoys = pickDecoyWords(real, SPOOF_WORD_COUNT);
            expect(decoys.length).toBe(SPOOF_WORD_COUNT);
            for (const d of decoys) {
                expect(real).not.toContain(d);
            }
            expect(new Set(decoys).size).toBe(SPOOF_WORD_COUNT);
        }
    });
});

describe("parseSpoofBusterWords", () => {
    it("round-trips a valid record", () => {
        const words = generateSpoofBusterWords();
        expect(parseSpoofBusterWords(JSON.stringify(words))).toEqual(words);
    });

    it("rejects malformed records", () => {
        expect(parseSpoofBusterWords(null)).toBeNull();
        expect(parseSpoofBusterWords("")).toBeNull();
        expect(parseSpoofBusterWords("not json")).toBeNull();
        expect(parseSpoofBusterWords("{}")).toBeNull();
        expect(parseSpoofBusterWords("[]")).toBeNull();
        expect(parseSpoofBusterWords(JSON.stringify(["a"]))).toBeNull();
        expect(parseSpoofBusterWords(JSON.stringify(["a", "b", ""]))).toBeNull();
        expect(parseSpoofBusterWords(JSON.stringify(["a", "b", 3]))).toBeNull();
        // Legacy {word, style} objects are not valid entries.
        expect(parseSpoofBusterWords(JSON.stringify([
            { word: "a", style: 0 }, { word: "b", style: 1 }, { word: "c", style: 2 },
        ]))).toBeNull();
    });
});

describe("spoofBusterSave / spoofBusterLoad", () => {
    beforeEach(() => {
        vi.mocked(storageGetItem).mockReset();
        vi.mocked(storageSetItem).mockClear();
    });

    it("saves under the SpoofBusterWords key as JSON", async () => {
        const words = generateSpoofBusterWords();
        await spoofBusterSave(words);
        expect(storageSetItem).toHaveBeenCalledWith(SPOOF_BUSTER_STORAGE_KEY, JSON.stringify(words));
    });

    it("loads what was saved", async () => {
        const words = generateSpoofBusterWords();
        vi.mocked(storageGetItem).mockResolvedValue(JSON.stringify(words));
        expect(await spoofBusterLoad()).toEqual(words);
    });

    it("returns null when nothing stored or storage throws", async () => {
        vi.mocked(storageGetItem).mockResolvedValue(null);
        expect(await spoofBusterLoad()).toBeNull();
        vi.mocked(storageGetItem).mockRejectedValue(new Error("hash mismatch"));
        expect(await spoofBusterLoad()).toBeNull();
    });
});

describe("renderSpoofBusterWords", () => {
    it("renders one chip per word with position-based classes and clears previous content", () => {
        const container = document.createElement("div");
        container.appendChild(document.createElement("span"));
        renderSpoofBusterWords(container, ["alpha", "bravo", "canyon"]);
        expect(container.children.length).toBe(3);
        const chips = Array.from(container.children) as HTMLElement[];
        expect(chips[0].textContent).toBe("alpha");
        expect(chips[0].className).toBe("spoof-word spoof-style-0");
        expect(chips[1].className).toBe("spoof-word spoof-style-1");
        expect(chips[2].className).toBe("spoof-word spoof-style-2");
    });
});
