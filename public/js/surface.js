// Burger-menu surface controls. The same index.html is served across four
// surfaces, distinguished by a ?view= query param:
//   panel  - Chrome Side Panel / Firefox sidebar (default docked surface)
//   popup  - toolbar action popup (Firefox fallback)
//   window - detached floating window ("popped out")
//   tab    - full browser tab ("full screen")
//
// Actions:
//   Overlay    -> the toolbar action popup (default surface); reopened via
//                 action.openPopup() where supported, else close and re-click
//   Pop out    -> open a detached window (windows.create type "popup")
//   Dock       -> the sidebar (sidePanel.open / sidebarAction.open)
//   Full screen-> open a full browser tab (tabs.create)
//
// Runs at parse time (before csp-rehydrate.js), and sets data-view on <html> so
// popup.css can size each surface (fixed for the overlay popup, fluid elsewhere).
(function () {
    "use strict";

    function api() {
        return (typeof browser !== "undefined") ? browser : chrome;
    }

    var params = new URLSearchParams(location.search);
    var view = params.get("view") || "panel";
    var winParam = params.get("win");

    // Drive the surface-specific sizing in popup.css.
    document.documentElement.setAttribute("data-view", view);

    // Close the current surface. Tabs can't close via window.close(), so use the
    // tabs API; the side panel and detached window both honor window.close().
    function closeSelf() {
        var A = api();
        if (view === "tab") {
            if (A.tabs && A.tabs.getCurrent) {
                A.tabs.getCurrent().then(function (t) {
                    if (t && t.id != null) A.tabs.remove(t.id);
                }).catch(function () { });
            }
            return;
        }
        try { window.close(); } catch (e) { /* ignore */ }
    }

    window.walletPopOut = function () {
        var A = api();
        A.windows.getCurrent().then(function (w) {
            var srcId = (w && w.id != null) ? w.id : "";
            return A.windows.create({
                url: A.runtime.getURL("index.html?view=window&win=" + srcId),
                type: "popup",
                width: 640,
                height: 820,
            });
        }).then(function () {
            closeSelf();
        }).catch(function (e) {
            console.warn("[surface] pop out failed", e);
        });
        return false;
    };

    window.walletFullScreen = function () {
        var A = api();
        A.windows.getCurrent().then(function (w) {
            var srcId = (w && w.id != null) ? w.id : "";
            return A.tabs.create({
                url: A.runtime.getURL("index.html?view=tab&win=" + srcId),
            });
        }).then(function () {
            closeSelf();
        }).catch(function (e) {
            console.warn("[surface] full screen failed", e);
        });
        return false;
    };

    // Dock back into the sidebar. sidePanel.open() requires the click's user
    // gesture, so it is called synchronously with the source window id carried in
    // the URL (no awaited call precedes it).
    window.walletDock = function () {
        var A = api();
        var winId = winParam ? Number(winParam) : null;
        var done = function () { closeSelf(); };
        try {
            if (A.sidePanel && A.sidePanel.open) {
                var opts = (winId != null && !isNaN(winId)) ? { windowId: winId } : {};
                A.sidePanel.open(opts).then(done).catch(function () {
                    // Fallback: last focused normal window (may lose the gesture).
                    A.windows.getLastFocused({ windowTypes: ["normal"] })
                        .then(function (w) { return A.sidePanel.open({ windowId: w.id }); })
                        .then(done)
                        .catch(function (err) { console.warn("[surface] dock failed", err); done(); });
                });
            } else if (A.sidebarAction && A.sidebarAction.open) {
                A.sidebarAction.open().then(done).catch(function (err) {
                    console.warn("[surface] dock failed", err);
                    done();
                });
            } else {
                done();
            }
        } catch (e) {
            console.warn("[surface] dock error", e);
            done();
        }
        return false;
    };

    // Return to the toolbar action popup ("Overlay"). There is no fully reliable
    // API to reopen the anchored popup, so this is best-effort: try openPopup()
    // where supported, otherwise just close the current surface so the next
    // toolbar click floats it again.
    window.walletOverlay = function () {
        var A = api();
        var opener = (A.action && A.action.openPopup)
            ? A.action
            : ((A.browserAction && A.browserAction.openPopup) ? A.browserAction : null);
        if (!opener) {
            closeSelf();
            return false;
        }
        try {
            var p = opener.openPopup();
            if (p && p.then) {
                p.then(function () { closeSelf(); }).catch(function () { closeSelf(); });
            } else {
                closeSelf();
            }
        } catch (e) {
            closeSelf();
        }
        return false;
    };

    // The item matching the current surface is disabled (you can't switch to the
    // surface you're already in), matching the Wallets/Settings disabled styling.
    var ACTIVE_ITEM = {
        popup: "burgerOverlay",
        window: "burgerPopOut",
        tab: "burgerFullScreen",
        panel: "burgerDock",
    };

    function setup() {
        var activeId = ACTIVE_ITEM[view];
        if (activeId) {
            var el = document.getElementById(activeId);
            if (el) el.classList.add("disabled");
        }
    }

    setup();
})();
