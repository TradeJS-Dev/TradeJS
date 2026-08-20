# Derive package releases from the registry

Status: accepted.

TradeJS package releases do not write generated version commits to the
protected `stable` branch. The npm registry is the authority for the last
published stable version, and the verified source commit is the authority for
the released code.

All publishable source manifests use `3.1.0+development`. This SemVer build
metadata keeps local workspace peer checks on the supported 3.1 compatibility
line while making it explicit that the checked-out manifest is not a registry
release identity. Beta and stable workflows rewrite every publishable manifest
to one exact release version only in their ephemeral checkout.

For a relevant source push, the beta workflow reads `@tradejs/types@latest`,
derives the next patch plus its unique workflow run suffix, verifies every
package and production-like consumer, and moves `beta` only after success. The
stable workflow proves the beta's npm `gitHead` and successful CI run, derives
the stable version from that beta, repeats all stable checks, and tags the
verified `stable` source commit before moving every package's `latest` tag.

This ordering makes the release idempotent without a protected-branch write. An
existing stable tag must point to the exact release source; a partial `latest`
set or a missing tag is an error, not a compatibility path. The `Protect stable`
GitHub ruleset permits bypass only for organization administrators. Deploy-key
bypass and the former `RELEASE_DEPLOY_KEY` secret are not part of the release
architecture.

Runtime consumers remain stricter than the source workspace: TradeJS-Project
pins exact published versions in `package.json`, `yarn.lock`, and its runtime
package manifest. This ADR changes package-release bookkeeping only; it does not
weaken runtime composition identity or trigger a server deployment.
