---
name: mop-samsung-udu-vdu-application-deployment
description: >-
  Follow Method of Procedure "Samsung UDU/VDU application deployment" (mop_id=samsung-udu-vdu-application-deployment). Use when working on:
  Samsung application deployment, SS deployment, Samsung software deployment, UDU deployment, VDU deployment, Atlas deployment, Zero Touch Deployment, samsung-udu-vdu-application-deployment, MOP, method of procedure. Always recall Memoria for the latest MOP chunks before executing.
---

# MOP: Samsung UDU/VDU application deployment

**mop_id:** `samsung-udu-vdu-application-deployment`  
**Source of truth:** Memoria at `http://10.10.50.2:8765` (Procedures / `[MOP] mop_id=samsung-udu-vdu-application-deployment`)

## Before you act

1. Call `memoria_recall` with query including `MOP samsung-udu-vdu-application-deployment` and the user task keywords.
2. Prefer hits whose content starts with `[MOP] mop_id=samsung-udu-vdu-application-deployment`.
3. List the required steps to the user and follow them in order.
4. If Memoria returns a newer/conflicting step, **prefer Memoria** over this draft skill.
5. Never print or commit Atlas passwords or Bearer tokens; use placeholders or env vars the user provides.

## Procedure (draft snapshot)

### 1. Overview

Method of Procedure for Samsung software deployment via Atlas automation (UDU and VDU workflow job templates). Use when deploying a Samsung UDU or VDU application to a cluster.

| Workload | Atlas workflow template | Typical workflow name |
|----------|------------------------|------------------------|
| **UDU** | `8784` | Samsung UADPF Zero Touch Deployment (SI Team) |
| **VDU** | `6746` | FOA Samsung vDU ZeroTouch Deployment V2 |

### 2. Prerequisites

1. Deployment is approved and change window is active if required.
2. Identify target **gNB DUID** from `vDU_List` / Mission Control Network inventory.
3. Confirm whether the target is **UDU** or **VDU** — use the correct workflow template.
4. Obtain **Atlas** Bearer token or credentials with permission to launch workflow job templates.
5. Workstation must reach `http://me.atlas.automation.vzwnet.com` (lab/VPN as required).
6. Record the **target software version** to deploy for the JSON `version` field.

### 3. Create the deployment JSON file

Create one JSON file per gNB DUID (or batch as required). Update:

- `gnbDuId` — target gNB DUID
- `version` — **target** software version to deploy (e.g. `26.A.0-0110`)
- `ciqSource` — site/source tag (e.g. `CONQUEST_LAB` or `MARKET_PLACE` depending on environment)
- `method` — `Orchestrator`

```json
{
    "extra_vars": {
        "gnbDuId": "29991572163",
        "version": "26.A.0-0110",
        "ciqSource": "CONQUEST_LAB",
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
  -d@UDU_deploy.json \
  -X POST \
  http://me.atlas.automation.vzwnet.com/api/v2/workflow_job_templates/8784/launch/ \
  --insecure
```

**VDU:**

```bash
curl -vvv -f \
  -H 'Content-Type: application/json' \
  -H 'Cache-Control: no-cache' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <Bearer token>' \
  -d@VDU_deploy.json \
  -X POST \
  http://me.atlas.automation.vzwnet.com/api/v2/workflow_job_templates/6746/launch/ \
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
| **UDU** | `uADPF Launcher Bulk uDU Deployment Precheck Postcheck (SI Team)` |
| **VDU** | `FOA Launcher Bulk vDU Deployment Precheck Postcheck` |

### 6. Mark complete

Mark the deployment **completed** only when the final playbook above shows **successful** status in the activity stream.

### 7. Compliance

1. Do not mark complete while the terminal playbook is still running or shows failed.
2. Update production Mission Control (http://10.10.50.6) with outcome notes when part of a tracked change window.
3. Store lasting lessons in Memoria with `memoria_remember` linked to [[Network Equipment]].

## After completion

- Note deviations or outcomes in Memoria (`memoria_remember`, semantic, high) if the user shipped a milestone.
