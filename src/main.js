import './style.css';
import { abi, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant, transactionsStatusNumberToName } from 'genlayer-js/types';
import deployment from './deployment.json';

const $ = (selector) => document.querySelector(selector);
const reader = createClient({ chain: studionet });
const eventId = /^[a-z0-9]{2,32}$/;
const reportIdPattern = /^[0-9a-f]{64}$/;
const sealKey = /^[a-z0-9]{2,32}:[1-9][0-9]{0,15}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const storeKey = 'isoseal-studionet-v1';
const query = new URLSearchParams(location.search);
const terminal = new Set(['Finalized', 'Failed', 'Canceled']);
const explorer = 'https://explorer-studio.genlayer.com/tx/';

let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(storeKey) || '{}') || {};
} catch {
  // A damaged or unavailable cache should not prevent a new lookup.
}
const legacySeal = query.has('seal') && !query.has('contract') ? deployment.legacyAddress : '';
const sharedAddress = query.get('contract') || legacySeal || '';
const savedAddress = (typeof saved.address === 'string' ? saved.address.toLowerCase() : '') === deployment.legacyAddress.toLowerCase() ? '' : saved.address;
let address = [sharedAddress, savedAddress, deployment.address].find((value) => addressPattern.test(value)) || '';
let entries = Array.isArray(saved.entries) ? saved.entries : [];
let account = '';
let busy = false;
let polling = false;
let viewVersion = 0;

function cache() {
  try {
    localStorage.setItem(storeKey, JSON.stringify({ address, entries }));
  } catch {
    // Pending hashes still remain visible for this session.
  }
}

function message(text, error = false) {
  $('#notice').textContent = text;
  $('#notice').classList.toggle('error', error);
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(text, href, className) {
  const node = element('a', text, className);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function describeError(error) {
  if (error?.code === 4001 || /user rejected|user denied/i.test(error?.message || '')) {
    return 'Request declined in your wallet.';
  }
  return String(error?.shortMessage || error?.message || 'Request failed.').slice(0, 240);
}

function showWallet() {
  $('#wallet').textContent = account ? account.slice(0, 6) + '…' + account.slice(-4) : 'Connect wallet';
}

async function connectWallet() {
  const provider = window.ethereum;
  if (!provider?.request) throw new Error('Open this page in a browser with an EIP-1193 wallet.');
  const [selected] = await provider.request({ method: 'eth_requestAccounts' });
  if (!selected) throw new Error('The wallet did not provide an account.');
  const chainId = '0x' + studionet.id.toString(16);
  if (BigInt(await provider.request({ method: 'eth_chainId' })) !== BigInt(chainId)) {
    const switchChain = () => provider.request({
      method: 'wallet_switchEthereumChain', params: [{ chainId }],
    });
    try {
      await switchChain();
    } catch (error) {
      if (error?.code !== 4902 && error?.data?.originalError?.code !== 4902) throw error;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId,
          chainName: 'GenLayer Studionet',
          nativeCurrency: studionet.nativeCurrency,
          rpcUrls: studionet.rpcUrls.default.http,
          blockExplorerUrls: ['https://explorer-studio.genlayer.com'],
        }],
      });
      if (BigInt(await provider.request({ method: 'eth_chainId' })) !== BigInt(chainId)) await switchChain();
    }
  }
  if (BigInt(await provider.request({ method: 'eth_chainId' })) !== BigInt(chainId)) {
    throw new Error('Switch your wallet to GenLayer Studionet.');
  }
  const [active] = await provider.request({ method: 'eth_accounts' });
  if (active?.toLowerCase() !== selected.toLowerCase()) throw new Error('Wallet account changed. Try again.');
  account = selected;
  showWallet();
  return createClient({ chain: studionet, account: selected, provider });
}

window.ethereum?.on?.('accountsChanged', ([active]) => {
  account = active || '';
  showWallet();
});

$('#wallet').addEventListener('click', async () => {
  $('#wallet').disabled = true;
  try {
    await connectWallet();
    message('Wallet connected to Studionet.');
  } catch (error) {
    message(describeError(error), true);
  } finally {
    $('#wallet').disabled = false;
  }
});

