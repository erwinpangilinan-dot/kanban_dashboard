---
name: mop-samsung-udu-vdu-application-precheck
description: >-
  Follow Method of Procedure "Samsung UDU/VDU application precheck" (mop_id=samsung-udu-vdu-application-precheck). Use when working on:
  Samsung application precheck, SS precheck, Samsung software precheck, UDU precheck, VDU precheck, Atlas precheck, Samsung upgrade precheck, samsung-udu-vdu-application-precheck, MOP, method of procedure. Always recall Memoria for the latest MOP chunks before executing.
---

# MOP: Samsung UDU/VDU application precheck

**mop_id:** `samsung-udu-vdu-application-precheck`  
**Source of truth:** Memoria at `http://10.10.50.2:8765` (Procedures / `[MOP] mop_id=samsung-udu-vdu-application-precheck`)

## Before you act

1. Call `memoria_recall` with query including `MOP samsung-udu-vdu-application-precheck` and the user task keywords.
2. Prefer hits whose content starts with `[MOP] mop_id=samsung-udu-vdu-application-precheck`.
3. List the required steps to the user and follow them in order.
4. If Memoria returns a newer/conflicting step, **prefer Memoria** over this draft skill.
5. Never print or commit Atlas passwords; use placeholders or env vars the user provides.

## Procedure (draft snapshot)

### 1. Overview

Samsung UDU/VDU software **precheck** via Atlas automation. Launch the correct job template for **UDU** or **VDU**, then monitor the activity stream until successful.

| Workload | Atlas job template | Typical workflow name |
|----------|-------------------|------------------------|
| **UDU** | `7491` | uADPF Wrapper Bulk uDU Upgrade Precheck Postcheck (SI Team) |
| **VDU** | `6578` | FOA Wrapper Bulk vDU Upgrade Precheck Postcheck |

### 2. Prerequisites

1. Identify target **gNB DUID** value(s) from `vDU_List` / Mission Control Network inventory.
2. Confirm **UDU vs VDU** per target — use **separate JSON files** per type.
3. Obtain **Atlas** credentials with permission to launch templates on `me.atlas.automation.vzwnet.com`.
4. Confirm target **software version** for the planned upgrade (e.g. `23.B.0-0100`).
5. Confirm network/VPN access to the Atlas API host.

### 3. Create precheck JSON batch file

Create one JSON file per workload type. Update:

- `scheduled_run_date` — current UTC date/time
- `version` — target SW version for precheck
- `gnblist` — gNB DUID(s) to precheck (array; multiple DUIDs allowed)
- `userName` — operator username if required by site policy

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
        "operation": "precheck",
        "version": "23.B.0-0100",
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

### 4. Launch Atlas precheck job

Replace `@precheck.json` with your file. Use the template matching UDU or VDU.

**UDU — template 7491:**

```bash
curl -vvv -f \
  -H 'Content-Type: application/json' \
  -H 'Cache-Control: no-cache' \
  -H 'Accept: application/json' \
  -u '<ATLAS_username>:<ATLAS_password>' \
  -d@precheck-udu.json \
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
  -d@precheck-vdu.json \
  -X POST 'http://me.atlas.automation.vzwnet.com/api/v2/job_templates/6578/launch/' \
  --insecure
```

### 5. Monitor activity stream

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

### 6. Completion criteria

Mark precheck **complete** only when the activity stream shows **successful** status for all targeted gNB DUIDs.

If failed or stuck: capture activity stream output, escalate, and do **not** proceed to upgrade.

### 7. Compliance and escalation

1. Do not mark precheck complete while Atlas jobs are pending or failed.
2. Always use the correct template: **7491 (UDU)** vs **6578 (VDU)**.
3. After verification, update production Mission Control (http://10.10.50.6) when part of a tracked change window.
4. Store lasting lessons in Memoria (`memoria_remember`, semantic, high) linked to [[Network Equipment]].

## After completion

- Note deviations or outcomes in Memoria if the user shipped a milestone.
- Do not silently install or overwrite other skills.
