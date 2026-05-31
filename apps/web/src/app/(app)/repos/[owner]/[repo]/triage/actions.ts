"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getRepoIssuesWithStats } from "@/lib/github";
import {
	getIssueTriageAnalytics,
	getIssueTriageOverlays,
	upsertIssueTriageOverlay,
	type IssueTriageDifficulty,
	type IssueTriageStatus,
	type IssueTriageV2Fit,
} from "@/lib/issue-triage-store";
import type { IssuesPageResult } from "@/lib/github";

export interface SaveIssueTriageInput {
	issueNumber: number;
	issueId?: number | string | null;
	issueTitle: string;
	issueUrl?: string | null;
	labels?: Array<{ name?: string; color?: string | null }>;
	difficulty?: IssueTriageDifficulty | null;
	v2Fit?: IssueTriageV2Fit | null;
	categoryPaths?: string[][];
	notes?: string | null;
	status?: IssueTriageStatus;
}

export async function fetchTriageIssuePage(
	owner: string,
	repo: string,
	cursor: string | null,
): Promise<{ issues: IssuesPageResult["issues"]; pageInfo: IssuesPageResult["pageInfo"] }> {
	const { issues, pageInfo } = await getRepoIssuesWithStats(owner, repo, "open", {
		perPage: 30,
		cursor,
	});
	return { issues, pageInfo };
}

export async function fetchTriageOverlays(owner: string, repo: string) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) return [];
	return getIssueTriageOverlays(session.user.id, owner, repo);
}

export async function fetchTriageAnalytics(owner: string, repo: string, scope: "repo" | "all") {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) {
		return getIssueTriageAnalytics("__missing_user__");
	}
	return getIssueTriageAnalytics(
		session.user.id,
		scope === "repo" ? owner : undefined,
		scope === "repo" ? repo : undefined,
	);
}

export async function saveIssueTriageOverlay(
	owner: string,
	repo: string,
	input: SaveIssueTriageInput,
) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) return { success: false, error: "Not authenticated" };

	const overlay = await upsertIssueTriageOverlay({
		userId: session.user.id,
		owner,
		repo,
		issueNumber: input.issueNumber,
		issueId: input.issueId ?? null,
		issueTitle: input.issueTitle,
		issueUrl: input.issueUrl ?? null,
		labels: input.labels ?? [],
		difficulty: input.difficulty ?? null,
		v2Fit: input.v2Fit ?? null,
		categoryPaths: input.categoryPaths ?? [],
		notes: input.notes ?? null,
		status: input.status ?? "triaged",
	});

	revalidatePath(`/${owner}/${repo}/triage`);
	return { success: true, overlay };
}
