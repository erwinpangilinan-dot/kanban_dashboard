---
type: mop
mop_id: samsung-udu-vdu-application-undeployment
title: Samsung UDU/VDU application undeployment
task_triggers: ["Samsung application undeployment", "SS undeployment", "Samsung software undeployment", "UDU undeployment", "VDU undeployment", "Atlas undeployment", "Zero Touch Undeployment"]
entities: ["Network Equipment", "Mission Control Dashboard", "Samsung", "Atlas", "Zero Touch Undeployment"]
importance: high
---

# Samsung UDU/VDU application undeployment

Method of Procedure for Samsung software undeployment via Atlas automation (UDU and VDU workflow job templates).

**mop_id:** `samsung-udu-vdu-application-undeployment`  
**Triggers:** Samsung application undeployment, SS undeployment, Samsung software undeployment, UDU undeployment, VDU undeployment, Atlas undeployment, Zero Touch Undeployment

Use this procedure when undeploying a Samsung UDU or VDU application from a cluster.

## Prerequisites

1. Undeployment is approved and change window is active if required.
2. Identify target **gNB DUID** from `vDU_List` / Mission Control Network inventory.
3. Confirm whether the target is **UDU** or **VDU** — use the correct workflow template.
4. Obtain **Atlas** Bearer token or credentials with permission to launch workflow job templates.
5. Workstation must reach `http://me.atlas.automation.vzwnet.com` (lab/VPN as required).
6. Record the **current running software version** for the JSON `version` field.

## 1. Create the undeployment JSON file

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

## 2. Launch Atlas workflow job template

Replace `-d@sample.json` with your JSON file from §1.

| Workload | Atlas workflow template | Typical workflow name |
|----------|------------------------|------------------------|
| **UDU** | `5666` | Samsung UADPF Zero Touch Undeployment (SI Team) |
| **VDU** | `10237` | FOA ONLY Samsung vDU ZeroTouch Undeployment |

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

## 3. Monitor activity stream

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

## 4. Mark complete

Mark the undeployment **completed** only when the final verification playbook above shows **successful** status in the activity stream.

## Compliance

1. Do not mark complete while verification playbooks are still running or failed.
2. Update production Mission Control (http://10.10.50.6) with outcome notes when part of a tracked change window.
3. Store lasting lessons in Memoria with `memoria_remember` linked to [[Network Equipment]].
