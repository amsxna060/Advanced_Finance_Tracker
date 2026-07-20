# Learning Guide — Senior Python Developer Track

Each epic in [../BACKLOG.md](../BACKLOG.md) ends with a tutorial written **while doing the work**, in this folder.
The rule: a tutorial is written from what we actually built and the mistakes we actually hit — not copied theory. That's what makes it interview-grade experience ("in my project I implemented X, and here's the trade-off we hit").

## Index (created as epics complete)

| # | Tutorial | Epic | Core concepts you'll be able to defend in an interview |
|---|----------|------|--------------------------------------------------------|
| 01 | multi-tenancy.md | E1 | shared-schema vs schema/DB-per-tenant, automatic query scoping (`with_loader_criteria`), isolation testing |
| 02 | authorization.md | E2 | RBAC vs ownership vs ABAC, safe permission migrations |
| 03 | entitlements.md | E3 | feature flags vs entitlements, server-enforced gating, onboarding funnels |
| 04 | modular-monolith.md | E4 | package-by-feature, interface seams, why monolith-first |
| 05 | admin-impersonation.md | E5 | "view as user", audit trails, least privilege, support tooling |
| 06 | release-engineering.md | E6 | expand→migrate→contract DB changes, phase-gated branches, smoke tests |
| 07 | celery.md | E7 | broker vs result backend, acks_late, idempotency, beat, DLQ, flower |
| 08 | events-outbox.md | E8 | transactional outbox, at-least-once delivery, eventual consistency |
| 09 | service-extraction.md | E9 | strangler fig, shared-JWT auth across services, per-service CI |
| 10 | messaging.md | E10 | SNS fan-out → SQS, IAM least privilege, localstack, Kafka vs queues |
| 11 | lambda-whatsapp.md | E11 | serverless webhooks, API Gateway, service tokens |

## Template for each tutorial

```markdown
# <Topic>
## Why we needed it (the problem in THIS codebase)
## The options considered & trade-offs
## What we built (with file paths + key snippets)
## Mistakes / surprises along the way
## How big orgs do it at scale (what changes beyond our size)
## Interview drill: 5 questions you should now be able to answer
```
