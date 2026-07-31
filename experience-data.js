(function () {
  "use strict";

  const invariants = {
    typedAction: "External side effect chỉ chạy qua typed action, policy verdict và approval receipt hợp lệ khi thuộc lớp cần duyệt.",
    noDirect: "Code và Browser microVM không có direct edge, shared filesystem hoặc socket.",
    credential: "Plaintext credential dài hạn không vào sandbox, model context, log, screenshot hoặc snapshot.",
    network: "Sandbox không có route trực tiếp tới control plane, metadata hoặc private network.",
    artifact: "Artifact chưa scan không được rời quarantine.",
    retry: "Không retry mù external mutation có outcome chưa xác định.",
    snapshot: "Post-user snapshot chưa scan không được resume hoặc dùng cross-tenant.",
    controlPlane: "Control Plane không parse hoặc execute untrusted artifact với privilege.",
    audit: "Mọi quyết định, approval, revoke và external receipt đều tạo audit event.",
    reversible: "Workspace thay đổi theo version và compare-and-swap để có thể review hoặc rollback."
  };

  const nodes = [
    { id: "user-ui", title: "User / HITL UI", subtitle: "Plan · Preview · Approval · Review", type: "normal", icon: "UI", x: 690, y: 48, w: 220 },

    { id: "api-auth", title: "API / Authentication", subtitle: "Tenant identity & session", type: "infra", icon: "ID", x: 58, y: 202 },
    { id: "task-planner", title: "Task Planner", subtitle: "Goal → constrained plan", type: "infra", icon: "PL", x: 218, y: 202 },
    { id: "durable-workflow", title: "Durable Workflow", subtitle: "Checkpoint & replay-safe steps", type: "infra", icon: "WF", x: 378, y: 202 },
    { id: "policy-engine", title: "Policy Engine", subtitle: "Risk & data-flow decision", type: "security", icon: "PE", x: 538, y: 202 },
    { id: "approval-service", title: "Approval Service", subtitle: "Canonical signed receipt", type: "security", icon: "AP", x: 698, y: 202 },
    { id: "credential-broker", title: "Credential Broker", subtitle: "Short-lived, scoped token", type: "security", icon: "CB", x: 858, y: 202 },
    { id: "action-executor", title: "Action Executor", subtitle: "Typed external side effect", type: "security", icon: "AX", x: 1018, y: 202 },
    { id: "idempotency-store", title: "Idempotency / Outbox", subtitle: "Intent, key & reconcile", type: "infra", icon: "IO", x: 1178, y: 202 },
    { id: "audit-log", title: "Event / Audit Log", subtitle: "Append-only, redacted", type: "infra", icon: "AL", x: 1338, y: 202 },

    { id: "scheduler", title: "Scheduler / Attestation", subtitle: "Clean image & capability", type: "security", icon: "SA", x: 138, y: 320 },
    { id: "workspace-service", title: "Workspace Versions", subtitle: "Diff · CAS · rollback", type: "infra", icon: "VS", x: 338, y: 320 },
    { id: "egress-gateway", title: "Egress / DNS / SSRF / DLP", subtitle: "Default deny · inspect each hop", type: "security", icon: "GW", x: 638, y: 320, w: 190 },
    { id: "artifact-policy", title: "Artifact Policy Controller", subtitle: "Receives result; promotes only", type: "security", icon: "PC", x: 898, y: 320, w: 176 },

    {
      id: "code-vm", title: "Code Firecracker microVM", subtitle: "Untrusted", type: "infra microvm", icon: "C",
      x: 57, y: 508, w: 438,
      subs: ["Terminal", "Package Manager", "Code Runner", "CoW Workspace", "/tmp", "Process Supervisor", "Resource Monitor"]
    },
    {
      id: "browser-vm", title: "Browser Firecracker microVM", subtitle: "Untrusted", type: "infra microvm", icon: "B",
      x: 583, y: 508, w: 438,
      subs: ["Chromium / Playwright", "Isolated Profile", "Download Staging", "Upload Staging", "Browser Monitor", "Provenance Labels"]
    },
    {
      id: "scanner-cell", title: "Artifact Scanner / Detonation Cell", subtitle: "Separate quarantine sandbox",
      type: "quarantine", icon: "Q", x: 1178, y: 530, w: 250
    },

    { id: "persistent-store", title: "Persistent State Store", subtitle: "Workflow · versions · receipts", type: "infra", icon: "DB", x: 102, y: 758, w: 190 },
    { id: "clean-images", title: "Clean Base Images", subtitle: "Signed · pre-agent only", type: "infra", icon: "IM", x: 360, y: 758, w: 170 },

    { id: "selected-files", title: "Selected User Files", subtitle: "Read-only · pinned hash", type: "external", icon: "F", x: 742, y: 758 },
    { id: "verified-mirror", title: "Verified Mirror", subtitle: "Pinned digest / provenance", type: "external", icon: "PK", x: 902, y: 758 },
    { id: "public-internet", title: "Public Internet", subtitle: "Untrusted web content", type: "external", icon: "W", x: 1062, y: 758 },
    { id: "external-apis", title: "External APIs / Accounts", subtitle: "Credential-bound resource", type: "external", icon: "API", x: 1222, y: 758 },
    { id: "export-destination", title: "Approved Export", subtitle: "Project Drive", type: "external", icon: "EX", x: 1382, y: 758 }
  ];

  const edges = [
    { id: "ui-api", from: "user-ui", to: "api-auth", label: "goal / decision" },
    { id: "api-plan", from: "api-auth", to: "task-planner" },
    { id: "plan-workflow", from: "task-planner", to: "durable-workflow" },
    { id: "workflow-policy", from: "durable-workflow", to: "policy-engine" },
    { id: "policy-approval", from: "policy-engine", to: "approval-service" },
    { id: "approval-credential", from: "approval-service", to: "credential-broker" },
    { id: "credential-action", from: "credential-broker", to: "action-executor", label: "scoped token / grant" },
    { id: "action-idempotency", from: "action-executor", to: "idempotency-store", label: "intent / receipt" },
    { id: "idempotency-audit", from: "idempotency-store", to: "audit-log" },
    { id: "workflow-scheduler", from: "durable-workflow", to: "scheduler" },
    { id: "workflow-workspace", from: "durable-workflow", to: "workspace-service" },
    { id: "policy-egress", from: "policy-engine", to: "egress-gateway" },
    { id: "policy-artifact", from: "policy-engine", to: "artifact-policy" },
    { id: "scheduler-code", from: "scheduler", to: "code-vm", label: "short capability" },
    { id: "scheduler-browser", from: "scheduler", to: "browser-vm", label: "short capability" },
    { id: "workspace-code", from: "workspace-service", to: "code-vm", label: "versioned /work" },
    { id: "gateway-code", from: "egress-gateway", to: "code-vm", label: "filtered egress" },
    { id: "gateway-browser", from: "egress-gateway", to: "browser-vm", label: "filtered egress" },
    { id: "browser-workflow", from: "browser-vm", to: "durable-workflow", label: "typed extraction / ref" },
    { id: "workflow-code", from: "durable-workflow", to: "code-vm", label: "structured data / scanned ref" },
    { id: "code-scanner", from: "code-vm", to: "scanner-cell", label: "quarantine staging" },
    { id: "browser-scanner", from: "browser-vm", to: "scanner-cell", label: "download ref" },
    { id: "scanner-artifact", from: "scanner-cell", to: "artifact-policy", label: "scan result + manifest" },
    { id: "artifact-approval", from: "artifact-policy", to: "approval-service", label: "promotable ref" },
    { id: "action-gateway", from: "action-executor", to: "egress-gateway", label: "typed mutation" },
    { id: "workflow-persist", from: "durable-workflow", to: "persistent-store", label: "checkpoint" },
    { id: "workspace-persist", from: "workspace-service", to: "persistent-store", label: "versions / diff" },
    { id: "audit-persist", from: "audit-log", to: "persistent-store", label: "append-only" },
    { id: "images-scheduler", from: "clean-images", to: "scheduler", label: "signed image" },
    { id: "files-api", from: "selected-files", to: "api-auth", label: "selected only" },
    { id: "mirror-gateway", from: "verified-mirror", to: "egress-gateway", label: "pinned package" },
    { id: "internet-gateway", from: "public-internet", to: "egress-gateway", label: "GET / inspected" },
    { id: "gateway-apis", from: "egress-gateway", to: "external-apis", label: "audience-bound" },
    { id: "gateway-export", from: "egress-gateway", to: "export-destination", label: "approved artifact" }
  ];

  const happySteps = [
    {
      id: "goal-classification", number: 1, title: "Parse goal & classify data/risk",
      short: "Tạo constrained plan cho CSV, research và upload.", severity: "Low", outcome: "Plan constrained",
      node: "task-planner", supporting: ["api-auth", "policy-engine", "durable-workflow", "audit-log"],
      edges: ["ui-api", "api-plan", "plan-workflow", "workflow-policy"], phase: "Planning",
      objective: "Hiểu mục tiêu và xác định trước data, domain, credential, budget và side effect.",
      systemAction: "Task Planner tạo plan; Policy Engine đánh dấu upload là mutation cần duyệt.",
      userUI: "Plan Preview với file nguồn, public research, output report.md và Project Drive.",
      checkpoint: "plan.v1 + policy version", persisted: "Task plan, policy version, initial audit event",
      ephemeral: "Không có sandbox hoặc credential", invariant: invariants.typedAction,
      message: "Đang phân loại mục tiêu và dữ liệu", resources: [8, 12, 4, 3],
      status: { sandbox: "Chưa cấp phát", network: "Default deny", credential: "Absent", approval: "Not required", sideEffect: "None", outcome: "Plan constrained" }
    },
    {
      id: "allocate-microvms", number: 2, title: "Allocate & attest dual microVM",
      short: "Tạo hai Firecracker microVM độc lập.", severity: "Low", outcome: "Environment attested",
      node: "scheduler", supporting: ["clean-images", "code-vm", "browser-vm", "durable-workflow"],
      edges: ["workflow-scheduler", "images-scheduler", "scheduler-code", "scheduler-browser"], phase: "Provisioning",
      objective: "Cấp môi trường code và browser bằng hai guest kernel, filesystem và network identity riêng.",
      systemAction: "Scheduler lấy clean signed images, tạo capability ngắn hạn và attestation.",
      userUI: "Environment ready; thấy quota, network default-deny và credential absent.",
      checkpoint: "session.created + attestation", persisted: "Session metadata và image digests",
      ephemeral: "RAM/process của hai microVM", invariant: invariants.noDirect,
      message: "Hai Firecracker microVM đã được attestation", resources: [12, 18, 4, 6],
      status: { sandbox: "2 microVM · isolated", network: "Default deny", credential: "Absent", approval: "Not required", sideEffect: "None", outcome: "Environment attested" }
    },
    {
      id: "import-files", number: 3, title: "Import selected files read-only",
      short: "Pin hash và tạo workspace base version.", severity: "Low", outcome: "Inputs pinned",
      node: "workspace-service", supporting: ["selected-files", "api-auth", "code-vm", "persistent-store"],
      edges: ["files-api", "workspace-code", "workspace-persist"], phase: "Input",
      objective: "Chỉ đưa các CSV người dùng đã chọn vào workspace.",
      systemAction: "Pin SHA-256, mount read-only input và tạo base version bằng compare-and-swap.",
      userUI: "File Inventory hiển thị tên, size, hash và sensitivity label.",
      checkpoint: "inputs.pinned", persisted: "Input manifest, base workspace version",
      ephemeral: "Read cache trong microVM", invariant: invariants.reversible,
      message: "Đã pin 3 CSV ở chế độ read-only", resources: [14, 23, 8, 8],
      status: { sandbox: "2 microVM · healthy", network: "Default deny", credential: "Absent", approval: "Not required", sideEffect: "None", outcome: "Inputs pinned" }
    },
    {
      id: "browser-research", number: 4, title: "Research with provenance labels",
      short: "Browser đọc public web qua gateway.", severity: "Medium", outcome: "Structured data mediated",
      node: "browser-vm", supporting: ["egress-gateway", "policy-engine", "durable-workflow", "audit-log", "code-vm"],
      edges: ["policy-egress", "internet-gateway", "gateway-browser", "browser-workflow", "workflow-code"], phase: "Research",
      objective: "Tìm dữ liệu công khai còn thiếu mà không trao authority cho website.",
      systemAction: "Browser gắn provenance untrusted; kết quả đi qua typed mediation thành structured data.",
      userUI: "Browser Preview và nhãn “Nguồn không tin cậy”; timeline ghi URL.",
      checkpoint: "research.extract.v1", persisted: "URL provenance, structured extraction, audit event",
      ephemeral: "DOM, page RAM và transient download", invariant: invariants.noDirect,
      message: "Browser → typed extraction → Workflow → Code", resources: [26, 38, 7, 18],
      status: { sandbox: "Browser active · Code isolated", network: "GET allowlist · inspected", credential: "Absent", approval: "Not required", sideEffect: "Read-only", outcome: "Structured data mediated" }
    },
    {
      id: "install-dependency", number: 5, title: "Install pinned dependency",
      short: "Chỉ dùng verified mirror và digest.", severity: "Medium", outcome: "Dependency verified",
      node: "code-vm", supporting: ["verified-mirror", "egress-gateway", "policy-engine", "audit-log"],
      edges: ["mirror-gateway", "gateway-code", "policy-egress"], phase: "Dependency",
      objective: "Cài parser CSV đã pin mà không mở egress tùy ý.",
      systemAction: "Gateway chỉ cho package digest từ verified mirror; install script bị quota.",
      userUI: "Package, version, digest và provenance xuất hiện trong timeline.",
      checkpoint: "deps.locked", persisted: "Dependency lock và provenance",
      ephemeral: "Package cache của session", invariant: invariants.network,
      message: "Package digest đã được xác minh", resources: [34, 31, 14, 24],
      status: { sandbox: "Code active · Browser idle", network: "Verified mirror only", credential: "Absent", approval: "Within plan", sideEffect: "Workspace only", outcome: "Dependency verified" }
    },
    {
      id: "create-report", number: 6, title: "Build, edit, test & create report",
      short: "Tạo report.md trong versioned workspace.", severity: "Low", outcome: "Artifact candidate created",
      node: "code-vm", supporting: ["workspace-service", "durable-workflow", "persistent-store", "audit-log"],
      edges: ["workflow-code", "workspace-code", "workspace-persist", "workflow-persist"], phase: "Build",
      objective: "Kết hợp CSV và structured research để tạo báo cáo.",
      systemAction: "Code Runner tạo report.md, validate Markdown và ghi workspace diff.",
      userUI: "Terminal Preview, resource budget và live File Diff.",
      checkpoint: "workspace.v2", persisted: "Workspace version, report diff, test result",
      ephemeral: "Process state, compiler cache, /tmp", invariant: invariants.reversible,
      message: "report.md đã tạo; chưa đủ điều kiện upload", resources: [48, 44, 22, 41],
      status: { sandbox: "Code active · healthy", network: "Default deny", credential: "Absent", approval: "Not required", sideEffect: "Workspace only", outcome: "Artifact candidate created" }
    },
    {
      id: "quarantine-scan", number: 7, title: "Quarantine, scan & manifest",
      short: "Scan trước mọi External Action Preview.", severity: "Medium", outcome: "Artifact promotable",
      node: "scanner-cell", supporting: ["artifact-policy", "code-vm", "audit-log", "persistent-store"],
      edges: ["code-scanner", "scanner-artifact", "policy-artifact"], edgeTone: "quarantine", phase: "Quarantine",
      objective: "Chứng minh artifact sạch trước khi cho phép trình duyệt external upload.",
      systemAction: "Cell riêng parse/scan file; Control Plane chỉ nhận scan result và manifest.",
      userUI: "Artifact Review hiển thị MIME, malware result, hash và provenance.",
      checkpoint: "artifact.scan.clean", persisted: "Scan result, artifact manifest, file hash",
      ephemeral: "Detonation process và untrusted parse state", invariant: invariants.controlPlane,
      message: "Artifact sạch · manifest verified · promotable", resources: [42, 53, 29, 52],
      status: { sandbox: "Quarantine cell active", network: "Quarantine isolated", credential: "Absent", approval: "Not required", sideEffect: "None", outcome: "Artifact promotable" }
    },
    {
      id: "request-service", number: 8, title: "Request user-service access",
      short: "Yêu cầu opaque handle cho Project Drive.", severity: "Medium", outcome: "Credential intent prepared",
      node: "credential-broker", supporting: ["policy-engine", "durable-workflow", "artifact-policy", "audit-log"],
      edges: ["workflow-policy", "policy-artifact", "approval-credential"], phase: "Credential",
      objective: "Chuẩn bị quyền tối thiểu cho exact Project Drive destination.",
      systemAction: "Broker xác định account/scope nhưng chưa đưa usable token vào sandbox.",
      userUI: "Account, resource, scope dự kiến và expiry được hiển thị.",
      checkpoint: "credential.intent", persisted: "Opaque handle và requested scope; không lưu access token",
      ephemeral: "Không có usable credential", invariant: invariants.credential,
      message: "Credential vẫn ở ngoài sandbox", resources: [28, 34, 18, 57],
      status: { sandbox: "2 microVM · isolated", network: "No mutation yet", credential: "Handle only", approval: "Pending preview", sideEffect: "Planned", outcome: "Credential intent prepared" },
      effectState: "planned"
    },
    {
      id: "preview-approval", number: 9, title: "Preview side effect & approve",
      short: "Canonical UI dừng tại checkpoint thực.", severity: "High", outcome: "Waiting for user",
      node: "approval-service", supporting: ["user-ui", "policy-engine", "artifact-policy", "credential-broker", "audit-log"],
      edges: ["artifact-approval", "policy-approval"], edgeTone: "security", phase: "Approval",
      objective: "Cho user thấy exact scanned artifact, destination, consequence và scope.",
      systemAction: "Approval Service render canonical sheet và bind receipt với hash/destination/expiry.",
      userUI: "Scope radio + nút “Upload report.md to Project Drive”, Reject và Stop task.",
      checkpoint: "approval.waiting", persisted: "Chỉ lưu receipt sau khi user quyết định",
      ephemeral: "Không token, không external request", invariant: invariants.artifact,
      message: "Đang chờ phê duyệt của người dùng", resources: [19, 31, 18, 63],
      status: { sandbox: "Paused at checkpoint", network: "No mutation", credential: "Not issued", approval: "Waiting for user", sideEffect: "Planned", outcome: "Waiting for user" },
      approval: true, effectState: "planned"
    },
    {
      id: "execute-upload", number: 10, title: "Execute typed upload",
      short: "Outbox → scoped token → Action Executor.", severity: "High", outcome: "External receipt received",
      node: "action-executor", supporting: ["credential-broker", "idempotency-store", "egress-gateway", "export-destination", "audit-log"],
      edges: ["approval-credential", "credential-action", "action-idempotency", "action-gateway", "gateway-export"], edgeTone: "security", phase: "Execution",
      objective: "Upload đúng scanned artifact tới đúng Project Drive một lần có thể đối soát.",
      systemAction: "Outbox ghi intent/key; Broker cấp request token; Executor gửi typed upload.",
      userUI: "Status hiển thị idempotency key, destination và pending receipt.",
      checkpoint: "side-effect.executing", persisted: "Intent, idempotency key, signed approval",
      ephemeral: "Short-lived audience-bound token", invariant: invariants.typedAction,
      message: "Typed upload đang đi qua Action Executor", resources: [38, 39, 26, 74],
      status: { sandbox: "No direct external access", network: "Exact POST allowed", credential: "Scoped · 5 min", approval: "Signed exact action", sideEffect: "Executing", outcome: "Awaiting receipt" },
      effectState: "executing"
    },
    {
      id: "review-commit", number: 11, title: "Receipt, review, audit & commit",
      short: "Đối soát receipt và review diff/artifact.", severity: "Medium", outcome: "Committed safely",
      node: "audit-log", supporting: ["idempotency-store", "persistent-store", "workspace-service", "user-ui", "export-destination"],
      edges: ["action-idempotency", "idempotency-audit", "audit-persist", "workspace-persist"], edgeTone: "success", phase: "Review",
      objective: "Xác nhận external outcome và cho user review trước final commit.",
      systemAction: "Receipt hợp lệ chuyển state sang committed; audit và workspace diff được persist.",
      userUI: "External receipt, Artifact Review, File Diff và Commit/Rollback.",
      checkpoint: "side-effect.committed", persisted: "External receipt, approval receipt, audit, manifest, diff",
      ephemeral: "Không giữ raw token", invariant: invariants.audit,
      message: "Receipt đã đối soát; artifact và diff sẵn sàng review", resources: [24, 36, 24, 83],
      status: { sandbox: "2 microVM · healthy", network: "Mutation complete", credential: "Expiring", approval: "Consumed", sideEffect: "Committed", outcome: "Committed safely" },
      effectState: "committed"
    },
    {
      id: "teardown", number: 12, title: "Teardown, revoke, persist & delete",
      short: "Phân loại trực quan state cuối session.", severity: "Low", outcome: "Completed safely",
      node: "durable-workflow", supporting: ["credential-broker", "scheduler", "persistent-store", "audit-log", "code-vm", "browser-vm"],
      edges: ["workflow-persist", "audit-persist", "scheduler-code", "scheduler-browser"], edgeTone: "success", phase: "Teardown",
      objective: "Kết thúc session mà không để lại capability, token hoặc untrusted runtime.",
      systemAction: "Revoke token/capability, destroy microVM, persist allowed state và xóa transient state.",
      userUI: "Summary trực quan: Persisted · Deleted · Revoked · Never snapshotted.",
      checkpoint: "session.closed", persisted: "Workflow, versions, diff, manifest, receipts và audit",
      ephemeral: "RAM, process, /tmp, clipboard, transient download bị xóa", invariant: invariants.snapshot,
      message: "Hoàn tất an toàn — artifact đã scan trước upload", resources: [6, 9, 3, 100],
      status: { sandbox: "Destroyed", network: "Closed", credential: "Revoked", approval: "Archived receipt", sideEffect: "Committed", outcome: "Completed safely" },
      stateSummary: true, effectState: "committed"
    }
  ];

  const phaseTemplates = [
    { key: "trigger", label: "Trigger", defaultNode: "durable-workflow" },
    { key: "detection", label: "Detection", defaultNode: "policy-engine" },
    { key: "containment", label: "Containment", defaultNode: "scheduler" },
    { key: "recovery", label: "Recovery", defaultNode: "durable-workflow" },
    { key: "userMessage", label: "User communication", defaultNode: "user-ui" },
    { key: "outcome", label: "Final state", defaultNode: "audit-log" }
  ];

  function makeCase(spec, kind) {
    const path = spec.path || [];
    const supporting = spec.ownerIds || [];
    const flows = phaseTemplates.map((phase, index) => {
      const custom = spec.flow && spec.flow[index] ? spec.flow[index] : {};
      const node = custom.node || path[index] || phase.defaultNode;
      return {
        phase: custom.phase || phase.label,
        title: custom.title || `${phase.label}: ${spec.title}`,
        explanation: custom.explanation || spec[phase.key] || spec.outcome,
        userMessage: custom.userMessage || (phase.key === "userMessage" ? spec.userMessage : spec.outcome),
        node,
        supporting: custom.supporting || supporting.filter(id => id !== node),
        edges: custom.edges || [],
        edgeTone: custom.edgeTone || (kind === "abuse" ? "blocked" : index >= 3 ? "success" : "normal"),
        blocked: custom.blocked || (kind === "abuse" && index === 3),
        effectState: custom.effectState || spec.effectState,
        resources: custom.resources || spec.resources || [24 + index * 4, 28 + index * 3, 12 + index * 2, 16 + index * 9],
        status: custom.status || {
          sandbox: spec.sandbox || "Contained",
          network: kind === "abuse" ? "Blocked / inspected" : "Policy controlled",
          credential: spec.credential || "Protected",
          approval: spec.approval || "Risk-based",
          sideEffect: spec.sideEffect || (kind === "abuse" ? "None" : "Checked"),
          outcome: index === phaseTemplates.length - 1 ? spec.outcome : "Handling safely"
        }
      };
    });
    return Object.assign({}, spec, { kind, steps: flows });
  }

  const failureSpecs = [
    {
      id: "infinite-loop", title: "Code/tool loop vô hạn", short: "Watchdog chặn loop và giữ partial result.", severity: "Medium",
      trigger: "Bug hoặc injection khiến code/tool call chạy không dừng.", entry: "Code Runner / agent loop", impact: "Cạn CPU, thời gian và ngân sách.",
      detection: "Wall-time, tool-call và token budget vượt ngưỡng; heartbeat không tiến triển.",
      prevention: "Hard quotas, watchdog và circuit breaker.", containment: "Process Supervisor dừng process tree.",
      recovery: "Giữ safe workspace checkpoint và partial artifact.", userMessage: "Đã dừng an toàn tại giới hạn; có thể cấp thêm budget một lần.",
      owner: "Runtime · Durable Workflow", ownerIds: ["code-vm", "durable-workflow", "audit-log"], path: ["code-vm", "code-vm", "scheduler", "workspace-service", "user-ui", "audit-log"],
      outcome: "Safely stopped", finalState: "Partial result preserved · No external side effect", sideEffect: "None"
    },
    {
      id: "sandbox-crash", title: "Sandbox crash", short: "Tạo clean VM và replay safe steps.", severity: "High",
      trigger: "Guest/VMM crash hoặc heartbeat bị mất.", entry: "Code microVM", impact: "Mất transient process state.",
      detection: "Scheduler không nhận heartbeat trong lease window.", prevention: "Health checks, replicated task metadata và versioned workspace.",
      containment: "Revoke live capability và cô lập microVM lỗi.", recovery: "Tạo clean VM, restore scanned workspace và replay safe steps.",
      userMessage: "Đã tự động phục hồi; external actions không bị lặp.", owner: "Scheduler · Workflow",
      ownerIds: ["scheduler", "durable-workflow", "credential-broker", "workspace-service"], path: ["code-vm", "scheduler", "credential-broker", "scheduler", "user-ui", "audit-log"],
      outcome: "Automatically recovered", finalState: "Workspace restored · No external action repeated"
    },
    {
      id: "browser-crash", title: "Browser crash", short: "Restart browser với profile được phép.", severity: "Medium",
      trigger: "Renderer, Chromium hoặc browser microVM crash.", entry: "Browser microVM", impact: "Mất DOM/tab và transient download.",
      detection: "Browser heartbeat hoặc renderer process biến mất.", prevention: "Renderer isolation, tab limit và RAM quota.",
      containment: "Đóng browser capability và quarantine downloads dở.", recovery: "Restart clean browser; restore profile chỉ khi user opt-in.",
      userMessage: "Browser đã khởi động lại tại checkpoint cuối.", owner: "Browser Runtime · Scheduler",
      ownerIds: ["browser-vm", "scheduler", "durable-workflow", "audit-log"], path: ["browser-vm", "browser-vm", "scheduler", "scheduler", "user-ui", "audit-log"],
      outcome: "Recovered with limited state", finalState: "DOM lost · Workflow preserved"
    },
    {
      id: "out-of-memory", title: "Out-of-memory", short: "Kill child lớn nhất, giữ checkpoint.", severity: "High",
      trigger: "Parser/build/browser dùng hết memory quota.", entry: "Resource Monitor", impact: "Process bị kill; task có thể dở dang.",
      detection: "Memory pressure chạm hard cgroup/VMM limit.", prevention: "Preflight input, hard RAM quota và pressure metrics.",
      containment: "Process Supervisor kill largest child, không kill control plane.", recovery: "Retry từ checkpoint ở tier cao hơn sau khi user xem cost delta.",
      userMessage: "Đã giữ workspace; chọn retry với thêm RAM hoặc dừng.", owner: "Runtime · Workflow",
      ownerIds: ["code-vm", "durable-workflow", "workspace-service", "user-ui"], path: ["code-vm", "code-vm", "scheduler", "workspace-service", "user-ui", "audit-log"],
      outcome: "Waiting for user", finalState: "Checkpoint intact · Retry requires approval", approval: "Cost-tier approval",
      resources: [94, 100, 38, 52]
    },
    {
      id: "disk-full", title: "Disk hoặc inode full", short: "Dọn temp/cache, giữ workspace delta.", severity: "Medium",
      trigger: "Archive, logs hoặc build tạo quá nhiều bytes/inodes.", entry: "Code microVM filesystem", impact: "Write fail và artifact không hoàn tất.",
      detection: "Disk/inode quota và preflight archive phát cảnh báo.", prevention: "Hard quota, archive limits và log rotation.",
      containment: "Dừng writer; giữ read-only base và workspace version.", recovery: "Xóa temp/cache; user chọn tăng storage nếu cần.",
      userMessage: "Storage limit reached; workspace changes were preserved.", owner: "Runtime · Workspace",
      ownerIds: ["code-vm", "workspace-service", "durable-workflow"], path: ["code-vm", "code-vm", "scheduler", "workspace-service", "user-ui", "audit-log"],
      outcome: "Partial result preserved", finalState: "Temporary data removed · No side effect", resources: [52, 48, 100, 44]
    },
    {
      id: "network-timeout", title: "Network timeout", short: "Outcome unknown được reconcile, không retry mù.", severity: "High",
      trigger: "Provider timeout sau khi nhận mutation.", entry: "Action Executor / external API", impact: "Không biết upload đã thành công hay chưa.",
      detection: "No response trước deadline trong khi mutation đã gửi.", prevention: "Outbox, idempotency key và bounded timeout.",
      containment: "Chuyển state sang unknown; khóa automatic retry.", recovery: "Query provider receipt bằng same idempotency key; commit, compensate hoặc manual.",
      userMessage: "Outcome unknown — đang đối soát; hệ thống không upload lại.", owner: "Action Executor · Idempotency · Workflow",
      ownerIds: ["action-executor", "idempotency-store", "durable-workflow", "audit-log"], path: ["action-executor", "egress-gateway", "idempotency-store", "durable-workflow", "user-ui", "audit-log"],
      outcome: "Reconciled safely", finalState: "No blind retry · Receipt reconciled", effectState: "unknown", sideEffect: "Unknown → reconcile"
    },
    {
      id: "registry-compromise", title: "Package registry compromise / outage", short: "Fail closed hoặc dùng verified cache.", severity: "High",
      trigger: "Registry trả package sai digest, mất signature hoặc unavailable.", entry: "Package Manager", impact: "Supply-chain RCE hoặc build bị dừng.",
      detection: "Digest/signature/provenance mismatch hoặc health failure.", prevention: "Pinned lockfile, signed verified mirror và install-script policy.",
      containment: "Gateway chặn package; Code microVM không nhận bytes.", recovery: "Dùng verified cache hoặc yêu cầu đổi dependency.",
      userMessage: "Dependency bị chặn; package không đạt provenance policy.", owner: "Supply Chain · Gateway",
      ownerIds: ["verified-mirror", "egress-gateway", "policy-engine", "code-vm"], path: ["verified-mirror", "egress-gateway", "policy-engine", "durable-workflow", "user-ui", "audit-log"],
      outcome: "Failed closed", finalState: "Unverified package not installed"
    },
    {
      id: "policy-unknown", title: "Policy không phân loại được risk", short: "Fail closed và chuyển review.", severity: "High",
      trigger: "Action hoặc schema mới không có deterministic policy.", entry: "Policy Engine", impact: "Có thể mở quyền sai nếu tự suy đoán.",
      detection: "No matching policy rule hoặc conflicting labels.", prevention: "Typed schemas và default deny.",
      containment: "Không mint credential, không mở egress.", recovery: "Human/security review hoặc re-plan bằng action đã hỗ trợ.",
      userMessage: "Không thể phân loại an toàn; hành động chưa được chạy.", owner: "Policy Engine",
      ownerIds: ["policy-engine", "approval-service", "credential-broker"], path: ["durable-workflow", "policy-engine", "credential-broker", "approval-service", "user-ui", "audit-log"],
      outcome: "Waiting for review", finalState: "No external side effect"
    },
    {
      id: "approval-expired", title: "Approval hết hạn / bị từ chối", short: "Grant bị hủy; side effect không chạy.", severity: "Medium",
      trigger: "User reject hoặc signed approval quá TTL.", entry: "Approval Service", impact: "Planned mutation không được phép tiếp tục.",
      detection: "Receipt absent, rejected hoặc expired.", prevention: "Exact-action binding và short TTL.",
      containment: "Credential Broker không cấp token; Executor từ chối.", recovery: "Discard intent hoặc re-plan và xin approval mới.",
      userMessage: "Phê duyệt không còn hiệu lực; không có side effect.", owner: "Approval Service",
      ownerIds: ["approval-service", "credential-broker", "action-executor", "audit-log"], path: ["user-ui", "approval-service", "credential-broker", "durable-workflow", "user-ui", "audit-log"],
      outcome: "No side effect", finalState: "Approval rejected/expired"
    },
    {
      id: "session-closed", title: "User đóng phiên giữa chừng", short: "Suspend, revoke và giữ durable state.", severity: "Medium",
      trigger: "Client disconnect hoặc user đóng tab/app.", entry: "API session lease", impact: "Tác vụ dở dang; live token có thể còn hạn.",
      detection: "Session heartbeat/lease hết hạn.", prevention: "Durable workflow và short-lived capabilities.",
      containment: "Pause task, revoke live token và block new actions.", recovery: "Resume card từ checkpoint hoặc teardown theo TTL.",
      userMessage: "Phiên đã tạm dừng; state được giữ/xóa theo policy.", owner: "Workflow · Credential Broker",
      ownerIds: ["api-auth", "durable-workflow", "credential-broker", "persistent-store"], path: ["api-auth", "durable-workflow", "credential-broker", "persistent-store", "user-ui", "audit-log"],
      outcome: "Suspended safely", finalState: "Durable state preserved · Capability revoked"
    },
    {
      id: "poisoned-snapshot", title: "Poisoned snapshot / workspace", short: "Discard snapshot, cherry-pick file sạch.", severity: "Critical",
      trigger: "Lineage hoặc scanner phát hiện contamination/persistence.", entry: "Snapshot/workspace restore", impact: "Malware có thể sống lại sau resume.",
      detection: "Attestation, lineage, malware scan hoặc integrity mismatch.", prevention: "Clean-only warm pool; post-user snapshot không cross-tenant.",
      containment: "Snapshot bị quarantine và không resume.", recovery: "Known-clean base + verified file-level cherry-pick.",
      userMessage: "Không thể resume snapshot; xem diff các file bị loại.", owner: "State · IR · Scheduler",
      ownerIds: ["clean-images", "scheduler", "scanner-cell", "workspace-service"], path: ["persistent-store", "scanner-cell", "artifact-policy", "scheduler", "user-ui", "audit-log"],
      outcome: "Cannot safely resume", finalState: "Clean base restored · Contaminated files excluded"
    },
    {
      id: "duplicate-retry", title: "Duplicate side effect after retry", short: "Dedupe và reconcile bằng same key.", severity: "Critical",
      trigger: "Crash/retry xảy ra quanh external mutation.", entry: "Action Executor retry path", impact: "Có thể gửi/upload/publish hai lần.",
      detection: "Outbox thấy same step_id và idempotency key.", prevention: "Intent persisted before call; same key cho mọi retry.",
      containment: "Dừng duplicate request và chuyển unknown nếu receipt thiếu.", recovery: "Query provider, commit existing receipt hoặc compensate/manual.",
      userMessage: "Duplicate đã được ngăn; outcome đang được đối soát.", owner: "Idempotency Store · Action Executor",
      ownerIds: ["idempotency-store", "action-executor", "durable-workflow", "audit-log"], path: ["durable-workflow", "idempotency-store", "action-executor", "idempotency-store", "user-ui", "audit-log"],
      outcome: "Duplicate prevented", finalState: "Single committed receipt or manual resolution", effectState: "reconcile"
    }
  ];

  const abuseSpecs = [
    {
      id: "fork-bomb", title: "Fork bomb", short: "PID quota chặn process explosion.", severity: "High",
      trigger: "Script/package hook liên tục fork process.", entry: "Code Runner", impact: "DoS CPU/PID cho session.",
      detection: "PID growth và cgroup pids.max.", prevention: "PID/CPU quota, non-root và no privilege.",
      containment: "Process Supervisor kill entire tree.", recovery: "Restore safe workspace checkpoint.",
      userMessage: "Fork bomb đã bị chặn trong microVM.", owner: "Runtime", ownerIds: ["code-vm", "scheduler", "audit-log"],
      path: ["code-vm", "code-vm", "scheduler", "workspace-service", "user-ui", "audit-log"], outcome: "Blocked safely", finalState: "Session contained · No side effect"
    },
    {
      id: "crypto-mining", title: "Crypto mining", short: "CPU/egress policy dừng miner.", severity: "High",
      trigger: "Binary kết nối mining pool và dùng CPU kéo dài.", entry: "Code microVM", impact: "Resource/cost abuse.",
      detection: "Sustained CPU, pool protocol/domain và budget anomaly.", prevention: "Hard CPU/time/egress quota.",
      containment: "Terminate process/session và revoke capability.", recovery: "Preserve minimal evidence; suspend account nếu lặp lại.",
      userMessage: "Session terminated vì resource abuse.", owner: "Abuse · Runtime", ownerIds: ["code-vm", "egress-gateway", "scheduler", "audit-log"],
      path: ["code-vm", "egress-gateway", "policy-engine", "scheduler", "user-ui", "audit-log"], outcome: "Session terminated", finalState: "Account review may be required"
    },
    {
      id: "zip-bomb", title: "Zip bomb", short: "Archive limits chặn trước giải nén.", severity: "High",
      trigger: "Archive có compression ratio/depth/inodes bất thường.", entry: "Download Staging / Code input", impact: "Disk, inode và CPU exhaustion.",
      detection: "Archive preflight vượt size, ratio, depth hoặc inode limit.", prevention: "Không extract trước preflight; quarantine staging.",
      containment: "Giữ archive trong quarantine, không mount vào workspace.", recovery: "Xóa transient data và giữ audit.",
      userMessage: "Archive bị quarantine vì expansion risk.", owner: "Artifact Scanner", ownerIds: ["scanner-cell", "artifact-policy", "audit-log"],
      path: ["browser-vm", "scanner-cell", "artifact-policy", "scanner-cell", "user-ui", "audit-log"], outcome: "Artifact quarantined", finalState: "Workspace protected"
    },
    {
      id: "ransomware", title: "Malware / ransomware", short: "Kill, quarantine và rollback workspace.", severity: "Critical",
      trigger: "Code/package/file cố mã hóa hoặc phá dữ liệu.", entry: "Code microVM / package hook", impact: "Workspace corruption và persistence.",
      detection: "YARA/behavior signal, entropy spike và destructive write pattern.", prevention: "Read-only inputs, microVM và versioned workspace.",
      containment: "Kill sandbox, revoke capability, quarantine evidence.", recovery: "Rollback clean workspace version.",
      userMessage: "Malware bị cô lập; workspace đã rollback.", owner: "IR · State", ownerIds: ["code-vm", "scanner-cell", "workspace-service", "scheduler"],
      path: ["code-vm", "scanner-cell", "policy-engine", "scheduler", "user-ui", "audit-log"], outcome: "Workspace rolled back", finalState: "Malware quarantined · Session terminated"
    },
    {
      id: "prompt-injection", title: "Website/email/document prompt injection", short: "Reader/Actor boundary từ chối authority.", severity: "Critical",
      trigger: "Trang chứa instruction độc hại giả làm dữ liệu.", entry: "Browser DOM / extracted content", impact: "Goal hijack, credential theft hoặc exfiltration.",
      detection: "Untrusted provenance + intent/action mismatch.", prevention: "Reader/Actor split, typed mediation và least tools.",
      containment: "Broker từ chối credential; gateway chặn destination.", recovery: "Discard poisoned checkpoint, giữ source evidence.",
      userMessage: "Đã chặn instruction độc hại và highlight nguồn.", owner: "Agent Security · Policy",
      ownerIds: ["browser-vm", "durable-workflow", "policy-engine", "credential-broker", "egress-gateway", "audit-log"],
      path: ["browser-vm", "durable-workflow", "policy-engine", "credential-broker", "user-ui", "audit-log"], outcome: "Blocked safely", finalState: "Credential protected · No side effect"
    },
    {
      id: "data-exfiltration", title: "Data exfiltration", short: "DLP chặn request trước external boundary.", severity: "Critical",
      trigger: "Compromised task thử POST/upload dữ liệu nhạy cảm.", entry: "Code/browser egress", impact: "Secret hoặc private file bị gửi ra ngoài.",
      detection: "Destination/method/body/data-label mismatch và DLP fingerprint.", prevention: "Default deny, exact allowlist và explicit upload approval.",
      containment: "Gateway dừng packet trước boundary; revoke token nếu cần.", recovery: "Incident/audit event và user review protected data.",
      userMessage: "Request không rời sandbox; dữ liệu được bảo vệ.", owner: "Egress/DLP · Credential",
      ownerIds: ["egress-gateway", "policy-engine", "credential-broker", "audit-log"],
      path: ["code-vm", "egress-gateway", "policy-engine", "credential-broker", "user-ui", "audit-log"], outcome: "Request never left sandbox", finalState: "Credential revoked · Incident created"
    },
    {
      id: "ssrf", title: "SSRF / DNS rebinding", short: "Mỗi DNS/redirect hop được đánh giá lại.", severity: "Critical",
      trigger: "URL resolve hoặc redirect sang private/metadata IP.", entry: "Browser navigation / URL tool", impact: "Truy cập metadata hoặc private service.",
      detection: "Resolver phát hiện RFC1918, loopback, link-local hoặc metadata.", prevention: "No route + host/eBPF + per-hop DNS/redirect validation.",
      containment: "Gateway và host chặn route.", recovery: "Rotate workload identity nếu nghi compromise.",
      userMessage: "Không request nào tới metadata/private network.", owner: "Gateway · Host Network",
      ownerIds: ["browser-vm", "egress-gateway", "policy-engine", "scheduler"],
      path: ["browser-vm", "egress-gateway", "policy-engine", "scheduler", "user-ui", "audit-log"], outcome: "Blocked safely", finalState: "Private network unreachable"
    },
    {
      id: "credential-theft", title: "Credential theft", short: "Sandbox chỉ thấy opaque handle.", severity: "Critical",
      trigger: "Package/webpage/process yêu cầu đọc secret.", entry: "env, proc, log, screenshot hoặc tool request", impact: "Account takeover.",
      detection: "Secret canary, anomalous use hoặc invalid audience.", prevention: "Vault ngoài sandbox; per-request short token và redaction.",
      containment: "Broker từ chối raw secret; revoke/rotate suspicious token.", recovery: "Invalidate affected session và notify user.",
      userMessage: "Credential được bảo vệ và không lộ cho sandbox.", owner: "Credential Broker",
      ownerIds: ["credential-broker", "policy-engine", "egress-gateway", "audit-log"],
      path: ["code-vm", "credential-broker", "policy-engine", "credential-broker", "user-ui", "audit-log"], outcome: "Credential protected", finalState: "Raw secret never exposed"
    },
    {
      id: "cross-tenant", title: "Cross-tenant access", short: "Tenant-bound KMS/authz và microVM cô lập.", severity: "Critical",
      trigger: "IDOR, cache/volume bug hoặc escape attempt.", entry: "API identifier / shared infrastructure", impact: "Đọc hoặc sửa dữ liệu tenant khác.",
      detection: "Tenant mismatch, canary object hoặc access-graph anomaly.", prevention: "Tenant-bound authz, KMS key, IDs và separate microVM.",
      containment: "Deny access, isolate cell/node và rotate identities.", recovery: "Incident response và forensic.",
      userMessage: "Cross-tenant request bị chặn; security review started.", owner: "Platform Security",
      ownerIds: ["api-auth", "scheduler", "persistent-store", "audit-log"],
      path: ["api-auth", "policy-engine", "scheduler", "scheduler", "user-ui", "audit-log"], outcome: "Security review required", finalState: "Tenant boundary held"
    },
    {
      id: "wrong-email", title: "Agent gửi nhầm email / form", short: "Canonical preview chặn recipient sai.", severity: "High",
      trigger: "Bad plan hoặc injection thay đổi recipient/payload.", entry: "External Action Preview", impact: "Gửi thông tin tới sai người.",
      detection: "Canonical action khác plan/approval receipt.", prevention: "Exact recipient/payload preview và action binding.",
      containment: "Approval Service không ký; Executor từ chối.", recovery: "Giữ draft; recall nếu provider hỗ trợ sau commit.",
      userMessage: "Recipient mismatch — hành động chưa được gửi.", owner: "Approval · Action Executor",
      ownerIds: ["approval-service", "action-executor", "policy-engine", "audit-log"],
      path: ["durable-workflow", "policy-engine", "approval-service", "action-executor", "user-ui", "audit-log"], outcome: "No side effect occurred", finalState: "Draft retained"
    },
    {
      id: "wrong-file-upload", title: "Upload nhầm file riêng tư", short: "Manifest và DLP không khớp approval.", severity: "Critical",
      trigger: "Broad glob hoặc poisoned content chọn private file.", entry: "Upload Staging / Action Executor", impact: "Rò rỉ dữ liệu riêng tư.",
      detection: "File hash/label không nằm trong exact artifact manifest.", prevention: "Explicit manifest, scan, DLP và one-shot approval.",
      containment: "Artifact Policy/Executor chặn upload.", recovery: "Revoke shared link/token nếu đã tạo.",
      userMessage: "Private file không thuộc manifest đã được chặn.", owner: "Artifact · DLP · Approval",
      ownerIds: ["artifact-policy", "egress-gateway", "approval-service", "action-executor"],
      path: ["browser-vm", "artifact-policy", "policy-engine", "action-executor", "user-ui", "audit-log"], outcome: "Protected file not uploaded", finalState: "No unauthorized side effect"
    },
    {
      id: "destructive-files", title: "Xóa / ghi đè file", short: "Version, CAS và trash giữ khả năng undo.", severity: "High",
      trigger: "Ambiguous command hoặc malicious package xóa file.", entry: "Code Runner / filesystem tool", impact: "Mất hoặc ghi đè user data.",
      detection: "Destructive diff và base-version conflict.", prevention: "Read-only input, workspace branch, CAS và trash.",
      containment: "Dừng write ngoài scope; require approval cho irreversible batch.", recovery: "Undo/restore prior workspace version.",
      userMessage: "Thay đổi phá hủy đã rollback; xem exact diff.", owner: "Workspace Version Service",
      ownerIds: ["code-vm", "workspace-service", "policy-engine", "user-ui"],
      path: ["code-vm", "workspace-service", "policy-engine", "workspace-service", "user-ui", "audit-log"], outcome: "Workspace rolled back", finalState: "Original files restored"
    },
    {
      id: "malicious-artifact", title: "Artifact chứa malware", short: "Artifact ở lại quarantine, không export.", severity: "Critical",
      trigger: "Generated/downloaded artifact chứa binary, macro hoặc script độc hại.", entry: "Quarantine staging", impact: "Malware thoát sandbox qua export.",
      detection: "AV/YARA/CDR/detonation finding.", prevention: "Mandatory quarantine trước preview/upload/export.",
      containment: "Artifact Policy đánh dấu non-promotable; export edge đóng.", recovery: "Regenerate hoặc sanitize trong fresh environment.",
      userMessage: "Artifact bị quarantine; finding được hiển thị.", owner: "Scanner · Artifact Policy",
      ownerIds: ["scanner-cell", "artifact-policy", "approval-service", "audit-log"],
      path: ["code-vm", "scanner-cell", "artifact-policy", "scanner-cell", "user-ui", "audit-log"], outcome: "Artifact quarantined", finalState: "Export blocked"
    },
    {
      id: "malicious-user", title: "User yêu cầu malware / phishing", short: "Use policy từ chối capability nguy hiểm.", severity: "Critical",
      trigger: "User cố tình yêu cầu payload, phishing hoặc credential theft.", entry: "User Prompt", impact: "Abuse platform và gây hại bên ngoài.",
      detection: "Use-policy classifier + requested capability/risk.", prevention: "Safety policy, narrow tools và rate limits.",
      containment: "Refuse task; không allocate risky capability.", recovery: "Preserve minimal audit; escalate repeated abuse.",
      userMessage: "Yêu cầu bị từ chối theo chính sách an toàn.", owner: "Trust & Safety · Policy",
      ownerIds: ["user-ui", "api-auth", "policy-engine", "audit-log"],
      path: ["user-ui", "policy-engine", "policy-engine", "api-auth", "user-ui", "audit-log"], outcome: "Request refused", finalState: "Account may be suspended"
    },
    {
      id: "budget-abuse", title: "Vượt thời gian / ngân sách", short: "Circuit breaker trả partial result.", severity: "Medium",
      trigger: "Agent chain tool/model calls vượt hard budget.", entry: "Durable Workflow", impact: "DoS/cost và runaway autonomy.",
      detection: "Time, token, tool-call và API spend meter.", prevention: "Per-task hard budget và rate limit.",
      containment: "Circuit breaker pause/stop workflow.", recovery: "Return partial artifact; ask exact budget extension.",
      userMessage: "Đã dừng tại ngân sách; partial result được giữ.", owner: "Workflow · Policy",
      ownerIds: ["durable-workflow", "policy-engine", "persistent-store", "user-ui"],
      path: ["durable-workflow", "policy-engine", "durable-workflow", "persistent-store", "user-ui", "audit-log"], outcome: "Safely stopped", finalState: "Partial result preserved"
    },
    {
      id: "approval-spoof", title: "Approval spoof / Lies-in-the-loop", short: "Fake UI không tạo signed receipt.", severity: "Critical",
      trigger: "Website/agent render fake approval message.", entry: "Untrusted content frame", impact: "Lừa user duyệt khác canonical action.",
      detection: "Canonical action không khớp fake content/recipient/payload.", prevention: "System-rendered UI tách biệt; no agent HTML controls.",
      containment: "Không tạo signed receipt; Executor từ chối.", recovery: "Highlight mismatch và discard poisoned content.",
      userMessage: "Fake approval bị phát hiện; hành động chưa chạy.", owner: "Approval UI · Policy",
      ownerIds: ["browser-vm", "approval-service", "policy-engine", "action-executor", "audit-log"],
      path: ["browser-vm", "approval-service", "policy-engine", "action-executor", "user-ui", "audit-log"], outcome: "No side effect occurred", finalState: "Signed approval not created"
    }
  ];

  const failures = failureSpecs.map(spec => makeCase(spec, "failure"));
  const abuse = abuseSpecs.map(spec => makeCase(spec, "abuse"));

  const persisted = ["Task plan", "Workflow state", "Policy version", "Approval receipt", "Workspace versions", "File diff", "Artifact manifest", "Idempotency / outbox", "External receipt", "Immutable audit", "Browser profile (opt-in per site)", "Quarantine artifact (temporary 1–7 days; never promoted before clean)"];
  const deleted = ["Process state", "RAM", "/tmp", "Clipboard", "Transient downloads", "Non-persisted browser profile"];
  const revoked = ["Short-lived access token", "Live session capability", "Sandbox controller lease"];
  const never = ["Plaintext secret", "Long-lived credential", "OTP / password", "Hidden model reasoning", "Unscanned quarantine content"];

  window.SANDBOX_EXPERIENCE = {
    nodes,
    edges,
    invariants,
    happySteps,
    failures,
    abuse,
    stateCategories: { persisted, deleted, revoked, never },
    modeMeta: {
      happy: {
        title: "Happy Path", description: "12 bước an toàn từ prompt đến scanned artifact được upload; mục ALL chạy toàn bộ luồng.",
        count: 12, scenario: "Kịch bản minh họa", canvasTitle: "CSV → report.md → Project Drive"
      },
      failures: {
        title: "Failure Cases", description: "Detection, containment và recovery cho 12 failure đã tài liệu hóa.",
        count: 12, scenario: "Failure simulation", canvasTitle: "Trigger → Detection → Recovery"
      },
      abuse: {
        title: "Abuse Cases", description: "Security enforcement cho 16 abuse case đã tài liệu hóa.",
        count: 16, scenario: "Adversarial simulation", canvasTitle: "Signal → Policy → Block / Quarantine"
      }
    }
  };
})();
