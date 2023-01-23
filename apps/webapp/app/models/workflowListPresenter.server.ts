import type { SchedulerSource } from ".prisma/client";
import { ScheduleSourceSchema } from "@trigger.dev/common-schemas";
import cronstrue from "cronstrue";
import type { DisplayProperties } from "internal-integrations";
import { airtable, github } from "internal-integrations";
import invariant from "tiny-invariant";
import { triggerLabel } from "~/components/triggers/triggerLabel";
import type { PrismaClient } from "~/db.server";
import { prisma } from "~/db.server";
import { getIntegration } from "~/utils/integrations";
import { getIntegrations } from "./integrations.server";
import { getRuntimeEnvironment } from "./runtimeEnvironment.server";
import type { ExternalSource, Workflow } from "./workflow.server";

export type WorkflowListItem = Awaited<
  ReturnType<WorkflowListPresenter["data"]>
>[number];

export class WorkflowListPresenter {
  #prismaClient: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.#prismaClient = prismaClient;
  }

  async data(organizationSlug: string, environmentSlug: string) {
    const organization = await this.#prismaClient.organization.findUnique({
      where: { slug: organizationSlug },
      select: { id: true },
    });
    invariant(organization, "Organization not found");

    const runtimeEnvironment = await getRuntimeEnvironment({
      organizationId: organization.id,
      slug: environmentSlug,
    });
    invariant(runtimeEnvironment, "Runtime environment not found");

    const workflows = await getWorkflows(
      this.#prismaClient,
      organizationSlug,
      runtimeEnvironment.id
    );
    const integrations = getIntegrations(true);

    return workflows.map((workflow) => {
      const lastRun =
        workflow.runs[0] === undefined
          ? undefined
          : {
              finishedAt: workflow.runs[0].finishedAt,
              status: workflow.runs[0].status,
            };

      return {
        id: workflow.id,
        title: workflow.title,
        slug: workflow.slug,
        status: workflow.status,
        trigger: triggerProperties(
          workflow,
          workflow.externalSource ?? undefined,
          workflow.schedulerSources[0] ?? undefined
        ),
        integrations: {
          source: workflow.service
            ? getIntegration(integrations, workflow.service)
            : undefined,
          services: workflow.externalServices.map((service) =>
            getIntegration(integrations, service.service)
          ),
        },
        lastRun,
      };
    });
  }
}

function getWorkflows(
  prismaClient: PrismaClient,
  organizationSlug: string,
  environmentId: string
) {
  return prismaClient.workflow.findMany({
    where: { organization: { slug: organizationSlug }, isArchived: false },
    include: {
      externalServices: {
        select: {
          service: true,
        },
      },
      externalSource: {
        select: {
          service: true,
          source: true,
        },
      },
      schedulerSources: {
        select: {
          schedule: true,
        },
        where: {
          environmentId,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      runs: {
        select: {
          finishedAt: true,
          status: true,
        },
        take: 1,
        orderBy: { finishedAt: { sort: "desc", nulls: "last" } },
      },
    },
    orderBy: [
      { disabledAt: { sort: "asc", nulls: "first" } },
      { title: "asc" },
    ],
  });
}

function triggerProperties(
  workflow: Pick<Workflow, "type" | "eventNames">,
  externalSource?: Pick<ExternalSource, "service" | "source">,
  schedulerSource?: Pick<SchedulerSource, "schedule">
): {
  type: Workflow["type"];
  typeTitle: string;
  title: string;
  properties?: DisplayProperties["properties"];
} {
  switch (workflow.type) {
    case "WEBHOOK": {
      invariant(externalSource, "External source is required for webhook");

      let displayProperties: DisplayProperties;
      switch (externalSource.service) {
        case "github":
          displayProperties = github.webhooks.displayProperties(
            externalSource.source
          );
          break;
        case "airtable":
          displayProperties = airtable.webhooks.displayProperties(
            externalSource.source
          );
          break;
        default:
          throw new Error(`Unsupported service ${externalSource.service}`);
      }

      return {
        type: workflow.type,
        typeTitle: "Webhook",
        title: displayProperties.title,
        properties: displayProperties.properties,
      };
    }
    case "SCHEDULE": {
      invariant(schedulerSource, "Scheduler source is required for schedule");
      const source = ScheduleSourceSchema.parse(schedulerSource.schedule);

      if ("rateOf" in source) {
        const unit =
          "minutes" in source.rateOf
            ? source.rateOf.minutes > 1
              ? "minutes"
              : "minute"
            : "hours" in source.rateOf
            ? source.rateOf.hours > 1
              ? "hours"
              : "hour"
            : source.rateOf.days > 1
            ? "days"
            : "day";

        const value =
          "minutes" in source.rateOf
            ? source.rateOf.minutes
            : "hours" in source.rateOf
            ? source.rateOf.hours
            : source.rateOf.days;

        return {
          type: workflow.type,
          typeTitle: "Schedule",
          title: `Every ${value} ${unit}`,
        };
      } else {
        return {
          type: workflow.type,
          typeTitle: "Schedule",
          title: cronstrue.toString(source.cron, {
            throwExceptionOnParseError: false,
            verbose: false,
            use24HourTimeFormat: true,
          }),
          properties: [{ key: "Cron Expression", value: source.cron }],
        };
      }
    }
    case "CUSTOM_EVENT":
      return {
        type: workflow.type,
        typeTitle: "Custom event",
        title: `on: ${workflow.eventNames.join(", ")}`,
      };
    default: {
      return {
        type: workflow.type,
        typeTitle: triggerLabel(workflow.type),
        title: workflow.type,
      };
    }
  }
}
