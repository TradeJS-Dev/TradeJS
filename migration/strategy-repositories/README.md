# Strategy repository migration

This directory contains the checked-in, secret-free inputs for extracting every
TradeJS strategy into an independently versioned repository and npm package.
It is an internal migration contour, not public user documentation.

## Sources of truth

- `catalog.json` maps every current strategy to its future repository and npm
  package.
- `helper-ownership.json` records the current consumers, source owner, and
  intended destination of each strategy helper. Extracted Strategy Kit modules
  remain in this inventory until the repository split is complete.
- `characterization-contract.json` defines the behavior-preservation evidence
  required before helper refactoring or repository extraction can complete.
- `documentation-inventory.json` records documentation that must move or be
  updated before the new repository topology is released.
- `github-environment-inventory.json` records secret and environment variable
  names, never values, together with their intended destination.

Run the structural validation from the TradeJS root:

```bash
yarn migration:strategy-repositories:validate
```

The validator deliberately checks the current source tree against these files.
Changing, adding, extracting, or removing a strategy helper therefore requires
an explicit migration decision.

The first implementation phase is complete only when the catalog and
inventories validate. Helper refactoring starts by filling the characterization
contract for all strategies; a single-strategy pilot is not a release stage.

## Migration invariant

No partial repository topology is published. TradeJS vNext, Strategy Kit, all
strategy packages, TradeJS Base, TradeJS Project images, and the Deploy cutover
remain one release train. Intermediate workspace modules exist only on the
migration branch to prove package isolation.