function readSeal(contract, key) {
  return reader.readContract({
    address: contract,
    functionName: sealKey.test(key) ? 'get_seal' : 'get_latest',
    args: [key],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}

function showRecord(raw, contract) {
  const target = $('#evidence');
  if (!raw) {
    target.replaceChildren(element('p', 'No finalized snapshot found for this reference.', 'empty'));
    return;
  }
  const record = JSON.parse(raw);
  const key = record.id + ':' + record.updated_ms;
  const formatDate = (time) => new Date(time).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace(/Z$/, ' UTC');
  const header = element('div', '', 'record-head');
  header.append(element('div', 'M ' + (record.magnitude_milli / 1000), 'magnitude'), element('span', record.status, 'flag'));
  const details = element('dl', '', 'metrics');
  for (const [title, value] of [
    ['Event', record.id],
    ['Depth', (record.depth_m / 1000).toFixed(2) + ' km'],
    ['Latitude', (record.latitude_microdegrees / 1000000).toFixed(4) + '°'],
    ['Longitude', (record.longitude_microdegrees / 1000000).toFixed(4) + '°'],
    ['Origin', formatDate(record.origin_ms)],
    ['USGS revision', formatDate(record.updated_ms)],
  ]) {
    const group = element('div');
    group.append(element('dt', title), element('dd', value));
    details.append(group);
  }
  const buttons = element('div', '', 'record-actions');
  const share = element('button', 'Copy seal link', 'text-button');
  share.addEventListener('click', async () => {
    const url = new URL(location.href);
    url.search = new URLSearchParams({ contract, seal: key }).toString();
    try {
      await navigator.clipboard.writeText(url.href);
      share.textContent = 'Link copied';
    } catch {
      message(url.href);
    }
  });
  if (contract.toLowerCase() === address.toLowerCase() && contract.toLowerCase() !== deployment.legacyAddress.toLowerCase()) {
    const cite = element('button', 'Add to report', 'text-button');
    cite.type = 'button';
    cite.addEventListener('click', () => {
      const field = $('#report-keys');
      const keys = field.value.trim().split(/\s+/).filter(Boolean);
      if (keys.includes(key)) return message('This seal is already in the report.');
      if (keys.length >= 8) return message('A report can cite up to eight seals.', true);
      field.value = [...keys, key].join('\n');
      message('Seal added to the incident report.');
    });
    buttons.append(cite);
  }
  buttons.append(share, link('USGS source ↗', 'https://earthquake.usgs.gov/earthquakes/eventpage/' + record.id, 'source'));
  target.replaceChildren(header, details, element('code', key, 'seal-key'), buttons);
}

function renderActivity() {
  const list = $('#transactions');
  list.replaceChildren();
  if (!entries.length) {
    list.append(element('li', 'Submitted transactions appear here and resume tracking when you reopen this page.', 'empty'));
  }
  for (const entry of entries) {
    const row = element('li', '', 'tx-row');
    const status = element('span', entry.status, 'tx-status');
    status.dataset.state = entry.status;
    const summary = element('div', '', 'tx-summary');
    summary.append(element('strong', entry.id), element('small', entry.detail || entry.hash));
    row.append(status, summary, link('Explorer ↗', explorer + entry.hash, 'source'));
    if (entry.key) {
      const open = element('button', entry.kind === 'report' ? 'View report' : 'View seal', 'text-button');
      open.addEventListener('click', async () => {
        if (entry.kind === 'report') return openReport(entry.key, entry.address);
        $('#lookup').value = entry.key;
        await lookup(entry.key, entry.address);
      });
      row.append(open);
    }
    list.append(row);
  }
}

async function lookup(key, contract) {
  const version = ++viewVersion;
  try {
    message('Reading finalized state…');
    const value = await readSeal(contract, key);
    if (version !== viewVersion) return;
    showRecord(value, contract);
    message(value ? 'Finalized record loaded.' : 'No finalized seal found.');
  } catch (error) {
    if (version === viewVersion) message(describeError(error), true);
  }
}

function finalizedResult(tx, entry) {
  const receipt = tx.consensus_data?.leader_receipt;
  const leader = Array.isArray(receipt) ? receipt.find((item) => item.mode === 'leader') ?? receipt[0] : receipt;
  const encoded = typeof leader?.result === 'string' ? leader.result : leader?.result?.raw;
  if (!encoded) return null;
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (bytes[0] === 0 && leader.execution_result === 'SUCCESS') {
    const key = abi.calldata.decode(bytes.slice(1));
    if (typeof key === 'string' && (entry.kind === 'report'
      ? reportIdPattern.test(key)
      : sealKey.test(key) && key.startsWith(entry.id + ':'))) return { key };
  }
  const detail = [1, 2].includes(bytes[0]) && new TextDecoder().decode(bytes.slice(1));
  return { error: detail || 'Consensus did not return a seal key.' };
}

async function update(entry) {
  try {
    const tx = await reader.getTransaction({ hash: entry.hash });
    if (!tx) return;
    const state = tx.statusName || tx.status_name || transactionsStatusNumberToName[tx.status] || String(tx.status);
    entry.detail = '';
    if (state === 'FINALIZED') {
      const result = finalizedResult(tx, entry);
      if (!result) {
        entry.status = 'Checking result';
        entry.detail = 'Finalized receipt has not exposed its execution result.';
      } else if (result.error) {
        entry.status = 'Failed';
        entry.detail = result.error;
      } else {
        const snapshot = entry.kind === 'report'
          ? await readReport(entry.address, result.key)
          : await readSeal(entry.address, result.key);
        if (!snapshot) throw new Error('The exact snapshot is not readable yet.');
        entry.status = 'Finalized';
        entry.key = result.key;
      }
    } else if (state === 'CANCELED') {
      entry.status = 'Canceled';
    } else {
      entry.status = state === 'ACCEPTED' ? 'Accepted' : 'In consensus';
      entry.detail = state.replaceAll('_', ' ').toLowerCase();
    }
  } catch (error) {
    entry.detail = 'Status check interrupted. ' + describeError(error);
  }
}

async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const pending = entries.filter((entry) => !terminal.has(entry.status));
    await Promise.all(pending.map(update));
    cache();
    renderActivity();
  } finally {
    polling = false;
  }
}

