// MV3 Content-Security-Policy forbids inline event handlers (onclick="...",
// oninput="...", etc.) and also forbids eval / new Function. The ported desktop
// UI in index.html uses ~150 inline handlers, so this script "rehydrates" them:
// it reads each on* attribute, removes it (so the browser never tries to run the
// CSP-blocked inline code), and re-attaches an equivalent addEventListener that
// interprets the original handler string with a tiny, eval-free parser.
//
// The handler strings used by the UI are limited to:
//   - global function calls:            foo()   foo(this, 'x')   foo(currentVar)
//   - optional leading return:          return foo();   return false;
//   - multiple ;-separated statements:  foo(); return false;
//   - radio/checkbox selection:         document.getElementById('id').checked = true;
//   - a single keyboard activation:     if (event.key === 'Enter' || event.key === ' ') { ... }
// Anything outside this grammar is logged and skipped.
//
// Loaded AFTER js/boot.js so initApp() has already captured its row templates
// (which embed inline handlers) before we strip attributes from the live DOM.
// A MutationObserver re-processes nodes injected later (e.g. token rows added via
// innerHTML) so their handlers work too.
(function () {
  "use strict";

  var EVENT_ATTRS = [
    "onclick", "oninput", "onchange", "onkeydown", "onkeyup", "onkeypress",
    "onfocus", "onblur", "onsubmit", "onmouseover", "onmouseout",
    "onmouseenter", "onmouseleave",
  ];

  var CHECKED_ASSIGN = /^document\.getElementById\((['"])(.+?)\1\)\.checked\s*=\s*true$/;
  var CALL_EXPR = /^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/;
  var IDENT = /^[A-Za-z_$][\w$]*$/;

  // item 13: instead of resolving ANY global by name (which turned this tiny
  // interpreter into an "any window function is callable" amplifier), we only
  // resolve names that appear in the extension's OWN trusted markup. The allowlist
  // is built from the static document (+ its row templates) during the initial
  // boot scan, then frozen — nodes injected later (e.g. token rows added via
  // innerHTML, or anything a compromised path could insert) can invoke ONLY the
  // handler functions / arg identifiers the real UI already uses, never new ones.
  var HANDLER_NAME_ALLOWLIST = new Set();
  var ARG_IDENT_ALLOWLIST = new Set();
  var allowlistFrozen = false;

  // Record the identifier used as a bare (unquoted, non-literal) handler argument,
  // mirroring evalArg's fallback branch (e.g. foo(currentWalletAddress)).
  function collectArgIdent(token) {
    token = token.trim();
    if (token === "" || token === "this" || token === "event"
      || token === "true" || token === "false" || token === "null" || token === "undefined") return;
    var q = token.charAt(0);
    if ((q === "'" || q === '"') && token.charAt(token.length - 1) === q) return;
    if (/^-?\d+(\.\d+)?$/.test(token)) return;
    if (IDENT.test(token)) ARG_IDENT_ALLOWLIST.add(token);
  }

  function collectFromExpr(expr) {
    expr = expr.trim();
    var m = expr.match(CALL_EXPR);
    if (!m) { collectArgIdent(expr); return; }
    HANDLER_NAME_ALLOWLIST.add(m[1]);
    var argsRaw = m[2].trim();
    if (argsRaw !== "") splitTop(argsRaw, ",").forEach(collectArgIdent);
  }

  // Harvest the callable names + arg identifiers from one handler string so they
  // can be added to the allowlist. Only called for trusted (static) markup.
  function collectFromCode(code) {
    var stmts = splitTop(code, ";");
    for (var i = 0; i < stmts.length; i++) {
      var stmt = stmts[i].trim();
      if (stmt === "" || stmt === "return") continue;
      if (stmt.indexOf("return ") === 0) stmt = stmt.slice(6).trim();
      // The if(event.key...) activation and checked-assign forms invoke no globals.
      if (stmt.indexOf("if") === 0 && stmt.indexOf("event.key") !== -1) continue;
      if (CHECKED_ASSIGN.test(stmt)) continue;
      collectFromExpr(stmt);
    }
  }

  // Split a code string on top-level separators, ignoring separators that are
  // inside quotes, parentheses, or braces.
  function splitTop(code, sep) {
    var parts = [];
    var cur = "";
    var quote = null;
    var depth = 0;
    for (var i = 0; i < code.length; i++) {
      var ch = code[i];
      if (quote) {
        cur += ch;
        if (ch === quote && code[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
      if (ch === "(" || ch === "{") { depth++; cur += ch; continue; }
      if (ch === ")" || ch === "}") { depth--; cur += ch; continue; }
      if (ch === sep && depth === 0) { parts.push(cur); cur = ""; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts;
  }

  function evalArg(token, el, event) {
    token = token.trim();
    if (token === "") return undefined;
    if (token === "this") return el;
    if (token === "event") return event;
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (token === "undefined") return undefined;
    var q = token.charAt(0);
    if ((q === "'" || q === '"') && token.charAt(token.length - 1) === q) {
      return token.slice(1, -1);
    }
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    // item 13: only resolve a global variable named by trusted markup.
    if (ARG_IDENT_ALLOWLIST.has(token)) return window[token];
    console.warn("[csp-rehydrate] arg identifier not allowed:", token);
    return undefined;
  }

  // Evaluate a single call expression like NAME(ARGS). Returns the call result,
  // or the raw literal value if it is not a call.
  function evalExpr(expr, el, event) {
    expr = expr.trim();
    var m = expr.match(CALL_EXPR);
    if (!m) return evalArg(expr, el, event);
    // item 13: only call handler functions named by trusted markup.
    if (!HANDLER_NAME_ALLOWLIST.has(m[1])) {
      console.warn("[csp-rehydrate] handler function not allowed:", m[1]);
      return undefined;
    }
    var fn = window[m[1]];
    if (typeof fn !== "function") {
      console.warn("[csp-rehydrate] handler function not found:", m[1]);
      return undefined;
    }
    var args = m[2].trim() === ""
      ? []
      : splitTop(m[2], ",").map(function (a) { return evalArg(a, el, event); });
    return fn.apply(el, args);
  }

  function runStatement(stmt, el, event) {
    stmt = stmt.trim();
    if (stmt === "") return true;

    // if (event.key === 'Enter' || event.key === ' ') { ...; el.click(); }
    if (stmt.indexOf("if") === 0 && stmt.indexOf("event.key") !== -1) {
      if (event && (event.key === "Enter" || event.key === " ")) {
        if (event.preventDefault) event.preventDefault();
        var idMatch = stmt.match(/getElementById\((['"])(.+?)\1\)/);
        if (idMatch) {
          var target = document.getElementById(idMatch[2]);
          if (target) target.click();
        }
      }
      return true;
    }

    // return [expr];  -> falsy result prevents the default (used by <a href="#">).
    if (stmt === "return" || stmt.indexOf("return ") === 0) {
      var rest = stmt.slice(6).trim();
      var val = rest ? evalExpr(rest, el, event) : undefined;
      if (val === false && event && event.preventDefault) event.preventDefault();
      return false; // stop processing further statements
    }

    // document.getElementById('id').checked = true;
    var assign = stmt.match(CHECKED_ASSIGN);
    if (assign) {
      var node = document.getElementById(assign[2]);
      if (node) node.checked = true;
      return true;
    }

    evalExpr(stmt, el, event);
    return true;
  }

  function runHandler(code, el, event) {
    var stmts = splitTop(code, ";");
    for (var i = 0; i < stmts.length; i++) {
      if (!runStatement(stmts[i], el, event)) break;
    }
  }

  function attachElement(el) {
    if (!el.hasAttribute) return;
    for (var i = 0; i < EVENT_ATTRS.length; i++) {
      var attr = EVENT_ATTRS[i];
      if (!el.hasAttribute(attr)) continue;
      var code = el.getAttribute(attr);
      // item 13: harvest callable names from trusted (static) markup only. Once
      // frozen (after the initial boot scan), later-injected nodes contribute
      // nothing to the allowlist and can only call already-known handlers.
      if (!allowlistFrozen) collectFromCode(code);
      el.removeAttribute(attr);
      var type = attr.slice(2);
      (function (codeStr, evtType, target) {
        target.addEventListener(evtType, function (event) {
          runHandler(codeStr, target, event);
        });
      })(code, type, el);
    }
  }

  var SELECTOR = EVENT_ATTRS.map(function (a) { return "[" + a + "]"; }).join(",");

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    attachElement(root);
    if (root.querySelectorAll) {
      var nodes = root.querySelectorAll(SELECTOR);
      for (var i = 0; i < nodes.length; i++) attachElement(nodes[i]);
    }
  }

  function boot() {
    // Initial scan of the trusted static markup builds the allowlist; freeze it
    // before observing so dynamically-added nodes cannot extend it.
    scan(document.body);
    allowlistFrozen = true;
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) scan(added[j]);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
