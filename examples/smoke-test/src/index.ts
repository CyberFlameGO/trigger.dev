import { z } from "zod";
import { Trigger, customEvent, sendEvent } from "@trigger.dev/sdk";
import { ulid } from "ulid";

const userCreatedEvent = z.object({
  id: z.string(),
});

const trigger = new Trigger({
  id: "my-workflow",
  name: "My workflow",
  apiKey: "trigger_dev_zC25mKNn6c0q",
  endpoint: "ws://localhost:8889/ws",
  logLevel: "debug",
  on: customEvent({ name: "user.created", schema: userCreatedEvent }),
  run: async (event, ctx) => {
    await ctx.logger.info("Inside the smoke test workflow, received event", {
      event,
      myDate: new Date(),
    });

    await ctx.sendEvent("start-fire", {
      name: "smoke.test",
      payload: { baz: "banana" },
    });

    await sendEvent("start-fire-2", {
      name: "smoke.test2",
      payload: { baz: "banana2" },
    });

    return { foo: "bar" };
  },
});

trigger.listen();

(async () => {
  process.env.TRIGGER_API_KEY = "trigger_dev_zC25mKNn6c0q";
  process.env.TRIGGER_API_URL = "http://localhost:3000";
  await sendEvent(ulid(), {
    name: "user.created",
    payload: { id: "123" },
  });
})();
