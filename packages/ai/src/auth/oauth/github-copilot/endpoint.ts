export function resolveGitHubCopilotOrigin(
  options: Readonly<{
    copilotToken?: string;
    enterpriseDomain?: string;
  }>,
): string {
  const tokenHint = options.copilotToken
    ?.split(';')
    .find((field) => field.startsWith('proxy-ep='));
  if (tokenHint) {
    const hostname = tokenHint.slice('proxy-ep='.length);
    if (!isCanonicalHostname(hostname))
      throw new Error('GitHub Copilot proxy endpoint hint is invalid');
    const apiHostname = hostname.startsWith('proxy.')
      ? `api.${hostname.slice('proxy.'.length)}`
      : hostname;
    return `https://${apiHostname}`;
  }
  if (options.enterpriseDomain !== undefined) {
    if (!isCanonicalHostname(options.enterpriseDomain))
      throw new Error('GitHub Copilot enterprise domain is invalid');
    return `https://copilot-api.${options.enterpriseDomain}`;
  }
  return 'https://api.individual.githubcopilot.com';
}

export function resolveGitHubCopilotOriginFact(
  value: unknown,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string')
    throw new Error('GitHub Copilot endpoint origin fact is invalid');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !isCanonicalHostname(url.hostname)
  )
    throw new Error('GitHub Copilot endpoint origin fact is invalid');
  return url.origin;
}

function isCanonicalHostname(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 253 &&
    value === value.toLowerCase() &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) &&
    !value.includes('..') &&
    value.split('.').every((label) => label.length > 0 && label.length <= 63)
  );
}
