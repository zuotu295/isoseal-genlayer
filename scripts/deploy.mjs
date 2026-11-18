import { readFile } from 'node:fs/promises';
import { createAccount, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus, TransactionHashVariant } from 'genlayer-js/types';

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
const hash = await client.deployContract({ code, args: [], leaderOnly: false });
console.log('Deploy transaction', hash);
const receipt = await client.waitForTransactionReceipt({
  hash, status: TransactionStatus.FINALIZED, interval: 4000, retries: 150,
});
const address = receipt.data?.contract_address ?? receipt.to_address ?? receipt.recipient;
if (!address) throw new Error('Deployment receipt has no contract address.');
const view = { address, transactionHashVariant: TransactionHashVariant.LATEST_FINAL };
const empty = await client.readContract({ ...view, functionName: 'get_latest', args: ['us7000pn9s'] });
if (empty !== '') throw new Error('Unexpected state after deployment.');
console.log('Contract address', address);

if (process.argv.includes('--smoke')) {
  const submission = await client.writeContract({
    address, functionName: 'seal', args: ['us7000pn9s'], value: 0n, leaderOnly: false,
  });
  console.log('Seal transaction', submission);
  const result = await client.waitForTransactionReceipt({
    hash: submission, status: TransactionStatus.FINALIZED, interval: 4000, retries: 150,
  });
  const snapshot = await client.readContract({ ...view, functionName: 'get_latest', args: ['us7000pn9s'] });
  if (typeof snapshot !== 'string' || !snapshot) {
    console.dir(result, { depth: 4 });
    throw new Error('The seal did not persist.');
  }
  const record = JSON.parse(snapshot);
  const exact = await client.readContract({
    ...view, functionName: 'get_seal', args: [record.id + ':' + record.updated_ms],
  });
  if (exact !== snapshot) throw new Error('Exact seal differs from latest event snapshot.');
  console.log('Finalized snapshot', snapshot);
}
