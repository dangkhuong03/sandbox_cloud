# Cloud sandbox an toàn cho AI agent: kiến trúc và UX

**Vai trò nghiên cứu:** Principal Cloud Security Architect / AI Agent Infrastructure Researcher  
**Ngày chốt nghiên cứu:** **30/07/2026** (Asia/Saigon)  
**Phạm vi:** agent chạy code không tin cậy, duyệt web, thao tác file, dùng quyền người dùng và tạo side effect trong môi trường cloud multi-tenant.

> Quy ước bằng chứng: **[Fact]** là điều nguồn công bố trực tiếp; **[Inference]** là suy luận có giới hạn từ nhiều nguồn; **[Recommendation]** là quyết định thiết kế của báo cáo. Những chi tiết kiến trúc sản phẩm không được nhà cung cấp công bố được ghi rõ là **“chưa có bằng chứng công khai”**.

## 1. Executive summary

**Kết luận:** production nên dùng **một microVM KVM/Firecracker cho code và một microVM riêng cho browser, theo session**, nằm trong cell/cluster dành riêng cho untrusted workloads. Hai sandbox không có credential gốc, không vào được control plane/private network, không gọi trực tiếp API có side effect và không nói chuyện trực tiếp với nhau. Mọi kết nối đi qua **Egress Gateway + DNS policy + SSRF guard**. **Credential Broker** giữ/cấp credential ngắn hạn; **Action Executor** thực hiện typed side effect; **Idempotency Store/Outbox** chống duplicate và reconcile. Workspace được lưu bằng phiên bản filesystem/object storage; workflow được lưu bằng event log/checkpoint. RAM, process state, plaintext secret, cookie không cần thiết và nội dung quarantine không được snapshot.

