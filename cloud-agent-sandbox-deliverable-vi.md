# Cloud sandbox cho AI agent — Architecture & UX deliverable

**Ngày thiết kế:** 30/07/2026  
**Mục tiêu:** cho phép AI agent chạy code, điều khiển browser và thao tác file thay người dùng trong cloud multi-tenant, nhưng giới hạn thiệt hại khi agent, code, website, package hoặc người dùng có hành vi độc hại.

## 1. Kiến trúc đề xuất

### 1.1 Quyết định cốt lõi

Production sử dụng **hai Firecracker microVM theo session**:

- **Code sandbox:** terminal, package manager, compiler và workspace.
- **Browser sandbox:** Chromium/Playwright, browser profile, download và upload staging.

Hai sandbox có guest kernel, filesystem, network identity và resource quota riêng. Chúng không trao đổi qua shared filesystem hay socket trực tiếp; mọi dữ liệu đi qua API có schema của control plane.

Container Linux thuần không được xem là ranh giới tenant đủ mạnh vì chia sẻ host kernel. gVisor có thể dùng cho MVP hoặc workload rủi ro thấp; production mặc định dùng microVM. Firecracker cung cấp KVM boundary, device model tối giản, jailer, seccomp và cgroup; network filtering vẫn phải thực hiện bên ngoài microVM. [Firecracker design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)

### 1.2 Sơ đồ thành phần

```text
User / Human-in-the-loop UI
        │ goal, policy choices, signed approvals
        ▼
┌──────────────────── TRUSTED CONTROL PLANE ─────────────────────┐
│ API/Auth                                                       │
│ Task Planner ─ Durable Workflow ─ Event/Audit Log              │
│                       │                                        │
│ Policy Engine ─ Approval Service ─ Action Executor             │
│                       │                   │                    │
│ Credential Broker                 Idempotency Store / Outbox   │
│                       │                   │                    │
│ Scheduler/Attestation ─ Egress/DNS/SSRF/DLP Gateway            │
│                       │                                        │
│ Workspace Versions ─ Artifact Policy/Quarantine Controller     │
└───────────────┬───────────────────────┬────────────────────────┘
                │ short-lived capability│
       ┌────────▼─────────┐     ┌───────▼──────────┐
       │ Code microVM     │     │ Browser microVM │
       │ terminal/package │     │ Chromium/profile│
       │ CoW /work        │     │ download staging│
       └──────────────────┘     └──────────────────┘
                 UNTRUSTED DATA PLANE
                            │ quarantine staging
                 ┌──────────▼──────────────────┐
                 │ Artifact Scanner /          │
                 │ Detonation Cell (separate)  │
                 └──────────┬──────────────────┘
                            │ scan result + manifest
                            ▼
                 Artifact Policy Controller
```

**Visible architecture nodes (24):** User/HITL UI; API/Auth; Task Planner; Durable Workflow; Policy Engine; Approval Service; Event/Audit Log; Scheduler/Attestation; Credential Broker; Action Executor; Idempotency Store/Outbox; Workspace Version Service; Egress/DNS/SSRF/DLP Gateway; Artifact Policy/Quarantine Controller; Code Firecracker microVM; Browser Firecracker microVM; Artifact Scanner/Detonation Cell; Persistent State Store; Clean Base Images; Selected User Files; Verified Mirror; Public Internet; External APIs/User Accounts; Approved Export Destination. Pause/Resume/Stop, approval fields, persisted-state types và các thành phần nội bộ microVM/Inspector không phải node riêng.

### 1.3 Control plane và data plane

**Control plane** quản lý identity, task state, policy, approvals, credential, audit, workspace version và artifact promotion. Nó chạy trong account/VPC riêng, không mount trực tiếp workspace và không parse artifact bằng privileged process.

**Data plane** chỉ nhận capability ngắn hạn gắn với `tenant_id`, `task_id`, `sandbox_id`, quyền, quota và expiry. Sandbox không có:

- Cloud IAM role hữu ích hoặc quyền Kubernetes API.
- Route tới control plane, metadata endpoint hoặc private network.
- Credential gốc, refresh token, password, API key hay signing key.
- Docker socket, host PID/IPC, privileged mode hoặc device passthrough.

Browser không gửi dữ liệu trực tiếp sang Code microVM. Đường truyền duy nhất là `Browser microVM → typed extraction/download reference → Control Plane mediation → structured data hoặc scanned reference → Code microVM`; không có shared filesystem, direct socket hoặc direct edge.

### 1.4 Filesystem và resource isolation

- Signed read-only base image; CoW overlay riêng cho từng sandbox.
- `/work` versioned; input gốc read-only; `/tmp` và download staging ephemeral.
- Non-root UID; drop capabilities; seccomp/AppArmor; no privilege escalation.
- Hard quota cho vCPU, RAM, PID, disk bytes/inodes, IOPS, network bytes/connections, wall time, số tool call và ngân sách API/model.
- Warm pool chỉ chứa clean pre-agent image. Không dùng snapshot sau phiên của tenant A làm base cho tenant B.

### 1.5 Network security

Mọi egress mặc định bị chặn và chỉ đi qua gateway:

1. Host/eBPF chặn private, loopback, link-local, multicast, metadata và control-plane CIDR.
2. Platform DNS resolver kiểm tra A/AAAA, từ chối special IP và pin kết quả ngắn hạn.
3. L7 proxy kiểm tra scheme, host, port, SNI, certificate, HTTP method, path, redirect, MIME và body size.
4. Policy được đánh giá lại sau mỗi DNS resolution và redirect để chống SSRF/DNS rebinding.
5. Egress DLP phát hiện secret, dữ liệu nhạy cảm, canary và upload bất thường.
6. DNS, WebSocket, raw TCP/UDP, DoH và QUIC không được phép bypass proxy.

Allowlist phải gắn với action và data flow, ví dụ: `GET registry.npmjs.org` có thể được phép nhưng `POST attacker.example` hoặc upload file vẫn bị chặn.

### 1.6 Credential và external action

Credential được giữ trong Vault/KMS ngoài sandbox. Khi agent cần truy cập dịch vụ:

1. Agent gửi typed action và opaque credential handle.
2. Policy Engine đánh giá account, scope, resource, destination, data và side effect.
3. Approval Service lấy xác nhận nếu cần.
4. Credential Broker mint token ngắn hạn/downscoped và audience-bound.
5. Idempotency Store/Outbox ghi intent và key trước mutation.
6. Action Executor dùng typed request để thực hiện side effect; Gateway gắn token sau khi kiểm tra destination.
7. Idempotency Store/Outbox lưu receipt, chống duplicate và reconcile outcome không rõ.

OAuth token nên được bind với resource/audience theo [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html) và downscope/delegate qua [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html). OTP/password đi qua secure input trực tiếp tới broker, không qua model context, terminal, log hoặc screenshot.

### 1.7 State persistence và resume

**Persist:**

- Task plan, workflow state, policy version và approval receipt.
- Append-only audit events.
- Workspace versions, file diff và artifact manifest.
- Idempotency/outbox records và external receipts.
- Browser profile tối thiểu nếu người dùng opt-in theo site.

**Xóa khi kết thúc:**

- Process/RAM state, `/tmp`, clipboard, transient downloads.
- Access token, OTP và session capability.
- Browser profile không được chọn lưu.

**Không bao giờ snapshot:** plaintext secret, token ngắn hạn, OTP/password, raw model scratchpad và quarantine chưa scan.

Mỗi side effect có trạng thái:

```text
planned → authorized → executing → committed
                                  ↘ unknown → reconcile
                                            ↘ compensated/manual
```

Intent/outbox được ghi trước khi gọi external API. Mọi retry sử dụng cùng idempotency key. Nếu timeout khiến outcome không rõ, hệ thống query receipt/provider thay vì tự chạy lại. Workspace dùng compare-and-swap trên base version để tránh ghi đè thay đổi mới.

### 1.8 Artifact pipeline

File tải về hoặc tạo ra đi vào quarantine:

