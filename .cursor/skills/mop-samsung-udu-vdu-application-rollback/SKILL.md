---
name: mop-samsung-udu-vdu-application-rollback
description: >-
  Follow Method of Procedure "Samsung UDU/VDU application rollback" (mop_id=samsung-udu-vdu-application-rollback). Use when working on:
  Samsung application rollback, SS rollback, Samsung software rollback, UDU rollback, VDU rollback, Atlas rollback, revert Samsung upgrade, samsung-udu-vdu-application-rollback, MOP, method of procedure. Always recall Memoria for the latest MOP chunks and the pre-upgrade software version before executing.
---

# MOP: Samsung UDU/VDU application rollback

**mop_id:** `samsung-udu-vdu-application-rollback`  
**Source of truth:** Memoria at `http://10.10.50.2:8765` (Procedures / `[MOP] mop_id=samsung-udu-vdu-application-rollback`)

## Before you act

1. Call `memoria_recall` with query including `MOP samsung-udu-vdu-application-rollback` and the user task keywords.
2. **Resolve rollback version first** — call `memoria_recall` with the gNB DUID + `Samsung pre-upgrade software version` + `rollback baseline` (see §2 below). Do **not** launch rollback until the version is confirmed.
3. Prefer hits whose content starts with `[MOP] mop_id=samsung-udu-vdu-application-rollback`.
4. List the required steps to the user and follow them in order.
5. If Memoria returns a newer/conflicting step, **prefer Memoria** over this draft skill.
6. Never print or commit Atlas passwords; use placeholders or env vars the user provides.

## Procedure (draft snapshot)

### 1. Overview

Samsung UDU/VDU software **rollback** via Atlas automation. Same launcher templates as precheck/upgrade (`7491` UDU, `6578` VDU); the batch JSON uses `"operation": "rollback"`. Launch the correct job template for **UDU** or **VDU**, then monitor the activity stream until successful.

| Workload | Atlas job template | Typical workflow name |
|----------|-------------------|------------------------|
| **UDU** | `7491` | uADPF Wrapper Bulk uDU Upgrade Precheck Postcheck (SI Team) |
| **VDU** | `6578` | FOA Wrapper Bulk vDU Upgrade Precheck Postcheck |

### 2. Resolve rollback software version (required)

Rollback must target the **software version that was running before the upgrade** — not the upgrade target version.

**Primary — Memoria recall**

```text
memoria_recall: "<gNB_DUID> Samsung pre-upgrade software version rollback baseline MOP"
```

Look for memories recorded at precheck/upgrade planning time, e.g. Pods tab `software_version` before the change window.

**Fallbacks (in order)**

1. **Network dashboard → Pods tab** — `software_version` / BuildInfo for the gNB DUID. If the upgrade **failed or was partial**, this may still be the pre-upgrade version. If the upgrade **succeeded**, this is the *new* version — do **not** use it; use Memoria or Atlas history instead.
2. **Atlas activity stream** — search by gNB DUID; find the last successful **upgrade** wrapper job and note its `version` (that is what was installed). The rollback target is the version **before** that upgrade — cross-check Memoria or change-window notes.
3. **Mission Control / change-window notes** — documented baseline SW for the site.
4. **Operator confirmation** — if still ambiguous, state the inferred version and ask the user to confirm before launch.

**After resolving**, record for the run:

- `rollback_version` — version string for the JSON `version` field (e.g. `25.A.0-0100`)
- `upgrade_version` — what the failed/successful upgrade targeted (for audit)

If you cannot determine `rollback_version` with confidence, **stop** and escalate — do not guess.

### 3. Prerequisites

1. A **Samsung upgrade** was attempted or completed and rollback is approved (failed upgrade, post-change issue, or approved revert).
2. **Rollback version resolved** per §2 and confirmed with the operator when uncertain.
3. Identify target **gNB DUID** value(s) from `vDU_List` / Mission Control Network inventory.
4. Confirm **UDU vs VDU** per target — use **separate JSON files** per type.
5. Obtain **Atlas** credentials with permission to launch templates on `me.atlas.automation.vzwnet.com`.
6. Confirm network/VPN access to the Atlas API host and an approved change window.

