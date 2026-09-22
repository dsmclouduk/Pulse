import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateBaselineDeployment, type BaselinePlanInput } from './bicepGenerator.js';

function plan(overrides: Partial<BaselinePlanInput> = {}): BaselinePlanInput {
  return {
    clientSlug: 'rwk',
    clientName: 'RWK Goodman',
    subscriptionId: '00000000-0000-0000-0000-000000000000',
    tier: 'essential',
    resourceGroup: 'rg-pulse-monitoring',
    location: 'uksouth',
    regions: ['uksouth'],
    resourceTypes: ['microsoft.compute/virtualmachines'],
    pulseBaseUrl: 'https://pulse.example.com',
    ...overrides
  };
}

function fileNamed(deployment: ReturnType<typeof generateBaselineDeployment>, part: string): string {
  const file = deployment.files.find((entry) => entry.name.includes(part));
  assert.ok(file, `expected a file matching ${part}`);
  return file.content;
}

describe('bicep generator', () => {
  it('emits a subscription-scoped entry point, a module and parameters', () => {
    const deployment = generateBaselineDeployment(plan());

    assert.deepEqual(
      deployment.files.map((file) => file.name),
      ['pulse-rwk-baseline.bicep', 'pulse-rwk-monitoring.bicep', 'pulse-rwk.parameters.json']
    );
    // Subscription scope is the whole reason we chose the CLI over a portal link: it lets the agent
    // policy deploy alongside everything else instead of needing a second manual step.
    assert.match(fileNamed(deployment, 'baseline'), /targetScope = 'subscription'/);
  });

  it('keeps the webhook token a secure parameter, never a literal', () => {
    const deployment = generateBaselineDeployment(plan());
    const module = fileNamed(deployment, 'monitoring');

    assert.match(module, /@secure\(\)\nparam webhookToken string/);
    assert.match(module, /serviceUri: '\$\{pulseBaseUrl\}\/api\/webhook\/azure-alerts\/\$\{webhookToken\}'/);
    assert.match(module, /useCommonAlertSchema: true/);

    for (const file of deployment.files) {
      assert.ok(!file.content.includes('PASTE-THE-TOKEN') || file.name.endsWith('.json'));
    }
  });

  it('emits one multi-resource metric rule per region', () => {
    const deployment = generateBaselineDeployment(plan({ regions: ['uksouth', 'ukwest'] }));
    const module = fileNamed(deployment, 'monitoring');

    assert.ok(module.includes("name: 'pulse-rwk-vm-cpu-high-uksouth'"));
    assert.ok(module.includes("name: 'pulse-rwk-vm-cpu-high-ukwest'"));
    assert.match(module, /targetResourceType: 'microsoft\.compute\/virtualmachines'/);
  });

  it('splits guest log rules by resource and by mount', () => {
    // Without the mount the payload names the VM but not the drive, and Pulse has to guess which
    // disk the alert is about. We hit exactly this on the first live alert.
    const deployment = generateBaselineDeployment(plan());
    const module = fileNamed(deployment, 'monitoring');
    const diskRule = module.slice(module.indexOf('pulse-rwk-vm-os-disk-free'));

    assert.match(diskRule, /name: '_ResourceId'/);
    assert.match(diskRule, /name: 'Mount'/);
    assert.match(diskRule, /metricMeasureColumn: 'FreePct'/);
  });

  it('only emits per-resource rules when it has resources to target', () => {
    const withoutTargets = generateBaselineDeployment(
      plan({ resourceTypes: ['microsoft.compute/virtualmachines', 'microsoft.web/sites'] })
    );

    assert.ok(!fileNamed(withoutTargets, 'monitoring').includes('pulse-rwk-app-http5xx'));
    assert.ok(withoutTargets.warnings.some((warning) => warning.includes('app-http5xx')));

    const withTargets = generateBaselineDeployment(
      plan({
        resourceTypes: ['microsoft.compute/virtualmachines', 'microsoft.web/sites'],
        perResourceTargets: {
          'microsoft.web/sites': ['/subscriptions/x/resourceGroups/rg/providers/Microsoft.Web/sites/portal']
        }
      })
    );

    assert.ok(fileNamed(withTargets, 'monitoring').includes('pulse-rwk-app-http5xx-portal'));
  });

  it('leaves out resource types the client does not have', () => {
    const module = fileNamed(generateBaselineDeployment(plan()), 'monitoring');

    assert.ok(!module.includes('sql-cpu-high'), 'no SQL rules for a client with no SQL');
    assert.ok(module.includes('service-health'), 'subscription rules apply regardless');
  });

  it('deploys the agent policy by default and warns when it is turned off', () => {
    assert.match(fileNamed(generateBaselineDeployment(plan()), 'baseline'), /policyAssignments/);

    const without = generateBaselineDeployment(plan({ deployAgentPolicy: false }));
    assert.ok(!fileNamed(without, 'baseline').includes('policyAssignments'));
    assert.ok(without.warnings.some((warning) => warning.includes('guest rules')));
  });

  it('warns rather than silently emitting nothing when the inventory has not run', () => {
    const deployment = generateBaselineDeployment(plan({ regions: [] }));
    assert.ok(deployment.warnings.some((warning) => warning.includes('No regions')));
  });

  it('offers what-if before create, both subscription scoped', () => {
    const deployment = generateBaselineDeployment(plan());

    assert.match(deployment.whatIfCommand, /az deployment sub what-if/);
    assert.match(deployment.deployCommand, /az deployment sub create/);
    for (const command of [deployment.whatIfCommand, deployment.deployCommand]) {
      assert.ok(command.includes('--subscription 00000000-0000-0000-0000-000000000000'));
      assert.ok(command.includes('--parameters @pulse-rwk.parameters.json'));
    }
  });

  it('tags everything so the coverage report can tell our rules from the client own ones', () => {
    const module = fileNamed(generateBaselineDeployment(plan()), 'monitoring');
    assert.ok(module.includes("'pulse-managed': 'true'"));
    assert.ok(module.includes("'pulse-client': 'rwk'"));
  });

  it('uses single-quoted strings only, as Bicep requires', () => {
    // A double-quoted string is a compile error, and an apostrophe inside a description causes one.
    for (const file of generateBaselineDeployment(plan({ tier: 'standard' })).files) {
      if (!file.name.endsWith('.bicep')) continue;

      const withoutKql = file.content.replace(/'''[\s\S]*?'''/g, '');
      const descriptions = withoutKql.match(/@description\([^)]*\)/g) ?? [];

      for (const description of descriptions) {
        assert.ok(!description.includes('"'), `double quote in ${description}`);
      }
    }
  });
});