1. Xác định MIME thật, archive depth/ratio và kích thước giải nén.
2. AV/YARA, macro/script/link scan, SBOM/SCA khi phù hợp.
3. Detonate file khả nghi trong quarantine VM riêng.
4. Tạo manifest gồm hash, nguồn, tool/package và scan result.
5. Chỉ artifact đạt policy mới xuất hiện trong review UI.
6. User chọn export/commit; artifact được ký và ghi audit.

## 2. Human-in-the-loop UX

### 2.1 Nguyên tắc

- Tự động cho phép read-only và thay đổi có thể rollback bên trong workspace.
- Chặn đúng lúc trước khi mở rộng quyền hoặc tạo external side effect.
- Approval dialog do hệ thống render từ canonical action, không dùng HTML/Markdown do agent hay website sinh.
- Không dùng nút chung chung “Allow”; nút phải nói hành động thật, như “Gửi email tới alice@example.com”.
- Nếu Policy Engine không xác định được risk, hệ thống deny hoặc xin quyết định rõ ràng; không tự coi là an toàn.

### 2.2 Mỗi approval checkpoint phải hiển thị

1. Agent muốn làm gì?
2. Dùng tài nguyên hoặc dữ liệu nào?
3. Dữ liệu được gửi đến domain/account/recipient nào?
4. Hậu quả và blast radius là gì?
5. Có thể undo/rollback không?
6. Quyền được cấp one-shot, theo batch, theo task hay có hạn bao lâu?

Approval được ký vào exact action. Thay đổi recipient, file hash, amount, scope hoặc payload làm approval hết hiệu lực.

Với upload minh họa, scope là radio **“Chỉ hành động này”** hoặc **“Batch chính xác gồm 1 artifact”**. Nút xác nhận duy nhất là **“Upload report.md to Project Drive”**; hai nút còn lại là **Reject** và **Stop task**.

### 2.3 Approval policy

| Hành động | Mức rủi ro | UX/policy |
|---|---:|---|
| Đọc file user đã chọn hoặc public web trong plan | Thấp | Auto; hiển thị trong timeline |
| Tạo/sửa file trong workspace versioned | Thấp–TB | Auto; review diff cuối |
| Cài package đã pin từ mirror được duyệt | TB | Auto hoặc batch approval theo dependency set |
| Domain/package mới | TB | JIT approval: destination, method, version, script |
| Xóa/overwrite file | Cao nếu mất dữ liệu | Preview exact paths và rollback; one-shot/batch |
| Dùng credential để đọc | TB | Approval lần đầu hoặc khi scope/account thay đổi |
| Gửi email/form, upload hoặc publish | Cao | Luôn preview recipient, payload và file manifest |
| Payment, security setting, account permission | Rất cao | One-shot, re-auth; không có “always allow” |
| Private network/admin/filesystem ngoài scope | Rất cao | Deny mặc định hoặc admin approval |

### 2.4 Các màn hình chính

- **Plan preview:** mục tiêu, bước dự kiến, nguồn dữ liệu, domain, credential, budget và side effects.
- **Live activity:** timeline có provenance; browser, terminal, files, network và budget tabs.
- **Approval sheet:** sáu trường bắt buộc, risk reason, exact scope và expiry.
- **Diff review:** added/modified/deleted, file sensitivity, rollback và commit target.
- **External action preview:** recipient/destination, full payload, attachment hashes và idempotency status.
- **Artifact review:** preview, scan findings, manifest, provenance và export/commit.
- **Audit timeline:** ai/agent làm gì, policy nào quyết định, user duyệt gì và external receipt.
- **Global controls:** Pause, Resume, Stop, Revoke credentials và Rollback.

## 3. Happy path

