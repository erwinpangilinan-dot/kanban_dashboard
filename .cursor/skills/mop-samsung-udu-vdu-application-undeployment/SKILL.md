---
name: mop-samsung-udu-vdu-application-undeployment
description: >-
  Follow Method of Procedure "Samsung UDU/VDU application undeployment" (mop_id=samsung-udu-vdu-application-undeployment). Use when working on:
  Samsung application undeployment, SS undeployment, Samsung software undeployment, UDU undeployment, VDU undeployment, Atlas undeployment, Zero Touch Undeployment, samsung-udu-vdu-application-undeployment, MOP, method of procedure. Always recall Memoria for the latest MOP chunks before executing.
---

# MOP: Samsung UDU/VDU application undeployment

**mop_id:** `samsung-udu-vdu-application-undeployment`  
**Source of truth:** Memoria at `http://10.10.50.2:8765` (Procedures / `[MOP] mop_id=samsung-udu-vdu-application-undeployment`)

## Before you act

1. Call `memoria_recall` with query including `MOP samsung-udu-vdu-application-undeployment` and the user task keywords.
2. Prefer hits whose content starts with `[MOP] mop_id=samsung-udu-vdu-application-undeployment`.
3. List the required steps to the user and follow them in order.
4. If Memoria returns a newer/conflicting step, **prefer Memoria** over this draft skill.
5. Never print or commit Atlas passwords or Bearer tokens; use placeholders or env vars the user provides.

## Procedure (draft snapshot)

### 1. Overview

Method of Procedure for Samsung software undeployment via Atlas automation (UDU and VDU workflow job templates). Use when undeploying a Samsung UDU or VDU application from a cluster.

| Workload | Atlas workflow template | Typical workflow name |
|----------|------------------------|------------------------|
| **UDU** | `5666` | Samsung UADPF Zero Touch Undeployment (SI Team) |
| **VDU** | `10237` | FOA ONLY Samsung vDU ZeroTouch Undeployment |

### 2. Prerequisites

1. Undeployment is approved and change window is active if required.
2. Identify target **gNB DUID** from `vDU_List` / Mission Control Network inventory.
3. Confirm whether the target is **UDU** or **VDU** — use the correct workflow template.
4. Obtain **Atlas** Bearer token or credentials with permission to launch workflow job templates.
5. Workstation must reach `http://me.atlas.automation.vzwnet.com` (lab/VPN as required).
6. Record the **current running software version** for the JSON `version` field.

### 3. Create the undeployment JSON file

Create one JSON file per gNB DUID (or batch as required). Update:

- `gnbDuId` — target gNB DUID
- `version` — **current running** software version (e.g. `26.A.0-0110`)
- `ciqSource` — typically `MARKET_PLACE`
- `method` — `Orchestrator`

```json
{
    "extra_vars": {
        "gnbDuId": "29991572163",
        "version": "26.A.0-0110",
        "ciqSource": "MARKET_PLACE",
        "method": "Orchestrator"
    }
}
```

### 4. Launch Atlas workflow job template

Replace `-d@sample.json` with your JSON file from §3.

**UDU:**

```bash
curl -vvv -f \
  -H 'Content-Type: application/json' \
  -H 'Cache-Control: no-cache' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <Bearer token>' \
  -d@UDU_undeploy.json \
  -X POST \
  http://me.atlas.automation.vzwnet.com/api/v2/workflow_job_templates/5666/launch/ \
  --insecure
```

**VDU:**

```bash
curl -vvv -f \
  -H 'Content-Type: application/json' \
  -H 'Cache-Control: no-cache' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <Bearer token>' \
  -d@VDU_undeploy.json \
  -X POST \
  http://me.atlas.automation.vzwnet.com/api/v2/workflow_job_templates/10237/launch/ \
  --insecure
```

### 5. Monitor activity stream

Poll the activity stream using the gNB DUID as search keyword until the workflow completes.

```bash
curl -k -X GET \
  "http://me.atlas.automation.vzwnet.com/api/v2/activity_stream/?search=<gnb_duid>" \
  -u '<ATLAS_username>:<ATLAS_password>' \
  -H 'Content-Type: application/json'
```

**Terminal success indicators:**

| Workload | Final successful playbook |
|----------|----------------------------|
| **UDU** | `VERIFICATION - UADPF - Samsung - New Repo (SI Team)` |
| **VDU** | `FOA ONLY Samsung vDU Verification` |

### 6. Mark complete

Mark the undeployment **completed** only when the final verification playbook above shows **successful** status in the activity stream.

### 7. Compliance

1. Do not mark complete while verification playbooks are still running or failed.
2. Update production Mission Control (http://10.10.50.6) with outcome notes when part of a tracked change window.
3. Store lasting lessons in Memoria with `memoria_remember` linked to [[Network Equipment]].

## After completion

- Note deviations or outcomes in Memoria (`memoria_remember`, semantic, high) if the user shipped a milestone.
