import type { Authenticator } from "remix-auth";
import { GitHubStrategy } from "remix-auth-github";
import { env } from "~/env.server";
import { createFirstOrganization } from "~/models/organization.server";
import { findOrCreateUser } from "~/models/user.server";
import type { AuthUser } from "./authUser";
import { scheduleWelcomeEmail } from "./email.server";

const gitHubStrategy = new GitHubStrategy(
  {
    clientID: env.GITHUB_CLIENT_ID ?? "",
    clientSecret: env.GITHUB_SECRET ?? "",
    callbackURL: `${env.LOGIN_ORIGIN}/auth/github/callback`,
  },
  async ({ accessToken, extraParams, profile }) => {
    const emails = profile.emails;

    if (!emails) {
      throw new Error("GitHub login requires an email address");
    }

    try {
      const { user, isNewUser } = await findOrCreateUser({
        email: emails[0].value,
        authenticationMethod: "GITHUB",
        accessToken,
        authenticationProfile: profile,
        authenticationExtraParams: extraParams,
      });

      if (isNewUser) {
        await createFirstOrganization(user);
        await scheduleWelcomeEmail(user);
      }

      return {
        userId: user.id,
      };
    } catch (error) {
      console.error(error);
      throw error;
    }
  }
);

export function addGitHubStrategy(authenticator: Authenticator<AuthUser>) {
  authenticator.use(gitHubStrategy);
}