| Bước | Hệ thống | Trải nghiệm người dùng |
|---:|---|---|
| 1 | Parse prompt, phân loại dữ liệu/risk | Xem và sửa plan, domain, quyền, budget |
| 2 | Tạo/attest code và browser microVM từ clean image | “Environment ready”; thấy quota/network policy |
| 3 | Import file đã chọn vào workspace branch | Xem inventory và sensitivity labels |
| 4 | Agent đọc web/file với provenance labels | Theo dõi browser/terminal/file timeline; có thể pause |
| 5 | Cài dependency đã pin qua verified mirror | Chỉ hỏi nếu package/domain/script vượt scope |
| 6 | Agent tạo/sửa file, chạy test | Xem live logs và file diff; thay đổi có version |
| 7 | Đưa report vào quarantine; Scanner Cell scan và tạo manifest | Xem hash, provenance và scan findings |
| 8 | Credential Broker chuẩn bị opaque handle cho service | Xem account, resource, scope và expiry; chưa cấp token |
| 9 | External Action Preview → Human Approval | Chọn scope; xác nhận upload, Reject hoặc Stop |
| 10 | Action Executor upload bằng typed action; Outbox giữ idempotency key | UI hiển thị pending/succeeded/unknown cùng receipt |
| 11 | Đối soát receipt, review diff/artifact, audit và commit | Commit, yêu cầu sửa hoặc rollback |
| 12 | Session teardown | Summary state đã lưu/xóa và credential đã revoke |

Với scenario có upload, scan được đưa lên trước External Action Preview và Action Executor để tuân thủ invariant **“artifact chưa scan không được rời quarantine”**. Đây là thứ tự trình bày an toàn dành riêng cho data flow upload.

## 4. Failure cases

| Failure | Prevention/detection | Recovery | UX |
|---|---|---|---|
| Code/tool loop vô hạn | Wall time, tool/token budget, watchdog | Stop process tree; giữ safe workspace checkpoint | Hiển thị limit và partial result; user có thể cấp thêm budget |
| Sandbox crash | Health/heartbeat, replicated task metadata | Tạo clean VM, restore scanned workspace, replay safe steps | Báo phần nào đã phục hồi; xác nhận không lặp external action |
| Browser crash | Renderer isolation, tab/RAM limits | Restart browser; chỉ restore profile đã cho phép | Hiển thị trang/action cuối |
| OOM | Hard memory limit, pressure metrics | Kill child lớn nhất hoặc đề xuất resource tier cao hơn | Nêu process gây OOM và cost delta |
| Disk/inode full | Quota, archive preflight, log rotation | Xóa temp/cache; giữ workspace delta | Storage breakdown và lựa chọn cleanup |
| Network timeout | Timeout, bounded retry/backoff | Retry read/idempotent; reconcile mutation | Không báo thành công khi outcome chưa biết |
| Registry compromise/outage | Pinned digest, signed mirror, provenance | Fail closed hoặc dùng verified cache | Nêu dependency bị chặn và lý do |
| Policy không phân loại được | Typed schemas, fail-closed | Deny hoặc chuyển human/security review | Thông báo rõ hành động chưa chạy |
| Approval hết hạn/từ chối | Signed approval TTL | Hủy grant, re-plan | Hiển thị “không có side effect” |
| User đóng phiên | Durable event log, session lease | Suspend, revoke token, teardown theo TTL | Resume card liệt kê state còn lại |
| Poisoned snapshot/workspace | Lineage, scan, attestation | Discard snapshot; restore clean base, cherry-pick file sạch | Cảnh báo và diff file bị loại |
| Duplicate sau retry | Outbox, idempotency, receipt | Query provider, compensate hoặc manual resolution | Trạng thái “Outcome unknown—đang đối soát” |

## 5. Abuse cases

