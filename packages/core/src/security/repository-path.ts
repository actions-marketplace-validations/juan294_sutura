/** Reserved controller/evaluator storage, never candidate source or patch targets.
 * Public .sutura.json contracts are specifications and deliberately remain readable.
 */
export function isVerificationPrivatePath(path: string): boolean {
  const segments = path.split('/');
  return segments.some((segment, index) =>
    ['.sutura-controller', '.sutura-evaluator', 'hidden'].includes(segment) ||
    (segment === '.sutura' && segments[index + 1] === 'challenges'));
}

export interface SensitiveRepositoryPathOptions {
  includeDependencies?: boolean;
}

export function isSensitiveRepositoryPath(
  path: string,
  options: Readonly<SensitiveRepositoryPathOptions> = {},
): boolean {
  const segments = path.split('/');
  if (
    isVerificationPrivatePath(path) ||
    segments.includes('.git') ||
    (!options.includeDependencies && segments.includes('node_modules'))
  ) {
    return true;
  }

  const basename = segments.at(-1)?.toLowerCase() ?? '';
  return (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    basename === '.netrc' ||
    basename === '.npmrc' ||
    basename === '.pypirc' ||
    basename === 'credentials.json' ||
    basename === 'id_rsa' ||
    basename === 'id_ed25519' ||
    /\.(?:key|pem|p12|pfx)$/u.test(basename)
  );
}
