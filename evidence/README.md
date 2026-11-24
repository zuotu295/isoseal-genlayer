# Studionet evidence

## Reports deployment

The [deployment transaction](https://explorer-studio.genlayer.com/tx/0x76b5a290a26ae68b90629f0cc4cac55913bad0ff46ac2b77fc796724917dc48e) is
FINALIZED with successful execution. The deployed source matches the repository
byte for byte. Its SHA-256 is recorded in [studionet.json](studionet.json).

| Operation | Outcome |
| --- | --- |
| [Seal USGS event us7000pn9s](https://explorer-studio.genlayer.com/tx/0x95077ccf9767488bbe206a35fda4d937edf8dd4f7a7f03b37f120c3457ef1c19) | FINALIZED + SUCCESS |
| [Seal USGS event us7000m9g4](https://explorer-studio.genlayer.com/tx/0x9e583d8abfab3da10baddc09a9b9fd27249e5ac0eae335cd8b688596cf543101) | FINALIZED + SUCCESS |
| [Publish incident report](https://explorer-studio.genlayer.com/tx/0x57fcf82f49242088e413cd197544ed2ac79c4eb6a7d8de10ee9b32659a2fbd49) | FINALIZED + SUCCESS. The manifest and both exact revisions were read back. |
| [Publish with an absent revision](https://explorer-studio.genlayer.com/tx/0x2dc075344b88c22beb8c0e29fff5541ff9506864680c0960934e5c621c175c08) | FINALIZED with a contract error. No report was stored. |

Open the [verification page](https://zuotu295.github.io/isoseal-genlayer/?report=bce32e8b6f89a1eb91eaf058f94dd446bbe511b79562c3ecc2dab1cda0cb464f&contract=0x0ADcE9061a5A048aA068f04E9a1ce29253B7d51d) and compare
[sample-report.txt](sample-report.txt). The original file matches. Editing any
byte changes its fingerprint. The two revision links resolve to the exact
snapshots registered by the report.

Run `npm ci` and `npm run verify:live` to re-read the deployment, verify the
source and transaction results, match the sample digest against the manifest,
and check that the invalid report is absent. The verification command performs
only reads.

## Earlier deployment attempts

The initial deployment attempt through genlayer-js 1.1.8 reverted with
`FeesDistributionMissing` before contract execution. Its
[EVM transaction](https://explorer-studio.genlayer.com/tx/0xa3b03bf4b3970f614723edb4001bd172ebf34245a88f83b195344b9e858e50bf)
did not create a contract. The deployment using the SDK 2.0.0 fee estimator is
linked in the project README.

The first fee-compatible deployment
([deployment](https://explorer-studio.genlayer.com/tx/0x4a6ab0fc335123dd114360b14eee45b601faf105e6c864903505b21390662353))
successfully published a report, but the
[invalid-reference transaction](https://explorer-studio.genlayer.com/tx/0x52597281e51db5c824fae973cacddd618eb9dc8bc53abfa13972972c767c43b2)
exposed a GenVM compatibility issue. It halted with an `AttributeError` because
the runtime exposes `UserError` under `gl.vm`. The contract now uses
`gl.vm.UserError` to reject invalid inputs with an explicit reason.