| Abuse | Prevention/detection | Recovery và UX |
|---|---|---|
| Fork bomb | PID/cgroup limit, no privilege; process growth alert | Kill tree; giải thích quota violation |
| Crypto mining | CPU/time/egress cap; mining protocol/domain detection | Terminate session, preserve audit, suspend account nếu cần |
| Zip bomb | Giới hạn size, ratio, depth và inode trước giải nén | Xóa temp/quarantine; báo file bị chặn |
| Malware/ransomware | MicroVM, read-only inputs, versioned workspace, YARA/behavior detection | Kill sandbox, rollback workspace, quarantine evidence |
| Website/email/document prompt injection | Untrusted provenance, reader/actor split, origin policy, least tools | Chặn action, highlight nguồn injection, discard poisoned checkpoint |
| Data exfiltration | Default-deny egress, DLP, method/body policy, upload approval | Block request, revoke token, mở incident |
| SSRF/DNS rebinding | Không route private/metadata; validate IP mỗi DNS/redirect hop | Kill session và rotate workload identity |
| Credential theft | Secret ngoài sandbox, request-level injection, log/screenshot redaction | Revoke/rotate credential; thông báo account bị ảnh hưởng |
| Cross-tenant access | MicroVM, tenant-bound authz/KMS/cache/volume | Isolate cell/node, rotate identity và incident response |
| Agent gửi nhầm email/form | Canonical recipient/payload preview | Hủy draft; recall/compensate nếu provider hỗ trợ |
| Agent upload nhầm file riêng tư | Explicit file manifest, DLP labels, approval | Chặn upload hoặc revoke shared link/token |
| Agent xóa/ghi đè file | Version/CAS, trash và destructive diff | Undo/restore phiên bản |
| Artifact chứa mã độc | Quarantine, AV/YARA/CDR/detonation | Block export; hiển thị finding và cho phép regenerate |
| User yêu cầu tạo malware/phishing | Use-policy enforcement, capability restriction, abuse rate limit | Refuse, preserve minimal audit, escalate account khi cần |
| Agent vượt ngân sách | Hard budget và circuit breaker | Stop; trả partial artifact và xin extension cụ thể |
| Approval spoof/Lies-in-the-loop | System-rendered dialog, no agent HTML, signed canonical action | Reject mismatch; cảnh báo injection và không execute |

## 6. Security invariants và acceptance criteria

### Invariants

1. Plaintext credential dài hạn không vào sandbox, model context, log, screenshot hoặc snapshot.
2. Sandbox không có route tới control plane, metadata hoặc private network mặc định.
3. Không có egress path bypass gateway và DNS policy.
4. External side effect cần typed action, policy verdict và approval receipt khi thuộc lớp duyệt.
5. Approval luôn bind với exact destination, data, action và expiry.
6. Không retry mù external mutation có outcome chưa xác định.
7. Post-user snapshot không dùng cross-tenant; snapshot chưa scan không resume.
8. Artifact chưa scan không rời quarantine.
9. Control plane không parse hoặc execute untrusted artifact với privilege.
10. Pause, stop và credential revoke phải có hiệu lực trong vài giây và được audit.

### Prototype phải xác thực trước production

- p50/p95/p99 cold start và memory density của dual microVM với browser thực.
- Escape, kernel/VMM, SSRF, DNS rebinding, redirect, WebSocket và DoH bypass tests.
- Prompt/visual injection tests trên web, email, PDF, image và tool output.
- Crash tại mọi điểm trước/sau external API để chứng minh không duplicate side effect.
- Snapshot scan, secret-remnant, RNG/stale-connection và poisoned-workspace tests.
- Artifact scanner coverage/latency và false-negative handling.
- Usability study đo user hiểu recipient/data/consequence/scope, approval fatigue và stop/revoke behavior.

## 7. MVP và production

**MVP:** gVisor trên dedicated Kubernetes nodes; code/browser pod tách; HTTPS allowlist proxy; không private network; PostgreSQL workflow/outbox; object-store workspace versions; credential proxy cho ít connector; manual approval cho send/upload/delete/domain mới; không memory snapshot; giới hạn beta ở workload low/medium risk.

**Production:** dual Firecracker fleet theo cell; clean warm snapshots; risk-aware scheduler; eBPF + L7/DNS/DLP egress; token exchange/downscope; durable event-sourced workflow; provider-specific idempotent action adapters; multi-stage artifact quarantine; tenant KMS, WORM audit, SIEM/SOAR và data-residency controls.

**Recommendation:** dùng kiến trúc production làm target, nhưng giữ runtime sau một sandbox interface chung để MVP gVisor có thể chuyển sang Firecracker mà không thay đổi trust boundary, policy, credential, workflow hoặc UX.
