---
type: mop
mop_id: wind-river-subcloud-check-status
title: Wind River Subcloud check status
task_triggers: [WR subcloud precheck, subcloud, Wind River, WRCP, kubectl, system host-list]
entities: ["Network Equipment", "Mission Control Dashboard", "Wind River", "Wind River Subcloud"]
importance: high
---

# Wind River Subcloud check status

Method of Procedure for pre-change verification of a Wind River subcloud (WRCP). Use the **Subcloud IP** / cluster IP from `vDU_List` or Mission Control Network → Subcloud tab.

## Prerequisites

1. Confirm Subcloud IP reachability (Mission Control Network → Subcloud tab ping/latency, or manual ping).
2. Identify target cluster ID and Subcloud IP from `vDU_List` / Network inventory.
3. Obtain SSH credentials for the subcloud controller (cluster IP).
4. Confirm you are on the appropriate lab/VPN network before proceeding.

## Login and credentials

1. SSH to the subcloud using the **Cluster IP** (Subcloud IP from inventory).
2. Load administrator credentials:

```bash
source /etc/platform/openrc
```

## Host and platform checks

3. Verify overall host status:

```bash
system host-list
```

4. Check CPU allocation (replace `<hostname>` from host-list output):

```bash
system host-cpu-list <hostname>
```

5. Check memory and huge pages:

```bash
system host-memory-list <hostname>
```

For more detail on a processor:

```bash
system host-memory-show <hostname> <processor_id>
```

6. Check detailed host configuration:

```bash
system host-show <hostname>
```

7. Check alarm status:

```bash
fm alarm-list
```

8. Check Wind River software version:

```bash
software list
```

9. Verify installed applications:

```bash
system application-list
```

## Kubernetes and vDU namespace checks

10. Verify Kubernetes node status:

```bash
kubectl get nodes -o wide
```

11. Verify vDU namespace exists (namespace name contains `vdu`):

```bash
kubectl get ns
```

Example vDU namespaces: `ss-vdu-001`, `welktxfb-1372466vzwcvdu-y-ss-x-29991502555`.

## Compliance and escalation

1. Do not mark the precheck complete while critical alarms remain on `fm alarm-list` without escalation.
2. All Kubernetes nodes should be `Ready` before proceeding with change-window work.
3. Confirm the expected vDU namespace is present for the target gNB DUID / cluster.
4. After verification, update production Mission Control (http://10.10.50.6) with outcome notes when this is part of a tracked change window.
5. Store lasting lessons in Memoria with `memoria_remember` (semantic, high) linked to [[Network Equipment]].
