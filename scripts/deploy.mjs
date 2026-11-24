import { readFile } from 'node:fs/promises';
import { createAccount, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

const key = process.env.STUDIONET_PRIVATE_KEY;
if (!key && process.env.STUDIONET_FAUCET !== '1') {
  throw new Error('Set STUDIONET_PRIVATE_KEY, or opt into a fresh disposable test account with STUDIONET_FAUCET=1.');
}
const account = createAccount(key);
const client = createClient({ chain: studionet, account });
const code = await readFile(new URL('../contracts/isoseal.py', import.meta.url), 'utf8');
if (!key) {
  await client.request({ method: 'sim_fundAccount', params: [account.address, 10 ** 18] });
}
const { distribution, feeValue } = await client.estimateTransactionFees({
  leaderTimeunitsAllocation: 100n, validatorTimeunitsAllocation: 200n, rotations: [0n],
});
const fees = { distribution, feeValue };
const hash = await client.deployContract({ code, args: [], leaderOnly: false, fees });
console.log('Deploy transaction', hash);
async function waitForSuccess(hash) {
  await client.waitForTransactionReceipt({ hash, waitUntil: 'finalized', interval: 4000, retries: 150 });
  const tx = await client.getTransaction({ hash });
  const leader = tx.consensus_data?.leader_receipt;
  const receipt = Array.isArray(leader) ? leader.find((entry) => entry.mode === 'leader') ?? leader[0] : leader;
  if ((tx.statusName ?? tx.status_name) !== 'FINALIZED' || receipt?.execution_result !== 'SUCCESS') {
    throw new Error('Transaction did not finalize successfully: ' + hash);
  }
  return tx;
}
const receipt = await waitForSuccess(hash);
const address = receipt.data?.contract_address ?? receipt.to_address ?? receipt.recipient;
if (!address) throw new Error('Deployment receipt has no contract address.');
if (await client.getContractCode(address) !== code) throw new Error('Deployed source differs from local source.');
const view = { address, transactionHashVariant: TransactionHashVariant.LATEST_FINAL };
const empty = await client.readContract({ ...view, functionName: 'get_latest', args: ['us7000pn9s'] });
if (empty !== '') throw new Error('Unexpected state after deployment.');
console.log('Contract address', address);

if (process.argv.includes('--smoke')) {
  const submission = await client.writeContract({
    address, functionName: 'seal', args: ['us7000pn9s'], value: 0n, leaderOnly: false, fees,
  });
  console.log('Seal transaction', submission);
  await waitForSuccess(submission);
  const snapshot = await client.readContract({ ...view, functionName: 'get_latest', args: ['us7000pn9s'] });
  if (typeof snapshot !== 'string' || !snapshot) {
    throw new Error('The seal did not persist.');
  }
  const record = JSON.parse(snapshot);
  const exact = await client.readContract({
    ...view, functionName: 'get_seal', args: [record.id + ':' + record.updated_ms],
  });
  if (exact !== snapshot) throw new Error('Exact seal differs from latest event snapshot.');
  console.log('Finalized snapshot', snapshot);
}
