import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  driverRealtimeMessageParser,
  passengerRealtimeMessageParser,
} from '../src/features/rides/data/realtimeSchemas.ts';

const contractUrl = new URL('../../backend/realtime_contract.json', import.meta.url);
const contract = JSON.parse(readFileSync(contractUrl, 'utf8'));
const parsers = {
  passenger: passengerRealtimeMessageParser,
  driver: driverRealtimeMessageParser,
};

test('el fixture backend declara una matriz versionada y sin casos duplicados', () => {
  assert.equal(contract.fixture_version, 1);
  assert.ok(contract.cases.length > 0);
  assert.equal(
    new Set(contract.cases.map((contractCase) => contractCase.name)).size,
    contract.cases.length,
  );
});

for (const contractCase of contract.cases) {
  test(`acepta el contrato backend ${contractCase.name}`, () => {
    assert.ok(contractCase.audiences.length > 0);

    for (const audience of contractCase.audiences) {
      const parser = parsers[audience];
      assert.ok(parser, `Público desconocido: ${audience}`);

      const result = parser.safeParse(contractCase.message);
      assert.equal(
        result.success,
        true,
        result.success ? undefined : JSON.stringify(result.error.issues),
      );
    }
  });
}
