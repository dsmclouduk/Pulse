# Onboarding a client to Azure Lighthouse

Pulse can only see subscriptions delegated to the Synextra tenant through Azure Lighthouse.
**Lighthouse coverage is Pulse coverage.** Written 2026-09-16.

## Why a group, not a service principal

A Lighthouse delegation authorises named principals in the managing tenant. Access is never inherited
by being in that tenant, so a new service principal sees nothing until it is named in a delegation, or
belongs to a group that is.

Authorising a group means adding a principal to that group in Synextra's own tenant grants it access to
every delegated client at once, with no customer involvement. Authorising individual principals means a
template redeploy at every client whenever the principal changes.

### Two groups, deliberately

| Group | Object ID | Roles | Who is in it |
|---|---|---|---|
| `Lighthouse Management Group` | `89e5ce35-e62d-40f6-877b-c249b53b2c28` | Reader, **Managed Services Registration assignment Delete** | Synextra engineers |
| `Synextra - Monitoring Reader` | `650b3883-3936-4045-88db-32bc44a43a46` | Reader, Monitoring Reader, Log Analytics Reader | `pulse-dev`, and future monitoring identities |

Pulse is **not** put in the engineers' group. That group can delete registration assignments, meaning
anything in it can remove Synextra's own access to a client tenant. A monitoring service should never hold
that, so the monitoring group is a separate, additive authorisation with no delete role.

The live offer name is **`Synextra-Lighthouse`**. Reuse it exactly.

Lighthouse does not follow nested groups. Members must be direct.

Built-in role IDs used:

| Role | ID |
|---|---|
| Reader | `acdd72a7-3385-48ef-bd42-f606fba81ae7` |
| Monitoring Reader | `43d0d8ad-25c7-4714-9337-8ba259a9fe05` |
| Log Analytics Reader | `73c42c96-874c-492b-b04d-ab87d138a893` |

## Deploying to one subscription

Run **in the customer tenant**, signed in as someone with Owner on the subscription:

```bash
az deployment sub create \
  --name pulse-lighthouse \
  --location uksouth \
  --subscription <customer subscription id> \
  --template-file scripts/azure/lighthouse/delegate-subscription.json \
  --parameters @scripts/azure/lighthouse/delegate-subscription.parameters.json
```

**`mspOfferName` is the identity of the delegation.** The registration definition id is `guid(mspOfferName)`,
so redeploying with the same name updates the existing delegation in place, and a different name creates a
second, parallel one. Before adding the group to an existing client, find the offer name already in use
(customer tenant → Service providers → Service provider offers) and reuse it exactly.

Adding the group to an existing delegation is a redeploy of the same template with the extra
authorizations. It is read-only and additive; nothing already granted is removed.

## Scaling beyond one subscription at a time

Delegation scope is a subscription or a resource group. A management group cannot be delegated directly,
which is why onboarding feels like one subscription at a time. Three ways out, in order of preference.

### 1. Managed Service offer in the Azure Marketplace (private plan)

The proper MSP answer and the best customer experience. Published once from Partner Center, restricted to
named customer tenant ids so it is never publicly visible. The customer accepts the offer once, then
delegates as many subscriptions as they like from the portal themselves, with no template to send and no
Owner-level help needed from us per subscription.

- One-time cost: a Commercial Marketplace profile in Partner Center, which a CSP already has most of.
- Trade-off: changing the authorizations means publishing a new plan version and asking customers to
  update. Get the group into the offer before scaling, not after.

### 2. Azure Policy at the customer's management group

A `deployIfNotExists` policy assigned at the customer's root management group creates the registration
assignment on every subscription, current and future. Best where a customer has many subscriptions and
their own management group hierarchy, and it makes new subscriptions self-onboarding.

- Needs the policy assignment's managed identity to hold permission to create registration assignments at
  that scope, so it is a bigger ask up front than a single template.
- Microsoft publishes a sample policy for exactly this.

### 3. Scripted template loop

What we do today, wrapped in a loop rather than run by hand:

```bash
for sub in $(cat subscriptions.txt); do
  az deployment sub create --name pulse-lighthouse --location uksouth --subscription "$sub" \
    --template-file delegate-subscription.json --parameters @delegate-subscription.parameters.json
done
```

Fine for a handful. Still requires Owner on each subscription in the customer tenant.

## What Lighthouse cannot do

- No Microsoft Graph, so no users, sign-ins or M365 data, and **no customer tenant display name**. Tenant
  names are typed into Pulse, not discovered.
- No data-plane access: blob contents, Key Vault secrets, storage keys.
- Built-in roles only. No Owner, and no role carrying `DataActions`.
- Delegated role assignments do not appear in `az role assignment list`; they are under Service providers.

## The other access route, and why Pulse cannot use it

Synextra also holds named admin accounts in client tenants, for example `az.synadmin02@rwkllp.onmicrosoft.com`.
Those make subscriptions appear in `az account list` for the person signed in, but a Synextra token is
rejected against them: *"the access token is from the wrong issuer"*. They are per-person credentials in a
foreign tenant, so a service principal in the Synextra tenant can never use them.

Subscriptions reached only this way are invisible to Pulse until they are delegated.
