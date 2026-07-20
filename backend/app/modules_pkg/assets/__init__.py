"""Assets module — gold, silver, vehicles, real estate, FDs/RDs, stocks.

BOUNDARY RULES (this package is the Phase-3 service-extraction rehearsal):
  - This package imports NOTHING from other domain modules (no Loan, no
    PropertyDeal, no CashAccount joins). Shared infra only: database,
    mixins, dependencies, config, gold_price.
  - Other code consumes this module ONLY through `service.assets_summary()`
    (and the HTTP API). No cross-module FK joins against the assets table.
  - When this becomes a standalone service, `assets_summary()` turns into
    an HTTP call and nothing else has to change.
"""
