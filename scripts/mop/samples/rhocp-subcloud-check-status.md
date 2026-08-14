---
type: mop
mop_id: rhocp-subcloud-check-status
title: RHOCP Subcloud check status
task_triggers: [RHOCP subcloud precheck, subcloud, RHOCP, OpenShift, oc, OCP]
entities: ["Network Equipment", "Mission Control Dashboard", "Red Hat", "RHOCP"]
importance: high
---

# RHOCP Subcloud check status

Method of Procedure for pre-change verification of a Red Hat OpenShift (RHOCP) subcloud. Use the **Subcloud IP** / cluster API from `vDU_List` or Mission Control Network → Subcloud tab.

## Prerequisites

1. Confirm Subcloud IP reachability (Mission Control Network → Subcloud tab ping/latency, or manual ping).
2. Identify target cluster ID and Subcloud IP from `vDU_List` / Network inventory.
3. Obtain `oc` login credentials (kubeconfig or user/token) for the target cluster API.
4. Confirm `oc` CLI is installed on the operator workstation or bastion.
5. Confirm you are on the appropriate lab/VPN network before proceeding.

## Login and credentials

1. Set the cluster API endpoint (Subcloud IP from inventory). IPv6 must be bracketed:

```bash
export API=https://[<subcloud-ip>]:6443
```

2. Log in with `oc` (use site kubeconfig or token as provided):

```bash
oc login "$API" --token=<token> --insecure-skip-tls-verify=true
# or: export KUBECONFIG=/path/to/kubeconfig && oc whoami
```

3. Confirm context and cluster access:

```bash
oc whoami
oc cluster-info
```

## Cluster health checks

4. Verify all nodes are `Ready`:

```bash
oc get nodes -o wide
```

5. Verify ClusterOperators are healthy (no `Degraded` or `Unavailable`):

```bash
oc get co
```

6. Check cluster version and upgrade state:

```bash
oc get clusterversion
```

7. Verify MachineConfigPools are fully updated (not updating):

```bash
oc get mcp
```

## Workload and alarm checks

8. List non-running pods cluster-wide (investigate any unexpected output):

```bash
oc get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded
```

9. Check monitoring alerts (if cluster monitoring is enabled):

```bash
oc get alerts -A 2>/dev/null || oc get prometheusrule -A | head -20
```

## gNB namespace checks

10. Verify the application namespace exists (namespace name contains `gnb`):

```bash
oc get ns | grep -i gnb
```

Example gNB namespaces: `s1372466-069-ec-gnb-001`, `ec-gnb-001`, `ec-gnb-crd`.

11. Verify gNB workloads in the target namespace (replace `<gnb-namespace>`):

```bash
oc get pods -n <gnb-namespace> -o wide
oc get deployment,statefulset -n <gnb-namespace>
```

## Compliance and escalation

1. Do not mark the precheck complete while any ClusterOperator is `Degraded` or nodes are `NotReady` without escalation.
2. Resolve or escalate any unexpected non-running pods in critical namespaces before change-window work.
3. Confirm the expected gNB namespace (tag `gnb`) and workloads are present for the target gNB DUID / cluster.
4. After verification, update production Mission Control (http://10.10.50.6) with outcome notes when this is part of a tracked change window.
5. Store lasting lessons in Memoria with `memoria_remember` (semantic, high) linked to [[Network Equipment]].
