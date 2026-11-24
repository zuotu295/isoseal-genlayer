import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { abi, createAccount, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

const write = process.argv.includes('--write');
const published = write ? {} : JSON.parse(await readFile(
  new URL('../evidence/studionet.json', import.meta.url), 'utf8',
));
const address = process.env.ISOSEAL_ADDRESS ?? published.address;
assert.match(address ?? '', /^0x[0-9a-fA-F]{40}$/);
const client = createClient({ chain: studionet });
const source = await readFile(new URL('../contracts/isoseal.py', import.meta.url), 'utf8');
assert.equal(await client.getContractCode(address), source);
const view = { address, transactionHashVariant: TransactionHashVariant.LATEST_FINAL };
const read = (functionName, key) => client.readContract({ ...view, functionName, args: [key] });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(new URL('../evidence/sample-report.txt', import.meta.url));
const digest = sha256(bytes);

async function finalized(hash) {
  await client.waitForTransactionReceipt({ hash, waitUntil: 'finalized', interval: 4000, retries: 150 });
  const receipt = await client.getTransaction({ hash });
  assert.equal(receipt.statusName ?? receipt.status_name, 'FINALIZED');
  const leader = receipt.consensus_data?.leader_receipt;
  const record = Array.isArray(leader) ? leader.find((entry) => entry.mode === 'leader') ?? leader[0] : leader;
  assert.ok(record, 'Finalized transaction must have a leader receipt');
  const encoded = typeof record.result === 'string' ? record.result : record.result?.raw;
  assert.ok(encoded, 'Finalized transaction must have an execution result');
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes[0] === 0, record.execution_result === 'SUCCESS');
  return {
    result: bytes[0] === 0 ? abi.calldata.decode(bytes.subarray(1)) : null,
    failure: bytes[0] === 0 ? null : bytes.subarray(1).toString('utf8'),
    calldata: receipt.data?.calldata,
    destination: receipt.data?.contract_address ?? receipt.to_address ?? receipt.recipient,
  };
}

const eventIds = ['us7000pn9s', 'us7000m9g4'];
const sealKeys = [];
const sealTransactions = (process.env.ISOSEAL_SEAL_TXS ?? published.sealTransactions?.join(',') ?? '')
  .split(',').filter(Boolean);
let reportTx = process.env.ISOSEAL_REPORT_TX ?? published.reportTx;
let invalidTx = process.env.ISOSEAL_INVALID_TX ?? published.invalidTx;
if (write) {
  const account = createAccount();
  const writer = createClient({ chain: studionet, account });
  await writer.request({ method: 'sim_fundAccount', params: [account.address, 10 ** 18] });
  async function send(functionName, args) {
    const fees = await writer.estimateTransactionFees({
      leaderTimeunitsAllocation: 100n, validatorTimeunitsAllocation: 200n, rotations: [0n],
    });
    const hash = await writer.writeContract({ address, functionName, args, value: 0n, leaderOnly: false, fees });
    console.error(functionName, hash);
    return hash;
  }
  const pendingSeals = [];
  for (const eventId of eventIds) {
    const current = await read('get_latest', eventId);
    if (current) {
      sealKeys.push(eventId + ':' + JSON.parse(current).updated_ms);
      continue;
    }
    const hash = await send('seal', [eventId]);
    sealTransactions.push(hash);
    pendingSeals.push({ eventId, hash });
  }
  const newKeys = await Promise.all(pendingSeals.map(async ({ eventId, hash }) => {
    const { result, failure } = await finalized(hash);
    assert.ok(typeof result === 'string' && result.startsWith(eventId + ':'), failure ?? 'Seal did not return its key');
    return result;
  }));
  sealKeys.push(...newKeys);
  reportTx ??= await send('publish_report', [digest, sealKeys]);
  const validKey = sealKeys.find((key) => key.startsWith(eventIds[0] + ':'));
  invalidTx ??= await send('publish_report', [digest, [validKey, 'missingevent:1']]);
}

assert.match(reportTx ?? '', /^0x[0-9a-f]{64}$/);
assert.match(invalidTx ?? '', /^0x[0-9a-f]{64}$/);
if (published.deploymentTx) {
  const deployment = await finalized(published.deploymentTx);
  assert.equal(deployment.failure, null);
  assert.equal(deployment.destination.toLowerCase(), address.toLowerCase());
}
const { result: reportId, failure } = await finalized(reportTx);
assert.ok(typeof reportId === 'string' && /^[0-9a-f]{64}$/.test(reportId), failure ?? 'Report did not return an ID');
const raw = await read('get_report', reportId);
assert.equal(sha256(raw), reportId);
const manifest = JSON.parse(raw);
if (published.manifest) assert.deepEqual(manifest, published.manifest);
assert.equal(manifest.document_sha256, digest);
assert.notEqual(sha256(Buffer.concat([bytes, Buffer.from('edited')])), manifest.document_sha256);
assert.equal(manifest.revision_keys.length, 2);
await Promise.all(manifest.revision_keys.map(async (key, index) => {
  const [event, revision] = key.split(':');
  assert.equal(event, [...eventIds].sort()[index]);
  const snapshot = JSON.parse(await read('get_seal', key));
  assert.equal(snapshot.id, event);
  assert.equal(String(snapshot.updated_ms), revision);
}));
const invalid = await finalized(invalidTx);
assert.equal(invalid.result, null);
await Promise.all(sealTransactions.map(async (hash) => {
  const seal = await finalized(hash);
  assert.ok(manifest.revision_keys.includes(seal.result), seal.failure ?? 'Receipt did not produce a referenced revision');
}));
assert.match(invalid.failure, /Referenced revision is not sealed/);
const invalidCall = abi.calldata.decode(Buffer.from(invalid.calldata.base64, 'base64'));
const invalidKeys = [manifest.revision_keys.find((key) => key.startsWith(eventIds[0] + ':')), 'missingevent:1'];
assert.equal(invalidCall.get(''), 'publish_report');
assert.deepEqual(invalidCall.get('args'), [digest, invalidKeys]);
const badManifest = JSON.stringify({
  document_sha256: digest,
  revision_keys: invalidKeys.sort(),
});
assert.equal(await read('get_report', sha256(badManifest)), '');
console.log(JSON.stringify({ address, sourceSha256: sha256(source), sealTransactions, reportTx, invalidTx, reportId, manifest, invalidFailure: invalid.failure }, null, 2));
