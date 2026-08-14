---
type: mop
mop_id: vdu-bmc-redfish-check
title: vDU BMC Redfish health check
task_triggers: [network probe, redfish, bmc, vDU, iDRAC]
entities: ["Network Equipment", "Mission Control Dashboard", "Erwin Pangilinan", "Dell iDRAC", "Redfish", "Google Sheet"]
importance: high
---

# vDU BMC Redfish health check

Pilot Method of Procedure for verifying Dell iDRAC / Redfish health on XR8720t vDU nodes listed in Google Sheet `vDU_List`.

## Prerequisites

1. Confirm Mission Control Network tab can reach BMC IPv6 (host poller on Windows if needed).
2. Confirm DELL Redfish credentials are saved under Network → Settings (shared vendor credentials).
3. Confirm Google Workspace token is valid if inventory sync from Drive is required (Re-authenticate if needed).
4. Identify target cluster IDs from `vDU_List` / Network inventory.

## Connectivity check

1. For each target BMC, verify TCP reachability to port 443 (Redfish).
2. Record latency_ms from the Network dashboard snapshot.
3. If unreachable (`ENETUNREACH` / timeout), stop Redfish checks for that node and escalate network/routing (Docker IPv6 vs host poller).
4. Do not mark the procedure complete while any in-scope BMC remains unexpectedly down.

## Redfish health collection

1. Query Dell Redfish `GET /redfish/v1/Systems/System.Embedded.1` using vendor credentials.
2. Capture system Health, PowerState, ProcessorSummary, MemorySummary.
3. Roll up Storage collection health.
4. Persist results via the Network poller snapshots (do not scrape iDRAC from the browser).

## Compliance and escalation

1. If any system Health is `Critical`, open/track a Mission Control task under **Network Equipment** and investigate in iDRAC before further changes.
2. If credentials fail (HTTP 401), update DELL Redfish credentials and re-probe — do not bypass auth.
3. After verification, update production Mission Control (http://10.10.50.6) with outcome notes when this is part of a tracked change window.
4. Store lasting lessons in Memoria with `memoria_remember` (semantic, high) linked to [[Network Equipment]].
