# Share one strategy evidence verifier

Strategy Release publishers, runtime dashboard readers, and tests will use the same Node-safe `@tradejs/infra/strategyReleaseEvidence` verifier for canonical JSON, checksums, artifact identity, and marker structure. Keeping a second app-local verifier looked simpler, but it could allow the producer and UI to disagree about which immutable evidence is valid; the shared subpath makes that integrity rule one deep module while `@tradejs/types` remains the contract-only package.
