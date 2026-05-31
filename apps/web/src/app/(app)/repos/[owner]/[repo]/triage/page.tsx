import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getRepoIssuesPage } from "@/lib/github";
import { getIssueTriageAnalytics, getIssueTriageOverlays } from "@/lib/issue-triage-store";
import { IssueTriageBoard } from "@/components/issue/issue-triage-board";
import { fetchTriageIssuePage, saveIssueTriageOverlay } from "./actions";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
	const { owner, repo } = await params;
	return { title: `Triage · ${owner}/${repo}` };
}

export default async function TriagePage({
	params,
}: {
	params: Promise<{ owner: string; repo: string }>;
}) {
	const { owner, repo } = await params;
	const session = await auth.api.getSession({ headers: await headers() });
	const [{ openIssues, openPageInfo, openCount }, overlays, analytics] = await Promise.all([
		getRepoIssuesPage(owner, repo),
		session?.user?.id
			? getIssueTriageOverlays(session.user.id, owner, repo)
			: Promise.resolve([]),
		session?.user?.id
			? getIssueTriageAnalytics(session.user.id, owner, repo)
			: getIssueTriageAnalytics("__missing_user__"),
	]);

	return (
		<IssueTriageBoard
			owner={owner}
			repo={repo}
			initialIssues={openIssues}
			initialPageInfo={openPageInfo}
			openCount={openCount}
			initialOverlays={overlays}
			initialAnalytics={analytics}
			onFetchIssuePage={fetchTriageIssuePage}
			onSaveOverlay={saveIssueTriageOverlay}
		/>
	);
}
