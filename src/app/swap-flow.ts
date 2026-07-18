export type SwapWorkflowStepKind = "approve" | "swap";

export interface SwapWorkflowStepPlan {
    kind: SwapWorkflowStepKind;
    label: string;
}

export interface SwapSuccessAmounts {
    from: string;
    to: string;
}

export interface SwapReviewQuantities {
    quantityValue: string;
    tokenQuantityValue: string | null;
}

export function createSwapReviewQuantities(
    fromToken: string,
    fromQuantity: string,
    fromSymbol: string,
    toToken: string,
    toQuantity: string,
    toSymbol: string,
): SwapReviewQuantities {
    const tokenQuantities: string[] = [];
    if (fromToken !== "Q") {
        tokenQuantities.push(fromQuantity + " " + fromSymbol);
    }
    if (toToken !== "Q") {
        tokenQuantities.push(toQuantity + " " + toSymbol);
    }

    return {
        quantityValue: fromToken === "Q" ? fromQuantity : (toToken === "Q" ? toQuantity : "0"),
        tokenQuantityValue: tokenQuantities.length > 0 ? tokenQuantities.join(" for ") : null,
    };
}

export function createSwapSuccessAmounts(
    fromQuantity: string,
    fromSymbol: string,
    toQuantity: string,
    toSymbol: string,
): SwapSuccessAmounts {
    return {
        from: fromQuantity + " " + fromSymbol,
        to: toQuantity + " " + toSymbol,
    };
}

// Pure workflow planning kept separate from DOM/RPC code so the conditional
// step order and user-facing symbols can be verified directly.
export function createSwapWorkflowStepPlan(
    needsApproval: boolean,
    fromSymbol: string,
    toSymbol: string,
    approveText = "Approve",
    swapText = "Swap",
): SwapWorkflowStepPlan[] {
    const steps: SwapWorkflowStepPlan[] = [];
    if (needsApproval) {
        steps.push({ kind: "approve", label: approveText + " " + fromSymbol });
    }
    steps.push({ kind: "swap", label: swapText + " " + fromSymbol + " -> " + toSymbol });
    return steps;
}
