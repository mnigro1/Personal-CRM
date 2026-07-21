# Extraction Eval Harness

The extractor is Claude-over-MCP, so the model half of this harness runs *in a
Claude session* rather than CI. The deterministic half (schema validation,
dedup flagging, apply, undo) is covered by `tests/extraction.integration.test.ts`.

## Running the golden set

Run before every change to `mcp/EXTRACTION.md` / `PROMPT_VERSION`, and after
model upgrades. In a Claude Code session in this repo:

> Run the extraction evals in evals/golden/fixtures.json

Claude should, for each case, **in a scratch workspace** (create a throwaway
user/workspace via the repo layer, or reuse a dedicated eval workspace — never
the real one):

1. Create the `setup` contacts/memories/tags
2. `log_interaction` with the input text and `occurred_at`
3. `get_extraction_context` + `submit_extraction_proposal` following
   `mcp/EXTRACTION.md` — no peeking at `expect`
4. Compare the staged proposal against `expect` and score

## Scoring (spec §7)

| Metric | From cases |
| --- | --- |
| Contact binding accuracy | 01, 02, 05, 06, 08 |
| Memory recall/precision | 01, 02, 09 |
| Supersession detection | 03 |
| Duplicate suppression | 04 |
| Tag reuse rate | 10 |
| Date resolution accuracy | 01 (winter break), 07 |

Record results per `prompt_version` in `evals/results/<version>-<model>.md`
(score per case, failures verbatim). A regression on 04 (dedup) or 05 (never
guess) blocks shipping the prompt change — those two failures are the ones
that destroy trust in the product.
