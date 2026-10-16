// Apply only explicitly recorded deployed event layouts to isolated release artifacts.
export function executorApprovalIndexed(deployment) {
  const indexed = deployment.automation?.executorApprovalIndexed;
  if (indexed === undefined) return true; // Existing Sepolia/source ABI.
  if (deployment.chainId !== 42161 || deployment.automation?.mode !== 'keeper' || typeof indexed !== 'boolean') {
    throw new Error('Executor approval layout requires an explicit mainnet keeper boolean.');
  }
  return indexed;
}

export function deploymentAbi(artifact, deployment) {
  const indexed = executorApprovalIndexed(deployment);
  const copy = structuredClone(artifact);
  const abi = Array.isArray(copy) ? copy : copy.abi;
  for (const event of abi) {
    if (event.type !== 'event' || event.name !== 'ExecutorApprovalUpdated') continue;
    if (event.inputs?.length !== 2 || event.inputs[0].type !== 'address' || event.inputs[1].type !== 'bool') {
      throw new Error('Unexpected ExecutorApprovalUpdated ABI shape.');
    }
    event.inputs[0].indexed = indexed;
  }
  return copy;
}
