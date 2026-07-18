import { describe, expect, it } from "vitest";
import {
    createSwapReviewQuantities,
    createSwapSuccessAmounts,
    createSwapWorkflowStepPlan,
} from "./swap-flow";

describe("createSwapReviewQuantities", () => {
    it("separates two token amounts from the native Q quantity", () => {
        expect(createSwapReviewQuantities(
            "0xtig", "2.377715260798994844", "TIG",
            "0xlion", "9.040139995395390906", "Lion",
        )).toEqual({
            quantityValue: "0",
            tokenQuantityValue: "2.377715260798994844 TIG for 9.040139995395390906 Lion",
        });
    });

    it("puts Q and token amounts on their respective rows in either direction", () => {
        expect(createSwapReviewQuantities("Q", "2", "Q", "0xtig", "9", "TIG")).toEqual({
            quantityValue: "2",
            tokenQuantityValue: "9 TIG",
        });
        expect(createSwapReviewQuantities("0xtig", "2", "TIG", "Q", "9", "Q")).toEqual({
            quantityValue: "9",
            tokenQuantityValue: "2 TIG",
        });
    });
});

describe("createSwapWorkflowStepPlan", () => {
    it("uses only the swap step when allowance is sufficient", () => {
        expect(createSwapWorkflowStepPlan(false, "TOKENA", "TOKENB")).toEqual([
            { kind: "swap", label: "Swap TOKENA -> TOKENB" },
        ]);
    });

    it("orders exact-amount approval before swap when allowance is insufficient", () => {
        expect(createSwapWorkflowStepPlan(true, "TOKENA", "TOKENB")).toEqual([
            { kind: "approve", label: "Approve TOKENA" },
            { kind: "swap", label: "Swap TOKENA -> TOKENB" },
        ]);
    });

    it("uses token symbols and localized action text in labels", () => {
        expect(createSwapWorkflowStepPlan(true, "BOSS", "FUN", "Allow", "Exchange")).toEqual([
            { kind: "approve", label: "Allow BOSS" },
            { kind: "swap", label: "Exchange BOSS -> FUN" },
        ]);
    });
});

describe("createSwapSuccessAmounts", () => {
    it("preserves the exact quantities submitted to the swap", () => {
        expect(createSwapSuccessAmounts("1.2500", "TOKENA", "9.87654321", "TOKENB")).toEqual({
            from: "1.2500 TOKENA",
            to: "9.87654321 TOKENB",
        });
    });
});
