# TradeJS Licensing

TradeJS version 2.0.0 and later uses a mixed-license open-core model. The
license nearest to a file in the repository tree governs that file. When a
package contains its own `LICENSE`, that package license overrides the
repository default.

## Business Source License components

The following product components are licensed under the Business Source
License 1.1 (`BUSL-1.1`) with the Additional Use Grant in their `LICENSE`:

| Path | Package or component |
| --- | --- |
| `apps/app` | `@tradejs/app` |
| `packages/base` | `@tradejs/base` |
| `packages/cli` | `@tradejs/cli` |
| `packages/ml` | private ML runtime assets |
| `packages/node` | `@tradejs/node` |
| `packages/strategies` | `@tradejs/strategies` |

The repository root and product code outside a package-specific MIT exception
are also covered by the root Business Source License.

The Additional Use Grant permits production use, including internal trading,
research, analytics, and operations. It does not permit using the licensed
components to offer a competing product or hosted or managed service to third
parties. A commercial license is required for that use.

The Change Date is 2030-07-17. On that date, or the fourth anniversary of the
first public distribution of a particular licensed version if earlier, the
applicable Change License is GNU Affero General Public License Version 3.

## MIT components

The following SDK, integration, scaffolding, and example components remain
available under the MIT License contained in their own `LICENSE`:

| Path | Package or component |
| --- | --- |
| `packages/connectors` | `@tradejs/connectors` |
| `packages/core` | `@tradejs/core` |
| `packages/create-tradejs` | `create-tradejs` |
| `packages/indicators` | `@tradejs/indicators` |
| `packages/infra` | `@tradejs/infra` |
| `packages/types` | `@tradejs/types` |
| `examples/sandbox` | external-user example application |

Using an MIT component does not change the license of its dependencies. Users
must comply with the license of every TradeJS package included in their
application.

## Earlier releases

TradeJS releases through version 1.0.12 were published under the MIT License
and remain available under those terms. The licensing change applies only to
version 2.0.0 and later. See the `v1.0.12` tag for the last fully MIT-licensed
release.

## Commercial licensing

For permission to provide a Competing Offering, contact the TradeJS-Dev
maintainers through the repository:
https://github.com/TradeJS-Dev/TradeJS.
