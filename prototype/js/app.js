/* RayuCode Desktop prototype — minimal interactivity only:
   theme switch, collapsibles, tabs, segmented toggles, diff accept. */
(function () {
  "use strict";

  var root = document.documentElement;

  /* ---------- Theme ---------- */
  function applyTheme(theme) {
    if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    try { localStorage.setItem("rayu-theme", theme); } catch (e) {}
    document.querySelectorAll("[data-theme-set]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-theme-set") === theme));
    });
    document.querySelectorAll(".theme-toggle").forEach(function (btn) {
      var isDark = theme !== "light";
      btn.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
      btn.querySelector(".icon-use").setAttribute("href", isDark ? "#i-sun" : "#i-moon");
    });
  }

  var saved = "dark";
  try { saved = localStorage.getItem("rayu-theme") || "dark"; } catch (e) {}
  applyTheme(saved);

  /* Open at the live end of the stream, like a running session. */
  document.querySelectorAll(".pane-scroll").forEach(function (scroller) {
    if (scroller.querySelector(".stream")) scroller.scrollTop = scroller.scrollHeight;
  });

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-theme-set], .theme-toggle");
    if (t) {
      if (t.hasAttribute("data-theme-set")) {
        applyTheme(t.getAttribute("data-theme-set"));
      } else {
        applyTheme(root.getAttribute("data-theme") === "light" ? "dark" : "light");
      }
      return;
    }

    /* ---------- Collapsibles (reasoning, tree) ---------- */
    var tog = ev.target.closest("[data-collapse]");
    if (tog) {
      var body = document.getElementById(tog.getAttribute("data-collapse"));
      if (body) {
        var open = tog.getAttribute("aria-expanded") === "true";
        tog.setAttribute("aria-expanded", String(!open));
        body.hidden = open;
      }
      return;
    }

    /* ---------- Segmented toggles ---------- */
    var seg = ev.target.closest(".seg button");
    if (seg) {
      seg.parentElement.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === seg));
      });
      return;
    }

    /* ---------- Tabs ---------- */
    var tab = ev.target.closest("[role='tab']");
    if (tab) {
      var list = tab.closest("[role='tablist']");
      list.querySelectorAll("[role='tab']").forEach(function (b) {
        b.setAttribute("aria-selected", String(b === tab));
      });
      var scope = tab.closest("[data-tabs]") || document;
      scope.querySelectorAll("[role='tabpanel']").forEach(function (p) {
        p.hidden = p.id !== tab.getAttribute("aria-controls");
      });
      return;
    }

    /* ---------- Switch ---------- */
    var sw = ev.target.closest(".switch");
    if (sw) {
      sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true"));
      return;
    }

    /* ---------- Diff accept / reject ---------- */
    var accept = ev.target.closest("[data-diff-accept]");
    if (accept) {
      var diff = accept.closest(".diff");
      diff.classList.add("is-accepted");
      diff.querySelector(".diff-foot").innerHTML =
        '<span class="hint">Accepted · staged for commit</span><span class="spacer"></span>' +
        '<button class="btn btn-ghost btn-sm" type="button">Undo</button>';
      return;
    }
    var reject = ev.target.closest("[data-diff-reject]");
    if (reject) {
      var d = reject.closest(".diff");
      d.querySelector(".diff-foot").innerHTML =
        '<span class="hint" style="color:var(--danger)">Rejected · agent will revise</span><span class="spacer"></span>' +
        '<button class="btn btn-ghost btn-sm" type="button">Restore</button>';
      return;
    }

    /* ---------- Chip remove ---------- */
    var chipX = ev.target.closest(".chip-x");
    if (chipX) { chipX.closest(".chip").remove(); return; }

    /* ---------- Send: append the typed message to the stream ---------- */
    var send = ev.target.closest(".send-btn");
    if (send) {
      var composer = send.closest(".composer");
      var input = composer && composer.querySelector(".composer-input");
      var stream = document.querySelector(".stream");
      if (input && stream && input.value.trim()) {
        var msg = document.createElement("div");
        msg.className = "msg msg-user";
        var p = document.createElement("p");
        p.textContent = input.value.trim();
        var meta = document.createElement("div");
        meta.className = "msg-meta";
        meta.textContent = "you · just now";
        msg.appendChild(p);
        msg.appendChild(meta);
        stream.appendChild(msg);
        input.value = "";
        msg.scrollIntoView({ block: "end" });
      } else if (input) {
        input.focus();
        input.placeholder = "Type a message first, then send";
        var bar = composer.querySelector(".composer-bar");
        var hint = bar.querySelector(".send-hint");
        if (!hint) {
          hint = document.createElement("span");
          hint.className = "send-hint dim";
          hint.style.fontSize = "var(--text-2xs)";
          hint.textContent = "Nothing to send yet";
          bar.insertBefore(hint, bar.querySelector(".spacer"));
          setTimeout(function () { hint.remove(); input.placeholder = "Ask rayu anything, @ to mention a file, / for actions"; }, 2000);
        }
      }
    }
  });
})();