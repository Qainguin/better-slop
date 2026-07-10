import { dash, sentinel } from "@better-auth/infra";
import { stripe } from "@better-auth/stripe";
import { createHash } from "@better-auth/utils/hash";
import { Octokit } from "@octokit/rest";
import { waitUntil } from "@vercel/functions";
import { all } from "better-all";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, oAuthProxy } from "better-auth/plugins";
import { headers } from "next/headers";
import { cache } from "react";

import { patSignIn } from "./auth-plugins/pat-signin";
import { grantSignupCredits } from "./billing/credit";
import { getStripeClient, isStripeEnabled } from "./billing/stripe";
import { prisma } from "./db";
import { redis } from "./redis";

async function getOctokitUser(token: string) {
	const hash = await createHash("SHA-256", "base64").digest(token);
	const cacheKey = `github_user:${hash}`;
	const cached =
		await redis.get<
			Awaited<ReturnType<(typeof octokit)["users"]["getAuthenticated"]>>["data"]
		>(cacheKey);
	if (cached) return cached;
	const octokit = new Octokit({ auth: token });
	const { data } = await octokit.users.getAuthenticated();
	waitUntil(redis.set(cacheKey, data, { ex: 3600 }));
	return data;
}

export const auth = betterAuth({
	appName: "Better Hub",
	database: prismaAdapter(prisma, {
		provider: "postgresql",
	}),
	experimental: {
		joins: true,
	},
	plugins: [
		dash({
			activityTracking: {
				enabled: true,
			},
		}),
		sentinel(),
		admin(),
		patSignIn(),
		...(isStripeEnabled
			? [
					stripe({
						stripeClient: getStripeClient(),
						stripeWebhookSecret:
							process.env.STRIPE_WEBHOOK_SECRET!,
						createCustomerOnSignUp: true,
						onCustomerCreate: async ({ user }) => {
							await grantSignupCredits(user.id);
						},
						subscription: {
							enabled: true,
							plans: [
								{
									name: "base",
									priceId: process.env
										.STRIPE_BASE_PRICE_ID!,
									lineItems: [
										{
											price: process
												.env
												.STRIPE_METERED_PRICE_ID!,
										},
									],
								},
							],
						},
					}),
				]
			: []),
		...(process.env.VERCEL
			? [oAuthProxy({ productionURL: "https://www.better-hub.com" })]
			: []),
	],
	user: {
		additionalFields: {
			githubPat: {
				type: "string",
				required: false,
			},
			onboardingDone: {
				type: "boolean",
				required: false,
			},
		},
		deleteUser: {
			enabled: true,
		},
	},
	account: {
		encryptOAuthTokens: true,
		//cache the account in the cookie
		storeAccountCookie: true,
		//to update scopes
		updateAccountOnSignIn: true,
	},
	socialProviders: {
		github: {
			clientId: process.env.GITHUB_CLIENT_ID!,
			clientSecret: process.env.GITHUB_CLIENT_SECRET!,
			// Minimal default — the sign-in UI lets users opt into more
			scope: ["read:user", "user:email", "public_repo"],
			async mapProfileToUser(profile) {
				return {
					githubLogin: profile.login,
				};
			},
		},
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 60 * 60 * 24 * 7,
			strategy: "jwe",
		},
	},
	trustedOrigins: [
		// Production
		"https://www.better-hub.com",
		// Vercel preview
		"https://better-hub-*-better-auth.vercel.app",
		// Beta site
		"https://beta.better-hub.com",
	],
	advanced: {
		ipAddress: {
			ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
		},
	},
});

export const getServerSession = cache(async () => {
	try {
		const { session, account } = await all({
			async session() {
				const session = await auth.api.getSession({
					headers: await headers(),
				});
				return session;
			},
			async account() {
				const session = await auth.api.getAccessToken({
					headers: await headers(),
					body: { providerId: "github" },
				});
				return session;
			},
		});
		if (!session || !account?.accessToken) {
			return null;
		}
		let githubUserData: Record<string, unknown> | null = null;
		try {
			const githubUser = await getOctokitUser(account.accessToken);
			githubUserData = githubUser ?? null;
		} catch {
			// GitHub API may be rate-limited; don't treat as unauthenticated.
		}
		if (!githubUserData) {
			return {
				user: session.user,
				session,
				githubUser: { accessToken: account.accessToken } as any,
			};
		}
		return {
			user: session.user,
			session,
			githubUser: {
				...githubUserData,
				accessToken: account.accessToken,
			},
		};
	} catch {
		return null;
	}
});

export type $Session = NonNullable<Awaited<ReturnType<typeof getServerSession>>>;
