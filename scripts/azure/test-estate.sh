#!/usr/bin/env bash
# Builds the Pulse live-test estate in the Synextra tenant: one VM with the Azure Monitor Agent and
# a VM Insights DCR, a Log Analytics workspace, an action group pointing at Pulse, and three alert
# rules (CPU metric, disk log search, Service Health). Idempotent: re-running updates in place.
#
# Prereqs: az CLI logged in to the Synextra tenant with Contributor on the target subscription.
# Usage:  PULSE_URL=https://<static>.ngrok-free.app WEBHOOK_SECRET=<secret> ./scripts/azure/test-estate.sh
set -euo pipefail

: "${PULSE_URL:?Set PULSE_URL to the public Pulse base URL (ngrok or App Service)}"
: "${WEBHOOK_SECRET:?Set WEBHOOK_SECRET to the value in .env}"

LOCATION="${LOCATION:-uksouth}"
RG="${RG:-rg-pulse-test}"
VM="${VM:-vm-pulse-test-01}"
LAW="${LAW:-law-pulse-test}"
DCR="${DCR:-dcr-pulse-vminsights}"
AG="${AG:-ag-pulse-test}"
ADMIN_USER="${ADMIN_USER:-pulseadmin}"
# Windows computer names are capped at 15 characters, so it cannot just be $VM.
COMPUTER_NAME="${COMPUTER_NAME:-pulse-test-01}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD for the test VM (complex, 12+ chars)}"

# DCR and scheduled-query commands live in CLI extensions; add them up front so the run is self-contained.
for ext in monitor-control-service scheduled-query; do
  az extension show --name "$ext" -o none 2>/dev/null || az extension add --name "$ext" --only-show-errors -o none
done

SUB=$(az account show --query id -o tsv)
echo "Subscription: $SUB  Region: $LOCATION  RG: $RG"

az group create -n "$RG" -l "$LOCATION" -o none

echo "== Log Analytics workspace"
az monitor log-analytics workspace create -g "$RG" -n "$LAW" -l "$LOCATION" -o none
LAW_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$LAW" --query id -o tsv)
LAW_CUSTOMER_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$LAW" --query customerId -o tsv)

echo "== VM (B2s Windows, system-assigned identity)"
az vm create -g "$RG" -n "$VM" -l "$LOCATION" \
  --image Win2022Datacenter --size Standard_B2s \
  --admin-username "$ADMIN_USER" --admin-password "$ADMIN_PASSWORD" --computer-name "$COMPUTER_NAME" \
  --assign-identity --public-ip-sku Standard --nsg-rule NONE -o none
VM_ID=$(az vm show -g "$RG" -n "$VM" --query id -o tsv)

echo "== Azure Monitor Agent"
az vm extension set -g "$RG" --vm-name "$VM" \
  --name AzureMonitorWindowsAgent --publisher Microsoft.Azure.Monitor \
  --enable-auto-upgrade true -o none

echo "== VM Insights DCR (classic InsightsMetrics)"
DCR_FILE=$(mktemp)
trap 'rm -f "$DCR_FILE"' EXIT
# On Git Bash the Windows az CLI cannot see a /tmp path, so hand it a native path when cygpath exists.
DCR_FILE_ARG="$DCR_FILE"
command -v cygpath >/dev/null 2>&1 && DCR_FILE_ARG=$(cygpath -w "$DCR_FILE")
cat > "$DCR_FILE" <<JSON
{
  "location": "$LOCATION",
  "properties": {
    "description": "Pulse VM Insights performance counters",
    "dataSources": {
      "performanceCounters": [{
        "name": "VMInsightsPerfCounters",
        "streams": ["Microsoft-InsightsMetrics"],
        "samplingFrequencyInSeconds": 60,
        "counterSpecifiers": ["\\\\VmInsights\\\\DetailedMetrics"]
      }]
    },
    "destinations": {
      "logAnalytics": [{ "workspaceResourceId": "$LAW_ID", "name": "law" }]
    },
    "dataFlows": [{ "streams": ["Microsoft-InsightsMetrics"], "destinations": ["law"] }]
  },
  "tags": { "pulse-managed": "true", "pulse-client": "synextra-test", "pulse-baseline": "2026.09.1" }
}
JSON
# The CLI extension's --rule-file schema has moved between versions; a direct ARM PUT is stable.
az rest --method put   --url "https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Insights/dataCollectionRules/$DCR?api-version=2022-06-01"   --body "@$DCR_FILE_ARG" -o none
DCR_ID=$(az monitor data-collection rule show -g "$RG" -n "$DCR" --query id -o tsv)
az monitor data-collection rule association create --name pulse-vminsights --rule-id "$DCR_ID" --resource "$VM_ID" -o none

echo "== Action group → Pulse webhook (common alert schema)"
az monitor action-group create -g "$RG" -n "$AG" --short-name pulse \
  --action webhook pulse "$PULSE_URL/api/webhook/azure-alerts/$WEBHOOK_SECRET" usecommonalertschema -o none
AG_ID=$(az monitor action-group show -g "$RG" -n "$AG" --query id -o tsv)

echo "== CPU metric alert (breachable: > 5% for 1 minute)"
az monitor metrics alert create -g "$RG" -n "pulse-synextra-test-vm-cpu-high" \
  --scopes "$VM_ID" --condition "avg Percentage CPU > 5" \
  --window-size 1m --evaluation-frequency 1m --severity 2 --auto-mitigate true \
  --action "$AG_ID" --description "Pulse live test: CPU" \
  --tags pulse-managed=true pulse-client=synextra-test pulse-rule=vm-cpu-high -o none

echo "== Disk log search alert (InsightsMetrics free space, split by _ResourceId and Mount)"
az monitor scheduled-query create -g "$RG" -n "pulse-synextra-test-vm-os-disk-free" \
  --scopes "$LAW_ID" --location "$LOCATION" \
  --condition "avg 'FreePct' from 'FreePctQuery' < 90 resource id _ResourceId where Mount includes *" \
  --condition-query FreePctQuery='InsightsMetrics | where Origin == "vm.azm.ms" and Namespace == "LogicalDisk" and Name == "FreeSpacePercentage" | extend Mount = tostring(todynamic(Tags)["vm.azm.ms/mountId"]) | project TimeGenerated, _ResourceId, Mount, FreePct = Val' \
  --window-size 15m --evaluation-frequency 5m --severity 2 --auto-mitigate true \
  --action-groups "$AG_ID" --description "Pulse live test: OS disk free space" \
  --tags pulse-managed=true pulse-client=synextra-test pulse-rule=vm-os-disk-free -o none

echo "== Service Health activity log alert"
az monitor activity-log alert create -g "$RG" -n "pulse-synextra-test-service-health" \
  --scope "/subscriptions/$SUB" --condition "category=ServiceHealth" \
  --action-group "$AG_ID" --description "Pulse live test: Service Health" -o none

cat <<EOF

Done.
  VM:                  $VM_ID
  Workspace customerId: $LAW_CUSTOMER_ID   ← LOG_ANALYTICS_WORKSPACE_ID in .env
  Action group:        $AG_ID

Breach on demand (RDP or Run Command on the VM):
  CPU : powershell -c "\$end=(Get-Date).AddMinutes(4); while((Get-Date) -lt \$end){ 1..1e6 | % { \$_*2 } | Out-Null }"
  Disk: fsutil file createnew C:\\fill.bin 100000000000   (adjust to leave < 10% free), then del C:\\fill.bin to resolve

Expect the CPU alert within ~2 minutes and the disk alert within 5–15 minutes (log ingestion + evaluation).
EOF
