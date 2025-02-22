import { z } from "zod";
import type { PrismaClient } from "~/db.server";
import { prisma } from "~/db.server";
import type { Organization } from "./organization.server";
import type { RuntimeEnvironment } from "./runtimeEnvironment.server";
import type { User } from "./user.server";
import type { Workflow } from "./workflow.server";
import { allStatuses } from "./workflowRunStatus";

const literals = allStatuses.map((s) => z.literal(s));
const statusSchema = z.union([literals[0], literals[1], ...literals.splice(2)]);

const SearchParamsSchema = z.object({
  page: z.coerce.number().default(1),
  statuses: z.preprocess((arg) => {
    if (arg === undefined || typeof arg !== "string") {
      return undefined;
    }
    const statuses = arg.split(",");
    if (statuses.length === 0) {
      return undefined;
    }
    return statuses;
  }, z.array(statusSchema).optional().default(allStatuses)),
});

export class WorkflowRunListPresenter {
  #prismaClient: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.#prismaClient = prismaClient;
  }

  async data({
    userId,
    organizationSlug,
    workflowSlug,
    environmentSlug,
    pageSize = 20,
    searchParams,
  }: {
    userId: User["id"];
    organizationSlug: Organization["slug"];
    workflowSlug: Workflow["slug"];
    environmentSlug: RuntimeEnvironment["slug"];
    pageSize?: number;
    searchParams: URLSearchParams;
  }) {
    const searchEntries = Object.fromEntries(searchParams.entries());
    const { page, statuses } = SearchParamsSchema.parse(searchEntries);

    const offset = (page - 1) * pageSize;
    const total = await this.#prismaClient.workflowRun.count({
      where: {
        workflow: {
          slug: workflowSlug,
        },
        environment: {
          slug: environmentSlug,
        },
        status: {
          in: statuses,
        },
      },
    });

    const runs = await this.#prismaClient.workflowRun.findMany({
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        isTest: true,
      },
      where: {
        status: {
          in: statuses,
        },
        environment: {
          slug: environmentSlug,
        },
        workflow: {
          slug: workflowSlug,
          organization: {
            slug: organizationSlug,
            users: {
              some: {
                id: userId,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: offset,
      take: pageSize,
    });

    return {
      runs,
      page,
      pageCount: Math.ceil(total / pageSize),
      total,
      filters: {
        statuses,
      },
      hasFilters: statuses.length !== allStatuses.length,
      pageSize,
    };
  }
}
