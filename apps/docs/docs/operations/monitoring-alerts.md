---
title: Monitoring and Alerts
---

Monitoring should cover infrastructure, runtime quality, and business-level behavior.

## Infrastructure Metrics

- CPU / memory / disk
- Redis latency and errors
- Postgres connections and slow queries
- Container restart counts

## Runtime Metrics

- Signals per interval
- Order execution attempts vs successful placements
- Runtime error rate by strategy
- API latency for market endpoints

## AI and ML Metrics

- AI approval rate
- AI quality distribution
- ML inference latency and failure rate
- ML score distribution drift

## Alerting Levels

- Warning: degradation trend (latency up, small error rise)
- Critical: hard dependency down, sustained order failures, or data pipeline broken

## Recommended Response

- Route warnings to on-call channel.
- Escalate critical alerts with immediate rollback options.
- Track each incident with postmortem actions.
