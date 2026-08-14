---
type: mop
mop_id: samsung-udu-vdu-application-upgrade
title: Samsung UDU/VDU application upgrade
task_triggers: ["Samsung application upgrade", "SS upgrade", "Samsung software upgrade", "UDU upgrade", "VDU upgrade", "Atlas upgrade"]
entities: ["Network Equipment", "Mission Control Dashboard", "Samsung", "Atlas"]
importance: high
---

# Samsung UDU/VDU application upgrade

Method of Procedure for Samsung software upgrade via Atlas automation (UDU and VDU job templates).

**mop_id:** `samsung-udu-vdu-application-upgrade`  
**Triggers:** Samsung application upgrade, SS upgrade, Samsung software upgrade, Atlas upgrade

Use this procedure whenever the user requests a Samsung UDU or VDU software **upgrade** after precheck has passed.

## Prerequisites

1. **Precheck successful** for the same gNB DUID(s) and target version (`samsung-udu-vdu-application-precheck`).
2. Identify target **gNB DUID** value(s) from `vDU_List` / Mission Control Network inventory.
3. Confirm whether each target is **UDU** or **VDU** — use separate JSON files per type.
4. Obtain **Atlas** credentials (`ATLAS_username`, `ATLAS_password`) with permission to launch job templates.
5. Confirm target **software version** string for the upgrade (e.g. `23.B.0-0100`).
6. Workstation must reach `http://me.atlas.automation.vzwnet.com` (lab/VPN as required).

## 1. Create the upgrade JSON batch file

Create one JSON file per workload type (UDU vs VDU). Update:

- `scheduled_run_date` — current UTC timestamp
- `version` — target new software version for the upgrade
- `gnblist` — gNB DUID(s) to upgrade (one or more; comma-separated list in JSON array)
- `userName` — operator Atlas username if required by your site
- `operation` — **`upgrade`**

Example (`upgrade-vdu-29991503555.json`):

```json
{
  "extra_vars": {
    "batch_list": [
      {
        "userName": "panger6",
        "batch_id": "1",
        "batch_priority": 1,
        "scheduled_run_date": "2023-09-06 18:09:20 UTC",
        "operation": "upgrade",
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

## 2. Launch the Atlas upgrade job

Replace `@upgrade.json` with your saved file from step 1. Replace Atlas credentials.

### UDU upgrade — job template **7491**

```bash
curl -vvv -f \
  -H 'Content-Type: application/json' \
  -H 'Cache-Control: no-cache' \
  -H 'Accept: application/json' \
  -u '<ATLAS_username>:<ATLAS_password>' \
  -d@upgrade-udu.json \
  -X POST 'http://me.atlas.automation.vzwnet.com/api/v2/job_templates/7491/launch/' \
  --insecure
```

Expected workflow name (typical): **uADPF Wrapper Bulk uDU Upgrade Precheck Postcheck (SI Team)**

### VDU upgrade — job template **6578**

```bash
curl -vvv -f \
  -H 'Content-Type: application/json' \
  -H 'Cache-Control: no-cache' \
  -H 'Accept: application/json' \
  -u '<ATLAS_username>:<ATLAS_password>' \
  -d@upgrade-vdu.json \
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

Poll until the wrapper job shows **successful** completion status.

## 4. Mark upgrade complete

Mark the upgrade **complete** only when the Atlas activity stream shows the job in **successful** status for all targeted gNB DUIDs.

If the job fails or stalls, capture the activity stream output, escalate, and follow rollback procedure.

## Compliance and escalation

1. Do not launch upgrade without successful precheck for the same version and targets.
2. Do not mark upgrade complete while Atlas jobs are pending or failed.
3. Use separate JSON files and the correct job template (7491 UDU vs 6578 VDU).
4. After verification, update production Mission Control (http://10.10.50.6) with outcome notes when part of a tracked change window.
5. Store lasting lessons in Memoria with `memoria_remember` (semantic, high) linked to [[Network Equipment]].
