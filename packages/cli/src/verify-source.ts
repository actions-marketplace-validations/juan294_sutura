/** Compatibility exports; CLI and Action use the same trusted input boundary. */
export {
  assertCleanCheckoutAt,
  MAX_POLICY_OBJECT_BYTES,
  MAX_SNAPSHOT_FILES,
  MAX_SNAPSHOT_FILE_BYTES,
  readBoundedRegularFile,
  readTrustedPolicyAtCommit,
  snapshotCleanSourceAt,
  TRUSTED_POLICY_PATH,
  VerifySourceError,
  type SourceSnapshot,
} from '@sutura/core';
