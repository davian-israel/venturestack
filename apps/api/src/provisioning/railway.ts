import { config } from '../config';

/**
 * Minimal client for Railway's public GraphQL API.
 * Docs: https://docs.railway.com/reference/public-api
 */
const ENDPOINT = 'https://backboard.railway.com/graphql/v2';

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!config.RAILWAY_API_TOKEN) throw new Error('RAILWAY_API_TOKEN not set');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.RAILWAY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || body.errors?.length) {
    throw new Error(`Railway API: ${body.errors?.map((e) => e.message).join('; ') ?? res.status}`);
  }
  return body.data as T;
}

export interface ServiceSpec {
  name: string;
  image: string;
  variables: Record<string, string>;
  volumeMountPath?: string;
  publicDomain?: boolean;
}

export async function createService(spec: ServiceSpec): Promise<{ id: string; url?: string }> {
  const projectId = config.RAILWAY_PROJECT_ID!;
  const environmentId = config.RAILWAY_ENVIRONMENT_ID!;

  const { serviceCreate } = await gql<{ serviceCreate: { id: string } }>(
    `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
    { input: { projectId, environmentId, name: spec.name, source: { image: spec.image }, variables: spec.variables } },
  );
  const serviceId = serviceCreate.id;

  if (spec.volumeMountPath) {
    await gql(`mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }`, {
      input: { projectId, environmentId, serviceId, mountPath: spec.volumeMountPath },
    });
  }

  let url: string | undefined;
  if (spec.publicDomain) {
    const { serviceDomainCreate } = await gql<{ serviceDomainCreate: { domain: string } }>(
      `mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`,
      { input: { serviceId, environmentId } },
    );
    url = `https://${serviceDomainCreate.domain}`;
  }

  await gql(`mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }`, {
    serviceId,
    environmentId,
  });
  return { id: serviceId, url };
}

/** Scale to zero replicas (suspension for non-payment). Data volumes are kept. */
export async function setReplicas(serviceId: string, replicas: number): Promise<void> {
  await gql(
    `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
       serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }`,
    { serviceId, environmentId: config.RAILWAY_ENVIRONMENT_ID, input: { numReplicas: replicas } },
  );
  await gql(`mutation($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`, {
    serviceId,
    environmentId: config.RAILWAY_ENVIRONMENT_ID,
  });
}

export async function deleteService(serviceId: string): Promise<void> {
  await gql(`mutation($id: String!) { serviceDelete(id: $id) }`, { id: serviceId });
}
