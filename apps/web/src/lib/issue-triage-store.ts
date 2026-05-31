import { prisma } from "./db";

export type IssueTriageDifficulty = "simple" | "hard" | "delegate_ai";
export type IssueTriageV2Fit = "yes" | "maybe" | "no";
export type IssueTriageStatus = "untriaged" | "triaged" | "skipped";

export interface IssueTriageOverlay {
	id: string;
	userId: string;
	owner: string;
	repo: string;
	issueNumber: number;
	issueId: string | null;
	issueTitle: string;
	issueUrl: string | null;
	labels: Array<{ name?: string; color?: string | null }>;
	difficulty: IssueTriageDifficulty | null;
	v2Fit: IssueTriageV2Fit | null;
	categoryPaths: string[][];
	notes: string | null;
	status: IssueTriageStatus;
	triagedAt: string | null;
	skippedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface UpsertIssueTriageOverlayInput {
	userId: string;
	owner: string;
	repo: string;
	issueNumber: number;
	issueId?: number | string | bigint | null;
	issueTitle: string;
	issueUrl?: string | null;
	labels?: Array<{ name?: string; color?: string | null }>;
	difficulty?: IssueTriageDifficulty | null;
	v2Fit?: IssueTriageV2Fit | null;
	categoryPaths?: string[][];
	notes?: string | null;
	status?: IssueTriageStatus;
}

export interface IssueTriageAnalytics {
	overlays: IssueTriageOverlay[];
	summary: {
		total: number;
		triaged: number;
		skipped: number;
		delegateAi: number;
		simple: number;
		hard: number;
		v2Yes: number;
		v2Maybe: number;
		v2No: number;
	};
	categories: Array<{
		path: string;
		count: number;
		delegateAi: number;
		v2Candidates: number;
	}>;
	repos: Array<{ repo: string; count: number; triaged: number }>;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function normalizeCategoryPaths(paths: string[][] | undefined): string[][] {
	if (!paths) return [];
	const normalized = paths
		.map((path) => path.map((part) => part.trim().toLowerCase()).filter(Boolean))
		.filter((path) => path.length > 0);
	const seen = new Set<string>();
	return normalized.filter((path) => {
		const key = path.join("/");
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function toOverlay(row: {
	id: string;
	userId: string;
	owner: string;
	repo: string;
	issueNumber: number;
	issueId: bigint | null;
	issueTitle: string;
	issueUrl: string | null;
	labelsJson: string;
	difficulty: string | null;
	v2Fit: string | null;
	categoryPathsJson: string;
	notes: string | null;
	status: string;
	triagedAt: string | null;
	skippedAt: string | null;
	createdAt: string;
	updatedAt: string;
}): IssueTriageOverlay {
	return {
		...row,
		issueId: row.issueId?.toString() ?? null,
		labels: parseJson<Array<{ name?: string; color?: string | null }>>(
			row.labelsJson,
			[],
		),
		difficulty: row.difficulty as IssueTriageDifficulty | null,
		v2Fit: row.v2Fit as IssueTriageV2Fit | null,
		categoryPaths: parseJson<string[][]>(row.categoryPathsJson, []),
		status: row.status as IssueTriageStatus,
	};
}

export async function getIssueTriageOverlays(
	userId: string,
	owner: string,
	repo: string,
): Promise<IssueTriageOverlay[]> {
	const rows = await prisma.issueTriageOverlay.findMany({
		where: { userId, owner, repo },
		orderBy: { updatedAt: "desc" },
	});
	return rows.map(toOverlay);
}

export async function getIssueTriageOverlayMap(
	userId: string,
	owner: string,
	repo: string,
): Promise<Record<number, IssueTriageOverlay>> {
	const overlays = await getIssueTriageOverlays(userId, owner, repo);
	return Object.fromEntries(overlays.map((overlay) => [overlay.issueNumber, overlay]));
}

export async function upsertIssueTriageOverlay(
	input: UpsertIssueTriageOverlayInput,
): Promise<IssueTriageOverlay> {
	const now = new Date().toISOString();
	const categoryPaths = normalizeCategoryPaths(input.categoryPaths);
	const status = input.status ?? "triaged";
	const triagedAt = status === "triaged" ? now : null;
	const skippedAt = status === "skipped" ? now : null;
	const issueId = input.issueId == null ? null : BigInt(input.issueId);
	const row = await prisma.issueTriageOverlay.upsert({
		where: {
			userId_owner_repo_issueNumber: {
				userId: input.userId,
				owner: input.owner,
				repo: input.repo,
				issueNumber: input.issueNumber,
			},
		},
		create: {
			id: crypto.randomUUID(),
			userId: input.userId,
			owner: input.owner,
			repo: input.repo,
			issueNumber: input.issueNumber,
			issueId,
			issueTitle: input.issueTitle,
			issueUrl: input.issueUrl ?? null,
			labelsJson: JSON.stringify(input.labels ?? []),
			difficulty: input.difficulty ?? null,
			v2Fit: input.v2Fit ?? null,
			categoryPathsJson: JSON.stringify(categoryPaths),
			notes: input.notes?.trim() || null,
			status,
			triagedAt,
			skippedAt,
			createdAt: now,
			updatedAt: now,
		},
		update: {
			issueId,
			issueTitle: input.issueTitle,
			issueUrl: input.issueUrl ?? null,
			labelsJson: JSON.stringify(input.labels ?? []),
			difficulty: input.difficulty ?? null,
			v2Fit: input.v2Fit ?? null,
			categoryPathsJson: JSON.stringify(categoryPaths),
			notes: input.notes?.trim() || null,
			status,
			triagedAt: status === "triaged" ? now : undefined,
			skippedAt: status === "skipped" ? now : undefined,
			updatedAt: now,
		},
	});
	return toOverlay(row);
}

export async function getIssueTriageAnalytics(
	userId: string,
	owner?: string,
	repo?: string,
): Promise<IssueTriageAnalytics> {
	const overlays = (
		await prisma.issueTriageOverlay.findMany({
			where: {
				userId,
				...(owner && repo ? { owner, repo } : {}),
			},
			orderBy: { updatedAt: "desc" },
		})
	).map(toOverlay);

	const summary = overlays.reduce(
		(acc, overlay) => {
			acc.total += 1;
			if (overlay.status === "triaged") acc.triaged += 1;
			if (overlay.status === "skipped") acc.skipped += 1;
			if (overlay.difficulty === "delegate_ai") acc.delegateAi += 1;
			if (overlay.difficulty === "simple") acc.simple += 1;
			if (overlay.difficulty === "hard") acc.hard += 1;
			if (overlay.v2Fit === "yes") acc.v2Yes += 1;
			if (overlay.v2Fit === "maybe") acc.v2Maybe += 1;
			if (overlay.v2Fit === "no") acc.v2No += 1;
			return acc;
		},
		{
			total: 0,
			triaged: 0,
			skipped: 0,
			delegateAi: 0,
			simple: 0,
			hard: 0,
			v2Yes: 0,
			v2Maybe: 0,
			v2No: 0,
		},
	);

	const categoryMap = new Map<
		string,
		{ path: string; count: number; delegateAi: number; v2Candidates: number }
	>();
	const repoMap = new Map<string, { repo: string; count: number; triaged: number }>();

	for (const overlay of overlays) {
		const repoKey = `${overlay.owner}/${overlay.repo}`;
		const repoStats = repoMap.get(repoKey) ?? { repo: repoKey, count: 0, triaged: 0 };
		repoStats.count += 1;
		if (overlay.status === "triaged") repoStats.triaged += 1;
		repoMap.set(repoKey, repoStats);

		for (const path of overlay.categoryPaths) {
			const key = path.join("/");
			const stats = categoryMap.get(key) ?? {
				path: key,
				count: 0,
				delegateAi: 0,
				v2Candidates: 0,
			};
			stats.count += 1;
			if (overlay.difficulty === "delegate_ai") stats.delegateAi += 1;
			if (overlay.v2Fit === "yes" || overlay.v2Fit === "maybe") {
				stats.v2Candidates += 1;
			}
			categoryMap.set(key, stats);
		}
	}

	return {
		overlays,
		summary,
		categories: [...categoryMap.values()].sort((a, b) => b.count - a.count),
		repos: [...repoMap.values()].sort((a, b) => b.count - a.count),
	};
}
