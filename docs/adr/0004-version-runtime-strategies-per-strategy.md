# Version runtime configuration per strategy

Runtime configuration is published as immutable, independently numbered strategy releases in Redis; deployments bind one release to an account and may pause only new entries. We rejected embedded deployment config and production git/fingerprint identity so code packages, runtime configuration, operational binding, and research evidence each have one explicit owner while historical evidence remains checksum-verifiable.

Each published release materializes package defaults and owns strategy semantics, including interval, universe, policy, and risk settings. Deployment owns the connector/account binding and entry-control state. Invocation-only fields such as execution mode and whether orders may be placed are not publishable config, so signals adds them without replacing release values.