### 4. Create rollback JSON batch file

Create one JSON file per workload type. Update:

- `scheduled_run_date` — current UTC date/time
- `version` — **pre-upgrade software version** from §2 (rollback target)
- `gnblist` — gNB DUID(s) to roll back (array; multiple DUIDs allowed)
- `userName` — operator username if required by site policy
- `operation` — must be **`rollback`** (not `upgrade` or `precheck`)

Example:

```json
{
  "extra_vars": {
    "batch_list": [
      {
        "userName": "panger6",
        "batch_id": "1",
        "batch_priority": 1,
        "scheduled_run_date": "2023-09-06 18:09:20 UTC",
        "operation": "rollback",
        "version": "25.A.0-0100",
        "gnblist": ["29991503555"]
      }
    ]
  }
}
```

Multiple gNB DUIDs:

```json
"gnblist": ["29991503555", "29991572163"]
```

### 5. Launch Atlas rollback job

Replace `@rollback.json` with your file. Use the template matching UDU or VDU.

**UDU — template 7491:**

```bash
curl -vvv -f \
  -H 'Content-Type: application/json' \
  -H 'Cache-Control: no-cache' \
  -H 'Accept: application/json' \
  -u '<ATLAS_username>:<ATLAS_password>' \
  -d@rollback-udu.json \
  -X POST 'http://me.atlas.automation.vzwnet.com/api/v2/job_templates/7491/launch/' \
  --insecure
```

**VDU — template 6578:**

```bash
curl -vvv -f \
  -H 'Content-Type: application/json' \
  -H 'Cache-Control: no-cache' \
  -H 'Accept: application/json' \
  -u '<ATLAS_username>:<ATLAS_password>' \
  -d@rollback-vdu.json \
  -X POST 'http://me.atlas.automation.vzwnet.com/api/v2/job_templates/6578/launch/' \
  --insecure
```

### 6. Monitor activity stream

Poll by gNB DUID until the job completes successfully:

```bash
curl -k -X GET \
  "http://me.atlas.automation.vzwnet.com/api/v2/activity_stream/?search=<gNB_DUID>" \
  -u '<ATLAS_username>:<ATLAS_password>' \
  -H 'Content-Type: application/json'
```

Example:

```bash
curl -k -X GET \
  "http://me.atlas.automation.vzwnet.com/api/v2/activity_stream/?search=29991572163" \
  -u '<ATLAS_username>:<ATLAS_password>' \
  -H 'Content-Type: application/json'
```

Monitor the **wrapper** job (not the short-lived launcher). Wait for **successful** completion with a `finished` timestamp before marking done.

### 7. Completion criteria

Mark rollback **complete** only when the activity stream (and wrapper job API status) shows **successful** for all targeted gNB DUIDs.

Verify post-rollback software on the Pods tab / BuildInfo matches `rollback_version` when possible.

If failed or stuck: capture activity stream output, escalate, and do **not** mark the change window complete.

### 8. Compliance and escalation

1. Do **not** launch rollback without a confirmed **pre-upgrade** `version` from §2.
2. Do **not** use the failed upgrade's target version as the rollback version.
3. Do not mark rollback complete while Atlas jobs are pending or failed.
4. Always use the correct template: **7491 (UDU)** vs **6578 (VDU)**.
5. After verification, update production Mission Control (http://10.10.50.6) when part of a tracked change window.
6. Store rollback outcome in Memoria (`memoria_remember`, semantic, high) linked to [[Network Equipment]] — include gNB DUID, rollback version, and upgrade version reverted from.

## After completion

- Note deviations or outcomes in Memoria if the user shipped a milestone.
- Do not silently install or overwrite other skills.