$('#settings-toggle').addEventListener('click', () => {
  $('#settings').hidden = !$('#settings').hidden;
  $('#settings-toggle').setAttribute('aria-expanded', String(!$('#settings').hidden));
});
$('#contract').value = address;
$('#contract-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const next = $('#contract').value.trim();
  if (!addressPattern.test(next) || /^0x0{40}$/i.test(next)) {
    message('Enter a valid, nonzero Studionet contract address.', true);
    return;
  }
  address = next;
  ++viewVersion;
  clearReport();
  $('#report-keys').value = '';
  reportNotice('Contract address updated.');
  $('#evidence').replaceChildren(element('p', 'Look up a seal on this contract.', 'empty'));
  cache();
  message('Studionet contract address saved.');
});
$('#evidence-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const key = $('#lookup').value.trim().toLowerCase();
  const contract = address;
  const write = event.submitter?.value === 'seal';
  if (!contract) return message('Set the deployed address in Contract settings.', true);
  if (write ? !eventId.test(key) : !eventId.test(key) && !sealKey.test(key)) {
    return message(write ? 'Enter a USGS event ID to seal.' : 'Enter a USGS event ID or an exact seal key.', true);
  }
  if (!write) {
    await lookup(key, contract);
    return;
  }
  busy = true;
  $('#seal').disabled = true;
  message('Approve the transaction in your wallet…');
  try {
    const client = await connectWallet();
    const hash = await client.writeContract({
      address: contract, functionName: 'seal', args: [key], value: 0n, leaderOnly: false,
      fees: await studyFees(client),
    });
    entries.unshift({ hash, id: key, address: contract, status: 'Submitted' });
    cache();
    renderActivity();
    message('Submitted. Follow validator consensus in Transaction activity.');
    void refresh();
  } catch (error) {
    message(describeError(error), true);
  } finally {
    busy = false;
    $('#seal').disabled = false;
  }
});

$('#refresh').addEventListener('click', refresh);
renderActivity();
void refresh();
setInterval(refresh, 10000);
const sharedSeal = query.get('seal') || '';
if (address && sealKey.test(sharedSeal)) {
  $('#lookup').value = sharedSeal;
  void lookup(sharedSeal, address);
}

let reportVersion = 0;
let verificationVersion = 0;
let loadedReport = null;

function reportNotice(text) {
  $('#report-notice').textContent = text;
}

function clearReport() {
  ++reportVersion;
  loadedReport = null;
  $('#report-record').replaceChildren();
  $('#report-verify').hidden = true;
  $('#report-verify').reset();
  $('#verify-result').textContent = '';
}

function evidenceUrl(parameter, value, contract) {
  const url = new URL(location.pathname, location.href);
  url.search = new URLSearchParams({ [parameter]: value, contract });
  return url.href;
}

