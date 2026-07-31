(function () {
  "use strict";

  const data = window.SANDBOX_EXPERIENCE;
  if (!data) throw new Error("Experience data is unavailable.");

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  const els = {
    world: $("#canvas-world"),
    canvas: $("#architecture-canvas"),
    nodeLayer: $("#node-layer"),
    edgeLayer: $("#edge-layer"),
    caseList: $("#case-list"),
    navigator: $("#case-navigator"),
    inspector: $("#case-inspector"),
    navigatorTitle: $("#navigator-title"),
    navigatorDescription: $("#navigator-description"),
    caseCount: $("#case-count"),
    inspectorMode: $("#inspector-mode"),
    inspectorTitle: $("#inspector-title"),
    inspectorSeverity: $("#inspector-severity"),
    phaseNumber: $("#phase-number"),
    phaseTitle: $("#phase-title"),
    componentChips: $("#component-chips"),
    inspectorFields: $("#inspector-fields"),
    invariant: $("#invariant-text"),
    scenarioLabel: $("#scenario-label"),
    canvasTitle: $("#canvas-title"),
    progressPhase: $("#progress-phase"),
    progressMessage: $("#progress-message"),
    progressFraction: $("#progress-fraction"),
    progressFill: $("#progress-fill"),
    statusNode: $("#status-node"),
    statusSandbox: $("#status-sandbox"),
    statusNetwork: $("#status-network"),
    statusCredential: $("#status-credential"),
    statusApproval: $("#status-approval"),
    statusSideEffect: $("#status-side-effect"),
    statusOutcome: $("#status-outcome"),
    resourceCopy: $("#resource-copy"),
    bars: [$("#cpu-bar"), $("#ram-bar"), $("#disk-bar"), $("#time-bar")],
    sideEffectPanel: $("#side-effect-panel"),
    stateSummaryPanel: $("#state-summary-panel"),
    approvalDialog: $("#approval-dialog"),
    simulatedNote: $("#simulated-approval-note"),
    approvalCountdown: $("#approval-countdown"),
    approvalScopeCopy: $("#approval-scope-copy"),
    playToggle: $("#play-toggle"),
    footerPlayToggle: $("#footer-play-toggle"),
    autoplay: $("#autoplay-toggle"),
    speed: $("#speed-select"),
    docsButton: $("#docs-menu-button"),
    docsPopover: $("#docs-popover"),
    toastRegion: $("#toast-region")
  };

  const state = {
    mode: "happy",
    selectedId: "full-happy",
    currentCase: null,
    stepIndex: 0,
    playing: false,
    timer: null,
    approvalTimer: null,
    approvalCountdown: 3,
    approvalResolved: false,
    completedNodes: new Set(),
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    panStartX: 0,
    panStartY: 0
  };

  const nodeMap = new Map(data.nodes.map(node => [node.id, node]));
  const edgeMap = new Map(data.edges.map(edge => [edge.id, edge]));

  function iconForType(type) {
    if (type.includes("security")) return "security";
    if (type.includes("quarantine")) return "quarantine";
    if (type.includes("infra")) return "infra";
    if (type.includes("external")) return "external";
    return "normal";
  }

  function renderNodes() {
    const fragment = document.createDocumentFragment();
    data.nodes.forEach(node => {
      const el = document.createElement("article");
      el.className = `arch-node ${node.type}`;
      el.id = `node-${node.id}`;
      el.dataset.nodeId = node.id;
      el.dataset.icon = node.icon;
      el.dataset.kind = iconForType(node.type);
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      if (node.w) el.style.width = `${node.w}px`;
      el.innerHTML = `<strong>${node.title}</strong><small>${node.subtitle}</small>`;
      if (node.subs) {
        const grid = document.createElement("div");
        grid.className = "subcomponent-grid";
        node.subs.forEach(label => {
          const sub = document.createElement("span");
          sub.className = "subcomponent";
          sub.textContent = label;
          grid.appendChild(sub);
        });
        el.appendChild(grid);
      }
      fragment.appendChild(el);
    });
    els.nodeLayer.appendChild(fragment);
  }

  function nodeCenter(id) {
    const node = nodeMap.get(id);
    if (!node) return { x: 0, y: 0 };
    const el = $(`#node-${id}`);
    const width = el ? el.offsetWidth : (node.w || 142);
    const height = el ? el.offsetHeight : 58;
    return { x: node.x + width / 2, y: node.y + height / 2 };
  }

  function edgePath(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) > Math.abs(dy) * 1.4) {
      const bend = Math.min(90, Math.abs(dx) * .28);
      return `M ${from.x} ${from.y} C ${from.x + Math.sign(dx) * bend} ${from.y}, ${to.x - Math.sign(dx) * bend} ${to.y}, ${to.x} ${to.y}`;
    }
    const bend = Math.min(85, Math.abs(dy) * .28);
    return `M ${from.x} ${from.y} C ${from.x} ${from.y + Math.sign(dy) * bend}, ${to.x} ${to.y - Math.sign(dy) * bend}, ${to.x} ${to.y}`;
  }

  function renderEdges() {
    const ns = "http://www.w3.org/2000/svg";
    els.edgeLayer.innerHTML = `
      <defs>
        <marker id="arrow-default" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#aebdcb"></path>
        </marker>
      </defs>`;
    data.edges.forEach(edge => {
      const from = nodeCenter(edge.from);
      const to = nodeCenter(edge.to);
      const path = document.createElementNS(ns, "path");
      path.id = `edge-${edge.id}`;
      path.dataset.edgeId = edge.id;
      path.classList.add("architecture-edge");
      path.setAttribute("d", edgePath(from, to));
      path.setAttribute("marker-end", "url(#arrow-default)");
      els.edgeLayer.appendChild(path);
      if (edge.label) {
        const label = document.createElementNS(ns, "text");
        label.id = `edge-label-${edge.id}`;
        label.classList.add("edge-label");
        label.setAttribute("x", (from.x + to.x) / 2);
        label.setAttribute("y", (from.y + to.y) / 2 - 5);
        label.textContent = edge.label;
        els.edgeLayer.appendChild(label);
      }
    });
  }

  function fullHappyCase() {
    return {
      id: "full-happy",
      kind: "happy",
      title: "Run complete Happy Path",
      short: "Prompt → dual microVM → scan → approval → upload → teardown.",
      severity: "Medium",
      outcome: "Completed safely",
      objective: "Thực hiện toàn bộ illustrative CSV-to-report-to-Project-Drive journey.",
      steps: data.happySteps
    };
  }

  function itemsForMode(mode) {
    if (mode === "happy") {
      return [fullHappyCase()].concat(data.happySteps.map(step => ({
        id: step.id,
        kind: "happy",
        title: `${step.number}. ${step.title}`,
        short: step.short,
        severity: step.severity,
        outcome: step.outcome,
        objective: step.objective,
        steps: [step]
      })));
    }
    return mode === "failures" ? data.failures : data.abuse;
  }

  function renderCaseList() {
    const items = itemsForMode(state.mode);
    els.caseList.innerHTML = "";
    els.caseList.setAttribute("aria-label", `Các case ${data.modeMeta[state.mode].title}`);
    items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `case-item${item.id === state.selectedId ? " active" : ""}`;
      button.dataset.caseId = item.id;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", item.id === state.selectedId ? "true" : "false");
      const displayNumber = state.mode === "happy" && index === 0 ? "ALL" : String(state.mode === "happy" ? index : index + 1).padStart(2, "0");
      button.innerHTML = `
        <span class="case-number">${displayNumber}</span>
        <span class="case-copy"><strong>${item.title}</strong><span>${item.short}</span></span>
        <span class="outcome-mini">${shortOutcome(item.outcome)}</span>`;
      button.addEventListener("click", () => selectCase(item.id));
      els.caseList.appendChild(button);
    });
  }

  function shortOutcome(outcome) {
    const words = String(outcome || "Handled").split(/\s+/);
    return words.slice(0, 2).join(" ");
  }

  function selectCase(id) {
    const item = itemsForMode(state.mode).find(candidate => candidate.id === id);
    if (!item) return;
    clearTimers();
    state.selectedId = id;
    state.currentCase = item;
    state.stepIndex = 0;
    state.completedNodes.clear();
    state.approvalResolved = false;
    state.playing = els.autoplay.checked;
    updatePlayControls();
    renderCaseList();
    hideOverlays();
    applyStep();
    closeMobilePanels();
  }

  function setMode(mode) {
    if (!data.modeMeta[mode]) return;
    clearTimers();
    state.mode = mode;
    state.selectedId = mode === "happy" ? "full-happy" : itemsForMode(mode)[0].id;
    document.body.classList.remove("mode-happy", "mode-failures", "mode-abuse");
    document.body.classList.add(`mode-${mode}`);
    $$(".mode-tab").forEach(tab => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    const meta = data.modeMeta[mode];
    els.navigatorTitle.textContent = meta.title;
    els.navigatorDescription.textContent = meta.description;
    els.caseCount.textContent = meta.count;
    els.scenarioLabel.textContent = meta.scenario;
    els.canvasTitle.textContent = meta.canvasTitle;
    selectCase(state.selectedId);
  }

  function clearTimers() {
    if (state.timer) window.clearTimeout(state.timer);
    if (state.approvalTimer) window.clearInterval(state.approvalTimer);
    state.timer = null;
    state.approvalTimer = null;
  }

  function currentStep() {
    return state.currentCase && state.currentCase.steps[state.stepIndex];
  }

  function derivedEdges(step) {
    if (step.edges && step.edges.length) return step.edges;
    const activeIds = new Set([step.node].concat(step.supporting || []));
    let candidates = data.edges
      .filter(edge => activeIds.has(edge.from) && activeIds.has(edge.to))
      .map(edge => edge.id);
    if (!candidates.length) {
      candidates = data.edges
        .filter(edge => edge.from === step.node || edge.to === step.node)
        .slice(0, 3)
        .map(edge => edge.id);
    }
    return candidates;
  }

  function resetVisualState() {
    $$(".arch-node").forEach(node => {
      node.classList.remove("active", "supporting", "blocked", "dimmed");
      node.classList.toggle("completed", state.completedNodes.has(node.dataset.nodeId));
    });
    $$(".architecture-edge").forEach(edge => edge.className.baseVal = "architecture-edge dimmed");
    $$(".edge-label").forEach(label => label.classList.remove("active", "blocked"));
  }

  function applyStep(options = {}) {
    clearTimers();
    const step = currentStep();
    if (!step) return;
    resetVisualState();

    const activeIds = new Set([step.node].concat(step.supporting || []));
    $$(".arch-node").forEach(node => {
      const id = node.dataset.nodeId;
      if (id === step.node) node.classList.add(step.blocked ? "blocked" : "active");
      else if (activeIds.has(id)) node.classList.add("supporting");
      else node.classList.add("dimmed");
    });

    const edgeIds = derivedEdges(step);
    $$(".architecture-edge").forEach(edge => {
      const id = edge.dataset.edgeId;
      if (!edgeIds.includes(id)) return;
      edge.classList.remove("dimmed");
      edge.classList.add(step.blocked || step.edgeTone === "blocked" ? "blocked" : "active");
      if (step.edgeTone && !["normal", "blocked"].includes(step.edgeTone)) edge.classList.add(step.edgeTone);
      const label = $(`#edge-label-${id}`);
      if (label) label.classList.add(step.blocked ? "blocked" : "active");
    });

    updateInspector(step);
    updateStatus(step);
    updateProgress(step);
    updateSideEffect(step);
    updateStateSummary(step);

    if (step.approval && !state.approvalResolved) {
      showApproval();
      return;
    }

    if (state.playing && els.autoplay.checked && !options.manual) scheduleNext();
  }

  function scheduleNext() {
    state.timer = window.setTimeout(() => {
      if (!state.playing) return;
      if (state.stepIndex < state.currentCase.steps.length - 1) {
        state.completedNodes.add(currentStep().node);
        state.stepIndex += 1;
        applyStep();
      } else {
        state.playing = false;
        updatePlayControls();
        showToast(state.currentCase.outcome || currentStep().status?.outcome || "Flow completed", "success");
      }
    }, Number(els.speed.value));
  }

  function stepForward(manual = true) {
    clearTimers();
    if (!state.currentCase) return;
    if (manual) {
      state.playing = false;
      updatePlayControls();
    }
    if (state.stepIndex < state.currentCase.steps.length - 1) {
      state.completedNodes.add(currentStep().node);
      state.stepIndex += 1;
      applyStep({ manual });
    }
  }

  function stepBackward() {
    clearTimers();
    state.playing = false;
    updatePlayControls();
    if (state.stepIndex > 0) {
      state.stepIndex -= 1;
      state.completedNodes = new Set(state.currentCase.steps.slice(0, state.stepIndex).map(step => step.node));
      state.approvalResolved = state.stepIndex > state.currentCase.steps.findIndex(step => step.approval);
      applyStep({ manual: true });
    }
  }

  function updateInspector(step) {
    const item = state.currentCase;
    els.inspectorMode.textContent = data.modeMeta[state.mode].title;
    els.inspectorTitle.textContent = item.title;
    els.inspectorSeverity.textContent = item.severity || "Low";
    els.inspectorSeverity.className = `severity-badge ${String(item.severity || "low").toLowerCase()}`;
    els.phaseNumber.textContent = String(state.stepIndex + 1).padStart(2, "0");
    els.phaseTitle.textContent = step.title;

    const components = [step.node].concat(step.supporting || []).map(id => nodeMap.get(id)?.title).filter(Boolean);
    els.componentChips.innerHTML = components.slice(0, 6).map(name => `<span>${name}</span>`).join("");

    let fields;
    if (state.mode === "happy") {
      fields = [
        ["Mục tiêu", step.objective],
        ["System action", step.systemAction],
        ["UI cho user", step.userUI],
        ["Checkpoint", step.checkpoint],
        ["Persisted", step.persisted],
        ["Ephemeral", step.ephemeral]
      ];
      els.invariant.textContent = step.invariant;
    } else if (state.mode === "failures") {
      const repeatedAction = item.id === "network-timeout"
        ? "Không retry mù; đối soát receipt trước khi quyết định."
        : item.id === "duplicate-retry"
          ? "Không; idempotency key và Outbox trả lại receipt đã có."
          : "Không; external mutation vẫn bị chặn sau checkpoint.";
      const lostState = /destroy|discard|lost|mất|xóa/i.test(item.finalState || "")
        ? "Ephemeral runtime có thể mất; checkpoint và audit vẫn được giữ."
        : "Checkpoint và audit được giữ; chỉ ephemeral runtime có thể bị hủy.";
      fields = [
        ["Failure", item.title],
        ["Entry / impact", `${item.entry} — ${item.impact}`],
        ["Detection", item.detection],
        ["Prevention", item.prevention],
        ["Recovery", item.recovery],
        ["State lost?", lostState],
        ["External action repeated?", repeatedAction],
        ["Human approval", item.approval || "Chỉ yêu cầu lại khi scope, risk hoặc exact action thay đổi."],
        ["UX response", step.userMessage || item.userMessage],
        ["Owner", item.owner],
        ["Final state", item.finalState]
      ];
      els.invariant.textContent = item.id.includes("retry") || item.id.includes("timeout") ? data.invariants.retry : data.invariants.audit;
    } else {
      fields = [
        ["Abuse", item.title],
        ["Entry / impact", `${item.entry} — ${item.impact}`],
        ["Prevention", item.prevention],
        ["Detection", item.detection],
        ["Containment", item.containment],
        ["Recovery", item.recovery],
        ["UX response", step.userMessage || item.userMessage],
        ["Owner", item.owner],
        ["Final state", item.finalState]
      ];
      if (item.id.includes("credential")) els.invariant.textContent = data.invariants.credential;
      else if (item.id.includes("artifact") || item.id.includes("upload")) els.invariant.textContent = data.invariants.artifact;
      else if (item.id.includes("ssrf") || item.id.includes("exfiltration")) els.invariant.textContent = data.invariants.network;
      else els.invariant.textContent = data.invariants.audit;
    }

    els.inspectorFields.innerHTML = fields
      .filter(([, value]) => value)
      .map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`)
      .join("");
  }

  function updateStatus(step) {
    const status = step.status || {};
    els.statusNode.textContent = nodeMap.get(step.node)?.title || step.node;
    els.statusSandbox.textContent = status.sandbox || "Contained";
    els.statusNetwork.textContent = status.network || "Policy controlled";
    els.statusCredential.textContent = status.credential || "Protected";
    els.statusApproval.textContent = status.approval || "Risk-based";
    els.statusSideEffect.textContent = status.sideEffect || "None";
    els.statusOutcome.textContent = status.outcome || "Handling safely";

    const values = (step.resources || [12, 16, 8, 10]).map(value => Math.max(0, Math.min(100, value)));
    values.forEach((value, index) => els.bars[index].style.setProperty("--value", `${value}%`));
    els.resourceCopy.textContent = values.map(value => String(value).padStart(2, "0")).join(" / ") + "%";
  }

  function updateProgress(step) {
    const total = state.currentCase.steps.length;
    const current = state.stepIndex + 1;
    els.progressPhase.textContent = step.phase || "Running";
    els.progressMessage.textContent = step.message || step.explanation || step.title;
    els.progressFraction.textContent = `${current} / ${total}`;
    els.progressFill.style.width = `${current / total * 100}%`;
  }

  function activateEffectState(effectState) {
    $$("[data-effect-state]").forEach(item => item.classList.remove("active", "warning", "success"));
    const target = $(`[data-effect-state="${effectState}"]`);
    if (target) {
      target.classList.add("active");
      if (["unknown", "reconcile"].includes(effectState)) target.classList.add("warning");
      if (["committed", "resolution"].includes(effectState)) target.classList.add("success");
    }
  }

  function updateSideEffect(step) {
    const relevant = Boolean(step.effectState || ["execute-upload", "review-commit", "network-timeout", "duplicate-retry"].includes(state.currentCase.id));
    els.sideEffectPanel.hidden = !relevant;
    if (!relevant) {
      $$("[data-effect-state]").forEach(item => item.classList.remove("active", "warning", "success"));
      return;
    }
    activateEffectState(step.effectState || "planned");
  }

  function renderStateItems(targetId, items) {
    const target = $(`#${targetId}`);
    target.innerHTML = items.map((item, index) => `<span style="animation-delay:${index * 45}ms">${item}</span>`).join("");
  }

  function updateStateSummary(step) {
    els.stateSummaryPanel.hidden = !step.stateSummary;
    if (!step.stateSummary) return;
    renderStateItems("persisted-items", data.stateCategories.persisted);
    renderStateItems("deleted-items", data.stateCategories.deleted);
    renderStateItems("revoked-items", data.stateCategories.revoked);
    renderStateItems("never-items", data.stateCategories.never);
  }

  function hideOverlays() {
    els.sideEffectPanel.hidden = true;
    els.stateSummaryPanel.hidden = true;
    if (els.approvalDialog.open) els.approvalDialog.close("reset");
  }

  function showApproval() {
    state.playing = false;
    updatePlayControls();
    if (!els.approvalDialog.open) els.approvalDialog.showModal();
    els.simulatedNote.hidden = !els.autoplay.checked;
    state.approvalCountdown = 3;
    els.approvalCountdown.textContent = state.approvalCountdown;
    if (els.autoplay.checked) {
      state.approvalTimer = window.setInterval(() => {
        state.approvalCountdown -= 1;
        els.approvalCountdown.textContent = Math.max(0, state.approvalCountdown);
        if (state.approvalCountdown <= 0) {
          window.clearInterval(state.approvalTimer);
          state.approvalTimer = null;
          els.approvalDialog.close("approve");
        }
      }, 1000);
    }
  }

  function handleApproval(result) {
    if (result === "reset") return;
    if (state.approvalTimer) window.clearInterval(state.approvalTimer);
    state.approvalTimer = null;
    if (result === "approve") {
      state.approvalResolved = true;
      state.completedNodes.add("approval-service");
      els.sideEffectPanel.hidden = false;
      activateEffectState("authorized");
      els.statusApproval.textContent = "Approved";
      els.statusSideEffect.textContent = "Authorized";
      els.statusOutcome.textContent = "Authorized · execution pending";
      showToast(els.autoplay.checked ? "Giả lập người dùng phê duyệt · receipt đã ký" : "Người dùng đã phê duyệt exact action", "success");
      if (state.stepIndex < state.currentCase.steps.length - 1) {
        state.playing = true;
        updatePlayControls();
        window.setTimeout(() => stepForward(false), 700);
      } else {
        state.playing = false;
        els.statusOutcome.textContent = "Approved safely";
        updatePlayControls();
      }
    } else if (result === "stop") {
      state.playing = false;
      els.statusOutcome.textContent = "Stopped by user";
      els.statusApproval.textContent = "Stopped";
      els.statusSideEffect.textContent = "None";
      showToast("Tác vụ đã dừng · không có external side effect", "danger");
      updatePlayControls();
    } else {
      state.playing = false;
      els.statusOutcome.textContent = "Rejected safely";
      els.statusApproval.textContent = "Rejected";
      els.statusSideEffect.textContent = "None";
      showToast("Phê duyệt bị từ chối · credential không được cấp", "warning");
      updatePlayControls();
    }
  }

  function togglePlay(force) {
    state.playing = typeof force === "boolean" ? force : !state.playing;
    updatePlayControls();
    if (state.playing) {
      if (currentStep()?.approval && !state.approvalResolved) showApproval();
      else scheduleNext();
    } else {
      clearTimers();
    }
  }

  function updatePlayControls() {
    const icon = state.playing ? "Ⅱ" : "▶";
    const label = state.playing ? "Tạm dừng" : "Tiếp tục";
    els.playToggle.querySelector(".button-icon").textContent = icon;
    els.playToggle.querySelector(".button-label").textContent = label;
    els.playToggle.setAttribute("aria-label", label);
    els.footerPlayToggle.textContent = icon;
    els.footerPlayToggle.setAttribute("aria-label", label);
  }

  function replay() {
    clearTimers();
    state.stepIndex = 0;
    state.completedNodes.clear();
    state.approvalResolved = false;
    state.playing = els.autoplay.checked;
    updatePlayControls();
    hideOverlays();
    applyStep();
  }

  function showToast(message, tone = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${tone}`;
    toast.textContent = message;
    els.toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3500);
  }

  function updateTransform() {
    els.world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  }

  function fitCanvas() {
    const rect = els.canvas.getBoundingClientRect();
    const padding = 24;
    state.zoom = Math.min((rect.width - padding * 2) / 1600, (rect.height - padding * 2) / 980);
    state.zoom = Math.max(.35, Math.min(1, state.zoom));
    state.panX = (rect.width - 1600 * state.zoom) / 2;
    state.panY = (rect.height - 980 * state.zoom) / 2;
    updateTransform();
  }

  function zoomAt(factor, clientX, clientY) {
    const rect = els.canvas.getBoundingClientRect();
    const x = clientX == null ? rect.width / 2 : clientX - rect.left;
    const y = clientY == null ? rect.height / 2 : clientY - rect.top;
    const previous = state.zoom;
    const next = Math.max(.35, Math.min(1.8, previous * factor));
    state.panX = x - (x - state.panX) * (next / previous);
    state.panY = y - (y - state.panY) * (next / previous);
    state.zoom = next;
    updateTransform();
  }

  function closeMobilePanels() {
    els.navigator.classList.remove("open");
    els.inspector.classList.remove("open");
  }

  function bindEvents() {
    $$(".mode-tab").forEach(tab => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
    els.playToggle.addEventListener("click", () => togglePlay());
    els.footerPlayToggle.addEventListener("click", () => togglePlay());
    $("#replay-button").addEventListener("click", replay);
    $("#previous-step").addEventListener("click", stepBackward);
    $("#next-step").addEventListener("click", () => stepForward(true));
    els.speed.addEventListener("change", () => {
      if (state.playing) {
        clearTimers();
        scheduleNext();
      }
    });
    els.autoplay.addEventListener("change", () => {
      if (!els.autoplay.checked) {
        clearTimers();
        state.playing = false;
        updatePlayControls();
      }
    });

    $("#zoom-in").addEventListener("click", () => zoomAt(1.15));
    $("#zoom-out").addEventListener("click", () => zoomAt(1 / 1.15));
    $("#zoom-reset").addEventListener("click", () => {
      state.zoom = 1; state.panX = 0; state.panY = 0; updateTransform();
    });
    $("#zoom-fit").addEventListener("click", fitCanvas);

    els.canvas.addEventListener("wheel", event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
    }, { passive: false });

    els.canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      state.dragging = true;
      state.dragStartX = event.clientX;
      state.dragStartY = event.clientY;
      state.panStartX = state.panX;
      state.panStartY = state.panY;
      els.canvas.classList.add("dragging");
      els.canvas.setPointerCapture(event.pointerId);
    });
    els.canvas.addEventListener("pointermove", event => {
      if (!state.dragging) return;
      state.panX = state.panStartX + event.clientX - state.dragStartX;
      state.panY = state.panStartY + event.clientY - state.dragStartY;
      updateTransform();
    });
    const endDrag = event => {
      if (!state.dragging) return;
      state.dragging = false;
      els.canvas.classList.remove("dragging");
      try { els.canvas.releasePointerCapture(event.pointerId); } catch (_) {}
    };
    els.canvas.addEventListener("pointerup", endDrag);
    els.canvas.addEventListener("pointercancel", endDrag);

    els.docsButton.addEventListener("click", () => {
      const hidden = els.docsPopover.hidden;
      els.docsPopover.hidden = !hidden;
      els.docsButton.setAttribute("aria-expanded", String(hidden));
    });
    document.addEventListener("click", event => {
      if (!event.target.closest(".docs-menu")) {
        els.docsPopover.hidden = true;
        els.docsButton.setAttribute("aria-expanded", "false");
      }
    });

    els.approvalDialog.addEventListener("close", () => handleApproval(els.approvalDialog.returnValue));
    $$('input[name="approval-scope"]').forEach(input => input.addEventListener("change", () => {
      els.approvalScopeCopy.textContent = input.value === "once" ? "Chỉ hành động này · 5 phút" : "Exact batch: 1 artifact · 5 phút";
    }));

    $("#navigator-drawer-button").addEventListener("click", () => els.navigator.classList.add("open"));
    $("#inspector-sheet-button").addEventListener("click", () => els.inspector.classList.add("open"));
    $$("[data-close-panel]").forEach(button => button.addEventListener("click", () => {
      $(`#${button.dataset.closePanel}`).classList.remove("open");
    }));

    document.addEventListener("keydown", event => {
      const tag = document.activeElement?.tagName;
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag) || els.approvalDialog.open) return;
      if (event.key === "ArrowRight") stepForward(true);
      if (event.key === "ArrowLeft") stepBackward();
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
      }
    });

    window.addEventListener("resize", () => {
      renderEdges();
    });
  }

  function initialize() {
    document.body.classList.add("mode-happy");
    renderNodes();
    renderEdges();
    bindEvents();
    state.currentCase = fullHappyCase();
    renderCaseList();
    updatePlayControls();
    window.requestAnimationFrame(() => {
      fitCanvas();
      applyStep();
    });
  }

  initialize();
})();
