## Opportunities
- `usePager('opportunities', { pipelineId, pipelineStageId, status: 'open'|'won'|'lost'|'abandoned'|'all', contactId, assignedTo, order: 'added_desc'|'added_asc', query, limit })` (deals; filter on the server with these options, never filter loaded items; `query` searches from 2 characters; `total` counts the matches).
- `call('getPipelines')` → `[{ id, name, stages: [{ id, name, position }] }]`. Show stages in `position` order; a deal's stage is `pipelineStageId`.
- `call('getOpportunity', { opportunityId })` → the opportunity (fields below).
- `call('updateOpportunity', { opportunityId }, { pipelineStageId, status, monetaryValue, name })` → the updated opportunity. Send only the fields to change. A write: only from a button; then `pager.reset()`. To move a deal to the next stage, send the stage after its current one (by `position`) in the same pipeline.

Endpoints (verified response shapes):
- `GET /opportunities/search` (usePager 'opportunities') → items `{ id, name, monetaryValue, status, pipelineId, pipelineStageId, contactId, contact, assignedTo, source, createdAt, updatedAt, lastStageChangeAt }`, `meta: { total }`. `contact` is `{ id, name, email, phone }` (use `contactName(deal.contact)`); `monetaryValue` is a number in the sub-account's currency, which the API doesn't return: format it with thousands separators and no currency symbol (never assume $).
- `GET /opportunities/pipelines` (getPipelines) → `{ pipelines: [{ id, name, stages: [{ id, name, position }] }] }`.
- `GET /opportunities/{opportunityId}` (getOpportunity) → `{ opportunity: { id, name, monetaryValue, status, pipelineId, pipelineStageId, contactId } }`.

Not available: creating or deleting opportunities; opportunity notes or tasks; stage changes across pipelines in one call.
