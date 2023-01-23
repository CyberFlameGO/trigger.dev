import {
  AccessInfo,
  DisplayProperty,
  HandleWebhookOptions,
  WebhookConfig,
  WebhookIntegration,
} from "../types";
import { Webhooks } from "@octokit/webhooks";
import { z } from "zod";
import { github } from "@trigger.dev/providers";
import { getAccessToken } from "../accessInfo";

export class GitHubWebhookIntegration implements WebhookIntegration {
  keyForSource(source: unknown): string {
    const githubSource = parseWebhookSource(source);

    if (githubSource.subresource === "repository") {
      return `repository.${githubSource.repo}.${githubSource.events.join(".")}`;
    } else if (githubSource.subresource === "organization") {
      return `organization.${githubSource.org}`;
    } else {
      throw new Error(`Unknown subresource`);
    }
  }

  registerWebhook(config: WebhookConfig, source: unknown) {
    const githubSource = parseWebhookSource(source);

    if (githubSource.subresource === "repository") {
      return registerRepositoryWebhook(config, githubSource);
    } else if (githubSource.subresource === "organization") {
      return registerOrganizationWebhook(config, githubSource);
    } else {
      throw new Error(`Unknown subresource`);
    }
  }

  async handleWebhookRequest(options: HandleWebhookOptions) {
    const deliveryId = options.request.headers["x-github-delivery"];

    const signature = options.request.headers["x-hub-signature-256"];

    if (options.secret && signature) {
      const githubWebhooks = new Webhooks({
        secret: options.secret,
      });

      console.log(
        `[${deliveryId}] GitHubWebhookIntegration: Verifying signature ${signature}`
      );

      if (!githubWebhooks.verify(options.request.body, signature)) {
        return {
          status: "error" as const,
          error: `GitHubWebhookIntegration: Could not verify webhook payload, invalid signature or secret. [deliveryId = ${deliveryId}]]`,
        };
      }
    }

    const event = options.request.headers["x-github-event"];

    const context = omit(options.request.headers, [
      "x-github-event",
      "x-github-delivery",
      "x-hub-signature-256",
      "x-hub-signature",
      "content-type",
      "content-length",
      "accept",
      "accept-encoding",
      "x-forwarded-proto",
    ]);

    return {
      status: "ok" as const,
      data: [{ id: deliveryId, payload: options.request.body, event, context }],
    };
  }

  displayProperties(source: unknown) {
    const githubSource = parseWebhookSource(source);

    const title = `GitHub ${githubSource.events.join(", ")}`;
    let properties: DisplayProperty[] = [];

    switch (githubSource.subresource) {
      case "repository": {
        properties = [
          {
            key: "Repo",
            value: githubSource.repo,
          },
        ];
        break;
      }
      case "organization": {
        properties = [
          {
            key: "Organization",
            value: githubSource.org,
          },
        ];
        break;
      }
      default: {
        throw new Error(`Unknown subresource`);
      }
    }

    return { title, properties };
  }
}

export const webhooks = new GitHubWebhookIntegration();

async function registerRepositoryWebhook(
  config: WebhookConfig,
  source: z.infer<typeof github.schemas.WebhookRepoSourceSchema>
) {
  // Create the webhook in github
  const response = await fetch(
    `https://api.github.com/repos/${source.repo}/hooks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${getAccessToken(config.accessInfo)}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: source.events,
        config: {
          url: config.callbackUrl,
          content_type: "json",
          secret: config.secret,
          insecure_ssl: "0",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to register webhook: ${response.statusText}`);
  }

  const webhook = await response.json();

  return webhook;
}

async function registerOrganizationWebhook(
  config: WebhookConfig,
  source: z.infer<typeof github.schemas.WebhookOrganizationSourceSchema>
) {
  // Create the webhook in github
  const response = await fetch(
    `https://api.github.com/orgs/${source.org}/hooks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${getAccessToken(config.accessInfo)}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: source.events,
        config: {
          url: config.callbackUrl,
          content_type: "json",
          secret: config.secret,
          insecure_ssl: "0",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to register webhook: ${response.statusText}`);
  }

  const webhook = await response.json();

  return webhook;
}

function parseWebhookSource(source: unknown) {
  return github.schemas.WebhookSourceSchema.parse(source);
}

function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result: any = {};

  for (const key of Object.keys(obj)) {
    if (!keys.includes(key as K)) {
      result[key] = obj[key];
    }
  }

  return result;
}
