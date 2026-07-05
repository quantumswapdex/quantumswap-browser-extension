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
    return window[token];
  }

  // Evaluate a single call expression like NAME(ARGS). Returns the call result,
  // or the raw literal value if it is not a call.
  function evalExpr(expr, el, event) {
    expr = expr.trim();
    var m = expr.match(CALL_EXPR);
    if (!m) return evalArg(expr, el, event);
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
    scan(document.body);
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
