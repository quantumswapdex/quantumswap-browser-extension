import { tokenStore } from "./state";

export const TOKEN_LIST_STATE_EVENT = "wallet-token-list-state";

export function setTokenListLoading(loading: boolean): void {
    tokenStore.isTokenListLoading = loading;
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(TOKEN_LIST_STATE_EVENT, { detail: { loading } }));
    }
}