Container Linux thuần, kể cả rootless, không phải ranh giới tenant đủ mạnh cho code và browser tùy ý vì vẫn chia sẻ host kernel. Nó hợp lý cho MVP single-tenant/risk thấp nếu được bọc bằng gVisor và node pool riêng. Firecracker dùng KVM, guest kernel riêng, device model tối giản, jailer/seccomp/cgroup; tài liệu thiết kế yêu cầu lọc egress ở host vì Firecracker không tự lọc mạng. [Firecracker design, AWS, cập nhật liên tục](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md) [USENIX NSDI 2020 paper](https://www.usenix.org/conference/nsdi20/presentation/agache)

Không có một prompt/classifier nào giải quyết dứt điểm indirect prompt injection. **Untrusted content không được trao authority.** Thiết kế phải kết hợp provenance labels, tách “reader” khỏi “actor”, origin/data-flow policy, deterministic tool schemas, least privilege, egress DLP và human approval cho sink rủi ro. OWASP mô tả prompt injection có thể dẫn tới tiết lộ dữ liệu, gọi chức năng trái phép và thực thi lệnh; nghiên cứu USENIX 2024 formalizes attack/defense, còn VPI-Bench 2025 (preprint) cho thấy UI trực quan cũng là kênh injection. [OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) [USENIX Security 2024](https://www.usenix.org/conference/usenixsecurity24/presentation/liu-yupei) [VPI-Bench, arXiv preprint 2025](https://arxiv.org/abs/2506.02456)

UX an toàn không hỏi “Allow?” liên tục. Nó tự động cho phép thao tác read-only và thay đổi có thể rollback bên trong workspace; gom duyệt theo **scope hẹp, có hạn dùng**; chỉ chặn ở điểm quyền/side effect. Mỗi dialog phải do hệ thống render từ dữ liệu canonical, không dùng HTML/Markdown do agent hay webpage sinh, và luôn hiển thị: việc làm, dữ liệu dùng, đích nhận, hậu quả, khả năng undo, thời hạn/scope. Cảnh báo lặp lại làm giảm chú ý và tuân thủ; đây là bằng chứng nền tảng cho risk-based approval. [SOUPS 2019](https://www.usenix.org/conference/soups2019/presentation/vance)

### Quyết định chính

| Câu hỏi | Quyết định |
|---|---|
| Isolation primitive | Firecracker microVM/KVM production; gVisor container là tier tiết kiệm cho workload đã phân loại |
| Code và browser | Tách hai sandbox; cùng session nhưng khác kernel/profile/network identity |
| Control/data plane | Control plane private, không chạy artifact; data plane untrusted, chỉ nhận capability ngắn hạn |
| Egress | Default deny ở nhiều lớp: guest route, host/eBPF, service-mesh/L7 proxy, DNS resolver; request-level enforcement tại proxy |
| Secret | Vault ngoài sandbox; token exchange/downscope; broker gắn token theo request và audience/domain |
| Resume | Durable workflow + append-only event log + idempotency key + reconciliation; không tin snapshot là nguồn sự thật |
| State | Persist workspace/version/audit/metadata; xóa process/RAM/temp; không snapshot plaintext secret/token/OTP |
| Approval | Dựa trên side effect, sensitivity, reversibility và blast radius; deny/escalate khi policy không chắc |

## 2. Research scope và phương pháp

Nghiên cứu tập trung vào nguồn sơ cấp và tài liệu chính thức, ưu tiên giai đoạn 30/07/2024–30/07/2026; dùng nghiên cứu cũ hơn khi là nền tảng. Đã tìm theo các nhóm: `agent sandbox microVM gVisor`, `browser agent prompt injection`, `credential broker token exchange`, `durable workflow idempotency`, `human approval fatigue`, `artifact supply chain`, và tài liệu sản phẩm chính thức.

Giới hạn:

- Benchmark cold-start/chi phí giữa các runtime phụ thuộc kernel, image, snapshot, host và workload; báo cáo chỉ dùng định tính nếu không có phép đo đồng nhất.
- Tuyên bố marketing không được dùng để chứng minh mức an toàn.
- Các sản phẩm SaaS chỉ được mô tả theo mặt ngoài công khai; không suy đoán hypervisor, scheduler hoặc topology nội bộ.

## 3. Key findings

1. **Containment quan trọng hơn model compliance.** Filesystem và network boundary phải cùng tồn tại; chỉ một trong hai vẫn cho phép đánh cắp file hoặc tải payload. Anthropic công khai cùng kết luận khi mô tả sandbox filesystem + proxy network của Claude Code. [Anthropic Engineering, 20/10/2025](https://www.anthropic.com/engineering/claude-code-sandboxing)
2. **Container hardening là defense-in-depth, không thay guest kernel.** Kubernetes khuyến nghị drop capabilities, seccomp, AppArmor/SELinux, read-only rootfs, resource limits và NetworkPolicy; tài liệu cũng gợi ý gVisor khi cần isolation cao hơn. [Kubernetes application checklist](https://kubernetes.io/docs/concepts/security/application-security-checklist/) [Linux kernel constraints](https://kubernetes.io/docs/concepts/security/linux-kernel-security-constraints/)
3. **Browser là workload thù địch riêng.** Chromium dùng sandbox + Site Isolation, đổi lại tốn RAM; điều này không thay thế việc cô lập cả browser khỏi code sandbox và control plane. [Chromium Site Isolation](https://www.chromium.org/Home/chromium-security/site-isolation/)
4. **Domain allowlist đơn thuần chưa đủ.** Cần resolve/pin IP, chặn private/link-local/metadata, kiểm tra redirect, SNI/certificate/Host, giới hạn HTTP methods/body và re-evaluate mỗi hop để chống SSRF/DNS rebinding.
5. **Credential injection qua environment là anti-pattern.** OAuth resource/audience restriction ngăn token dùng ở resource khác; token exchange hỗ trợ delegation/downscope. [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html) [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html)
6. **Side effect cần transaction record trước khi execute.** Idempotency token giúp retry không nhân đôi tác động; “exactly once” tổng quát không nên được hứa. [AWS REL04-BP04](https://docs.aws.amazon.com/wellarchitected/2025-02-25/framework/rel_prevent_interaction_failure_idempotent.html)
7. **Snapshot có thể là persistence vector của malware.** Chỉ snapshot sau quiesce + scan + policy attestation; ưu tiên filesystem snapshot/version thay memory snapshot. Firecracker snapshot lưu state thiết bị và RAM, còn backing block device phải được quản lý riêng. [Firecracker snapshot support](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md)

## 4. Landscape sản phẩm và công nghệ

| Sản phẩm | Fact công khai | Không nên suy luận |
|---|---|---|
| OpenAI Codex cloud | Mỗi task chạy trong isolated cloud container; agent internet off mặc định; setup có mạng; secret chỉ ở setup và bị loại trước agent phase; trả diff để review. [OpenAI Codex cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment) [Internet access](https://learn.chatgpt.com/docs/cloud/internet-access) | Loại hypervisor, tenant placement, kernel boundary và implementation proxy chưa được công bố đầy đủ |
| ChatGPT Work / Computer Use | Có per-app approval, always-allow có thể revoke, stop/takeover; cảnh báo website đã đăng nhập có thể gây hành động dưới danh nghĩa user. [OpenAI Computer Use](https://learn.chatgpt.com/docs/computer-use) | “ChatGPT Cowork” không phải tên kiến trúc cloud được tài liệu công khai hiện tại mô tả; không gán runtime nội bộ |
| Perplexity Computer | Công bố chạy cloud, quản lý project end-to-end; credential được mã hóa và proxy-inject, không lộ cho trajectory/sandbox; scope session/user/project. [Changelog 26/02/2026](https://www.perplexity.ai/changelog/what-we-shipped---february-27-2026) [Credential docs 16/07/2026](https://www.perplexity.ai/help-center/en/articles/20260716-using-custom-api-credentials-in-computer) | Isolation primitive, topology code/browser, snapshot và tenant boundary: **chưa có bằng chứng công khai** |
| Claude Code / web | OS sandbox dùng bubblewrap/Seatbelt; egress qua Unix socket proxy; web session isolated; git credential gắn tại proxy và kiểm tra branch/destination. [Anthropic Engineering 2025](https://www.anthropic.com/engineering/claude-code-sandboxing) | Không coi số liệu nội bộ giảm prompt là benchmark độc lập |
| Google Project Mariner / Gemini Computer Use | Research prototype đọc pixel/DOM và thao tác browser; bản công bố ban đầu chỉ active tab và xác nhận trước một số sensitive actions; Computer Use model dành cho browser automation. [Google Gemini 2.0](https://blog.google/intl/en-nz/company-news/2024_12_introducing-gemini-20-our-new-ai-mode/) [Gemini Computer Use](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-computer-use-preview-10-2025) | Cloud isolation/runtime nội bộ: **chưa có bằng chứng công khai** |
| Microsoft Agent Framework | Xem user/assistant/tool data là untrusted; validate tool args; approval cho side effect/sensitive/irreversible/broad actions. [Microsoft Agent Safety, 2026](https://learn.microsoft.com/en-us/agent-framework/agents/safety) | Không đồng nhất framework guidance với kiến trúc mọi sản phẩm Copilot |
| E2B | Công bố sandbox là Linux VM; trang sản phẩm nói Firecracker; secure controller access mặc định ở SDK v2. [E2B docs](https://www.e2b.dev/docs) [Secured access](https://e2b.dev/docs/sandbox/secured-access) | Tuyên bố “secure” của vendor không phải independent assurance |
| Modal | Sandbox cho untrusted code dùng gVisor; có block/CIDR/domain egress và snapshot filesystem/memory với giới hạn. [Modal networking](https://modal.com/docs/guide/sandbox-networking) [Snapshots](https://modal.com/docs/guide/sandbox-snapshots) | Domain allowlist beta không tự giải quyết mọi SSRF/rebinding |
| Daytona | Container mặc định; VM Linux/Windows có dedicated OS; snapshot/pause/volume; kiến trúc tách API, runners, registry và object store. [Daytona sandboxes](https://www.daytona.io/docs/en/sandboxes/) [Architecture](https://www.daytona.io/docs/en/architecture/) | “Dedicated kernel” trên trang tổng quan cần hiểu theo VM tier, không gán cho container tier |
| GitHub Codespaces | Mỗi codespace dùng VM và network riêng; lifecycle cho reconnect/stop/delete. [GitHub security](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces) [Lifecycle](https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle) | Đây là trusted developer environment, không mặc nhiên phù hợp malware analysis |
| Browserbase / browser sandboxes | Hosted browser/session APIs là pattern triển khai hữu ích | Cơ chế tenant/kernel cụ thể cần vendor evidence/assurance trước procurement |

## 5. Threat model

### Tài sản và adversary

Tài sản: dữ liệu/user files, OAuth grants/cookies/API keys, tenant isolation, artifact integrity, audit integrity, compute budget, external accounts và reputation. Adversary gồm user ác ý; website/email/document/package ác ý; dependency maintainer bị compromise; tenant khác; compromised agent/model/tool; insider/control-plane credential; và lỗi vận hành.

### Bảng B — Threat model tổng hợp

| Threat | Entry point | Impact | Prevention | Detection | Recovery |
|---|---|---|---|---|---|
| Sandbox/container escape | syscall, browser exploit, kernel bug | Cross-tenant/host compromise | microVM, patched host, jailer, seccomp, no device passthrough, dedicated nodes | host EDR/eBPF, VMM metrics, canary | kill cell, quarantine node, rotate node identity, reimage |
| Cross-tenant data access | IDOR, shared cache/volume/snapshot | Confidentiality breach | tenant-scoped IDs/KMS keys, per-tenant authz, no shared writable layer | access-log anomaly, canary object | revoke, isolate, forensic + notification |
| Prompt/visual injection | web/email/doc/DOM/image/tool output | Goal hijack, exfiltration, wrong action | provenance labels, reader/actor split, origin policy, least tools, approval | injection classifier + policy violations + egress DLP | stop, revoke, discard poisoned memory/checkpoint |
| SSRF/DNS rebinding | URL, redirect, package hook, browser | metadata/private service access | no route to RFC1918/link-local, resolver/proxy validation each hop, disable metadata | denied-IP/DNS logs, canary endpoints | kill session, rotate workload identity |
| Credential theft | env/log/proc/screenshot/clipboard | Account takeover | brokered request, short token, audience/domain binding, redaction | secret canary, anomalous token use | revoke/rotate, invalidate sessions |
| Data exfiltration | HTTP/DNS/WebSocket/form/upload | Data loss | default-deny egress, method/body/DLP policy, user approval | proxy/DNS volume anomaly, content fingerprint | block/revoke, incident workflow |
| Malicious package | registry/typosquat/install script | RCE, persistence | lockfile/digest, curated mirror, signature/provenance, network-off runtime | SBOM/SCA, behavior scan, file diff | discard sandbox/snapshot, restore clean workspace |
| Resource abuse | fork/zip bomb/miner/loop | DoS/cost | cgroup + VMM quotas: CPU/RAM/PID/disk/IO/network/time/tool budget | quota, miner/entropy/process signals | SIGTERM→kill, partial artifact recovery |
| Artifact malware | generated/downloaded file | Harm after export | quarantine, AV/YARA/CDR, MIME/archive limits, signed manifest | scan + sandbox detonation | block export, preserve evidence, regenerate |
| Duplicate side effect | retry/resume/timeouts | Double mail/payment/upload | outbox, idempotency key, at-most-once for non-idempotent sinks | reconciliation against remote receipt | compensate/undo or human incident |
| Malicious user request | prompt/code/upload | Malware/phishing/abuse | use policy, classifier, capability restriction, rate limits | abuse telemetry/red team | refuse, suspend/escalate, preserve minimal evidence |

## 6. Trust boundaries

```text
User/UI
  │ authenticated intent + approvals
  ▼
┌──────────────────────── TRUSTED CONTROL PLANE ────────────────────────┐
│ API/Auth ─ Workflow/Event Log ─ Policy Engine ─ Approval Service     │
│                    │                    │                             │
│ Artifact Policy Controller   Credential Broker ─ Action Executor     │
│                    │                    │              │              │
│ Scheduler/Attestation ─ Egress/DNS/SSRF/DLP Gateway ─ Idempotency    │
└───────────────┬───────────────────────┬───────────────────────────────┘
                │ capability only       │ capability only
       ┌────────▼─────────┐            ┌▼────────────────┐
       │ CODE microVM     │            │ BROWSER microVM │
       │ CoW root + /work │            │ fresh profile   │
       │ no secret/route  │            │ downloads→Q     │
       └────────┬─────────┘            └────────┬────────┘
                └────────── UNTRUSTED DATA PLANE ┘
                              │
                      Quarantine staging
                              ▼
                 ┌────────────────────────────┐
                 │ Artifact Scanner /         │
                 │ Detonation Cell (separate) │
                 └─────────────┬──────────────┘
                               │ scan result + manifest
                               ▼
                    Artifact Policy Controller
```

Security boundary không nằm ở agent prompt. Policy Engine và Action Executor chỉ nhận typed/canonical action; sandbox không được gửi raw HTTP tới connector có quyền. Control plane không mount user workspace, không parse artifact bằng privileged process; scan/detonation chạy ở một quarantine cell riêng. Browser và Code không có direct edge, shared filesystem hoặc socket: Browser trả typed extraction/download reference cho Control Plane; Control Plane chỉ chuyển structured data hoặc scanned reference sang Code.

## 7. So sánh isolation technologies

### Bảng A — Technology comparison

| Công nghệ | Isolation | Cold start | Density | Compatibility | Cost | Phù hợp |
|---|---|---:|---:|---|---:|---|
| Linux container | Thấp–TB; shared kernel | Rất nhanh | Rất cao | Rất cao | Thấp | Trusted/low-risk task, không phải hostile multi-tenant |
| Rootless container | TB; giảm privilege nhưng shared kernel | Rất nhanh | Rất cao | Cao; một số feature hạn chế | Thấp | Dev/MVP defense-in-depth |
| gVisor | Cao hơn container; userspace application kernel | Nhanh | Cao | TB–cao; syscall/I/O/GPU có gap | Thấp–TB | Risk-tier trung bình, bursty code |
| Kata Containers | Cao; VM per pod, guest kernel | TB | TB | Cao/OCI/K8s | TB–cao | K8s cần VM boundary và operational integration |
| Firecracker microVM | Cao; KVM + tối giản device model | Nhanh–TB; snapshot tốt | Cao | Linux cao, GUI cần cấu hình | TB | **Production untrusted code/browser** |
| KVM ephemeral VM đầy đủ | Rất cao | Chậm hơn | Thấp | Rất cao, Windows/GUI tốt | Cao | Legacy, kernel/module đặc thù, high-risk detonation |
| WebAssembly/WASI | Cao theo capability/runtime | Rất nhanh | Rất cao | Thấp–TB; không chạy package tùy ý | Rất thấp | Plugin/function đã compile, không phải desktop/browser |
| Browser process sandbox בלבד | Tốt giữa renderer/site, không đủ tenant | Nhanh | Cao | Browser-native | Thấp | Lớp bên trong browser microVM, không dùng độc lập |

WASI bắt đầu không ambient authority và chỉ nhận capability host cấp, nhưng POSIX/package/browser compatibility chưa thay được Linux sandbox tổng quát. [WASI.dev](https://wasi.dev/) gVisor reimplement Linux trong userspace Go và chấp nhận overhead syscall/I/O. [gVisor security](https://gvisor.dev/docs/architecture_guide/intro/) [Performance](https://gvisor.dev/docs/architecture_guide/performance/) Kata dùng lightweight VM và hardware virtualization. [Kata Containers](https://katacontainers.io/)

**Decision matrix (1 thấp, 5 cao; Cost/Ops: 5 là tốt/rẻ/dễ):**

| Phương án | Isolation | Start | Density | Compatibility | Snapshot | Observability | Cost/Ops | Tổng có trọng số |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Rootless container | 2 | 5 | 5 | 5 | 4 | 5 | 5 | 3.8 |
| gVisor container | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 3.8 |
| Kata | 4 | 3 | 3 | 4 | 4 | 3 | 3 | 3.6 |
| Firecracker | 5 | 4 | 4 | 4 | 5 | 3 | 3 | **4.3** |
| Full KVM VM | 5 | 2 | 2 | 5 | 4 | 3 | 2 | 3.6 |
| WASI | 5 | 5 | 5 | 1 | 3 | 4 | 4 | 3.8 |

Trọng số ưu tiên isolation/cross-tenant risk hơn raw density. Các điểm là đánh giá kiến trúc, không phải benchmark.

## 8. Execution environment đề xuất

### Production baseline

- Per-session code microVM và browser microVM; per-task child microVM cho package install/build không tin cậy hoặc malware detonation.
- Minimal signed guest kernel/rootfs, read-only; CoW overlay; `/work` riêng, `noexec` cho upload staging; ephemeral `/tmp`.
- Non-root UID; drop capabilities; no privileged container, host PID/IPC, device passthrough, Docker socket, KVM-in-guest; seccomp/AppArmor cả guest và VMM jail.
- cgroup/VMM hard quotas: vCPU, memory, PIDs, disk bytes/inodes, IOPS, egress bytes/connections, wall clock, model/tool/API budget.
- Browser bật sandbox, Site Isolation, fresh profile, extension allowlist rỗng; download vào quarantine; upload chỉ qua Action Executor với manifest file.
- Warm pool chỉ gồm **clean pre-agent image**; không chia sẻ post-user snapshot giữa tenant.
- Host pool không có cloud instance role hữu ích; metadata endpoint disabled hoặc unreachable. Firecracker khuyến nghị UID/GID riêng và hardening host. [Firecracker production host setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)

### Vì sao tách code và browser

Tách để cookie/profile không xuất hiện trong `/proc`, shell, logs hay package hook; browser exploit không có compiler/toolchain/workspace đầy đủ; code compromise không điều khiển DevTools socket. Giao tiếp là message typed qua Control Plane mediation (`navigate`, `extract`, `download_ref`, `upload_ref`), không phải shared filesystem/socket. Chi phí là thêm cold start/RAM và đồng bộ file; bù bằng warm clean snapshots và content-addressed transfer.

## 9. Control plane và data plane

**Control plane:** identity, tenant authz, task/workflow state, policy, approval, scheduling, attestation, credential vault, audit, artifact index. Chạy ở account/VPC/project riêng; mTLS workload identity; no inbound từ sandbox; mọi command ký và có nonce/session binding.

**Data plane:** microVM, ephemeral network namespace, CoW workspace, sidecars tối thiểu. Không có cloud IAM, DB credential, orchestrator token hoặc direct Kubernetes API. Sandbox controller dùng capability ngắn hạn, một sandbox ID không đủ để điều khiển (pattern tương tự secure controller access của E2B).

**Cells:** giới hạn blast radius theo region/tenant risk tier; scheduler không co-locate high-risk detonation với normal session; node immutable và rotate; admission chỉ nhận image digest đã verify. Sigstore xác minh digest/signature/identity; SLSA provenance mô tả nguồn/build/materials. [Sigstore verify](https://docs.sigstore.dev/cosign/verifying/verify/) [SLSA v1.2](https://slsa.dev/spec/v1.2/)

## 10. Network và credential security

### Egress enforcement

1. Guest chỉ có route tới transparent gateway; không có L2 tới tenant khác.
2. Host/eBPF chặn RFC1918, loopback, link-local, multicast, metadata, control-plane CIDR, raw socket và non-proxy path.
3. Resolver do platform quản lý; resolve A/AAAA, reject private/special IP, pin kết quả ngắn hạn; kiểm tra lại sau redirect và DNS change.
4. L7 proxy kiểm tra scheme, normalized host/port, SNI/cert/Host, method, path, MIME, request/response bytes, redirect count, WebSocket và rate.
5. Policy là `(task, sandbox, origin provenance, destination, method, data labels, credential, time)`, không chỉ domain.
6. DNS và HTTP logs redacted, append-only; DLP phát hiện secret/canary/high-sensitivity fingerprint.

### Credential Broker, Action Executor và Idempotency Store/Outbox

- Vault/KMS giữ OAuth refresh token, API key/password; sandbox chỉ thấy opaque credential handle.
- Credential Broker mint token qua RFC 8693 hoặc dùng provider token có scope nhỏ nhất; bind `aud/resource` theo RFC 8707 và chỉ cấp ngắn hạn cho exact request.
- Action Executor nhận typed request, policy/approval receipt và data manifest rồi thực hiện side effect.
- Idempotency Store/Outbox ghi intent/key trước mutation, lưu receipt, chống duplicate và reconcile outcome không rõ. Không có “Action Broker” riêng trùng vai trò.
- Proxy gắn header/cookie sau TLS policy validation; sandbox không đọc response header `Set-Cookie` nhạy cảm nếu không cần.
- OTP/password: UI secure input → broker; one-shot, không echo vào model/log/screenshot. SSH key không đưa vào sandbox; git/signing đi qua narrow proxy.
- Cookies: profile mã hóa per user+site; chỉ mount cho browser microVM cần thiết; không export; rotate/revoke; high-risk session dùng fresh profile.
- “Đọc bằng credential” và “gửi dữ liệu bằng credential” là hai quyền khác nhau: read scope không tự cho phép email/send/upload/write.
- Redaction ở model trace, terminal, browser screenshot OCR, proxy logs và crash dump; canary secret để phát hiện leak.

## 11. State persistence

### Bảng D — State policy

| Loại state | Persist? | Thời gian mặc định | Mã hóa | Snapshot? | Lý do |
|---|---|---:|---|---|---|
| User prompt/plan/approval receipt | Có | policy/30–90 ngày | KMS per tenant | N/A/event log | audit và resume |
| Workflow step + idempotency/outbox | Có | task + audit TTL | Có | DB checkpoint | chống duplicate side effect |
| Workspace files/version/diff | Có, opt-in theo project | 30 ngày hoặc project lifecycle | per-tenant DEK | Filesystem snapshot sau scan | review/rollback |
| Object/artifact quarantine | Có tạm | 1–7 ngày | Có | Không promote | scan/forensic |
| Base image/package cache | Có | versioned | signature + encryption | Clean-only | cold start |
| Process/RAM/kernel state | Không mặc định | đến suspend timeout | memory encryption nếu có | Chỉ experimental, low-risk | chứa token/malware/stale socket |
| Browser profile | Tối thiểu, opt-in per site | session hoặc 7–30 ngày | per-user/site key | Không snapshot chung | cookie risk |
| Raw secret/password/OTP | Vault only | theo grant; OTP phút | HSM/KMS | **Không bao giờ** | tránh leak/replay |
| Access token ngắn hạn | Không | phút | in-memory broker | **Không bao giờ** | revoke/expiry |
| Immutable audit log | Có | compliance policy | envelope + WORM/sign | N/A | non-repudiation |
| Model scratchpad/raw hidden reasoning | Không | request | transient | Không | privacy/minimization |

### Resume không lặp side effect

Mỗi step có `step_id`, input hash, policy version, approval receipt, idempotency key và trạng thái `planned → authorized → executing → committed/unknown/compensated`. Ghi outbox/intent bền vững **trước** call. Khi timeout ở trạng thái `unknown`, không tự gọi lại: query provider bằng idempotency key/receipt, reconcile, rồi commit hoặc xin user. API idempotent dùng same key cho mọi retry; API không idempotent dùng at-most-once và manual reconciliation. Workspace commit dùng compare-and-swap trên base version.

Snapshot restore luôn tạo session identity mới, RNG seed mới, token mới, đóng stale connection và chạy integrity/malware scan. Snapshot có lineage, image digest, scanner/policy version; không promote snapshot từ session bị injection/malware.

## 12. Human-in-the-loop UX

### Bảng C — Human approval

| Hành động | Risk | Cần duyệt? | Thông tin phải hiển thị | Scope |
|---|---:|---|---|---|
| Đọc public web / file user đã chọn | Thấp | Không, nếu trong plan | nguồn + provenance | task |
| Tạo/sửa file trong workspace versioned | Thấp–TB | Không từng file; review diff cuối | path, diff, rollback | workspace/task |
| Xóa/overwrite file | TB–cao | Có nếu mất dữ liệu hoặc ngoài staging | exact paths/count, backup, undo | một batch |
| Cài package | TB | Có khi domain/package mới hoặc script quyền cao | registry, name/version/digest, scripts, license | package set |
| Truy cập domain mới | TB | JIT nếu ngoài plan/allowlist | domain, method, lý do, data labels | once/task/time-boxed |
| Dùng credential đọc | TB | Lần đầu/scope mới | account, provider, read scopes, data | task hoặc 15 phút |
| Gửi email/form/upload | Cao | **Luôn preview** | recipient/domain, full payload, file manifest, consequence | một action/batch exact |
| Mua hàng/thanh toán/đổi security setting | Rất cao | Luôn, re-auth | amount/target/irreversibility | one-shot |
| Export artifact sạch | TB | Review artifact | scan result, hash, files, provenance | selected artifact |
| Mở rộng filesystem/private network/admin | Rất cao | Deny mặc định hoặc admin approval | exact boundary + blast radius | one-shot |

Dialog có 6 trường cố định: **agent muốn làm gì; dùng tài nguyên/dữ liệu nào; gửi tới đâu; hậu quả; undo được không; quyền once/task/session và expiry**. Nút chính ghi động từ thật (“Gửi email tới A”, không phải “Cho phép”). Untrusted text chỉ nằm trong khung “Nội dung từ website”, không thể tạo nút/heading. Approval receipt ký vào canonical action; nếu recipient/body/file thay đổi thì receipt vô hiệu.

Giảm fatigue bằng auto-allow read-only và reversible workspace operations, batch theo plan + destination + data class, risk scoring deterministic, và “deny + explain” thay vì hỏi khi policy không chắc. Không cho “always allow” với payment, security settings, delete không recoverable, public publish hoặc data nhạy cảm.

## 13. Happy-path user journey và storyboard

| Bước | Agent/system | UI cho user | Checkpoint |
|---:|---|---|---|
| 1 | Parse goal, classify data/risk | Plan preview: nguồn, output, dự kiến domain/quyền/budget | User sửa scope hoặc Start |
| 2 | Allocate/attest code + browser microVM từ clean image | “Environment ready”, quotas, network off/allowlist | `session.created` |
| 3 | Import selected files read-only → workspace branch | File inventory + sensitivity labels | `inputs.pinned` |
| 4 | Research/read; untrusted content labeled | Live timeline, browser/terminal/file tabs; pause/stop | read steps auto |
| 5 | Cài dependency đã pin qua mirror | package/digest/provenance; hỏi nếu mới/rủi ro | `deps.locked` |
| 6 | Build/edit/test | Streaming logs, resource budget, diff | workspace versions |
| 7 | Quarantine staging → Scanner Cell → scan result + manifest | AV/SBOM/macro/link scan, provenance, preview | promote hoặc block |
| 8 | Credential Broker chuẩn bị opaque handle | Account/scope/destination/expiry; chưa cấp token | credential intent |
| 9 | External Action Preview → Human Approval | Scope: một action hoặc exact batch; Upload/Reject/Stop | signed exact action |
| 10 | Action Executor upload; Outbox giữ idempotency key | Status pending/succeeded/unknown + receipt | reconcile/commit |
| 11 | External receipt → review → audit/commit | Accept/commit/rollback | immutable audit |
| 12 | Teardown | Summary: persisted/deleted/revoked | wipe microVM/token/temp |

Với scenario có upload, scan được đưa lên trước External Action Preview và Action Executor để tuân thủ invariant **“artifact chưa scan không được rời quarantine”**. Đây là thứ tự trình bày an toàn dành riêng cho data flow upload.

## 14. Failure-case matrix

| Failure | Entry/impact | Prevention & detection | Recovery | UX | Owner |
|---|---|---|---|---|---|
| Code vô hạn/tool loop | bug/injection; cost | wall/tool/token budget, watchdog; heartbeat | stop child, checkpoint safe files | countdown, “Stopped at limit”, extend once | Runtime/Workflow |
| Sandbox crash | VMM/guest bug; lost transient state | health check, replicated metadata | new clean VM, restore scanned workspace + replay safe steps | “Recovered; no external action repeated” | Scheduler |
| Browser crash | renderer/OOM | process isolation, tab limits | restart fresh browser; restore only approved profile | snapshot of last page/action | Browser service |
| OOM | zip/build/browser | memory limit, pressure metrics | kill largest child; retry higher tier with approval | show cause and cost delta | Runtime |
| Disk full/inodes | logs/archive | quota, archive preflight, log rotation | delete temp/cache, preserve workspace delta | storage breakdown | Runtime/Artifact |
| Network timeout | upstream/proxy | timeout, bounded retry+jitter | retry read/idempotent; reconcile mutation | pending/unknown, never imply success | Gateway/Workflow |
| Registry attacked/down | supply chain | mirror, lock digest, signature/provenance | fail closed; cached verified package | identify blocked dependency | Supply chain |
| Policy không xác định risk | novel action | fail closed, typed schemas | ask security/user or deny | “Không thể phân loại; không chạy” | Policy |
| Approval hết hạn/từ chối | delay/user decision | short TTL, bind exact action | discard grant; re-plan | clear no-side-effect status | Approval |
| User đóng phiên | disconnect | durable event log, lease | suspend; revoke live token; auto-teardown TTL | resume card + persisted/deleted list | Workflow |
| Snapshot poisoned | malware/injection | scan/attestation/lineage | discard; restore known-clean + file-level cherry-pick | warning + diff of excluded files | State/IR |
| Duplicate after retry | ambiguous response | idempotency/outbox/reconcile | query receipt, compensate/manual | “Outcome unknown—checking” | Action Executor / Outbox |

## 15. Abuse-case matrix

| Abuse | Entry/impact | Prevention | Detection | Recovery + UX | Owner |
|---|---|---|---|---|---|
| Fork bomb | shell/package hook; DoS | PID/cgroup, no privilege | PID growth | kill tree, explain quota | Runtime |
| Crypto mining | binary/script; cost | CPU/time/egress cap, deny mining endpoints | sustained CPU, pool protocol | terminate/suspend account | Abuse/Runtime |
| Zip bomb | upload/download; disk/CPU | recursive size/ratio/depth limits | decompression telemetry | quarantine/delete temp | Artifact |
| Malware/ransomware | code/package/file | versioned workspace, read-only inputs, microVM | YARA/EDR/file entropy | kill, rollback, quarantine | IR/State |
| Website prompt injection | DOM/image/email | label untrusted, reader/actor split, origin policy | classifier + intent/action mismatch | stop action, show malicious source | Agent Security |
| Exfiltration | POST/DNS/upload | deny-by-default + DLP + approval | proxy/DNS anomaly/canary | block/revoke/incident | Gateway |
| SSRF/metadata | URL/redirect/DNS | no route + validate each hop | denied special IP | kill, rotate workload identity | Gateway |
| Credential theft | env/proc/screenshot | secret outside sandbox, proxy injection | canary/anomalous usage | revoke/rotate; user notice | Credential Broker |
| Cross-tenant access | cache/IDOR/escape | per-tenant KMS/authz/microVM | canary/access graph | isolate cell + incident | Platform |
| Gửi nhầm email/form | bad plan/injection | canonical preview, recipient policy | pre-send anomaly | cancel draft; recall if supported | Action Executor/UX |
| Upload nhầm file riêng tư | broad glob/poisoned DOM | explicit manifest + DLP + approval | label mismatch | block, revoke link/token | Artifact/Broker |
| Xóa/ghi đè file | ambiguous command | branch/version/CAS, trash | destructive diff | undo/restore | Filesystem |
| Artifact chứa mã độc | generated/download | quarantine/detonation/CDR | scanners + behavior | block export, show findings | Artifact |
| User yêu cầu tạo malware | prompt | safety policy + constrained capabilities | abuse classifier/rate | refuse/escalate account | Trust & Safety |
| Vượt thời gian/ngân sách | loop/intent abuse | hard budget/circuit breaker | budget meter | partial result; explicit extension | Workflow |
| Approval spoof/Lies-in-loop | injected content/dialog | system-rendered canonical UI, no agent HTML | receipt/action mismatch | reject, security banner | Approval UI |

## 16. Security invariants và decision rationale

1. Không plaintext credential dài hạn nào vào sandbox, model context, log, screenshot hay snapshot.
2. Không sandbox nào có route tới control plane, metadata hoặc private network mặc định.
3. Không network path nào bypass policy proxy; DNS là một egress channel được kiểm soát.
4. Không side effect nào chạy chỉ vì model “quyết định”; cần typed action, policy verdict và approval receipt nếu thuộc lớp duyệt.
5. Approval ràng buộc exact destination/data/action/expiry; thay đổi payload làm mất hiệu lực.
6. Không retry mù một external mutation có outcome chưa biết.
7. Không post-user snapshot nào dùng làm base cross-tenant; snapshot chưa scan không resume.
8. Artifact chưa scan không rời quarantine; manifest/hash/provenance theo artifact.
9. Control plane không parse/chạy untrusted artifact với privilege.
10. Audit event append-only, tenant-bound, redacted; stop/revoke có hiệu lực trong vài giây và được kiểm thử.

Giải pháp không chọn làm mặc định: container thuần (kernel shared), một VM chung code+browser (credential blast radius), unrestricted internet (exfiltration), secret qua env (agent/process đọc được), per-action approval cho mọi lệnh (fatigue), memory snapshot mặc định (secret/malware persistence), và classifier-only prompt-injection defense (probabilistic).

## 17. Kiến trúc MVP

MVP 8–12 tuần, giới hạn beta/single region:

- Kubernetes node pool riêng + gVisor RuntimeClass; một sandbox/session, browser là pod gVisor riêng.
- No private network; egress off mặc định, HTTPS allowlist qua managed proxy; chặn special IP/metadata.
- Object storage per tenant + versioned workspace; PostgreSQL workflow/approval/outbox; không memory snapshot.
- OAuth connectors ưu tiên; credential vault + proxy inject cho 2–3 provider; không hỗ trợ raw password/SSH.
- Manual approval cho send/upload/delete/domain mới; diff/file preview; stop/revoke; immutable-ish audit bằng append-only bucket.
- ClamAV/YARA/archive limits + MIME validation; signed base images, pinned dependency mirror.
- Onboarding chỉ workload low/medium risk; high-risk malware/kernel work từ chối.

Rủi ro MVP phải chấp nhận/giảm bằng scope: gVisor compatibility gap, proxy policy còn thô, scanner false negative, recovery không giữ process state và chưa có multi-cell failover.

## 18. Kiến trúc production

- Firecracker fleet trên hardened bare-metal/KVM hosts; code/browser/quarantine cell tách; warm clean snapshot pool.
- Scheduler risk-aware, attestation, per-cell control plane proxy, fleet reimage/patch canary; tenant/data residency.
- Multi-layer egress với eBPF + L7 proxy + controlled DNS + DLP; domain/request/origin/data-label policy.
- Credential STS/token exchange/audience binding; provider-specific action adapters; HSM/KMS; automatic rotation/revocation.
- Durable event-sourced workflow, transactional outbox, reconciliation/compensation library, policy/version replay.
- Content-addressed encrypted workspace, snapshot lineage, malware detonation, SBOM/SLSA/Sigstore, CDR cho document.
- Enterprise RBAC/ABAC, admin policy, compliance export, WORM audit, SIEM/SOAR, anomaly/abuse detection và break-glass.
- SLO định tính: warm start ở mức “interactive”; stop/revoke seconds; policy decision sub-second; artifact scan có progressive status. Số cụ thể phải đo bằng prototype.

### Cost/latency

Chi phí tăng chủ yếu do guest memory, browser RAM, warm pool, dual sandbox và scanning. Bù bằng: risk-tier routing (WASI/gVisor/Firecracker), lazy page restore, content-addressed caches, scale-to-zero, per-task child teardown và browser only-when-needed. Không dùng số vendor làm cam kết SLO. Firecracker paper chứng minh mục tiêu density/startup cho serverless nhưng workload browser agent phải benchmark riêng. [USENIX NSDI 2020](https://www.usenix.org/conference/nsdi20/presentation/agache)

## 19. Open questions, trade-offs và prototype cần xác thực

1. p50/p95/p99 cold start cho Python/Node/browser với clean vs snapshot restore; RAM/density thật.
2. Compatibility corpus: package native, ptrace, FUSE, browser GPU, font/media, Playwright/CDP.
3. gVisor tier có đủ an toàn cho risk class nào; tiêu chí chuyển Firecracker/full VM.
4. DNS rebinding/redirect/WebSocket/QUIC/DoH bypass test suite và egress false positive.
5. Prompt-injection attack success dưới reader/actor split, origin sets, DLP và approval; test cả visual/Unicode/PDF.
6. UX study: comprehension, approval rate, time-to-decision, false trust, fatigue; đặc biệt dialog do untrusted content tác động.
7. Credential providers nào hỗ trợ token exchange/downscope/idempotency/receipt; fallback an toàn.
8. Scanner coverage/latency cho archives, Office macro, PDF/HTML, binaries và model-generated code.
9. Snapshot hygiene: secret remnants, RNG uniqueness, stale sockets, persistence; chaos restore.
10. Exactly-once illusion: mô phỏng crash tại mọi điểm trước/sau external API; verify reconciliation.
11. Data retention/residency/legal hold và khả năng cryptographic erasure per tenant.
12. Economics dual sandbox/warm pool và ngưỡng chuyển session→per-task microVM.

## 20. Source evidence và annotated bibliography

### Bảng E — Source evidence

| Claim | Source | Ngày/version | Loại nguồn | Peer-reviewed? | Tin cậy |
|---|---|---|---|---|---|
| Firecracker cung cấp KVM microVM, jailer/seccomp/cgroup; egress phải lọc ở host | [Design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md) | rolling, truy cập 30/07/2026 | Official technical | Không | Cao |
| Firecracker đạt isolation/density cho serverless | [Agache et al.](https://www.usenix.org/conference/nsdi20/presentation/agache) | NSDI 2020 | Conference paper | Có | Cao |
| gVisor là userspace application kernel, có overhead | [Security](https://gvisor.dev/docs/architecture_guide/intro/) / [Performance](https://gvisor.dev/docs/architecture_guide/performance/) | rolling | Official technical | Không | Cao |
| Kata dùng VM/hardware virtualization | [Kata](https://katacontainers.io/) | rolling | Official project | Không | TB–cao |
| WASI capability-based, no ambient authority | [WASI.dev](https://wasi.dev/) | 0.3, 2026 | Standards project | Không | Cao |
| Kubernetes hardening cần capability/seccomp/MAC/network/resource controls | [Checklist](https://kubernetes.io/docs/concepts/security/application-security-checklist/) | 06/11/2024 | Official docs | Không | Cao |
| Chromium Site Isolation tách site bằng sandbox process, đổi RAM | [Chromium](https://www.chromium.org/Home/chromium-security/site-isolation/) | rolling | Official technical | Không | Cao |
| Prompt injection là rủi ro hệ thống agent | [OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) | 2025 | Industry standard | Không | Cao |
| Excessive agency cần giảm function/permission/autonomy | [OWASP LLM06](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) | 2025 | Industry standard | Không | Cao |
| Prompt injection có mô hình formal và defense vẫn hạn chế | [USENIX Security](https://www.usenix.org/conference/usenixsecurity24/presentation/liu-yupei) | 08/2024 | Conference paper | Có | Cao |
| Visual injection tác động computer-use agent | [VPI-Bench](https://arxiv.org/abs/2506.02456) | 03/06/2025 | arXiv preprint | Không | TB |
| Repeated warnings làm giảm chú ý/tuân thủ | [Vance et al.](https://www.usenix.org/conference/soups2019/presentation/vance) | SOUPS 2019 | Conference paper | Có | Cao |
| OAuth token có thể bind resource/audience | [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html) | 02/2020 | IETF Standard | Consensus review | Cao |
| OAuth token exchange hỗ trợ delegation/downscope | [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html) | 01/2020 | IETF Standard | Consensus review | Cao |
| Idempotency token làm retry mutation an toàn hơn | [AWS REL04-BP04](https://docs.aws.amazon.com/wellarchitected/2025-02-25/framework/rel_prevent_interaction_failure_idempotent.html) | 25/02/2025 | Official guidance | Không | Cao |
| SLSA provenance + Sigstore signature hỗ trợ supply-chain integrity | [SLSA 1.2](https://slsa.dev/spec/v1.2/) / [Sigstore](https://docs.sigstore.dev/cosign/verifying/verify/) | 1.2 / rolling | Specification/docs | Không | Cao |
| NIST yêu cầu quản trị rủi ro GenAI theo lifecycle | [NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) | 26/07/2024 | Government standard profile | Public review | Cao |
| Codex cloud dùng isolated container, network off mặc định | [OpenAI](https://openai.com/index/introducing-codex/) | 16/05/2025 | Vendor primary | Không | TB–cao |
| Claude sandbox tách filesystem/network và proxy credential | [Anthropic](https://www.anthropic.com/engineering/claude-code-sandboxing) | 20/10/2025 | Vendor technical | Không | TB–cao |
| Perplexity proxy-inject credential ngoài task sandbox | [Perplexity](https://www.perplexity.ai/help-center/en/articles/20260716-using-custom-api-credentials-in-computer) | 16/07/2026 | Vendor docs | Không | TB–cao |

### Annotated bibliography (20 nguồn trọng yếu)

1. **Agache et al., “Firecracker,” NSDI 2020.** Nền tảng peer-reviewed cho lựa chọn microVM, density và minimal VMM.
2. **Firecracker Design.** Chi tiết trust zones, jailer, seccomp/cgroup, rate limiting và yêu cầu host egress filtering.
3. **Firecracker Snapshot Support.** Cho thấy snapshot gồm device/RAM state và block device cần quản trị riêng—cơ sở cho snapshot hygiene.
4. **gVisor Security/Performance Guides.** Giải thích userspace kernel và trade-off compatibility/overhead.
5. **Kata Containers Architecture.** Cơ sở đánh giá VM-per-pod và tích hợp OCI/Kubernetes.
6. **WASI.dev 0.3.** Capability sandbox/no ambient authority và giới hạn compatibility hiện tại.
7. **Kubernetes Security Checklist.** Baseline defense-in-depth cho container/guest/VMM host.
8. **Chromium Site Isolation.** Lý do browser cần multi-process sandbox và vẫn cần outer VM boundary.
9. **OWASP LLM01:2025.** Taxonomy/impact của direct và indirect prompt injection.
10. **OWASP LLM06:2025.** Least functionality, least privilege và human approval cho excessive agency.
11. **Liu et al., USENIX Security 2024.** Bằng chứng peer-reviewed rằng prompt injection cần mô hình và đánh giá defense có hệ thống.
12. **VPI-Bench, Cao et al., arXiv 2025 (preprint).** Bằng chứng mới về injection trong pixel/UI; dùng thận trọng vì chưa peer-review.
13. **Vance et al., SOUPS 2019.** Bằng chứng usable-security cho approval fatigue/habituation.
14. **RFC 8693.** Chuẩn token exchange/delegation cho Credential Broker.
15. **RFC 8707.** Chuẩn audience/resource-bound token, giảm token redirect/cross-resource misuse.
16. **AWS Well-Architected Idempotency.** Pattern retry/idempotency token cho durable action executor.
17. **SLSA v1.2 + Sigstore Cosign.** Provenance/signature/digest cho image, package và artifact supply chain.
18. **NIST AI RMF GenAI Profile 600-1 (2024).** Khung governance/risk lifecycle và TEVV.
19. **OpenAI Codex cloud/Internet Access docs (2025–2026).** Fact về two-phase setup/agent, network defaults, secret removal và diff review; không dùng để suy ra hypervisor.
20. **Anthropic Claude sandboxing (2025) + Perplexity credential docs (2026).** Hai implementation pattern công khai cho egress proxy và secret injection ngoài sandbox; là vendor evidence, không phải chứng nhận độc lập.

---

### Recommendation cuối cùng

Chọn **dual Firecracker microVM + external egress gateway + Credential Broker + typed Action Executor + Idempotency Store/Outbox + event-sourced durable workflow + versioned/quarantined artifact pipeline + risk-based approval UI**. Đây là cấu hình cân bằng tốt nhất giữa isolation, Linux/browser compatibility, resume và latency. MVP có thể bắt đầu bằng gVisor trên dedicated nodes nhưng phải giữ nguyên các trust boundary và typed interfaces để thay runtime mà không đổi mô hình quyền. Kiến trúc chỉ được coi là production-ready sau khi prototype vượt qua escape/SSRF/DNS/prompt-injection/duplicate-side-effect chaos suite và một usability study thực tế về approval comprehension.
