# IsoSeal

[Open IsoSeal on GitHub Pages](https://zuotu295.github.io/isoseal-genlayer/)

IsoSeal preserves specific USGS earthquake revisions and lets incident report
authors publish a verifiable reference to the data and file they used. Readers
can open a report link, follow its exact earthquake revisions, and compare their
copy of the report against the published SHA-256 fingerprint.

## Publish and verify an incident report

1. Find two or more event IDs on the [USGS earthquake map](https://earthquake.usgs.gov/earthquakes/map/).
2. Connect an EIP-1193 wallet to Stable Studionet (chain ID 61999). For each event,
   seal its current revision, wait for the transaction to finalize, then copy the
   exact seal key shown in Finalized evidence, or select **Add to report**.
3. Under **Incident reports**, enter two to eight distinct seal keys and choose a
   report file up to 20 MiB. Select **Publish report** and approve the transaction.
4. Once **Transaction activity** shows **Finalized**, select **View report** and
   copy the verification link. Send the report file to readers separately.
5. Readers open the link, inspect the cited revisions, and select their local
   copy under **Verify a local copy**. File verification works without a wallet.

The browser hashes files locally. The on-chain manifest contains the fingerprint
and sorted revision keys. Any wallet can publish a manifest. A matching file
establishes byte equality with the registered digest. It does not verify authorship,
review the report's conclusions, or prove that its prose accurately cites the
linked observations. The fingerprint and all linked revisions are public.

## Contract behavior

- **`seal(event_id)`** uses `gl.eq_principle.strict_eq` to compare observations
  fetched independently from the fixed USGS FDSN endpoint. Validators compare the
  canonical ID, revision and origin times, magnitude and its scale, review status,
  coordinates, and depth. The contract normalizes measurements to integers and
  stores the result at `event_id:updated_ms`.
- **`get_seal(key)`** retrieves an exact revision and **`get_latest(event_id)`**
  follows the latest stored revision. Repeated capture of an identical snapshot
  returns the same key. Conflicting data at the same key and older unseen
  revisions are rejected.
- **`publish_report(document_sha256, revision_keys)`** checks that every revision
  exists in the same contract, sorts the distinct keys, and stores the canonical
  JSON manifest under its own SHA-256. The same digest and key set produce the
  same report ID regardless of input order. **`get_report(report_id)`** reads it.
  Report publication is deterministic. The USGS agreement occurs when sealing.
- If validators cannot agree on the upstream record, a seal may fail. IsoSeal
  cannot recover a past revision unless it was captured when USGS served it.
  Studionet is a test network and may reset.

## Studionet deployments

| Version | Contract | Deployment |
| --- | --- | --- |
| Reports | [0x0ADcE9…d51d](https://explorer-studio.genlayer.com/address/0x0ADcE9061a5A048aA068f04E9a1ce29253B7d51d) | [Deployment transaction](https://explorer-studio.genlayer.com/tx/0x76b5a290a26ae68b90629f0cc4cac55913bad0ff46ac2b77fc796724917dc48e) |
| Original | [0x8E8bAE…255E](https://explorer-studio.genlayer.com/address/0x8E8bAE0BbE49Db72f280Fb3615899F68feb6255E) | [Deployment transaction](https://explorer-studio.genlayer.com/tx/0xdcb89bb427f8a1fb713cb8f2ad260e7980dd143b5c056a8f4b22a2e2c5332e20) |

The original deployment retains its [finalized seal transaction](https://explorer-studio.genlayer.com/tx/0xceb03e8dc1b288231ce642a4b3e2dfe5c480485e0c3ceec807285fa14edf0c8e)
and [exact revision link](https://zuotu295.github.io/isoseal-genlayer/?seal=us7000pn9s%3A1784316811066).
Existing seal links continue to target the original contract when their URL has
no explicit address. Report references must be sealed in the Reports deployment.


[Open the verified sample report](https://zuotu295.github.io/isoseal-genlayer/?report=bce32e8b6f89a1eb91eaf058f94dd446bbe511b79562c3ecc2dab1cda0cb464f&contract=0x0ADcE9061a5A048aA068f04E9a1ce29253B7d51d) and compare it with
[the sample file](evidence/sample-report.txt). The [Studionet evidence](evidence/README.md)
includes the finalized report publication, exact revision readbacks, and the
rejected reference. Recheck the deployment and receipts with `npm run verify:live`.

## Build and test

Node.js 24 and Python 3 are required for the following commands.

```sh
npm ci
npm run dev
npm run build
python3 -m unittest discover -s tests -v
```

The Python suite stubs the GenLayer runtime and tests input validation and report
storage. GitHub Pages publishes the production build from the default branch.

The transaction client uses `genlayer-js` 2.0.0 to estimate the fee allocation
required by Stable Studionet. Browser writes require test GEN for the estimated
fee. No contract value is transferred by the seal and report methods.

To deploy a separate test instance, run `STUDIONET_FAUCET=1 npm run deploy:contract`
or supply a funded Studionet signer through `STUDIONET_PRIVATE_KEY`. Configure its
address in `src/deployment.json` or through **Contract settings** in the app.
