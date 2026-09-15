import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { changeVerb, formatBytes, formatMetricDelta, formatMetricValue, formatSpan } from './formatMetricValue.js';

describe('formatMetricValue', () => {
  it('scales bytes to a readable unit', () => {
    assert.equal(formatBytes(512), '512 bytes');
    assert.equal(formatBytes(2469606195), '2.3 GB');
    assert.equal(formatBytes(1024 * 1024 * 1024 * 1024 * 3), '3 TB');
  });

  it('formats a reading with its unit', () => {
    assert.equal(formatMetricValue(87.14, 'Percent'), '87.1%');
    assert.equal(formatMetricValue(2469606195, 'Bytes'), '2.3 GB');
    assert.equal(formatMetricValue(412, 'Count'), '412');
  });

  it('words a change as a magnitude, not a signed number', () => {
    // The old wording was "Changed +35.1 pts"; an engineer reads "35.1 percentage points".
    assert.equal(formatMetricDelta(35.1, 'Percent'), '35.1 percentage points');
    assert.equal(formatMetricDelta(-1, 'Percent'), '1 percentage point');
    assert.equal(formatMetricDelta(-2469606195, 'Bytes'), '2.3 GB');
  });

  it('describes direction with a dead band', () => {
    assert.equal(changeVerb(3), 'increased');
    assert.equal(changeVerb(-3), 'decreased');
    assert.equal(changeVerb(0.01), 'unchanged');
  });

  it('formats a span in whole units', () => {
    assert.equal(formatSpan(2 / 24), '2 hours');
    assert.equal(formatSpan(1 / 24), '1 hour');
    assert.equal(formatSpan(5), '5 days');
  });
});
