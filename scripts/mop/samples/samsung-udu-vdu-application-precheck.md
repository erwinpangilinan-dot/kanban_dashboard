---
type: mop
mop_id: samsung-udu-vdu-application-precheck
title: Samsung UDU/VDU application precheck
task_triggers: ["Samsung application precheck", "SS precheck", "Samsung software precheck", "UDU precheck", "VDU precheck", "Atlas precheck"]
entities: ["Network Equipment", "Mission Control Dashboard", "Samsung", "Atlas"]
importance: high
---

# Samsung UDU/VDU application precheck

Method of Procedure for Samsung software precheck via Atlas automation (UDU and VDU job templates).

**mop_id:** `samsung-udu-vdu-application-precheck`  
**Triggers:** Samsung application precheck, SS precheck, Samsung software precheck, Atlas precheck

Use this procedure whenever the user requests a Samsung UDU or VDU software **precheck** before an upgrade.

## Prerequisites

1. Identify target **gNB DUID** value(s) from `vDU_List` / Mission Control Network inventory.
2. Confirm whether each target is **UDU** or **VDU** — use separate JSON files per type.
3. Obtain **Atlas** credentials (`ATLAS_username`, `ATLAS_password`) with permission to launch job templates.
4. Confirm target **software version** string for the planned upgrade (e.g. `23.B.0-0100`).
5. Workstation must reach `http://me.atlas.automation.vzwnet.com` (lab/VPN as required).

## 1. Create the precheck JSON batch file

Create one JSON file per workload type (UDU vs VDU). Update:

- `scheduled_run_date` — current UTC timestamp
- `version` — target new software version for the precheck
- `gnblist` — gNB DUID(s) to precheck (one or more; comma-separated list in JSON array)
- `userName` — operator Atlas username if required by your site

Example (`precheck-vdu-29991503555.json`):

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

For multiple gNB DUIDs in one batch, add each DUID to `gnblist`:

```json
"gnblist": ["29991503555", "29991572163"]
```

## 2. Launch the Atlas precheck job

Replace `@precheck.json` with your saved file from step 1. Replace Atlas credentials.

### UDU precheck — job template **7491**

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

Expected workflow name (typical): **uADPF Wrapper Bulk uDU Upgrade Precheck Postcheck (SI Team)**

### VDU precheck — job template **6578**

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

Expected workflow name (typical): **FOA Wrapper Bulk vDU Upgrade Precheck Postcheck**

## 3. Monitor activity stream until complete

Search activity stream by gNB DUID to confirm the job was triggered and finished:

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

Poll until the precheck job shows **successful** completion status.

## 4. Mark precheck complete

Mark the precheck **complete** only when the Atlas activity stream shows the job in **successful** status for all targeted gNB DUIDs.

If the job fails or stalls, capture the activity stream output, escalate, and do **not** proceed to upgrade.

## Compliance and escalation

1. Do not mark precheck complete while Atlas jobs are pending or failed.
2. Use separate JSON files and the correct job template (7491 UDU vs 6578 VDU).
3. After verification, update production Mission Control (http://10.10.50.6) with outcome notes when part of a tracked change window.
4. Store lasting lessons in Memoria with `memoria_remember` (semantic, high) linked to [[Network Equipment]].