function readReport(contract, id) {
  return reader.readContract({
    address: contract,
    functionName: 'get_report',
    args: [id],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}

async function openReport(id, contract) {
  clearReport();
  const version = reportVersion;
  $('#report-id').value = id;
  reportNotice('Reading finalized report…');
  try {
    const raw = await readReport(contract, id);
    if (version !== reportVersion) return;
    if (!raw) return reportNotice('No finalized report found.');
    const record = JSON.parse(raw);
    if (typeof record.document_sha256 !== 'string' || !reportIdPattern.test(record.document_sha256) ||
      !Array.isArray(record.revision_keys) || record.revision_keys.length < 2 || record.revision_keys.length > 8 ||
      !record.revision_keys.every((key) => typeof key === 'string' && sealKey.test(key))) {
      throw new Error('Invalid report manifest.');
    }
    const references = element('ul', '');
    for (const key of record.revision_keys) {
      const item = element('li', '');
      item.append(link(key, evidenceUrl('seal', key, contract)));
      references.append(item);
    }
    const copy = element('button', 'Copy verification link', 'quiet');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(evidenceUrl('report', id, contract));
        reportNotice('Verification link copied.');
      } catch (error) {
        reportNotice(describeError(error));
      }
    });
    $('#report-record').append(element('p', 'File SHA-256: ' + record.document_sha256), references, copy);
    loadedReport = record;
    $('#report-verify').hidden = false;
    reportNotice('Finalized report loaded.');
  } catch (error) {
    if (version === reportVersion) reportNotice(describeError(error));
  }
}

async function fileDigest(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a file up to 20 MiB.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

$('#report-lookup').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = $('#report-id').value.trim().toLowerCase();
  if (!reportIdPattern.test(id)) return reportNotice('Enter a 64-character report ID.');
  void openReport(id, address);
});

$('#verify-file').addEventListener('change', () => {
  ++verificationVersion;
  $('#verify-result').textContent = '';
});

$('#report-verify').addEventListener('submit', async (event) => {
  event.preventDefault();
  const record = loadedReport;
  if (!record) return;
  const version = ++verificationVersion;
  try {
    const digest = await fileDigest($('#verify-file').files[0]);
    if (record === loadedReport && version === verificationVersion) {
      $('#verify-result').textContent = digest === record.document_sha256
        ? 'Match. This file has the registered SHA-256.'
        : 'Mismatch. This file differs from the registered report.';
    }
  } catch (error) {
    if (record === loadedReport && version === verificationVersion) $('#verify-result').textContent = describeError(error);
  }
});

$('#report-publish').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#publish-report');
  if (button.disabled) return;
  const contract = address;
  const keys = $('#report-keys').value.trim().toLowerCase().split(/\s+/);
  if (keys.length < 2 || keys.length > 8 || new Set(keys).size !== keys.length ||
    !keys.every((key) => sealKey.test(key))) {
    return reportNotice('Enter two to eight distinct exact seal keys.');
  }
  button.disabled = true;
  try {
    const digest = await fileDigest($('#report-file').files[0]);
    if (contract.toLowerCase() === deployment.legacyAddress.toLowerCase()) {
      throw new Error('Switch Contract settings to the current IsoSeal deployment to publish a report.');
    }
    await readReport(contract, '0'.repeat(64));
    const snapshots = await Promise.all(keys.map((key) => readSeal(contract, key)));
    if (snapshots.some((snapshot) => !snapshot)) throw new Error('Every revision must already be sealed on this contract.');
    reportNotice('Approve the report transaction and estimated test GEN fee in your wallet…');
    const client = await connectWallet();
    const hash = await client.writeContract({
      address: contract, functionName: 'publish_report', args: [digest, keys], value: 0n, leaderOnly: false,
      fees: await studyFees(client),
    });
    entries.unshift({ hash, id: 'Incident report', kind: 'report', address: contract, status: 'Submitted' });
    cache();
    renderActivity();
    reportNotice('Report submitted. Follow its status in Transaction activity.');
    void refresh();
  } catch (error) {
    reportNotice(describeError(error));
  } finally {
    button.disabled = false;
  }
});

const sharedReport = query.get('report') || '';
if (address && reportIdPattern.test(sharedReport)) void openReport(sharedReport, address);

async function studyFees(client) {
  const { distribution, feeValue } = await client.estimateTransactionFees({
    leaderTimeunitsAllocation: 100n, validatorTimeunitsAllocation: 200n, rotations: [0n],
  });
  return { distribution, feeValue };
}
