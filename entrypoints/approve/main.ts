// dApp approval entry point (approve.html?requestId=...). Mounts the el()-built
// approval markup and hands control to the approval controller. This surface
// deliberately skips the wallet renderer boot (no initApp/initDialogs): all of
// its behavior is self-contained in src/approval/dapp.ts, mirroring the legacy
// public/js/dapp.js page.
import { mountScreenModules } from "@/src/ui/screens";
import { approvalScreenModules } from "@/src/approval/screens";
import { initDappApproval } from "@/src/approval/dapp";

function boot(): void {
    mountScreenModules(approvalScreenModules);
    void initDappApproval();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}
