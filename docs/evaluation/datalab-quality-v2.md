# Blinded Data Lab quality experiment v2

The local controller is `scripts/datalab-quality-experiment.mjs`. It preserves
the historical v1 experiment and consumes the blinded, executed-record quality
dataset. No v2 paid experiment has been run by this implementation task.

Prepare a private input JSON containing `entries`, `sources`, `manifest` and
one `split`. `sources` maps each custom ID to the exact retained executed JSON
bytes. The controller checks each source hash and regenerates the blinded
record before accepting it. The scoring keys and raw source records are kept
in a private mode-0600 sidecar; uploaded rows contain only blinded prompts.
Keep the input and experiment directory outside public archives.

Development and validation each prepare both prompt variants through the
shared paired-batch builder. A held-out input also needs the completed
validation `selection`; only that frozen selected variant is built. It must
use the same experiment identity, model and prices, and held-out subjects and
families cannot overlap those used for selection. Do not inspect held-out
results to tune a new prompt.

The CLI has explicit stages:

| Stage | Behavior |
| --- | --- |
| `prepare --directory … --input …` | Validate source, split, manifest and worst-case price; retain exact request bytes and request hash. No provider call. |
| `upload --directory … --request-hash …` | Upload the exact prepared dataset under the existing explicit upload authorization. |
| `run-batch --directory … --request-hash …` | Launch one authorized batch after a durable manifest reservation. |
| `recover-upload --directory … --dataset-id …` | Attach the observed dataset identity after an ambiguous upload; do not upload again. |
| `recover-batch --directory … --operation-id …` | Attach the observed operation after an ambiguous dispatch; do not relaunch. |
| `finalize --directory …` | Read the existing operation and outputs; retain failures, missing rows, model mismatches, unknown usage and timing. |
| `freeze-selection --directory …` | Select only from a terminal, complete validation result. Development and held-out results cannot select a winner. |

Run each stage with `node scripts/datalab-quality-experiment.mjs`. Consult the
controller's error output for required explicit authorization flags. There is
no authorization in this document to upload data or launch a batch.

Each paid batch requires its own exact manifest and cap. A durable reservation
in the repository's Git common directory prevents restarting or copying the
experiment directory from resetting that authorization. Ambiguous dispatch
requires recovery of the original operation, never a fresh batch under the
same manifest. Recovery does not grant more budget.

The final report joins outputs by custom ID, compares both prompts on the
same records and retains coverage separately from correctness. Calibration
uses decided answers with known independent truth: ten fixed confidence bins,
expected calibration error and Brier score. Missing/abstained/unknown-truth
items remain in coverage and resource accounting. Unknown actual-model cost,
missing token usage or invalid timing cannot be reported as zero or used to
justify a cost improvement. Prompt selection is blocked by incomplete or
invalid provider evidence.

Archive only sanitized inputs and permitted public results after a separately
authorized real experiment. The private scoring sidecar is not a public
artifact. A successful local fake-provider test proves the controller's
contract, not improved model quality or successful sponsor use.
