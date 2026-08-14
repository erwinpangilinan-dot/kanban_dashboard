---
type: mop
mop_id: samsung-udu-vdu-application-rollback
title: Samsung UDU/VDU application rollback
task_triggers: ["Samsung application rollback", "SS rollback", "Samsung software rollback", "UDU rollback", "VDU rollback", "Atlas rollback", "revert Samsung upgrade"]
entities: ["Network Equipment", "Mission Control Dashboard", "Samsung", "Atlas"]
importance: high
---

# Samsung UDU/VDU application rollback

Method of Procedure for Samsung software rollback via Atlas automation (UDU and VDU job templates).

**mop_id:** `samsung-udu-vdu-application-rollback`  
**Triggers:** Samsung application rollback, SS rollback, Samsung software rollback, Atlas rollback, revert Samsung upgrade

Use this procedure when rolling back a Samsung UDU or VDU to the software version that was running **before** a upgrade attempt.

## Prerequisites

1. Rollback is approved (failed upgrade, post-change issue, or authorized revert).
2. **Rollback version identified** — the pre-upgrade software version (see §1 below). Do not proceed without it.
3. Identify target **gNB DUID** value(s) from `vDU_List` / Mission Control Network inventory.
4. Confirm whether each target is **UDU** or **VDU** — use separate JSON files per type.
5. Obtain **Atlas** credentials with permission to launch job templates.
6. Workstation must reach `http://me.atlas.automation.vzwnet.com` (lab/VPN as required).

## 1. Resolve rollback software version (required)

The JSON `version` field must be the **pre-upgrade** software version — not the version the upgrade was trying to install.

**Steps:**

1. Recall Memoria: `Samsung <gNB_DUID> pre-upgrade software version rollback baseline`.
2. Check Network dashboard Pods tab `software_version` — valid only if upgrade did not complete successfully.
3. Review Atlas activity stream history and change-window documentation.
4. Confirm with the operator if any doubt remains.

Example: upgrade targeted `26.A.0-0200` but the node previously ran `25.A.0-0100` → rollback JSON uses `"version": "25.A.0-0100"`.

## 2. Create the rollback JSON batch file

Create one JSON file per workload type (UDU vs VDU). Update:

- `scheduled_run_date` — current UTC timestamp
- `version` — **pre-upgrade** software version from §1
- `gnblist` — gNB DUID(s) to roll back
- `userName` — operator Atlas username if required
- `operation` — **`rollback`**

Example (`rollback-vdu-29991503555.json`):

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

For multiple gNB DUIDs:

```json
"gnblist": ["29991503555", "29991572163"]
```

## 3. Launch the Atlas rollback job

Replace `@rollback.json` with your saved file. Replace Atlas credentials.

### UDU rollback — job template **7491**

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

Expected workflow name (typical): **uADPF Wrapper Bulk uDU Upgrade Precheck Postcheck (SI Team)**

### VDU rollback — job template **6578**

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

Expected workflow name (typical): **FOA Wrapper Bulk vDU Upgrade Precheck Postcheck**

## 4. Monitor activity stream until complete

```bash
curl -k -X GET \
  "http://me.atlas.automation.vzwnet.com/api/v2/activity_stream/?search=<gNB_DUID>" \
  -u '<ATLAS_username>:<ATLAS_password>' \
  -H 'Content-Type: application/json'
```

Poll until the wrapper job shows **successful** completion status.

## 5. Mark rollback complete

Mark rollback **complete** only when Atlas shows **successful** status for all targeted gNB DUIDs and post-rollback software matches the intended version when verifiable.

## Compliance and escalation

1. Do not launch rollback without a confirmed pre-upgrade `version`.
2. Do not use the upgrade target version as the rollback version.
3. Do not mark rollback complete while Atlas jobs are pending or failed.
4. Use separate JSON files and the correct job template (7491 UDU vs 6578 VDU).
5. After verification, update production Mission Control (http://10.10.50.6) with outcome notes.
6. Store rollback outcome in Memoria linked to [[Network Equipment]].
