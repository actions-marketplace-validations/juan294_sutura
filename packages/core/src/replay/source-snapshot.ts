import { freezeSandboxSource, type FrozenVerificationSource } from '../heal.js';
import type { RepositoryPort } from '../orchestrate.js';
import type { ReplayRecorder } from './bundle.js';
import { recordedErrorResult } from './recorded-error.js';

/** Captures provenance at the live boundary; replay consumes that identity, never a new source tree. */
export async function freezeRepositorySource(
  repository: RepositoryPort,
  checkoutDir: string,
  recorder?: ReplayRecorder,
): Promise<FrozenVerificationSource> {
  if (repository.freezeSource) return repository.freezeSource(checkoutDir);
  const sequence = recorder?.reservePortSequence('repository');
  try {
    const frozen = await freezeSandboxSource(checkoutDir);
    recorder?.registerCheckoutAlias(frozen.dir, checkoutDir);
    recorder?.recordRepository({
      method: 'freezeSource', args: [checkoutDir],
      result: { sourceDir: frozen.dir, snapshotSha256: frozen.snapshotSha256 },
    }, sequence);
    return frozen;
  } catch (error) {
    recorder?.recordRepository({ method: 'freezeSource', args: [checkoutDir], result: recordedErrorResult(error) }, sequence);
    throw error;
  }
}
