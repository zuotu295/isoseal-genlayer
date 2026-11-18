# IsoSeal

IsoSeal preserves dated USGS earthquake revisions on GenLayer Studionet. It gives claims teams, researchers, and incident-report authors an exact reference when a USGS event page later reflects revised magnitude, depth, location, or review status.

## Use the project

1. Open the [IsoSeal app](https://zuotu295.github.io/isoseal-genlayer/).
2. Enter a canonical event ID from the [USGS earthquake map](https://earthquake.usgs.gov/earthquakes/map/), such as `us7000pn9s`.
3. Select **Look up seal** to read the latest finalized snapshot for the event. A link with an exact seal key opens that revision.
4. To capture the current state, connect an EIP-1193 wallet on Studionet (chain ID 61999), select **Seal current revision**, and approve the transaction. Use the faucet in [GenLayer Studio](https://studio.genlayer.com/) if the test account needs GEN.
5. Track the transaction in **Transaction activity**. Accepted indicates a provisional consensus decision. Once finalized, the app checks the returned seal key against finalized contract state and enables **View seal**. Share the exact revision using **Copy seal link**.

## How consensus works

The `seal` method accepts only a bounded alphanumeric event ID. Validators independently query the fixed USGS FDSN endpoint and compare only the canonical event ID, source revision timestamp, origin time, magnitude, review status, coordinates, and depth. The contract normalizes measurements to integers and uses `gl.eq_principle.strict_eq` to compare the canonical snapshot. It stores the agreed snapshot under `event_id:updated_ms`.

A second seal of the same payload returns the same key. A conflicting payload under an existing key and an older, unseen revision both cause the write to fail. Newer revisions update a per-event latest pointer while retaining the prior snapshots. `get_seal` and `get_latest` are public read methods.

Consensus attests to the version validators could observe at capture time, with USGS as the upstream authority. Temporary source disagreements or failures can prevent a write. An older revision is available through IsoSeal if someone captured it while USGS served it. Studionet is a development network and may reset. IsoSeal is intended for report provenance, with no alerting or claims decisions.

## Run and deploy

Use Node.js 24.

```sh
npm ci
npm run dev
npm run build
```

`src/deployment.json` contains the project's Studionet address. To deploy another instance with a funded test account, pass the private key through the `STUDIONET_PRIVATE_KEY` environment variable. For a disposable Studionet account, run:

```sh
STUDIONET_FAUCET=1 npm run deploy:contract -- --smoke
```

The smoke flow deploys the contract, verifies initial state, sends a real validator-backed seal for `us7000pn9s`, waits for finalization, and compares the latest and exact read results. After deployment, set the address in `src/deployment.json` or paste it under **Contract settings** in the app. The GitHub Pages workflow builds and publishes `dist/` using the GitHub Actions source.

## Submit to GenLayer Projects

- **Name** — IsoSeal
- **Category** — Projects
- **Primary tag** — Other
- **Repository** — [Source code](https://github.com/zuotu295/isoseal-genlayer)
- **Demo** — [IsoSeal app](https://zuotu295.github.io/isoseal-genlayer/)
- **Description** — IsoSeal gives authors of earthquake incident reports an immutable reference to the specific USGS revision they used. GenLayer validators independently fetch official USGS measurements, agree on a canonical snapshot, and preserve it under a stable revision key. The web app submits transactions, tracks consensus and finalization, and creates shareable links to finalized records.
