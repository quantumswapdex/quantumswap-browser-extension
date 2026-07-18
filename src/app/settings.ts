// Advanced-signing settings. 1:1 port of the corresponding functions from the
// old src/js/app.js (the offline-signing setting is desktop-only and was not
// ported: the extension does not support offline transaction signing).
import { storageGetItem, storageSetItem } from "../lib/storage";
import { DEFAULT_ADVANCED_SIGNING_SETTING_KEY } from "./state";
import { getGenericError } from "./app";
import { showWarnAlert } from "./dialog";

export async function advancedSigningSetDefaultValue(value: string): Promise<boolean> {
    const itemStoreResult = await storageSetItem(DEFAULT_ADVANCED_SIGNING_SETTING_KEY, value);
    if (itemStoreResult != true) {
        throw new Error("advancedSigningSetDefaultValue item store failed");
    }
    return true;
}

export async function advancedSigningGetDefaultValue(): Promise<boolean> {
    const value = await storageGetItem(DEFAULT_ADVANCED_SIGNING_SETTING_KEY);
    if (value == null) {
        return false;
    }
    if (value === "enabled") {
        return true;
    }
    return false;
}

export async function saveSelectedAdvancedSigningSetting(): Promise<void> {
    const radioButtons = document.querySelectorAll<HTMLInputElement>('input[name="optAdvancedSigning"]');
    let selectedValue = "";
    radioButtons.forEach(function (radioButton) {
        if (radioButton.checked) {
            selectedValue = radioButton.value;
        }
    });
    const result = await advancedSigningSetDefaultValue(selectedValue);
    if ((result as boolean) == false) {
        showWarnAlert(getGenericError(""));
    }
}
