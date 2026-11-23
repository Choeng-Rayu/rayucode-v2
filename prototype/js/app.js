/* RayuCode Desktop v1 prototype — minimal vanilla JS for:
   Dark/Light theme toggle, sidebar & preview drawer toggles,
   Antigravity mode cycle (Plan/Build/Auto), slash commands,
   tabs (Browser/Office/MD), PowerPoint slides, MD Rendered/Raw,
   diff Accept/Reject/Undo, and live message send. */
(function () {
  "use strict";

  var root = document.documentElement;
  var toastTimer = null;

  function showToast(text) {
    var existing = document.querySelector(".toast");
    if (existing) existing.remove();
    clearTimeout(toastTimer);
    var el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.innerHTML =
      '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg><span></span>';
    el.querySelector("span").textContent = text;
    document.body.appendChild(el);
    toastTimer = setTimeout(function () { el.remove(); }, 2400);
  }

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
      var use = btn.querySelector(".icon-use");
      if (use) use.setAttribute("href", isDark ? "#i-sun" : "#i-moon");
    });
  }

  var saved = "dark";
  try { saved = localStorage.getItem("rayu-theme") || "dark"; } catch (e) {}
  applyTheme(saved);

  /* ---------- Accent Color (Rayu Green default / Ocean Blue option) ---------- */
  function applyAccent(accent, announce) {
    var val = accent === "blue" ? "blue" : "green";
    if (val === "blue") root.setAttribute("data-accent", "blue");
    else root.removeAttribute("data-accent");
    try { localStorage.setItem("rayu-accent", val); } catch (e) {}
    document.querySelectorAll("[data-accent-set]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-accent-set") === val));
    });
    if (announce) showToast(val === "blue" ? "Accent color: Ocean Blue" : "Accent color: Rayu Green");
  }

  var savedAccent = "green";
  try { savedAccent = localStorage.getItem("rayu-accent") || "green"; } catch (e) {}
  applyAccent(savedAccent, false);

  function closeDropdowns(except) {
    document.querySelectorAll("[data-dropdown-menu]").forEach(function (m) {
      if (m !== except) m.hidden = true;
    });
    document.querySelectorAll("[data-dropdown]").forEach(function (btn) {
      var menu = document.getElementById(btn.getAttribute("data-dropdown"));
      if (menu !== except) btn.setAttribute("aria-expanded", "false");
    });
  }

  function activateTab(tab) {
    var list = tab.closest("[role='tablist']");
    if (!list) return;
    list.querySelectorAll("[role='tab']").forEach(function (b) {
      b.setAttribute("aria-selected", String(b === tab));
    });
    var scope = list.closest("[data-tabs]") || document;
    var targetId = tab.getAttribute("aria-controls");
    list.querySelectorAll("[role='tab']").forEach(function (b) {
      var id = b.getAttribute("aria-controls");
      if (!id) return;
      var panel = (scope !== document && scope.querySelector("#" + id)) || document.getElementById(id);
      if (panel) panel.hidden = id !== targetId;
    });
    var pillLabel = tab.getAttribute("data-tab-pill");
    if (pillLabel) {
      var pillEl = document.getElementById("rs-active-pill-name");
      if (pillEl) pillEl.textContent = pillLabel;
      var appWrap = document.querySelector(".app");
      if (appWrap) {
        appWrap.classList.remove("is-right-collapsed");
        var isCtx = tab.id === "ptab-overview" || tab.id === "htab-overview" || tab.id === "xtab-overview";
        appWrap.classList.toggle("is-ctx-mode", isCtx);
      }
    }
  }

  function activateCustomizeView(view) {
    document.querySelectorAll("[data-customize-view]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-customize-view") === view);
    });
    ["plugins", "skills", "memory"].forEach(function (id) {
      var el = document.getElementById("view-" + id);
      if (el) el.hidden = id !== view;
    });
  }

  if (location.hash) {
    var h = location.hash.slice(1);
    var hashTab = document.querySelector("[data-hash-tab='" + h + "']");
    if (hashTab) activateTab(hashTab);
    if (h === "plugins" || h === "skills" || h === "memory") activateCustomizeView(h);
    if (h === "browser-side" || h === "browser-full") {
      var bTab = document.getElementById("ptab-browser") || document.getElementById("htab-browser");
      var appB = document.querySelector(".app");
      if (appB) appB.classList.remove("is-right-collapsed");
      if (bTab) activateTab(bTab);
      if (h === "browser-full" && appB) appB.classList.add("is-browser-full");
    }
    if (h === "model-effort" || h === "model-list") {
      var mWrapH = document.querySelector(".model-wrap");
      if (mWrapH) {
        var mTrigH = mWrapH.querySelector(".model-trigger");
        var mPopH = mWrapH.querySelector(".model-pop");
        if (mPopH) {
          mPopH.hidden = false;
          if (mTrigH) mTrigH.setAttribute("aria-expanded", "true");
          var eCardH = mPopH.querySelector(".effort-card");
          var lCardH = mPopH.querySelector(".model-list-card");
          if (eCardH) eCardH.hidden = h === "model-list";
          if (lCardH) lCardH.hidden = h !== "model-list";
        }
      }
    }
    if (h === "trace-open" || h === "trace-shell") {
      var wTog = document.querySelector("[data-work-toggle]");
      if (wTog) {
        var wBody = document.getElementById(wTog.getAttribute("data-work-toggle"));
        wTog.setAttribute("aria-expanded", "true");
        if (wBody) wBody.hidden = false;
      }
      if (h === "trace-shell") {
        document.querySelectorAll("[data-shell-toggle]").forEach(function (btn, i) {
          if (i === 1 || i === 2) {
            var card = document.getElementById(btn.getAttribute("data-shell-toggle"));
            btn.setAttribute("aria-expanded", "true");
            if (card) card.hidden = false;
          }
        });
      }
    }
    if (h === "turn-fork-tip") {
      var forkWrap = document.querySelector("[data-turn-fork]");
      if (forkWrap) {
        var wEl = forkWrap.closest(".turn-act-wrap");
        if (wEl) wEl.classList.add("is-hovered");
        forkWrap.classList.add("is-hovered");
      }
    }
    if (h === "ctx-expanded") {
      var ovTab = document.getElementById("xtab-overview") || document.getElementById("ptab-overview") || document.getElementById("htab-overview");
      if (ovTab) activateTab(ovTab);
      var appC = document.querySelector(".app");
      if (appC) appC.classList.remove("is-right-collapsed");
      var skBtn = document.querySelector("[data-ctx-detail]");
      if (skBtn) {
        var skBox = document.getElementById(skBtn.getAttribute("data-ctx-detail"));
        skBtn.setAttribute("aria-expanded", "true");
        if (skBox) skBox.hidden = false;
      }
      var mcpDisc = document.querySelector("[data-collapse='disc-mcp'], [data-collapse='x-disc-mcp'], [data-collapse='h-disc-mcp']");
      if (mcpDisc) {
        var mcpBox = document.getElementById(mcpDisc.getAttribute("data-collapse"));
        mcpDisc.setAttribute("aria-expanded", "true");
        if (mcpBox) mcpBox.hidden = false;
      }
    }
    if (h === "code-ref" || h === "code-ref-blue") {
      if (h === "code-ref-blue") applyAccent("blue", false);
      setTimeout(function () { openCodeInSidebar("lookup.rs", 21); }, 0);
    }
  }

  document.querySelectorAll(".pane-scroll").forEach(function (scroller) {
    if (scroller.querySelector(".stream")) {
      scroller.scrollTop = location.hash === "#turn-fork-tip" ? scroller.scrollHeight : 0;
    }
  });

  function sendComposerMessage(composer) {
    var input = composer && composer.querySelector(".composer-input");
    if (!input) return;
    var text = input.value.trim();
    if (!text) {
      input.focus();
      showToast("Type a prompt or /command first");
      return;
    }

    var stream = document.querySelector(".stream");
    var welcome = document.querySelector(".welcome-center");

    if (!stream && welcome) {
      /* Transition from New session -> Active Chat UI with full right sidebar */
      var scroller = document.createElement("div");
      scroller.className = "pane-scroll";
      stream = document.createElement("div");
      stream.className = "stream";
      scroller.appendChild(stream);
      welcome.replaceWith(scroller);

      var appRoot = document.querySelector(".app");
      if (appRoot) {
        appRoot.classList.remove("is-right-collapsed");
        appRoot.classList.add("is-ctx-mode");
      }
      var newActs = document.getElementById("new-session-actions");
      if (newActs) newActs.hidden = true;
      var activeStrip = document.getElementById("active-chat-strip");
      if (activeStrip) activeStrip.hidden = false;
      var canvasHead = document.querySelector(".canvas-head");
      if (canvasHead) canvasHead.classList.add("has-border");
      var hdrTitle = document.getElementById("session-header-title");
      if (hdrTitle) hdrTitle.textContent = text.length > 48 ? text.slice(0, 48) + "…" : text;
      var shellTop = composer.querySelector(".composer-shell-top");
      if (shellTop) shellTop.hidden = true;
    }

    if (stream) {
      var msg = document.createElement("div");
      msg.className = "msg msg-user";
      var p = document.createElement("p");
      p.textContent = text;
      msg.appendChild(p);
      stream.appendChild(msg);

      /* Stream a clean Codex-style live execution trace + editorial answer */
      var activeModelName = (composer.querySelector(".model-trigger .m-name") || {}).textContent || "Claude Opus 5.5";
      streamLiveAgentTurn(stream, text, activeModelName);

      input.value = "";
      var pop = composer.querySelector(".slash-pop");
      if (pop) pop.hidden = true;
    }
  }

  /* Live Codex-style agent execution trace streamer (real clickable steps + shell output) */
  var liveTraceSeq = 100;
  function streamLiveAgentTurn(stream, promptText, modelName) {
    liveTraceSeq++;
    var uid = "live-" + liveTraceSeq;
    var turn = document.createElement("div");
    turn.className = "msg msg-agent";
    turn.innerHTML =
      '<div class="work-trace">' +
        '<button class="work-toggle is-live" type="button" data-work-toggle="' + uid + '-body" aria-expanded="true">' +
          '<span class="work-live-dot" aria-hidden="true"></span>' +
          '<span class="work-label work-shimmer">Working · 1s</span>' +
          '<svg class="icon chev" aria-hidden="true"><use href="#i-chev-r"/></svg>' +
        '</button>' +
        '<div class="work-body" id="' + uid + '-body">' +
          '<p class="work-note"></p>' +
          '<div class="work-group">' +
            '<button class="work-group-toggle" type="button" data-group-toggle="' + uid + '-rail" aria-expanded="true">' +
              '<svg class="icon" aria-hidden="true"><use href="#i-book"/></svg>' +
              '<span>Read files, ran commands</span>' +
              '<svg class="icon chev" aria-hidden="true"><use href="#i-chev-r"/></svg>' +
            '</button>' +
            '<div class="work-rail" id="' + uid + '-rail"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="agent-answer" id="' + uid + '-ans" hidden></div>';
    turn.querySelector(".work-note").textContent =
      "I'll inspect the relevant files in rayucode-v2 and verify the changes with cargo test before reporting back.";
    stream.appendChild(turn);
    turn.scrollIntoView({ block: "end" });

    var rail = turn.querySelector("#" + uid + "-rail");
    var tog = turn.querySelector("[data-work-toggle]");
    var lbl = tog.querySelector(".work-label");
    var ans = turn.querySelector("#" + uid + "-ans");
    var sec = 1;
    var secTimer = setInterval(function () {
      sec++;
      if (lbl && tog.classList.contains("is-live")) lbl.textContent = "Working · " + sec + "s";
    }, 1000);

    var steps = [
      {
        delay: 350,
        html: '<div class="work-step-row"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg><span>Searched for symbols matching request in <strong>crates/rayucode-core</strong></span></div>'
      },
      {
        delay: 950,
        html: '<div class="work-step-row"><svg class="icon" aria-hidden="true"><use href="#i-book"/></svg><span>Read <button class="work-file-link" type="button" data-open-preview="ptab-changes">src/session/lookup.rs:1-64</button></span></div>'
      },
      {
        delay: 1650,
        html:
          '<button class="work-cmd-toggle is-cmd-mono" type="button" data-shell-toggle="' + uid + '-sh1" aria-expanded="false">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-terminal-prompt"/></svg>' +
            '<span class="work-cmd-text">cargo test -p rayucode session:: -- --nocapture</span>' +
            '<svg class="icon chev" aria-hidden="true"><use href="#i-chev-r"/></svg>' +
          '</button>' +
          '<div class="shell-card" id="' + uid + '-sh1" hidden>' +
            '<div class="shell-card-head"><span>Shell</span><button class="shell-copy-btn" type="button" data-copy-cmd="cargo test -p rayucode session:: -- --nocapture" aria-label="Copy command" title="Copy command"><svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg></button></div>' +
            '<div class="shell-cmd-line">$ cargo test -p rayucode session:: -- --nocapture</div>' +
            '<pre class="shell-out">running 14 tests\ntest session::lookup::routes_via_shard_store ... ok\ntest session::budget::preserves_lru_eviction ... ok\ntest result: ok. 14 passed; 0 failed; 0 ignored; finished in 0.42s</pre>' +
            '<div class="shell-card-foot is-ok"><svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>Success</div>' +
          '</div>'
      }
    ];

    steps.forEach(function (st) {
      setTimeout(function () {
        var wrapDiv = document.createElement("div");
        wrapDiv.innerHTML = st.html;
        while (wrapDiv.firstChild) rail.appendChild(wrapDiv.firstChild);
        turn.scrollIntoView({ block: "end" });
      }, st.delay);
    });

    setTimeout(function () {
      clearInterval(secTimer);
      tog.classList.remove("is-live");
      var dot = tog.querySelector(".work-live-dot");
      if (dot) dot.remove();
      lbl.classList.remove("work-shimmer");
      lbl.textContent = "Worked for " + Math.max(3, sec) + "s";
      tog.setAttribute("aria-expanded", "false");
      var body = turn.querySelector("#" + uid + "-body");
      if (body) body.hidden = true;
      ans.innerHTML =
        '<p><strong>Done.</strong> Checked the local workspace for your request, verified <code>session::</code> tests (14/14 passing), and kept the right-sidebar previews in sync. <button class="cite-link" type="button" data-open-code="lookup.rs" data-open-line="19"><span class="cite-ico">&lt;/&gt;</span>src/session/lookup.rs (line 19)</button></p>' +
        '<div class="turn-actions">' +
          '<div class="turn-act-wrap">' +
            '<button class="turn-act-btn" type="button" data-turn-copy aria-label="Copy response"><svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg></button>' +
            '<div class="turn-act-card is-compact" role="tooltip"><div class="turn-act-card-title">Copy response</div></div>' +
          '</div>' +
          '<div class="turn-act-wrap">' +
            '<button class="turn-act-btn" type="button" data-turn-fork aria-label="Fork from here"><svg class="icon" aria-hidden="true"><use href="#i-fork"/></svg></button>' +
            '<div class="turn-act-card" role="tooltip"><div class="turn-act-card-title">Fork from here</div><div class="turn-act-card-desc">Starts a new session from this point. This one stays as it is.</div></div>' +
          '</div>' +
          '<div class="turn-act-wrap">' +
            '<button class="turn-act-btn" type="button" data-turn-pin aria-pressed="false" aria-label="Pin response"><svg class="icon" aria-hidden="true"><use href="#i-pin"/></svg></button>' +
            '<div class="turn-act-card" role="tooltip"><div class="turn-act-card-title">Pin response</div><div class="turn-act-card-desc">Keeps this reply pinned so you can jump back to it anytime.</div></div>' +
          '</div>' +
          '<span class="turn-time">Just now</span>' +
          '<span class="turn-meta-right"><span class="credits">0.08 cr</span><span>·</span><span>' + modelName + '</span></span>' +
        '</div>';
      ans.hidden = false;
      turn.scrollIntoView({ block: "end" });
    }, 2600);
  }

  /* ---------- Right-Sidebar Code Viewer for Blue Inline Code References ---------- */
  var CODE_FILES = {
    "lookup.rs": {
      pill: "lookup.rs",
      path: "crates / rayucode-core / src / session / lookup.rs",
      start: 10,
      lines: [
        '<span class="ck">use</span> crate::session::{<span class="ct">CacheBudget</span>, <span class="ct">Session</span>, <span class="ct">SessionKey</span>};',
        '<span class="ck">use</span> crate::shard::<span class="ct">ShardStore</span>;',
        '',
        '<span class="ck">pub struct</span> <span class="ct">SessionLookup</span> {',
        '  shards: <span class="ct">ShardStore</span>,',
        '  budget: <span class="ct">CacheBudget</span>,',
        '}',
        '',
        '<span class="ck">impl</span> <span class="ct">SessionLookup</span> {',
        '  <span class="ck">pub fn</span> <span class="cf">get</span>(&amp;<span class="ck">self</span>, key: &amp;<span class="ct">SessionKey</span>) -&gt; <span class="ct">Option</span>&lt;<span class="ct">Session</span>&gt; {',
        '    <span class="cc">// Routed directly through ShardStore with LRU touch</span>',
        '    <span class="ck">let</span> hit = <span class="ck">self</span>.shards.<span class="cf">lookup</span>(key)?;',
        '    <span class="ck">self</span>.budget.<span class="cf">touch</span>(key);',
        '    <span class="ct">Some</span>(hit)',
        '  }',
        '',
        '  <span class="ck">pub fn</span> <span class="cf">evict_over_cap</span>(&amp;<span class="ck">self</span>) -&gt; <span class="ct">usize</span> {',
        '    <span class="ck">self</span>.budget.<span class="cf">evict_oldest</span>(&amp;<span class="ck">self</span>.shards)',
        '  }',
        '}'
      ]
    },
    "cache.rs": {
      pill: "cache.rs",
      path: "crates / rayucode-core / src / session / cache.rs",
      start: 1,
      lines: [
        '<span class="cc">// Legacy SessionCache retired in favor of ShardStore::lookup.</span>',
        '<span class="cc">// 48 lines of RwLock cache state removed; key derivation</span>',
        '<span class="cc">// now lives directly in src/shard/store.rs.</span>',
        '',
        '<span class="ck">pub use</span> crate::session::lookup::<span class="ct">SessionLookup</span>;',
        '<span class="ck">pub use</span> crate::session::budget::<span class="ct">CacheBudget</span>;'
      ]
    },
    "store.rs": {
      pill: "store.rs",
      path: "crates / rayucode-core / src / shard / store.rs",
      start: 14,
      lines: [
        '<span class="ck">impl</span> <span class="ct">ShardStore</span> {',
        '  <span class="ck">pub fn</span> <span class="cf">lookup</span>(&amp;<span class="ck">self</span>, key: &amp;<span class="ct">SessionKey</span>) -&gt; <span class="ct">Option</span>&lt;<span class="ct">Session</span>&gt; {',
        '    <span class="ck">let</span> shard_idx = <span class="ck">self</span>.<span class="cf">shard_for</span>(key);',
        '    <span class="ck">self</span>.shards[shard_idx].<span class="cf">read</span>().<span class="cf">get</span>(key).<span class="cf">cloned</span>()',
        '  }',
        '',
        '  <span class="ck">fn</span> <span class="cf">shard_for</span>(&amp;<span class="ck">self</span>, key: &amp;<span class="ct">SessionKey</span>) -&gt; <span class="ct">usize</span> {',
        '    (key.<span class="cf">hash64</span>() <span class="ck">as</span> <span class="ct">usize</span>) % <span class="ck">self</span>.shards.<span class="cf">len</span>()',
        '  }',
        '}'
      ]
    }
  };

  function openCodeInSidebar(fileKey, lineNum) {
    var spec = CODE_FILES[fileKey] || CODE_FILES["lookup.rs"];
    var chgTab = document.getElementById("ptab-changes") || document.getElementById("htab-changes");
    var appEl = document.querySelector(".app");
    if (appEl) appEl.classList.remove("is-right-collapsed");
    var newActsEl = document.getElementById("new-session-actions");
    if (newActsEl) newActsEl.hidden = true;
    var stripEl = document.getElementById("active-chat-strip");
    if (stripEl) stripEl.hidden = false;
    if (chgTab) activateTab(chgTab);
    var pillEl = document.getElementById("rs-active-pill-name");
    if (pillEl) pillEl.textContent = spec.pill;
    var pathEl = document.getElementById("rs-code-path");
    if (pathEl) pathEl.textContent = spec.path;
    var bodyEl = document.getElementById("rs-code-body");
    if (bodyEl) {
      var targetLine = parseInt(lineNum || "0", 10);
      bodyEl.innerHTML = spec.lines.map(function (html, i) {
        var ln = spec.start + i;
        var hl = targetLine && ln === targetLine ? " is-hl" : "";
        return '<div class="rs-code-line' + hl + '"><span class="rs-code-ln">' + ln + '</span><span class="rs-code-src">' + html + '</span></div>';
      }).join("");
    }
    document.querySelectorAll(".rs-code-ftab").forEach(function (t) {
      t.classList.toggle("is-active", t.getAttribute("data-open-code") === fileKey);
    });
  }

  /* ---------- RayuCode Model & 5-Stop Reasoning Effort Popover ---------- */
  var EFFORT_LEVELS = ["Auto", "Low", "Medium", "High", "Max"];

  function setModelPopView(wrap, view) {
    if (!wrap) return;
    var eCard = wrap.querySelector(".effort-card");
    var lCard = wrap.querySelector(".model-list-card");
    if (eCard) eCard.hidden = view !== "effort";
    if (lCard) lCard.hidden = view !== "list";
  }

  function applyEffortIndex(wrap, idx, silent) {
    if (!wrap) return;
    idx = Math.max(0, Math.min(EFFORT_LEVELS.length - 1, idx));
    var label = EFFORT_LEVELS[idx];
    var pct = idx / (EFFORT_LEVELS.length - 1);
    var slider = wrap.querySelector(".effort-slider");
    if (slider) {
      slider.style.setProperty("--p", String(pct));
      slider.setAttribute("aria-valuenow", String(idx));
      slider.setAttribute("aria-valuetext", label);
      slider.querySelectorAll(".effort-stop").forEach(function (st) {
        var sIdx = parseInt(st.getAttribute("data-effort-idx") || "0", 10);
        st.classList.toggle("is-filled", sIdx < idx);
        st.setAttribute("aria-pressed", String(sIdx === idx));
      });
    }
    var valEl = wrap.querySelector(".effort-val");
    if (valEl) valEl.textContent = label;
    var tierEl = wrap.querySelector(".model-trigger .m-tier");
    if (tierEl) tierEl.textContent = label;
    var fastBtn = wrap.querySelector("[data-effort-fast]");
    if (fastBtn) fastBtn.classList.toggle("is-active", idx === 1);
    wrap.setAttribute("data-effort-cur", String(idx));
    try { localStorage.setItem("rayu-effort-idx", String(idx)); } catch (e) {}
    if (!silent) showToast("Reasoning effort: " + label);
  }

  function selectModelOption(wrap, opt, silent) {
    if (!wrap || !opt) return;
    var label = opt.getAttribute("data-model-label") || "Claude Opus 5.5";
    var modelId = opt.getAttribute("data-model-id") || label;
    wrap.querySelectorAll(".model-opt").forEach(function (o) {
      o.setAttribute("aria-selected", String(o === opt));
    });
    var nameEl = wrap.querySelector(".model-trigger .m-name");
    if (nameEl) nameEl.textContent = label;
    var emEl = wrap.querySelector(".effort-model-link .em-name");
    if (emEl) emEl.textContent = label;
    try { localStorage.setItem("rayu-model-id", modelId); } catch (e) {}
    if (!silent) {
      var curEffort = EFFORT_LEVELS[parseInt(wrap.getAttribute("data-effort-cur") || "2", 10)] || "Medium";
      setModelPopView(wrap, "effort");
      closeDropdowns();
      showToast("Model: " + label + " · " + curEffort);
    }
  }

  /* Restore persisted model & effort across pages */
  (function initModelWraps() {
    var savedEffort = null;
    var savedModelId = null;
    try {
      savedEffort = localStorage.getItem("rayu-effort-idx");
      savedModelId = localStorage.getItem("rayu-model-id");
    } catch (e) {}
    document.querySelectorAll(".model-wrap").forEach(function (wrap) {
      var defIdx = savedEffort !== null ? parseInt(savedEffort, 10) : parseInt(wrap.getAttribute("data-effort-cur") || "2", 10);
      if (isNaN(defIdx)) defIdx = 2;
      applyEffortIndex(wrap, defIdx, true);
      if (savedModelId) {
        var matchedOpt = wrap.querySelector('.model-opt[data-model-id="' + savedModelId + '"]');
        if (matchedOpt) selectModelOption(wrap, matchedOpt, true);
      }
    });
  })();

  /* Drag support for 5-stop pill effort slider */
  var draggingSlider = null;
  function updateSliderFromClientX(slider, clientX) {
    var rect = slider.getBoundingClientRect();
    var usable = Math.max(1, rect.width - 34);
    var rel = Math.max(0, Math.min(1, (clientX - rect.left - 17) / usable));
    var idx = Math.round(rel * (EFFORT_LEVELS.length - 1));
    var wrap = slider.closest(".model-wrap");
    if (wrap && parseInt(wrap.getAttribute("data-effort-cur") || "2", 10) !== idx) {
      applyEffortIndex(wrap, idx, true);
    }
  }
  document.addEventListener("pointerdown", function (ev) {
    var slider = ev.target.closest(".effort-slider");
    if (!slider) return;
    draggingSlider = slider;
    updateSliderFromClientX(slider, ev.clientX);
  });
  document.addEventListener("pointermove", function (ev) {
    if (!draggingSlider) return;
    updateSliderFromClientX(draggingSlider, ev.clientX);
  });
  document.addEventListener("pointerup", function () {
    if (!draggingSlider) return;
    var wrap = draggingSlider.closest(".model-wrap");
    draggingSlider = null;
    if (wrap) {
      var curIdx = parseInt(wrap.getAttribute("data-effort-cur") || "2", 10);
      showToast("Reasoning effort: " + (EFFORT_LEVELS[curIdx] || "Medium"));
    }
  });

  function selectPermissionMode(wrap, opt) {
    if (!wrap || !opt) return;
    var label = opt.getAttribute("data-perm-label") || "Ask";
    var icon = opt.getAttribute("data-perm-icon") || "#i-lock";
    wrap.querySelectorAll(".perm-opt").forEach(function (o) {
      o.setAttribute("aria-selected", String(o === opt));
    });
    var trig = wrap.querySelector(".perm-trigger");
    if (trig) {
      var lbl = trig.querySelector(".mode-label");
      if (lbl) lbl.textContent = label;
      var use = trig.querySelector(".perm-trigger-icon use");
      if (use) use.setAttribute("href", icon);
    }
    var badge = document.querySelector("[data-session-mode-badge]");
    if (badge) badge.textContent = label;
    closeDropdowns();
    showToast("Local Permissions: " + label);
  }

  document.addEventListener("click", function (ev) {
    /* Theme toggle */
    var t = ev.target.closest("[data-theme-set], .theme-toggle");
    if (t) {
      if (t.hasAttribute("data-theme-set")) applyTheme(t.getAttribute("data-theme-set"));
      else applyTheme(root.getAttribute("data-theme") === "light" ? "dark" : "light");
      return;
    }

    /* Accent color toggle (Rayu Green / Ocean Blue) */
    var acc = ev.target.closest("[data-accent-set]");
    if (acc) {
      applyAccent(acc.getAttribute("data-accent-set"), true);
      return;
    }

    /* Left sidebar toggle */
    var sb = ev.target.closest("[data-toggle-sidebar]");
    if (sb) {
      var appEl = document.querySelector(".app");
      if (appEl) {
        var collapsed = appEl.classList.toggle("is-left-collapsed");
        document.querySelectorAll("[data-toggle-sidebar]").forEach(function (b) {
          b.setAttribute("aria-pressed", String(!collapsed));
        });
      }
      var spApp = document.querySelector(".settings-app");
      if (spApp) {
        var spCollapsed = spApp.classList.toggle("is-sp-collapsed");
        document.querySelectorAll("[data-toggle-sidebar]").forEach(function (b) {
          b.setAttribute("aria-pressed", String(!spCollapsed));
        });
      }
      return;
    }

    /* Full-page Settings sidebar section switcher */
    var spNav = ev.target.closest("[data-sp-section]");
    if (spNav) {
      var secId = spNav.getAttribute("data-sp-section");
      document.querySelectorAll("[data-sp-section]").forEach(function (b) {
        b.classList.toggle("is-active", b === spNav);
      });
      var panels = document.querySelectorAll(".sp-panel");
      var matched = document.getElementById("sp-panel-" + secId);
      if (matched) {
        panels.forEach(function (p) { p.hidden = p !== matched; });
      } else {
        var fallback = document.getElementById("sp-panel-generic");
        if (fallback) {
          panels.forEach(function (p) { p.hidden = p !== fallback; });
          var labelEl = spNav.querySelector("span:not(.sp-mini-avatar)");
          var titleText = labelEl ? labelEl.textContent : secId;
          var ft = fallback.querySelector(".sp-title");
          var fs = fallback.querySelector(".sp-subtitle");
          if (ft) ft.textContent = titleText;
          if (fs) fs.textContent = "Manage your " + titleText.toLowerCase() + " preferences";
        }
      }
      return;
    }

    /* Right sidebar toggle */
    var dr = ev.target.closest("[data-toggle-drawer]");
    if (dr) {
      var appR = document.querySelector(".app");
      if (appR) {
        appR.classList.remove("is-browser-full");
        var hidden = appR.classList.toggle("is-right-collapsed");
        dr.classList.toggle("is-active", !hidden);
        dr.setAttribute("aria-pressed", String(!hidden));
      }
      return;
    }

    /* Browser Full-View enter / exit */
    var bfEnter = ev.target.closest("[data-browser-full]");
    if (bfEnter) {
      var appBf = document.querySelector(".app");
      if (appBf) {
        appBf.classList.remove("is-right-collapsed");
        appBf.classList.add("is-browser-full");
      }
      closeDropdowns();
      return;
    }
    var bfExit = ev.target.closest("[data-browser-exit]");
    if (bfExit) {
      var appBx = document.querySelector(".app");
      if (appBx) appBx.classList.remove("is-browser-full");
      closeDropdowns();
      return;
    }

    /* Browser Zoom controls inside "..." menu */
    var zBtn = ev.target.closest("[data-browser-zoom]");
    if (zBtn) {
      var step = zBtn.getAttribute("data-browser-zoom");
      var shell = zBtn.closest(".rb-shell");
      var surf = shell && shell.querySelector(".rb-page-surface");
      var valEl = shell && shell.querySelector(".rb-zoom-val");
      if (surf && valEl) {
        var curZ = parseInt(surf.getAttribute("data-zoom") || "100", 10);
        var nextZ = step === "reset" ? 100 : Math.max(70, Math.min(130, curZ + parseInt(step, 10)));
        surf.setAttribute("data-zoom", String(nextZ));
        valEl.textContent = nextZ + "%";
        surf.style.transform = nextZ === 100 ? "" : "scale(" + (nextZ / 100) + ")";
      }
      return;
    }

    /* Browser Device Toolbar toggle */
    var devBtn = ev.target.closest("[data-browser-device]");
    if (devBtn) {
      var sh = devBtn.closest(".rb-shell");
      var sf = sh && sh.querySelector(".rb-page-surface");
      if (sf) {
        var mob = sf.classList.toggle("is-mobile");
        showToast(mob ? "Device toolbar: Mobile (375px)" : "Device toolbar: Desktop");
      }
      closeDropdowns();
      return;
    }

    /* Floating Browser Chat minimize / toggle */
    var fbMin = ev.target.closest("[data-fb-toggle]");
    if (fbMin) {
      var shFb = fbMin.closest(".rb-shell") || document;
      var fb = shFb.querySelector(".fb-chat");
      if (fb) {
        fb.classList.toggle("is-minimized");
        if (!fb.classList.contains("is-minimized")) {
          var inpFb = fb.querySelector(".fb-chat-input");
          if (inpFb) inpFb.focus();
        }
      }
      return;
    }
    var fbSend = ev.target.closest("[data-fb-send]");
    if (fbSend) {
      var fbCard = fbSend.closest(".fb-chat");
      var inpF = fbCard && fbCard.querySelector(".fb-chat-input");
      var bodyF = fbCard && fbCard.querySelector(".fb-chat-body");
      if (inpF && bodyF && inpF.value.trim()) {
        var pMsg = document.createElement("p");
        pMsg.innerHTML = '<strong>You:</strong> <span></span>';
        pMsg.querySelector("span").textContent = inpF.value.trim();
        bodyF.appendChild(pMsg);
        var pRep = document.createElement("p");
        pRep.innerHTML = '<strong>RayuCode:</strong> Inspected the live page DOM and updated the active session context.';
        bodyF.appendChild(pRep);
        bodyF.scrollTop = bodyF.scrollHeight;
        inpF.value = "";
      }
      return;
    }

    /* Telegram Remote pairing mode tabs & approval queue actions */
    var tgMode = ev.target.closest("[data-tg-mode]");
    if (tgMode) {
      var mId = tgMode.getAttribute("data-tg-mode");
      document.querySelectorAll("[data-tg-mode]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === tgMode));
      });
      ["connected", "hosted", "byo"].forEach(function (k) {
        var p = document.getElementById("tg-panel-" + k);
        if (p) p.hidden = k !== mId;
      });
      return;
    }
    var apprBtn = ev.target.closest("[data-approval-act]");
    if (apprBtn) {
      var act = apprBtn.getAttribute("data-approval-act");
      var rowA = apprBtn.closest(".op-ledger-row");
      if (rowA) {
        var acts = rowA.querySelector(".op-actions");
        if (acts) {
          acts.innerHTML = act === "approve"
            ? '<span class="badge badge-live">Approved via host</span>'
            : '<span class="badge badge-danger">Denied</span>';
        }
        showToast(act === "approve" ? "Tool approval sent to session" : "Tool request denied");
      }
      return;
    }

    /* Automations inline overnight run launcher */
    var launchTrig = ev.target.closest("[data-toggle-launcher]");
    if (launchTrig) {
      var ln = document.getElementById("overnight-launcher");
      if (ln) {
        ln.hidden = !ln.hidden;
        if (!ln.hidden) {
          var mi = ln.querySelector("input");
          if (mi) mi.focus();
        }
      }
      return;
    }
    var launchGo = ev.target.closest("[data-launch-overnight]");
    if (launchGo) {
      var lBox = document.getElementById("overnight-launcher");
      var mInput = lBox && lBox.querySelector("#ovn-mission");
      var durSel = lBox && lBox.querySelector("#ovn-duration");
      var activeList = document.getElementById("ovn-running-list");
      var mission = (mInput && mInput.value.trim()) || "Run full regression suite and draft morning handoff";
      var dur = (durSel && durSel.value) || "8h overnight";
      if (activeList) {
        var rowN = document.createElement("div");
        rowN.className = "op-ledger-row";
        rowN.innerHTML =
          '<div class="op-ledger-main">' +
            '<div class="op-ledger-name"><span class="pulse pulse-live"></span><span></span><span class="badge badge-live">Running</span></div>' +
            '<div class="op-ledger-meta">run_id: ovn_new · choeng-rayu-1 · ' + dur + ' · handoff ready 15m before wake</div>' +
          '</div>' +
          '<div class="op-actions"><button class="btn btn-danger-ghost btn-sm" type="button" data-toast="Cancellation requested for ovn_new">Cancel</button></div>';
        rowN.querySelector(".op-ledger-name span:nth-child(2)").textContent = mission;
        activeList.prepend(rowN);
      }
      if (mInput) mInput.value = "";
      if (lBox) lBox.hidden = true;
      showToast("Launched overnight run (" + dur + ")");
      return;
    }

    /* Authentic Microsoft Excel Right-Sidebar Workbook interactions */
    var xlCell = ev.target.closest(".xl-sheet td[data-ref]");
    if (xlCell) {
      var tbl = xlCell.closest(".xl-sheet");
      tbl.querySelectorAll("td.is-selected").forEach(function (c) { c.classList.remove("is-selected"); });
      xlCell.classList.add("is-selected");
      var appX = xlCell.closest(".xl-app");
      var nb = appX && appX.querySelector(".xl-namebox");
      var fi = appX && appX.querySelector(".xl-finput");
      if (nb) nb.textContent = xlCell.getAttribute("data-ref");
      if (fi) fi.value = xlCell.getAttribute("data-formula") || xlCell.textContent.trim();
      return;
    }

    var xlSheetTab = ev.target.closest("[data-xl-sheet]");
    if (xlSheetTab) {
      var targetSheet = xlSheetTab.getAttribute("data-xl-sheet");
      var appS = xlSheetTab.closest(".xl-app");
      if (appS) {
        appS.querySelectorAll("[data-xl-sheet]").forEach(function (b) {
          b.classList.toggle("is-active", b === xlSheetTab);
        });
        appS.querySelectorAll("[data-xl-sheet-table]").forEach(function (t) {
          t.hidden = t.getAttribute("data-xl-sheet-table") !== targetSheet;
        });
      }
      return;
    }

    var xlEmbedTog = ev.target.closest("[data-xl-embed-toggle]");
    if (xlEmbedTog) {
      var bar = document.getElementById("xl-embed-bar");
      if (bar) {
        bar.hidden = !bar.hidden;
        if (!bar.hidden) {
          var urlInp = bar.querySelector("input");
          if (urlInp) urlInp.focus();
        }
      }
      return;
    }

    var xlEmbedLoad = ev.target.closest("[data-xl-embed-load]");
    if (xlEmbedLoad) {
      var barL = document.getElementById("xl-embed-bar");
      var inpL = barL && barL.querySelector("input");
      var rawUrl = inpL ? inpL.value.trim() : "";
      if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
        showToast("Enter a public HTTPS .xlsx or OneDrive embed URL");
        return;
      }
      var embedSrc = /view\.officeapps\.live\.com|onedrive\.live\.com\/embed|sharepoint\.com/i.test(rawUrl)
        ? rawUrl
        : "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(rawUrl);
      var wrapIf = document.getElementById("xl-iframe-wrap");
      var localWrap = document.getElementById("xl-local-scroll");
      var iframe = wrapIf && wrapIf.querySelector("iframe");
      if (iframe && wrapIf && localWrap) {
        iframe.src = embedSrc;
        wrapIf.hidden = false;
        localWrap.hidden = true;
        showToast("Loaded live Microsoft Office Web Viewer");
      }
      return;
    }

    var xlEmbedClose = ev.target.closest("[data-xl-embed-local]");
    if (xlEmbedClose) {
      var wrapIf2 = document.getElementById("xl-iframe-wrap");
      var localWrap2 = document.getElementById("xl-local-scroll");
      if (wrapIf2 && localWrap2) {
        wrapIf2.hidden = true;
        localWrap2.hidden = false;
      }
      return;
    }

    /* Changes page file switcher */
    var chgFile = ev.target.closest("[data-change-file]");
    if (chgFile) {
      var cid = chgFile.getAttribute("data-change-file");
      document.querySelectorAll("[data-change-file]").forEach(function (b) {
        b.classList.toggle("is-active", b === chgFile);
      });
      document.querySelectorAll(".chg-panel").forEach(function (p) {
        p.hidden = p.id !== cid;
      });
      return;
    }

    /* Open code file & highlight line inside right sidebar */
    var openCode = ev.target.closest("[data-open-code]");
    if (openCode) {
      openCodeInSidebar(openCode.getAttribute("data-open-code"), openCode.getAttribute("data-open-line"));
      return;
    }

    /* Open preview tab inside right sidebar */
    var openPrev = ev.target.closest("[data-open-preview]");
    if (openPrev) {
      var tabId = openPrev.getAttribute("data-open-preview");
      var appOpen = document.querySelector(".app");
      if (appOpen) appOpen.classList.remove("is-right-collapsed");
      var newActsEl = document.getElementById("new-session-actions");
      if (newActsEl) newActsEl.hidden = true;
      var stripEl = document.getElementById("active-chat-strip");
      if (stripEl) stripEl.hidden = false;
      var tabBtn = document.getElementById(tabId);
      if (tabBtn) activateTab(tabBtn);
      return;
    }

    /* Codex-style Work Trace, Tool Group, Shell Output Card & Copy interactions */
    var workTog = ev.target.closest("[data-work-toggle]");
    if (workTog) {
      var wTarget = document.getElementById(workTog.getAttribute("data-work-toggle"));
      if (wTarget) {
        var isOpen = workTog.getAttribute("aria-expanded") === "true";
        workTog.setAttribute("aria-expanded", String(!isOpen));
        wTarget.hidden = isOpen;
      }
      return;
    }
    var grpTog = ev.target.closest("[data-group-toggle]");
    if (grpTog) {
      var gTarget = document.getElementById(grpTog.getAttribute("data-group-toggle"));
      if (gTarget) {
        var gOpen = grpTog.getAttribute("aria-expanded") === "true";
        grpTog.setAttribute("aria-expanded", String(!gOpen));
        gTarget.hidden = gOpen;
      }
      return;
    }
    var shTog = ev.target.closest("[data-shell-toggle]");
    if (shTog) {
      var sTarget = document.getElementById(shTog.getAttribute("data-shell-toggle"));
      if (sTarget) {
        var sOpen = shTog.getAttribute("aria-expanded") === "true";
        shTog.setAttribute("aria-expanded", String(!sOpen));
        sTarget.hidden = sOpen;
      }
      return;
    }
    var copyCmd = ev.target.closest("[data-copy-cmd]");
    if (copyCmd) {
      var cmdTxt = copyCmd.getAttribute("data-copy-cmd") || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmdTxt).catch(function () {});
      }
      showToast("Copied command");
      return;
    }
    var replayBtn = ev.target.closest("[data-replay-trace]");
    if (replayBtn) {
      var streamEl = document.querySelector(".stream");
      if (streamEl) {
        var activeMod = (document.querySelector(".model-trigger .m-name") || {}).textContent || "Claude Opus 5.5";
        streamLiveAgentTurn(streamEl, "Re-verify session:: tests", activeMod);
      }
      return;
    }

    /* End-of-response actions: Copy, Fork from here, Pin */
    var turnCopy = ev.target.closest("[data-turn-copy]");
    if (turnCopy) {
      var turnMsg = turnCopy.closest(".msg-agent");
      var ansText = (turnMsg && turnMsg.querySelector(".agent-answer") || {}).innerText || "";
      if (navigator.clipboard && navigator.clipboard.writeText && ansText) {
        navigator.clipboard.writeText(ansText.trim()).catch(function () {});
      }
      turnCopy.classList.add("is-copied");
      var uCopy = turnCopy.querySelector("use");
      if (uCopy) uCopy.setAttribute("href", "#i-check");
      setTimeout(function () {
        turnCopy.classList.remove("is-copied");
        if (uCopy) uCopy.setAttribute("href", "#i-copy");
      }, 1500);
      showToast("Copied response to clipboard");
      return;
    }
    var turnFork = ev.target.closest("[data-turn-fork]");
    if (turnFork) {
      showToast("Forked new session from this point · original kept as is");
      return;
    }
    var turnPin = ev.target.closest("[data-turn-pin]");
    if (turnPin) {
      var nowPinned = turnPin.classList.toggle("is-pinned");
      turnPin.setAttribute("aria-pressed", String(nowPinned));
      showToast(nowPinned ? "Pinned response to session" : "Unpinned response");
      return;
    }

    /* Model & Effort popover actions */
    var openModelList = ev.target.closest("[data-model-open-list]");
    if (openModelList) {
      ev.stopPropagation();
      setModelPopView(openModelList.closest(".model-wrap"), "list");
      return;
    }
    var backEffort = ev.target.closest("[data-model-back-effort]");
    if (backEffort) {
      ev.stopPropagation();
      setModelPopView(backEffort.closest(".model-wrap"), "effort");
      return;
    }
    var effortStop = ev.target.closest(".effort-stop");
    if (effortStop) {
      ev.stopPropagation();
      var sIdx = parseInt(effortStop.getAttribute("data-effort-idx") || "2", 10);
      applyEffortIndex(effortStop.closest(".model-wrap"), sIdx, false);
      return;
    }
    var fastEffort = ev.target.closest("[data-effort-fast]");
    if (fastEffort) {
      ev.stopPropagation();
      var fWrap = fastEffort.closest(".model-wrap");
      var curE = parseInt((fWrap && fWrap.getAttribute("data-effort-cur")) || "2", 10);
      applyEffortIndex(fWrap, curE === 1 ? 2 : 1, false);
      return;
    }
    var resetEffort = ev.target.closest("[data-effort-reset]");
    if (resetEffort) {
      ev.stopPropagation();
      applyEffortIndex(resetEffort.closest(".model-wrap"), 2, false);
      return;
    }
    var modelOpt = ev.target.closest(".model-opt");
    if (modelOpt) {
      ev.stopPropagation();
      selectModelOption(modelOpt.closest(".model-wrap"), modelOpt, false);
      return;
    }

    /* Select RayuCode Local Permissions mode from popover */
    var permOpt = ev.target.closest(".perm-opt");
    if (permOpt) {
      selectPermissionMode(permOpt.closest(".perm-wrap"), permOpt);
      return;
    }

    /* Dropdown trigger */
    var dd = ev.target.closest("[data-dropdown]");
    if (dd) {
      ev.stopPropagation();
      var menu = document.getElementById(dd.getAttribute("data-dropdown"));
      if (menu) {
        var willOpen = menu.hidden;
        closeDropdowns(menu);
        if (willOpen && dd.classList.contains("model-trigger")) {
          setModelPopView(dd.closest(".model-wrap"), "effort");
        }
        menu.hidden = !willOpen;
        dd.setAttribute("aria-expanded", String(willOpen));
      }
      return;
    }

    /* Toast feedback */
    var toastBtn = ev.target.closest("[data-toast]");
    if (toastBtn) {
      showToast(toastBtn.getAttribute("data-toast"));
      closeDropdowns();
      return;
    }

    /* Slash command insert */
    var slashRow = ev.target.closest("[data-slash-insert]");
    if (slashRow) {
      var cmd = slashRow.getAttribute("data-slash-insert");
      var comp = slashRow.closest(".composer-shell");
      var inp = comp && comp.querySelector(".composer-input");
      if (inp) { inp.value = cmd + " "; inp.focus(); }
      var pop = slashRow.closest(".slash-pop");
      if (pop) pop.hidden = true;
      return;
    }

    if (!ev.target.closest("[data-dropdown-menu]") || ev.target.closest(".usage-pop-action, .profile-pop-item, .profile-pop-account")) closeDropdowns();

    /* Swarm page: select agent, spawn worker, stop/retry, send steering DM */
    var swSel = ev.target.closest("[data-sw-select]");
    if (swSel) {
      var aid = swSel.getAttribute("data-sw-select");
      document.querySelectorAll("[data-sw-select]").forEach(function (el) {
        el.classList.toggle("is-selected", el.getAttribute("data-sw-select") === aid);
        el.classList.toggle("is-active", el.getAttribute("data-sw-select") === aid && el.classList.contains("conv-row"));
      });
      document.querySelectorAll(".sw-detail-panel").forEach(function (p) {
        p.hidden = p.getAttribute("data-sw-panel") !== aid;
      });
      return;
    }
    var swTogSpawn = ev.target.closest("[data-sw-toggle-spawn]");
    if (swTogSpawn) {
      var sBar = document.getElementById("sw-spawn-bar");
      if (sBar) {
        sBar.hidden = !sBar.hidden;
        if (!sBar.hidden) {
          var sInp = sBar.querySelector("#sw-new-task");
          if (sInp) sInp.focus();
        }
      }
      return;
    }
    var swSpawnGo = ev.target.closest("[data-sw-spawn-go]");
    if (swSpawnGo) {
      var nameInp = document.getElementById("sw-new-name");
      var modSel = document.getElementById("sw-new-model");
      var wtSel = document.getElementById("sw-new-wt");
      var taskInp = document.getElementById("sw-new-task");
      var roster = document.getElementById("sw-roster-list");
      var wName = (nameInp && nameInp.value.trim()) || "worker-3";
      var wMod = (modSel && modSel.value) || "Claude Sonnet 5";
      var wWt = (wtSel && wtSel.value) || "wt/new-scope";
      var wTask = (taskInp && taskInp.value.trim()) || "Run regression checks on gateway retry dedup";
      if (roster) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sw-agent-row";
        btn.setAttribute("data-sw-select", "worker-1");
        btn.innerHTML =
          '<div class="sw-agent-top"><span class="pulse pulse-live" aria-hidden="true"></span><span class="sw-agent-name"></span><span class="sw-agent-role"></span><span class="sw-agent-state is-run">running</span></div>' +
          '<div class="sw-agent-task"></div>' +
          '<div class="sw-agent-meta"><span></span><span>·</span><span>0 / 2 lane items</span><span>·</span><span>just now</span></div>';
        btn.querySelector(".sw-agent-name").textContent = wName;
        btn.querySelector(".sw-agent-role").textContent = wWt;
        btn.querySelector(".sw-agent-task").textContent = wTask;
        btn.querySelector(".sw-agent-meta span").textContent = wMod;
        roster.appendChild(btn);
      }
      var board = document.getElementById("sw-board-feed");
      if (board) {
        var bRow = document.createElement("div");
        bRow.className = "sw-board-row";
        bRow.innerHTML = '<span class="sw-board-time">just now</span><span class="sw-board-route">coordinator <span>→</span> </span><span></span><span class="sw-board-tag is-ok">spawned</span>';
        bRow.querySelector(".sw-board-route").appendChild(document.createTextNode(wName));
        bRow.querySelector("span:nth-child(3)").textContent = "Assigned lane (" + wWt + "): " + wTask;
        board.prepend(bRow);
      }
      var sBar2 = document.getElementById("sw-spawn-bar");
      if (sBar2) sBar2.hidden = true;
      if (taskInp) taskInp.value = "";
      showToast("Spawned " + wName + " (" + wMod + ")");
      return;
    }
    var swStop = ev.target.closest("[data-sw-stop]");
    if (swStop) {
      var targetAgent = swStop.getAttribute("data-sw-stop");
      var stopped = swStop.getAttribute("data-stopped") === "true";
      swStop.setAttribute("data-stopped", String(!stopped));
      swStop.textContent = stopped ? "Stop" : "Resume";
      showToast(stopped ? "Resumed " + targetAgent : "Stopped " + targetAgent + " cleanly");
      return;
    }
    var swDmSend = ev.target.closest("[data-sw-dm-send]");
    if (swDmSend) {
      var panel = swDmSend.closest(".sw-detail-panel");
      var inp = panel && panel.querySelector(".sw-dm-input");
      var targetName = swDmSend.getAttribute("data-sw-dm-send") || "worker-1";
      var txt = inp ? inp.value.trim() : "";
      if (!txt) { if (inp) inp.focus(); return; }
      var board2 = document.getElementById("sw-board-feed");
      if (board2) {
        var dmRow = document.createElement("div");
        dmRow.className = "sw-board-row";
        dmRow.innerHTML = '<span class="sw-board-time">just now</span><span class="sw-board-route">you <span>→</span> </span><span></span><span class="sw-board-tag">dm</span>';
        dmRow.querySelector(".sw-board-route").appendChild(document.createTextNode(targetName));
        dmRow.querySelector("span:nth-child(3)").textContent = txt;
        board2.prepend(dmRow);
      }
      inp.value = "";
      showToast("Sent steering DM to " + targetName);
      return;
    }

    /* Context dotted-underline inline detail breakdown & Connectors Show more */
    var ctxDet = ev.target.closest("[data-ctx-detail]");
    if (ctxDet) {
      var detId = ctxDet.getAttribute("data-ctx-detail");
      var detEl = document.getElementById(detId);
      if (detEl) {
        var wasOpen = ctxDet.getAttribute("aria-expanded") === "true";
        ctxDet.setAttribute("aria-expanded", String(!wasOpen));
        detEl.hidden = wasOpen;
      }
      return;
    }
    var connMore = ev.target.closest("[data-conn-more]");
    if (connMore) {
      var extraId = connMore.getAttribute("data-conn-more");
      var extraEl = document.getElementById(extraId);
      if (extraEl) {
        var nowHidden = !extraEl.hidden;
        extraEl.hidden = nowHidden;
        connMore.textContent = nowHidden ? "Show more" : "Show less";
      }
      return;
    }

    /* Collapsibles */
    var tog = ev.target.closest("[data-collapse]");
    if (tog) {
      var bodyEl = document.getElementById(tog.getAttribute("data-collapse"));
      if (bodyEl) {
        var open = tog.getAttribute("aria-expanded") === "true";
        tog.setAttribute("aria-expanded", String(!open));
        bodyEl.hidden = open;
      }
      return;
    }

    /* Segmented buttons */
    var seg = ev.target.closest(".seg button");
    if (seg) {
      seg.parentElement.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === seg));
      });
      return;
    }

    /* Tabs */
    var tab = ev.target.closest("[role='tab']");
    if (tab) { activateTab(tab); return; }

    /* Browser Desktop/Mobile viewport */
    var vpBtn = ev.target.closest("[data-viewport]");
    if (vpBtn) {
      var mode = vpBtn.getAttribute("data-viewport");
      var scope = vpBtn.closest(".preview-panel") || document;
      var frame = scope.querySelector(".browser-viewport");
      if (frame) frame.classList.toggle("is-mobile", mode === "mobile");
      vpBtn.parentElement.querySelectorAll("[data-viewport]").forEach(function (b) {
        b.classList.toggle("is-active", b === vpBtn);
      });
      return;
    }

    /* PowerPoint slide switcher */
    var slideBtn = ev.target.closest("[data-slide]");
    if (slideBtn) {
      var idx = slideBtn.getAttribute("data-slide");
      var wrap = slideBtn.closest(".ppt-layout") || document;
      wrap.querySelectorAll("[data-slide]").forEach(function (b) {
        b.classList.toggle("is-active", b === slideBtn);
      });
      wrap.querySelectorAll(".ppt-slide").forEach(function (s) {
        s.hidden = s.getAttribute("data-slide-panel") !== idx;
      });
      return;
    }

    /* Markdown Rendered/Raw toggle */
    var mdMode = ev.target.closest("[data-md-mode]");
    if (mdMode) {
      var m = mdMode.getAttribute("data-md-mode");
      var panel = mdMode.closest(".preview-panel") || document;
      var rendered = panel.querySelector("[data-md-rendered]");
      var raw = panel.querySelector("[data-md-raw]");
      if (rendered && raw) {
        rendered.hidden = m !== "rendered";
        raw.hidden = m !== "raw";
      }
      return;
    }

    /* Getting started checklist items (Codex-style sidebar card) */
    var gsItem = ev.target.closest("[data-gs-item]");
    if (gsItem) {
      gsItem.classList.toggle("is-done");
      var card = gsItem.closest(".gs-card");
      if (card) {
        var all = card.querySelectorAll("[data-gs-item]");
        var done = card.querySelectorAll("[data-gs-item].is-done").length;
        var cnt = card.querySelector(".gs-count");
        var fill = card.querySelector(".gs-fill");
        if (cnt) cnt.textContent = done + " of " + all.length;
        if (fill) fill.style.width = Math.round((done / all.length) * 100) + "%";
      }
      return;
    }

    /* Featured Plugin Showcase Tile Selector & Quick Add */
    var heroTile = ev.target.closest("[data-hero-plugin]");
    if (heroTile) {
      var hero = heroTile.closest(".plugin-hero");
      if (hero) {
        hero.querySelectorAll("[data-hero-plugin]").forEach(function (t) {
          t.classList.toggle("is-selected", t === heroTile);
          t.setAttribute("aria-pressed", String(t === heroTile));
        });
        var hTitle = hero.querySelector("#hero-plugin-title");
        var hDesc = hero.querySelector("#hero-plugin-desc");
        var hAdd = hero.querySelector("#hero-plugin-add");
        var hDet = hero.querySelector("#hero-plugin-details");
        var pName = heroTile.getAttribute("data-hero-plugin") || "Dynatrace";
        var pDesc = heroTile.getAttribute("data-hero-desc") || "";
        if (hTitle) hTitle.textContent = pName;
        if (hDesc) hDesc.textContent = pDesc;
        if (hAdd) {
          hAdd.setAttribute("data-hero-install", pName);
          var already = !!document.querySelector('#installed-plugins-list [data-plugin-remove="' + pName + '"]');
          hAdd.innerHTML = already
            ? '<svg class="icon" style="width:13px;height:13px" aria-hidden="true"><use href="#i-check"/></svg>Added'
            : '<svg class="icon" style="width:13px;height:13px" aria-hidden="true"><use href="#i-plus"/></svg>Add';
        }
        if (hDet) hDet.setAttribute("data-toast", pName + " · MCP server & RayuCode skills ready");
      }
      return;
    }

    var heroInstall = ev.target.closest("[data-hero-install]");
    if (heroInstall) {
      var targetName = heroInstall.getAttribute("data-hero-install") || "Dynatrace";
      var gridMatch = document.querySelector('[data-plugin-toggle="' + targetName + '"]');
      if (gridMatch) {
        gridMatch.click();
        var nowOn = gridMatch.classList.contains("is-installed");
        heroInstall.innerHTML = nowOn
          ? '<svg class="icon" style="width:13px;height:13px" aria-hidden="true"><use href="#i-check"/></svg>Added'
          : '<svg class="icon" style="width:13px;height:13px" aria-hidden="true"><use href="#i-plus"/></svg>Add';
      } else {
        var selTile = document.querySelector(".hero-tile.is-selected");
        var alreadyIn = !!document.querySelector('#installed-plugins-list [data-plugin-remove="' + targetName + '"]');
        var fakeWrap = document.createElement("div");
        if (selTile) {
          var lDiv = document.createElement("div");
          lDiv.className = "plugin-logo";
          lDiv.innerHTML = selTile.innerHTML;
          fakeWrap.appendChild(lDiv);
        }
        syncInstalledPlugins(fakeWrap, targetName, !alreadyIn);
        heroInstall.innerHTML = !alreadyIn
          ? '<svg class="icon" style="width:13px;height:13px" aria-hidden="true"><use href="#i-check"/></svg>Added'
          : '<svg class="icon" style="width:13px;height:13px" aria-hidden="true"><use href="#i-plus"/></svg>Add';
        showToast(!alreadyIn ? "Connected " + targetName : "Disconnected " + targetName);
      }
      return;
    }

    /* Plugins directory: install / uninstall toggle + sidebar Installed sync */
    var plugBtn = ev.target.closest("[data-plugin-toggle]");
    if (plugBtn) {
      var item = plugBtn.closest(".plugin-item");
      var name = plugBtn.getAttribute("data-plugin-toggle");
      var installed = plugBtn.classList.toggle("is-installed");
      plugBtn.setAttribute("aria-pressed", String(installed));
      var useEl = plugBtn.querySelector("use");
      if (useEl) useEl.setAttribute("href", installed ? "#i-check" : "#i-plus");
      syncInstalledPlugins(item, name, installed);
      showToast(installed ? "Connected " + name : "Disconnected " + name);
      return;
    }

    /* Remove plugin directly from sidebar Installed list */
    var rmPlug = ev.target.closest("[data-plugin-remove]");
    if (rmPlug) {
      var rmName = rmPlug.getAttribute("data-plugin-remove");
      var btnMatch = document.querySelector('[data-plugin-toggle="' + rmName + '"]');
      if (btnMatch) btnMatch.click();
      return;
    }

    /* Customize pane Plugins / Skills / Memory switcher */
    var custTab = ev.target.closest("[data-customize-view]");
    if (custTab) {
      activateCustomizeView(custTab.getAttribute("data-customize-view"));
      return;
    }

    /* Switch */
    var sw = ev.target.closest(".switch");
    if (sw) {
      sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true"));
      return;
    }

    /* Diff accept / reject / reset */
    var accept = ev.target.closest("[data-diff-accept]");
    if (accept) {
      var diff = accept.closest(".diff");
      diff.classList.add("is-accepted");
      diff.querySelector(".diff-foot").innerHTML =
        '<span class="hint">Accepted · staged for commit</span><span class="spacer"></span>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-diff-reset>Undo</button>';
      return;
    }
    var reject = ev.target.closest("[data-diff-reject]");
    if (reject) {
      var d = reject.closest(".diff");
      d.classList.remove("is-accepted");
      d.querySelector(".diff-foot").innerHTML =
        '<span class="hint" style="color:var(--danger)">Rejected · rayu will revise</span><span class="spacer"></span>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-diff-reset>Restore</button>';
      return;
    }
    var reset = ev.target.closest("[data-diff-reset]");
    if (reset) {
      var drDiff = reset.closest(".diff");
      drDiff.classList.remove("is-accepted");
      drDiff.querySelector(".diff-foot").innerHTML =
        '<span class="hint">Ready for review · tests green</span><span class="spacer"></span>' +
        '<button class="btn btn-danger-ghost btn-sm" type="button" data-diff-reject>Reject</button>' +
        '<button class="btn btn-primary btn-sm" type="button" data-diff-accept><svg class="icon" style="width:12px;height:12px" aria-hidden="true"><use href="#i-check"/></svg>Accept</button>';
      return;
    }

    /* Remove chip */
    var chipX = ev.target.closest(".chip-x");
    if (chipX) { chipX.closest(".chip").remove(); return; }

    /* Fill prompt */
    var starter = ev.target.closest("[data-fill-prompt]");
    if (starter) {
      var inputEl = document.querySelector(".composer-input");
      if (inputEl) { inputEl.value = starter.getAttribute("data-fill-prompt"); inputEl.focus(); }
      return;
    }

    /* Send message */
    var send = ev.target.closest(".send-orb");
    if (send) {
      sendComposerMessage(send.closest(".composer-shell"));
    }
  });

  function syncInstalledPlugins(item, name, installed) {
    var list = document.getElementById("installed-plugins-list");
    var empty = document.getElementById("installed-plugins-empty");
    if (!list || !empty) return;
    var existing = list.querySelector('[data-plugin-remove="' + name + '"]');
    if (installed && !existing) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "installed-row";
      row.setAttribute("data-plugin-remove", name);
      row.title = "Click to disconnect " + name;
      var logoClone = item && item.querySelector(".plugin-logo") ? item.querySelector(".plugin-logo").innerHTML : "";
      row.innerHTML =
        '<span class="installed-mini-ico">' + logoClone + '</span>' +
        '<span></span>' +
        '<span class="inst-rm">Remove</span>';
      row.querySelector("span:nth-child(2)").textContent = name;
      list.appendChild(row);
    } else if (!installed && existing) {
      existing.remove();
    }
    empty.hidden = list.children.length > 0;
  }

  document.addEventListener("input", function (ev) {
    if (ev.target && ev.target.matches && ev.target.matches(".xl-sheet td[contenteditable='true']")) {
      var tbl = ev.target.closest(".xl-sheet");
      var appX = ev.target.closest(".xl-app");
      var fi = appX && appX.querySelector(".xl-finput");
      if (fi) fi.value = ev.target.textContent.trim();
      if (tbl && tbl.id === "xl-sheet-q4") {
        var sumC = 0, sumD = 0, cntD = 0, sumE = 0, sumF = 0;
        for (var r = 2; r <= 6; r++) {
          var c = parseFloat((tbl.querySelector('[data-ref="C' + r + '"]') || {}).textContent || "0") || 0;
          var d = parseFloat(((tbl.querySelector('[data-ref="D' + r + '"]') || {}).textContent || "0").replace("%", "")) || 0;
          var e = parseFloat((tbl.querySelector('[data-ref="E' + r + '"]') || {}).textContent || "0") || 0;
          var f = parseFloat(((tbl.querySelector('[data-ref="F' + r + '"]') || {}).textContent || "0").replace(/[^0-9.-]/g, "")) || 0;
          sumC += c; sumD += d; cntD++; sumE += e; sumF += f;
        }
        var c7 = tbl.querySelector('[data-ref="C7"]');
        var d7 = tbl.querySelector('[data-ref="D7"]');
        var e7 = tbl.querySelector('[data-ref="E7"]');
        var f7 = tbl.querySelector('[data-ref="F7"]');
        if (c7) c7.textContent = Math.round(sumC).toLocaleString();
        if (d7) d7.textContent = (cntD ? (sumD / cntD).toFixed(1) : "0") + "%";
        if (e7) e7.textContent = sumE.toFixed(1);
        if (f7) f7.textContent = "$" + sumF.toFixed(2);
        var sbSum = appX && appX.querySelector("[data-xl-status-sum]");
        if (sbSum) sbSum.textContent = "Sum: $" + sumF.toFixed(2);
      }
      return;
    }
    if (ev.target.id === "sp-search-input") {
      var sq = ev.target.value.trim().toLowerCase();
      document.querySelectorAll(".sp-nav-group").forEach(function (grp) {
        var vis = 0;
        grp.querySelectorAll(".sp-nav-item").forEach(function (it) {
          var txt = (it.textContent || "").toLowerCase();
          var ok = !sq || txt.indexOf(sq) !== -1;
          it.hidden = !ok;
          if (ok) vis++;
        });
        grp.hidden = vis === 0;
      });
      return;
    }
    if (ev.target.id === "plugin-search-input") {
      var q = ev.target.value.trim().toLowerCase();
      document.querySelectorAll(".plugins-section").forEach(function (sec) {
        var visible = 0;
        sec.querySelectorAll(".plugin-item").forEach(function (item) {
          var hay = (item.getAttribute("data-search") || item.textContent || "").toLowerCase();
          var match = !q || hay.indexOf(q) !== -1;
          item.hidden = !match;
          if (match) visible++;
        });
        sec.hidden = visible === 0;
      });
      return;
    }
    if (!ev.target.classList || !ev.target.classList.contains("composer-input")) return;
    var comp = ev.target.closest(".composer-shell");
    var pop = comp && comp.querySelector(".slash-pop");
    if (pop) pop.hidden = !ev.target.value.startsWith("/");
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      closeDropdowns();
      document.querySelectorAll(".slash-pop").forEach(function (p) { p.hidden = true; });
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      var appEl = document.querySelector(".app");
      if (appEl) {
        var collapsed = appEl.classList.toggle("is-left-collapsed");
        document.querySelectorAll("[data-toggle-sidebar]").forEach(function (b) {
          b.setAttribute("aria-pressed", String(!collapsed));
        });
      }
    }
    if (ev.key === "Tab" && ev.shiftKey && ev.target.classList && ev.target.classList.contains("composer-input")) {
      var compWrap = ev.target.closest(".composer-shell");
      var pWrap = compWrap && compWrap.querySelector(".perm-wrap");
      if (pWrap) {
        ev.preventDefault();
        var opts = Array.prototype.slice.call(pWrap.querySelectorAll(".perm-opt"));
        var idx = opts.findIndex(function (o) { return o.getAttribute("aria-selected") === "true"; });
        var nextOpt = opts[(idx + 1) % opts.length];
        if (nextOpt) selectPermissionMode(pWrap, nextOpt);
      }
    }
    if (ev.key === "Enter" && ev.target.classList && ev.target.classList.contains("fb-chat-input")) {
      ev.preventDefault();
      var fbBtn = ev.target.closest(".fb-chat") && ev.target.closest(".fb-chat").querySelector("[data-fb-send]");
      if (fbBtn) fbBtn.click();
    }
    if (ev.key === "Enter" && !ev.shiftKey && ev.target.classList && ev.target.classList.contains("composer-input")) {
      ev.preventDefault();
      sendComposerMessage(ev.target.closest(".composer-shell"));
    }
  });

  if (location.hash) {
    var spTarget = document.querySelector("[data-sp-section='" + location.hash.slice(1) + "']");
    if (spTarget) spTarget.click();
  }

  /* ---------- Global Sleek Pill Hover Tag for Every Component ---------- */
  (function initTooltips() {
    var TIP_SELECTOR = [
      "[data-tip]",
      "[title]",
      ".cx-rail-btn",
      ".cx-avatar",
      ".icon-btn",
      ".rs-tab-btn",
      ".plugin-action",
      ".send-orb",
      ".model-trigger",
      ".effort-icon-btn",
      ".effort-stop",
      ".perm-trigger",
      ".shell-ctx-btn",
      ".composer-inline-btn",
      ".chip-x",
      ".btn",
      ".plugins-add-btn",
      ".changes-pr-btn",
      ".changes-cli-pill",
      ".artifact-pill",
      ".switch",
      ".preview-tab",
      ".office-tab"
    ].join(",");

    var tip = document.createElement("div");
    tip.className = "rayu-tip";
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    document.body.appendChild(tip);

    var activeEl = null;

    function getTipData(el) {
      if (!el || el.classList.contains("cx-toggle-btn") || el.classList.contains("turn-act-btn") || el.querySelector(".cx-tooltip")) return null;
      if (el.getAttribute("aria-expanded") === "true") return null;
      if (el.hasAttribute("title")) {
        var raw = el.getAttribute("title");
        if (raw && !el.hasAttribute("data-tip")) el.setAttribute("data-tip", raw);
        el.removeAttribute("title");
      }
      var text = el.getAttribute("data-tip") || el.getAttribute("aria-label") || el.getAttribute("data-toast") || "";
      text = text.trim();
      if (!text) return null;
      var kbd = el.getAttribute("data-tip-kbd") || "";
      if (!kbd) {
        var m = text.match(/^(.*?)\s*\(([^)]{1,20})\)$/);
        if (m && /[⌘⇧⌃⌥]|Shift\+|Ctrl\+|Tab/.test(m[2])) {
          text = m[1].trim();
          kbd = m[2].replace("Shift+Tab to cycle", "⇧Tab").trim();
        }
      }
      return { text: text, kbd: kbd };
    }

    function positionTip(el) {
      var r = el.getBoundingClientRect();
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var tw = tip.offsetWidth;
      var th = tip.offsetHeight;
      var gap = 8;
      var top, left;

      if (el.closest(".cx-rail")) {
        /* Exact right-side pill tag beside left icon rail */
        left = r.right + gap;
        top = r.top + (r.height - th) / 2;
      } else if (r.top < 72) {
        /* Top bar / right sidebar header strip -> place cleanly below */
        top = r.bottom + gap;
        left = r.left + (r.width - tw) / 2;
      } else {
        /* Default -> place cleanly above */
        top = r.top - th - gap;
        left = r.left + (r.width - tw) / 2;
      }

      left = Math.max(8, Math.min(vw - tw - 8, left));
      top = Math.max(8, Math.min(vh - th - 8, top));
      tip.style.left = Math.round(left) + "px";
      tip.style.top = Math.round(top) + "px";
    }

    function showTip(el) {
      var data = getTipData(el);
      if (!data) { hideTip(); return; }
      activeEl = el;
      tip.textContent = "";
      var span = document.createElement("span");
      span.textContent = data.text;
      tip.appendChild(span);
      if (data.kbd) {
        var k = document.createElement("kbd");
        k.textContent = data.kbd;
        tip.appendChild(k);
      }
      tip.hidden = false;
      positionTip(el);
      requestAnimationFrame(function () {
        if (activeEl === el) tip.classList.add("is-visible");
      });
    }

    function hideTip() {
      activeEl = null;
      tip.classList.remove("is-visible");
      tip.hidden = true;
    }

    /* Strip native browser titles upfront so OS tooltip never flashes */
    document.querySelectorAll("[title]").forEach(function (el) {
      if (el.classList.contains("cx-toggle-btn")) return;
      if (!el.hasAttribute("data-tip")) el.setAttribute("data-tip", el.getAttribute("title"));
      el.removeAttribute("title");
    });

    document.addEventListener("pointerover", function (ev) {
      var el = ev.target.closest(TIP_SELECTOR);
      if (!el || el === activeEl) return;
      showTip(el);
    });

    document.addEventListener("pointerout", function (ev) {
      if (!activeEl) return;
      var to = ev.relatedTarget;
      if (to && activeEl.contains(to)) return;
      hideTip();
    });

    document.addEventListener("focusin", function (ev) {
      var el = ev.target.closest(TIP_SELECTOR);
      if (el && el.matches(":focus-visible")) showTip(el);
    });
    document.addEventListener("focusout", hideTip);
    document.addEventListener("pointerdown", hideTip);
    document.addEventListener("scroll", hideTip, true);
  })();
})();
