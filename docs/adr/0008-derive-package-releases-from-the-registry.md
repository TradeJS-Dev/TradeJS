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
package and production-like consumer, and moves `beta` only after success.
TradeJS-Project polls that verified channel but commits the resolved exact beta
cohort, builds one immutable image, and deploys that exact Project SHA.

Stable promotion is an explicit weekly operation rather than an independent
GitHub cron. It requires the exact beta and current Project SHA, proves that the
Project pins the complete beta cohort, requires the latest successful Deploy
run to identify that Project SHA, and enforces at least 24 hours of production
soak. It then proves the beta's npm `gitHead` and successful CI run, derives the
stable version from that beta, repeats the stable package checks, and tags the
verified `stable` source commit before moving every package's `latest` tag.

This ordering makes the release idempotent without a protected-branch write. An
existing stable tag must point to the exact release source; a partial `latest`
set or a missing tag is an error, not a compatibility path. The `Protect stable`
GitHub ruleset permits bypass only for organization administrators. Deploy-key
bypass and the former `RELEASE_DEPLOY_KEY` secret are not part of the release
architecture.

Runtime consumers remain stricter than the source workspace: TradeJS-Project
pins exact published versions in `package.json`, `yarn.lock`, and its runtime
package manifest. A mutable npm tag is discovery input only and never a runtime
identity. Moving `latest` does not trigger a second production deployment.
