"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
	ArrowLeft,
	ArrowRight,
	BarChart3,
	Check,
	CheckCircle2,
	ChevronsRight,
	CircleDot,
	CircleOff,
	Clock,
	CornerDownLeft,
	ExternalLink,
	HelpCircle,
	Keyboard,
	Loader2,
	MessageSquare,
	Network,
	Pencil,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LabelBadge } from "@/components/shared/label-badge";
import { TimeAgo } from "@/components/ui/time-ago";
import { IssueCommentForm } from "@/components/issue/issue-comment-form";
import { IssueCommentsClient } from "@/components/issue/issue-comments-client";
import {
	addIssueComment,
	closeIssue,
	fetchIssueDetail,
	reopenIssue,
	type IssueDetailData,
} from "@/app/(app)/repos/[owner]/[repo]/issues/issue-actions";
import { useMutationEvents } from "@/components/shared/mutation-event-provider";
import type { IssuesPageResult, RepoIssueNode } from "@/lib/github";
import type {
	IssueTriageAnalytics,
	IssueTriageDifficulty,
	IssueTriageOverlay,
	IssueTriageStatus,
	IssueTriageV2Fit,
} from "@/lib/issue-triage-store";

const triageViews = ["queue", "map", "analytics"] as const;
const queueFilters = [
	"untriaged",
	"all",
	"delegate_ai",
	"simple",
	"hard",
	"v2",
	"skipped",
] as const;

const shortcutRows = [
	["1", "Effort: simple"],
	["2", "Effort: hard"],
	["3", "Effort: delegate AI"],
	["v", "v2: yes"],
	["m", "v2: maybe"],
	["n", "v2: no"],
	["c", "Focus tag input"],
	["Enter", "Complete and advance"],
	["s", "Skip"],
	["j / k", "Next / previous"],
	["?", "Shortcut help"],
];

type FetchIssuePageFn = (
	owner: string,
	repo: string,
	cursor: string | null,
) => Promise<{ issues: IssuesPageResult["issues"]; pageInfo: IssuesPageResult["pageInfo"] }>;

type SaveOverlayFn = (
	owner: string,
	repo: string,
	input: {
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
	},
) => Promise<{ success: boolean; overlay?: IssueTriageOverlay; error?: string }>;

type GitHubCloseReason = "completed" | "not_planned";
type CloseReason = GitHubCloseReason | "other";
type CategoryNode = {
	name: string;
	path: string[];
	count: number;
	children: Map<string, CategoryNode>;
};

function isTypingInField() {
	const el = document.activeElement;
	if (!el) return false;
	const tag = el.tagName.toLowerCase();
	return (
		tag === "input" ||
		tag === "textarea" ||
		tag === "select" ||
		el.hasAttribute("contenteditable")
	);
}

function issueUrl(owner: string, repo: string, issueNumber: number) {
	return `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
}

function formatCategoryPath(path: string[]) {
	return path.join("/");
}

function parseCategoryInput(input: string): string[] | null {
	const path = input
		.split("/")
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean);
	return path.length > 0 ? path : null;
}

function normalizeCategorySegment(input: string) {
	return input
		.trim()
		.toLowerCase()
		.replace(/^\/+|\/+$/g, "");
}

function pathStartsWith(path: string[], prefix: string[]) {
	return prefix.every((part, index) => path[index] === part);
}

function renameCategoryPaths(paths: string[][], oldPath: string[], newName: string) {
	return paths.map((path) => {
		if (!pathStartsWith(path, oldPath)) return path;
		const next = [...path];
		next[oldPath.length - 1] = newName;
		return next;
	});
}

function shortcutClass() {
	return "ml-1 text-[9px] font-mono text-muted-foreground/40";
}

function StatCard({
	label,
	value,
	accent,
}: {
	label: string;
	value: string | number;
	accent?: boolean;
}) {
	return (
		<div className="border border-dashed border-border/60 rounded-md px-3 py-2.5">
			<div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
				{label}
			</div>
			<div
				className={cn(
					"mt-1 text-sm font-medium tabular-nums",
					accent ? "text-success" : "text-foreground/80",
				)}
			>
				{value}
			</div>
		</div>
	);
}

function TogglePill({
	children,
	active,
	onClick,
	onMouseDown,
	hint,
}: {
	children: React.ReactNode;
	active?: boolean;
	onClick: () => void;
	onMouseDown?: React.MouseEventHandler<HTMLButtonElement>;
	hint?: string;
}) {
	return (
		<button
			onClick={onClick}
			onMouseDown={onMouseDown}
			className={cn(
				"px-2.5 py-1 text-[10px] font-mono rounded-sm transition-colors cursor-pointer border",
				active
					? "border-foreground/20 bg-foreground/8 text-foreground"
					: "border-border/40 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 dark:hover:bg-white/4",
			)}
		>
			{children}
			{hint && <span className={shortcutClass()}>{hint}</span>}
		</button>
	);
}

function CategoryBubble({
	node,
	depth = 0,
	selectedPath,
	onSelect,
	onStartRename,
}: {
	node: CategoryNode;
	depth?: number;
	selectedPath: string;
	onSelect: (path: string[]) => void;
	onStartRename: (path: string[]) => void;
}) {
	const children = [...node.children.values()].sort((a, b) => b.count - a.count);
	const path = formatCategoryPath(node.path);
	const selected = selectedPath === path;
	const size = Math.max(
		depth === 0 ? 190 : 92,
		Math.min(depth === 0 ? 360 : 220, 96 + node.count * 8 + children.length * 18),
	);
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={(event) => {
				event.stopPropagation();
				onSelect(node.path);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onSelect(node.path);
				}
			}}
			className={cn(
				"rounded-full border transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 p-4 text-center shrink-0",
				selected
					? "border-foreground/40 bg-muted/60"
					: "border-border/60 hover:border-foreground/25 hover:bg-muted/30",
			)}
			style={{ width: size, minHeight: size }}
		>
			<div className="flex items-center gap-1.5">
				<span
					className={cn(
						depth === 0 ? "text-sm" : "text-xs",
						"font-medium",
					)}
				>
					{node.name}
				</span>
				<button
					onClick={(event) => {
						event.stopPropagation();
						onStartRename(node.path);
					}}
					className="p-1 rounded-sm text-muted-foreground/50 hover:text-foreground hover:bg-background/60 transition-colors cursor-pointer"
					title={`Rename ${path}`}
				>
					<Pencil className="w-3 h-3" />
				</button>
			</div>
			<span className="text-[10px] font-mono text-muted-foreground/60">
				{node.count} issues
			</span>
			{children.length > 0 && (
				<div className="flex flex-wrap gap-2 justify-center mt-1">
					{children.map((child) => (
						<CategoryBubble
							key={formatCategoryPath(child.path)}
							node={child}
							depth={depth + 1}
							selectedPath={selectedPath}
							onSelect={onSelect}
							onStartRename={onStartRename}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function buildTriageAnalytics(overlays: IssueTriageOverlay[]): IssueTriageAnalytics {
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
			const key = formatCategoryPath(path);
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

export function IssueTriageBoard({
	owner,
	repo,
	initialIssues,
	initialPageInfo,
	openCount,
	initialOverlays,
	initialAnalytics,
	onFetchIssuePage,
	onSaveOverlay,
}: {
	owner: string;
	repo: string;
	initialIssues: RepoIssueNode[];
	initialPageInfo: IssuesPageResult["pageInfo"];
	openCount: number;
	initialOverlays: IssueTriageOverlay[];
	initialAnalytics: IssueTriageAnalytics;
	onFetchIssuePage: FetchIssuePageFn;
	onSaveOverlay: SaveOverlayFn;
}) {
	const [view, setView] = useQueryState(
		"view",
		parseAsStringLiteral(triageViews).withDefault("queue"),
	);
	const [filter, setFilter] = useQueryState(
		"filter",
		parseAsStringLiteral(queueFilters).withDefault("untriaged"),
	);
	const [search, setSearch] = useQueryState("q", parseAsString.withDefault(""));
	const [selectedCategory, setSelectedCategory] = useQueryState(
		"category",
		parseAsString.withDefault(""),
	);
	const [issueParam, setIssueParam] = useQueryState("issue", parseAsInteger);

	const [issues, setIssues] = useState(initialIssues);
	const [pageInfo, setPageInfo] = useState(initialPageInfo);
	const [overlays, setOverlays] = useState<Record<number, IssueTriageOverlay>>(() =>
		Object.fromEntries(
			initialOverlays.map((overlay) => [overlay.issueNumber, overlay]),
		),
	);
	const [analytics, setAnalytics] = useState(initialAnalytics);
	const [isPending, startTransition] = useTransition();
	const [isFetchingMore, setIsFetchingMore] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [detail, setDetail] = useState<IssueDetailData | null>(null);
	const [isLoadingDetail, setIsLoadingDetail] = useState(false);
	const [isIssueAreaScrolled, setIsIssueAreaScrolled] = useState(false);
	const [interactionMessage, setInteractionMessage] = useState("");
	const [closeReason, setCloseReason] = useState<CloseReason>("completed");
	const [interactionError, setInteractionError] = useState<string | null>(null);
	const [interactionNotice, setInteractionNotice] = useState<string | null>(null);
	const [isInteractionPending, startInteractionTransition] = useTransition();
	const [isMapPending, startMapTransition] = useTransition();
	const { emit } = useMutationEvents();

	const categoryInputRef = useRef<HTMLInputElement>(null);
	const [difficulty, setDifficulty] = useState<IssueTriageDifficulty | null>(null);
	const [v2Fit, setV2Fit] = useState<IssueTriageV2Fit | null>(null);
	const [categoryInput, setCategoryInput] = useState("");
	const [notes, setNotes] = useState("");
	const [renamingPath, setRenamingPath] = useState<string[] | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [renameError, setRenameError] = useState<string | null>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const triageRailRef = useRef<HTMLDivElement>(null);
	const [railStickyTop, setRailStickyTop] = useState(180);

	const overlayList = useMemo(() => Object.values(overlays), [overlays]);
	const currentCategoryPath = useMemo(
		() => parseCategoryInput(categoryInput),
		[categoryInput],
	);
	const currentCategoryPaths = useMemo(
		() => (currentCategoryPath ? [currentCategoryPath] : []),
		[currentCategoryPath],
	);
	const categorySuggestions = useMemo(() => {
		const tagCounts = new Map<string, number>();
		for (const overlay of overlayList) {
			for (const path of overlay.categoryPaths) {
				const tag = formatCategoryPath(path);
				tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			}
		}

		const normalizedQuery = currentCategoryPath
			? formatCategoryPath(currentCategoryPath)
			: categoryInput
					.trim()
					.toLowerCase()
					.replace(/^\/+|\/+$/g, "");

		return [...tagCounts.entries()]
			.filter(([tag]) => {
				if (tag === normalizedQuery) return false;
				return normalizedQuery ? tag.startsWith(normalizedQuery) : true;
			})
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, 6)
			.map(([tag]) => tag);
	}, [categoryInput, currentCategoryPath, overlayList]);
	const triagedCount = overlayList.filter((overlay) => overlay.status === "triaged").length;
	const skippedCount = overlayList.filter((overlay) => overlay.status === "skipped").length;
	const delegateCount = overlayList.filter(
		(overlay) => overlay.difficulty === "delegate_ai",
	).length;
	const v2CandidateCount = overlayList.filter(
		(overlay) => overlay.v2Fit === "yes" || overlay.v2Fit === "maybe",
	).length;

	const filteredIssues = useMemo(() => {
		const q = search.trim().toLowerCase();
		return issues.filter((issue) => {
			const overlay = overlays[issue.number];
			if (q) {
				const labelMatch = issue.labels.some((label) =>
					label.name?.toLowerCase().includes(q),
				);
				const categoryMatch = overlay?.categoryPaths.some((path) =>
					formatCategoryPath(path).includes(q),
				);
				if (
					!issue.title.toLowerCase().includes(q) &&
					!issue.user?.login.toLowerCase().includes(q) &&
					!String(issue.number).includes(q) &&
					!labelMatch &&
					!categoryMatch
				) {
					return false;
				}
			}
			if (selectedCategory) {
				const selected = selectedCategory;
				if (
					!overlay?.categoryPaths.some((path) =>
						formatCategoryPath(path).startsWith(selected),
					)
				) {
					return false;
				}
			}
			switch (filter) {
				case "all":
					return true;
				case "delegate_ai":
					return overlay?.difficulty === "delegate_ai";
				case "simple":
					return overlay?.difficulty === "simple";
				case "hard":
					return overlay?.difficulty === "hard";
				case "v2":
					return (
						overlay?.v2Fit === "yes" ||
						overlay?.v2Fit === "maybe"
					);
				case "skipped":
					return overlay?.status === "skipped";
				default:
					return !overlay || overlay.status === "untriaged";
			}
		});
	}, [filter, issues, overlays, search, selectedCategory]);

	const currentIndex = Math.max(
		0,
		filteredIssues.findIndex((issue) => issue.number === issueParam),
	);
	const currentIssue = filteredIssues[currentIndex] ?? filteredIssues[0] ?? issues[0] ?? null;
	const currentOverlay = currentIssue ? overlays[currentIssue.number] : null;

	useEffect(() => {
		if (!currentIssue) return;
		if (issueParam !== currentIssue.number) {
			setIssueParam(currentIssue.number);
		}
	}, [currentIssue, issueParam, setIssueParam]);

	useEffect(() => {
		if (!currentIssue) return;
		setDifficulty(currentOverlay?.difficulty ?? null);
		setV2Fit(currentOverlay?.v2Fit ?? "no");
		setCategoryInput(
			currentOverlay?.categoryPaths[0]
				? formatCategoryPath(currentOverlay.categoryPaths[0])
				: "",
		);
		setNotes(currentOverlay?.notes ?? "");
		setInteractionMessage("");
		setCloseReason("completed");
		setInteractionError(null);
		setInteractionNotice(null);
	}, [currentIssue, currentOverlay]);

	useEffect(() => {
		let cancelled = false;
		if (!currentIssue) return;
		setIsLoadingDetail(true);
		setDetail(null);
		fetchIssueDetail(owner, repo, currentIssue.number)
			.then((result) => {
				if (!cancelled) setDetail(result);
			})
			.finally(() => {
				if (!cancelled) setIsLoadingDetail(false);
			});
		return () => {
			cancelled = true;
		};
	}, [currentIssue, owner, repo]);

	useEffect(() => {
		let frame = 0;
		let scrollParent: HTMLElement | null = null;
		const getScrollParent = (el: Element | null) => {
			let ancestor = el?.parentElement ?? null;
			while (ancestor) {
				const style = window.getComputedStyle(ancestor);
				if (
					/(auto|scroll|hidden|clip)/.test(style.overflowY) ||
					ancestor.scrollHeight > ancestor.clientHeight
				) {
					return ancestor;
				}
				ancestor = ancestor.parentElement;
			}
			return null;
		};
		const updateLayout = () => {
			if (frame) cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const toolbar = toolbarRef.current;
				const rail = triageRailRef.current;
				if (!toolbar || !rail) return;
				scrollParent = getScrollParent(rail);
				const toolbarRect = toolbar.getBoundingClientRect();
				const scrollParentRect = scrollParent?.getBoundingClientRect();
				const scrollParentStyle = scrollParent
					? window.getComputedStyle(scrollParent)
					: null;
				const scrollParentPaddingTop = scrollParentStyle
					? parseFloat(scrollParentStyle.paddingTop) || 0
					: 0;
				const nextRailStickyTop = Math.max(
					0,
					Math.ceil(
						toolbarRect.bottom -
							(scrollParentRect?.top ?? 0) -
							scrollParentPaddingTop,
					),
				);
				setRailStickyTop((prev) =>
					Math.abs(prev - nextRailStickyTop) > 1
						? nextRailStickyTop
						: prev,
				);
				setIsIssueAreaScrolled(
					(scrollParent?.scrollTop ?? window.scrollY) > 0,
				);
			});
		};

		updateLayout();
		scrollParent = getScrollParent(triageRailRef.current);
		scrollParent?.addEventListener("scroll", updateLayout, { passive: true });
		window.addEventListener("resize", updateLayout);
		const resizeObserver = new ResizeObserver(updateLayout);
		if (toolbarRef.current) resizeObserver.observe(toolbarRef.current);

		return () => {
			if (frame) cancelAnimationFrame(frame);
			scrollParent?.removeEventListener("scroll", updateLayout);
			window.removeEventListener("resize", updateLayout);
			resizeObserver.disconnect();
		};
	}, [currentIssue, showShortcuts, view]);

	const fetchMore = useCallback(async () => {
		if (!pageInfo.hasNextPage || isFetchingMore) return [];
		setIsFetchingMore(true);
		try {
			const result = await onFetchIssuePage(owner, repo, pageInfo.endCursor);
			setIssues((prev) => {
				const seen = new Set(prev.map((issue) => issue.number));
				return [
					...prev,
					...result.issues.filter((issue) => !seen.has(issue.number)),
				];
			});
			setPageInfo(result.pageInfo);
			return result.issues;
		} finally {
			setIsFetchingMore(false);
		}
	}, [isFetchingMore, onFetchIssuePage, owner, pageInfo, repo]);

	const refreshCurrentDetail = useCallback(async () => {
		if (!currentIssue) return;
		const nextDetail = await fetchIssueDetail(owner, repo, currentIssue.number);
		setDetail(nextDetail);
	}, [currentIssue, owner, repo]);

	const goToIssueAt = useCallback(
		async (index: number) => {
			if (filteredIssues[index]) {
				await setIssueParam(filteredIssues[index].number);
				return;
			}
			if (index >= filteredIssues.length && pageInfo.hasNextPage) {
				const loadedIssues = await fetchMore();
				if (loadedIssues.length > 0) {
					const nextIssue = loadedIssues[0];
					if (nextIssue) await setIssueParam(nextIssue.number);
				}
			}
		},
		[fetchMore, filteredIssues, pageInfo.hasNextPage, setIssueParam],
	);

	const goNext = useCallback(() => {
		startTransition(() => {
			void goToIssueAt(currentIndex + 1);
		});
	}, [currentIndex, goToIssueAt]);

	const goPrevious = useCallback(() => {
		startTransition(() => {
			void goToIssueAt(Math.max(0, currentIndex - 1));
		});
	}, [currentIndex, goToIssueAt]);

	const normalizeCategoryInput = useCallback(() => {
		const path = parseCategoryInput(categoryInput);
		setCategoryInput(path ? formatCategoryPath(path) : "");
	}, [categoryInput]);

	const saveCurrent = useCallback(
		async (status: IssueTriageStatus = "triaged", advance = true) => {
			if (!currentIssue) return;
			setSaveError(null);
			const result = await onSaveOverlay(owner, repo, {
				issueNumber: currentIssue.number,
				issueId: currentIssue.id,
				issueTitle: currentIssue.title,
				issueUrl: issueUrl(owner, repo, currentIssue.number),
				labels: currentIssue.labels,
				difficulty,
				v2Fit,
				categoryPaths: currentCategoryPaths,
				notes,
				status,
			});
			if (!result.success || !result.overlay) {
				setSaveError(result.error ?? "Failed to save triage");
				return;
			}
			setOverlays((prev) => ({
				...prev,
				[result.overlay!.issueNumber]: result.overlay!,
			}));
			setAnalytics((prev) => {
				const overlays = [
					result.overlay!,
					...prev.overlays.filter(
						(overlay) => overlay.id !== result.overlay!.id,
					),
				];
				return buildTriageAnalytics(overlays);
			});
			if (advance) goNext();
		},
		[
			currentCategoryPaths,
			currentIssue,
			difficulty,
			goNext,
			notes,
			onSaveOverlay,
			owner,
			repo,
			v2Fit,
		],
	);

	const markCurrentIssueClosed = useCallback(
		async (reason: GitHubCloseReason) => {
			if (!currentIssue) return;
			setDetail((prev) =>
				prev
					? {
							...prev,
							issue: {
								...prev.issue,
								state: "closed",
								state_reason: reason,
								closed_at: new Date().toISOString(),
							},
							canClose: false,
						}
					: prev,
			);
			emit({ type: "issue:closed", owner, repo, number: currentIssue.number });
			await saveCurrent("triaged", false);
			const nextIssue =
				filteredIssues[currentIndex + 1] ??
				filteredIssues[currentIndex - 1] ??
				null;
			setIssues((prev) =>
				prev.filter((issue) => issue.number !== currentIssue.number),
			);
			if (nextIssue) {
				await setIssueParam(nextIssue.number);
			}
		},
		[
			currentIndex,
			currentIssue,
			emit,
			filteredIssues,
			owner,
			repo,
			saveCurrent,
			setIssueParam,
		],
	);

	const submitIssueInteraction = useCallback(
		(action: "comment" | "close" | "reopen") => {
			if (!currentIssue) return;
			const message = interactionMessage.trim();
			setInteractionError(null);
			setInteractionNotice(null);
			startInteractionTransition(async () => {
				if (action === "comment") {
					if (!message) {
						setInteractionError(
							"Write a message before commenting.",
						);
						return;
					}
					const result = await addIssueComment(
						owner,
						repo,
						currentIssue.number,
						message,
					);
					if (result.error) {
						setInteractionError(result.error);
						return;
					}
					setInteractionMessage("");
					setInteractionNotice("Comment posted.");
					emit({
						type: "issue:commented",
						owner,
						repo,
						number: currentIssue.number,
					});
					await refreshCurrentDetail();
					return;
				}

				if (action === "close") {
					const githubCloseReason =
						closeReason === "completed"
							? "completed"
							: "not_planned";
					const result = await closeIssue(
						owner,
						repo,
						currentIssue.number,
						githubCloseReason,
						message || undefined,
					);
					if (result.error) {
						setInteractionError(result.error);
						return;
					}
					setInteractionMessage("");
					setInteractionNotice(
						githubCloseReason === "completed"
							? "Issue closed as completed."
							: closeReason === "other"
								? "Issue closed."
								: "Issue closed as not planned.",
					);
					await markCurrentIssueClosed(githubCloseReason);
					return;
				}

				const result = await reopenIssue(
					owner,
					repo,
					currentIssue.number,
					message || undefined,
				);
				if (result.error) {
					setInteractionError(result.error);
					return;
				}
				setInteractionMessage("");
				setInteractionNotice("Issue reopened.");
				emit({
					type: "issue:reopened",
					owner,
					repo,
					number: currentIssue.number,
				});
				await refreshCurrentDetail();
			});
		},
		[
			closeReason,
			currentIssue,
			emit,
			interactionMessage,
			markCurrentIssueClosed,
			owner,
			refreshCurrentDetail,
			repo,
		],
	);

	const handleHotkey = useCallback((action: () => void | Promise<void>) => {
		if (isTypingInField()) return;
		void action();
	}, []);

	useHotkey("1", () => handleHotkey(() => setDifficulty("simple")));
	useHotkey("2", () => handleHotkey(() => setDifficulty("hard")));
	useHotkey("3", () => handleHotkey(() => setDifficulty("delegate_ai")));
	useHotkey("V", () => handleHotkey(() => setV2Fit("yes")));
	useHotkey("M", () => handleHotkey(() => setV2Fit("maybe")));
	useHotkey("N", () => handleHotkey(() => setV2Fit("no")));
	useHotkey("C", () => handleHotkey(() => categoryInputRef.current?.focus()));
	useHotkey("Enter", () => handleHotkey(() => saveCurrent("triaged", true)));
	useHotkey("S", () => handleHotkey(() => saveCurrent("skipped", true)));
	useHotkey("J", () => handleHotkey(goNext));
	useHotkey("K", () => handleHotkey(goPrevious));
	useHotkey({ key: "?" }, () => {
		if (isTypingInField()) return;
		setShowShortcuts((v) => !v);
	});

	const categoryTree = useMemo(() => {
		const root = new Map<string, CategoryNode>();
		for (const overlay of overlayList) {
			for (const path of overlay.categoryPaths) {
				let level = root;
				let currentPath: string[] = [];
				for (const part of path) {
					currentPath = [...currentPath, part];
					const node = level.get(part) ?? {
						name: part,
						path: currentPath,
						count: 0,
						children: new Map(),
					};
					node.count += 1;
					level.set(part, node);
					level = node.children;
				}
			}
		}
		return [...root.values()].sort((a, b) => b.count - a.count);
	}, [overlayList]);

	const startRenameCategory = useCallback((path: string[]) => {
		setRenamingPath(path);
		setRenameValue(path[path.length - 1] ?? "");
		setRenameError(null);
	}, []);

	const applyCategoryRename = useCallback(() => {
		if (!renamingPath) return;
		const nextName = normalizeCategorySegment(renameValue);
		if (!nextName) {
			setRenameError("Enter a category name.");
			return;
		}
		const previousName = renamingPath[renamingPath.length - 1];
		if (nextName === previousName) {
			setRenamingPath(null);
			setRenameError(null);
			return;
		}

		const affected = overlayList.filter((overlay) =>
			overlay.categoryPaths.some((path) => pathStartsWith(path, renamingPath)),
		);
		if (affected.length === 0) {
			setRenameError("No saved issues use this category.");
			return;
		}

		setRenameError(null);
		startMapTransition(async () => {
			const saved: IssueTriageOverlay[] = [];
			for (const overlay of affected) {
				const nextCategoryPaths = renameCategoryPaths(
					overlay.categoryPaths,
					renamingPath,
					nextName,
				);
				const result = await onSaveOverlay(owner, repo, {
					issueNumber: overlay.issueNumber,
					issueId: overlay.issueId,
					issueTitle: overlay.issueTitle,
					issueUrl: overlay.issueUrl,
					labels: overlay.labels,
					difficulty: overlay.difficulty,
					v2Fit: overlay.v2Fit,
					categoryPaths: nextCategoryPaths,
					notes: overlay.notes,
					status: overlay.status,
				});
				if (!result.success || !result.overlay) {
					setRenameError(
						result.error ?? "Failed to rename category.",
					);
					return;
				}
				saved.push(result.overlay);
			}
			let nextOverlayState: Record<number, IssueTriageOverlay> | null = null;
			setOverlays((prev) => {
				const next = { ...prev };
				for (const overlay of saved) {
					next[overlay.issueNumber] = overlay;
				}
				nextOverlayState = next;
				return next;
			});
			if (nextOverlayState) {
				setAnalytics(buildTriageAnalytics(Object.values(nextOverlayState)));
			}
			const nextSelected =
				selectedCategory &&
				pathStartsWith(selectedCategory.split("/"), renamingPath)
					? formatCategoryPath(
							renameCategoryPaths(
								[selectedCategory.split("/")],
								renamingPath,
								nextName,
							)[0],
						)
					: selectedCategory;
			setSelectedCategory(nextSelected);
			setRenamingPath(null);
		});
	}, [
		onSaveOverlay,
		overlayList,
		owner,
		renameValue,
		renamingPath,
		repo,
		selectedCategory,
		setSelectedCategory,
	]);

	return (
		<div className="flex flex-col min-h-0">
			<div
				ref={toolbarRef}
				className="sticky top-0 z-30 bg-background pb-3 pt-4 transition-shadow before:content-[''] before:absolute before:left-0 before:right-0 before:bottom-full before:h-8 before:bg-background"
			>
				<div className="flex flex-col gap-3">
					<div className="flex flex-col lg:flex-row lg:items-center gap-2">
						<div className="relative flex-1 max-w-xl">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
							<input
								value={search}
								onChange={(e) =>
									setSearch(e.target.value)
								}
								placeholder="Search queue..."
								className="w-full h-8 bg-transparent border border-border rounded-sm pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-foreground/20 transition-colors"
							/>
						</div>
						<div className="flex items-center gap-2 flex-wrap">
							{triageViews.map((item) => (
								<TogglePill
									key={item}
									active={view === item}
									onClick={() =>
										setView(item)
									}
								>
									{item === "queue" &&
										"Queue"}
									{item === "map" && "Map"}
									{item === "analytics" &&
										"Analytics"}
								</TogglePill>
							))}
							<TogglePill
								active={showShortcuts}
								onClick={() =>
									setShowShortcuts((v) => !v)
								}
								hint="?"
							>
								<Keyboard className="inline w-3 h-3 mr-1" />
								Keys
							</TogglePill>
						</div>
					</div>
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
						<StatCard
							label="Triaged"
							value={triagedCount}
							accent
						/>
						<StatCard
							label="Remaining"
							value={Math.max(
								0,
								openCount -
									triagedCount -
									skippedCount,
							)}
						/>
						<StatCard
							label="Queue"
							value={
								currentIssue
									? `${currentIndex + 1}/${filteredIssues.length}`
									: "0/0"
							}
						/>
						<StatCard
							label="AI Delegatable"
							value={delegateCount}
						/>
						<StatCard
							label="v2 Candidates"
							value={v2CandidateCount}
						/>
						<StatCard label="Skipped" value={skippedCount} />
					</div>
					<div className="flex items-center gap-2 flex-wrap">
						{queueFilters.map((item) => (
							<TogglePill
								key={item}
								active={filter === item}
								onClick={() => setFilter(item)}
							>
								{item.replace("_", " ")}
							</TogglePill>
						))}
						{selectedCategory && (
							<button
								onClick={() =>
									setSelectedCategory("")
								}
								className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
							>
								<X className="w-3 h-3" />
								{selectedCategory}
							</button>
						)}
					</div>
				</div>
			</div>

			{showShortcuts && (
				<div className="mb-3 border border-border/60 rounded-md p-3 bg-muted/20">
					<div className="flex items-center gap-2 mb-2">
						<HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
						<span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
							Keyboard shortcuts
						</span>
					</div>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
						{shortcutRows.map(([key, label]) => (
							<div
								key={key}
								className="flex items-center gap-2 text-[11px]"
							>
								<kbd className="min-w-7 text-center px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px]">
									{key}
								</kbd>
								<span className="text-muted-foreground">
									{label}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{view === "queue" && currentIssue && (
				<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
					<div className="relative border border-border rounded-md min-w-0">
						{isIssueAreaScrolled && (
							<div className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-10 bg-gradient-to-b from-background via-background/80 to-transparent" />
						)}
						<div className="px-4 py-3 border-b border-border/60">
							<div className="flex items-start gap-3">
								<CircleDot className="w-4 h-4 text-success mt-1 shrink-0" />
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 flex-wrap mb-2">
										<Link
											href={`/${owner}/${repo}/issues/${currentIssue.number}`}
											className="text-[11px] font-mono text-muted-foreground/60 hover:text-foreground"
										>
											{owner}/
											{repo}#
											{
												currentIssue.number
											}
										</Link>
										<span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
											<Clock className="w-3 h-3" />
											<TimeAgo
												date={
													currentIssue.updated_at
												}
											/>
										</span>
										<span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
											<MessageSquare className="w-3 h-3" />
											{
												currentIssue.comments
											}
										</span>
									</div>
									<h1 className="text-xl font-medium tracking-tight">
										{currentIssue.title}
									</h1>
									<div className="flex items-center gap-2 flex-wrap mt-3">
										{currentIssue.labels.map(
											(label) => (
												<LabelBadge
													key={
														label.name
													}
													label={
														label
													}
												/>
											),
										)}
									</div>
								</div>
								{currentIssue.user && (
									<Image
										src={
											currentIssue
												.user
												.avatar_url
										}
										alt={
											currentIssue
												.user
												.login
										}
										width={32}
										height={32}
										className="rounded-full"
									/>
								)}
							</div>
						</div>
						<div className="p-10">
							<div className="max-w-[1280px] mx-auto">
								{isLoadingDetail ? (
									<div className="space-y-3 animate-pulse">
										<div className="h-4 bg-muted/50 rounded w-3/4" />
										<div className="h-4 bg-muted/40 rounded w-full" />
										<div className="h-4 bg-muted/40 rounded w-2/3" />
									</div>
								) : detail ? (
									<div className="space-y-3">
										<IssueCommentsClient
											owner={
												owner
											}
											repo={repo}
											issueNumber={
												detail
													.issue
													.number
											}
											initialComments={
												detail.comments
											}
											descriptionEntry={
												detail.descriptionEntry
											}
											canEdit={
												detail.canEditIssue
											}
											issueTitle={
												detail
													.issue
													.title
											}
											currentUserLogin={
												detail.currentUserLogin
											}
											viewerHasWriteAccess={
												detail.viewerHasWriteAccess
											}
											timelineEvents={
												detail.timelineEvents
											}
										/>
										<div className="mt-6 pt-4">
											<IssueCommentForm
												owner={
													owner
												}
												repo={
													repo
												}
												issueNumber={
													detail
														.issue
														.number
												}
												issueState={
													detail
														.issue
														.state
												}
												canClose={
													detail.canClose
												}
												canReopen={
													detail.canReopen
												}
												userAvatarUrl={
													detail.userAvatarUrl
												}
												userName={
													detail.userName
												}
												participants={
													detail.participants
												}
											/>
										</div>
									</div>
								) : (
									<p className="text-sm text-muted-foreground/60 font-mono">
										No issue body.
									</p>
								)}
							</div>
						</div>
					</div>

					<div
						ref={triageRailRef}
						className="xl:sticky h-fit space-y-4"
						style={{ top: railStickyTop }}
					>
						<div className="border border-border rounded-md">
							<div className="px-3 py-2.5 border-b border-border/60 flex items-center justify-between">
								<span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
									Triage rail
								</span>
								{isPending && (
									<Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
								)}
							</div>
							<div className="p-3 space-y-4">
								<div>
									<div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
										Effort
									</div>
									<div className="flex flex-wrap gap-1.5">
										<TogglePill
											active={
												difficulty ===
												"simple"
											}
											onClick={() =>
												setDifficulty(
													"simple",
												)
											}
											hint="1"
										>
											Simple
										</TogglePill>
										<TogglePill
											active={
												difficulty ===
												"hard"
											}
											onClick={() =>
												setDifficulty(
													"hard",
												)
											}
											hint="2"
										>
											Hard
										</TogglePill>
										<TogglePill
											active={
												difficulty ===
												"delegate_ai"
											}
											onClick={() =>
												setDifficulty(
													"delegate_ai",
												)
											}
											hint="3"
										>
											Delegate AI
										</TogglePill>
									</div>
								</div>

								<div>
									<div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
										v2 Fit
									</div>
									<div className="flex flex-wrap gap-1.5">
										<TogglePill
											active={
												v2Fit ===
												"yes"
											}
											onClick={() =>
												setV2Fit(
													"yes",
												)
											}
											hint="v"
										>
											Yes
										</TogglePill>
										<TogglePill
											active={
												v2Fit ===
												"maybe"
											}
											onClick={() =>
												setV2Fit(
													"maybe",
												)
											}
											hint="m"
										>
											Maybe
										</TogglePill>
										<TogglePill
											active={
												v2Fit ===
												"no"
											}
											onClick={() =>
												setV2Fit(
													"no",
												)
											}
											hint="n"
										>
											No
										</TogglePill>
									</div>
								</div>

								<div>
									<div className="flex items-center justify-between mb-2">
										<div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
											Path tag
										</div>
										<span className="text-[9px] font-mono text-muted-foreground/40">
											c
										</span>
									</div>
									<div className="relative">
										<input
											ref={
												categoryInputRef
											}
											value={
												categoryInput
											}
											onChange={(
												e,
											) =>
												setCategoryInput(
													e
														.target
														.value,
												)
											}
											onKeyDown={(
												e,
											) => {
												if (
													e.key ===
													"Enter"
												) {
													e.preventDefault();
													normalizeCategoryInput();
												}
											}}
											onBlur={
												normalizeCategoryInput
											}
											placeholder="core/device-authorization"
											className="w-full h-8 bg-transparent border border-border rounded-sm px-2 pr-7 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20"
										/>
										{categoryInput && (
											<button
												onClick={() =>
													setCategoryInput(
														"",
													)
												}
												className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-sm text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 cursor-pointer"
												aria-label="Clear path tag"
											>
												<X className="w-3 h-3" />
											</button>
										)}
									</div>
									<p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/50">
										Use one
										slash-separated tag
										so the map can group
										related issues.
									</p>
									{categorySuggestions.length >
										0 && (
										<div className="mt-3">
											<div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5">
												Suggestions
											</div>
											<div className="flex flex-wrap gap-1.5">
												{categorySuggestions.map(
													(
														tag,
													) => (
														<TogglePill
															key={
																tag
															}
															onMouseDown={(
																event,
															) =>
																event.preventDefault()
															}
															onClick={() =>
																setCategoryInput(
																	tag,
																)
															}
														>
															{
																tag
															}
														</TogglePill>
													),
												)}
											</div>
										</div>
									)}
								</div>

								<div>
									<div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
										Notes
									</div>
									<textarea
										value={notes}
										onChange={(e) =>
											setNotes(
												e
													.target
													.value,
											)
										}
										placeholder="Optional triage note..."
										className="w-full min-h-20 bg-transparent border border-border rounded-sm p-2 text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20"
									/>
								</div>

								{saveError && (
									<div className="text-xs text-destructive border border-destructive/30 rounded-sm px-2 py-1.5">
										{saveError}
									</div>
								)}

								<div className="grid grid-cols-2 gap-2">
									<button
										onClick={() =>
											saveCurrent(
												"triaged",
												true,
											)
										}
										className="col-span-2 flex items-center justify-center gap-1.5 h-9 rounded-sm bg-foreground text-background text-xs font-medium cursor-pointer hover:opacity-90"
									>
										<Check className="w-3.5 h-3.5" />
										Complete
										<span className="opacity-60 font-mono">
											Enter
										</span>
									</button>
									<button
										onClick={() =>
											saveCurrent(
												"skipped",
												true,
											)
										}
										className="flex items-center justify-center gap-1.5 h-8 rounded-sm border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 cursor-pointer"
									>
										<ChevronsRight className="w-3.5 h-3.5" />
										Skip
									</button>
									<button
										onClick={goPrevious}
										className="flex items-center justify-center gap-1.5 h-8 rounded-sm border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 cursor-pointer"
									>
										<ArrowLeft className="w-3.5 h-3.5" />
										Back
									</button>
									<button
										onClick={goNext}
										className="col-span-2 flex items-center justify-center gap-1.5 h-8 rounded-sm border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 cursor-pointer"
									>
										Next
										<ArrowRight className="w-3.5 h-3.5" />
									</button>
								</div>
								{pageInfo.hasNextPage && (
									<button
										onClick={fetchMore}
										disabled={
											isFetchingMore
										}
										className="w-full h-8 rounded-sm border border-border text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50 cursor-pointer"
									>
										{isFetchingMore
											? "Loading..."
											: "Load more issues"}
									</button>
								)}
							</div>
						</div>

						<div className="border border-border rounded-md">
							<div className="px-3 py-2.5 border-b border-border/60 flex items-center justify-between">
								<span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
									Issue interactions
								</span>
								{isInteractionPending && (
									<Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
								)}
							</div>
							<div className="p-3 space-y-3">
								<div className="flex items-center justify-between gap-2">
									<div>
										<div className="text-xs font-medium">
											#
											{
												currentIssue.number
											}
										</div>
										<div className="text-[10px] font-mono text-muted-foreground/60">
											{detail
												?.issue
												.state ===
											"closed"
												? detail
														.issue
														.state_reason ===
													"not_planned"
													? "closed as not planned"
													: "closed as completed"
												: "open issue"}
										</div>
									</div>
									<Link
										href={issueUrl(
											owner,
											repo,
											currentIssue.number,
										)}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
									>
										GitHub
										<ExternalLink className="w-3 h-3" />
									</Link>
								</div>

								<textarea
									value={interactionMessage}
									onChange={(e) =>
										setInteractionMessage(
											e.target
												.value,
										)
									}
									placeholder="Closing message or comment..."
									className="w-full min-h-24 bg-transparent border border-border rounded-sm p-2 text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20"
								/>

								<div>
									<div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
										Close reason
									</div>
									<div className="flex flex-wrap gap-1.5">
										<TogglePill
											active={
												closeReason ===
												"completed"
											}
											onClick={() =>
												setCloseReason(
													"completed",
												)
											}
										>
											<CheckCircle2 className="inline w-3 h-3 mr-1" />
											Completed
										</TogglePill>
										<TogglePill
											active={
												closeReason ===
												"not_planned"
											}
											onClick={() =>
												setCloseReason(
													"not_planned",
												)
											}
										>
											<CircleOff className="inline w-3 h-3 mr-1" />
											Not planned
										</TogglePill>
										<TogglePill
											active={
												closeReason ===
												"other"
											}
											onClick={() =>
												setCloseReason(
													"other",
												)
											}
										>
											Something
											else
										</TogglePill>
									</div>
								</div>

								{interactionError && (
									<div className="text-xs text-destructive border border-destructive/30 rounded-sm px-2 py-1.5">
										{interactionError}
									</div>
								)}
								{interactionNotice && (
									<div className="text-xs text-success border border-success/30 rounded-sm px-2 py-1.5">
										{interactionNotice}
									</div>
								)}

								<div className="grid grid-cols-2 gap-2">
									<button
										onClick={() =>
											submitIssueInteraction(
												"comment",
											)
										}
										disabled={
											isInteractionPending ||
											!interactionMessage.trim()
										}
										className="flex items-center justify-center gap-1.5 h-8 rounded-sm border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
									>
										<CornerDownLeft className="w-3.5 h-3.5" />
										Comment
									</button>
									{detail?.issue.state ===
									"closed" ? (
										<button
											onClick={() =>
												submitIssueInteraction(
													"reopen",
												)
											}
											disabled={
												isInteractionPending ||
												!detail.canReopen
											}
											className="flex items-center justify-center gap-1.5 h-8 rounded-sm border border-success/30 text-xs text-success/80 hover:text-success hover:bg-success/10 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
										>
											<CircleDot className="w-3.5 h-3.5" />
											Reopen
										</button>
									) : (
										<button
											onClick={() =>
												submitIssueInteraction(
													"close",
												)
											}
											disabled={
												isInteractionPending ||
												isLoadingDetail ||
												!detail?.canClose
											}
											className="flex items-center justify-center gap-1.5 h-8 rounded-sm bg-foreground text-background text-xs font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
										>
											{closeReason ===
											"completed" ? (
												<CheckCircle2 className="w-3.5 h-3.5" />
											) : (
												<CircleOff className="w-3.5 h-3.5" />
											)}
											Close
										</button>
									)}
								</div>

								{detail &&
								detail.issue.state !== "closed" &&
								!detail.canClose ? (
									<p className="text-[10px] leading-relaxed text-muted-foreground/60">
										Your GitHub
										permissions do not
										allow closing this
										issue.
									</p>
								) : null}
							</div>
						</div>
					</div>
				</div>
			)}

			{view === "map" && (
				<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
					<div className="border border-border rounded-md p-4">
						<div className="flex items-start justify-between gap-3 mb-3">
							<div>
								<div className="flex items-center gap-2">
									<Network className="w-4 h-4 text-muted-foreground" />
									<h2 className="text-sm font-medium">
										Runtime category
										bubbles
									</h2>
								</div>
								<p className="mt-1 text-xs text-muted-foreground/60">
									Circles nest by category
									path. Rename a circle to
									update every saved issue in
									that branch.
								</p>
							</div>
							{isMapPending && (
								<Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0 mt-0.5" />
							)}
						</div>
						{renamingPath && (
							<div className="mb-4 border border-border/60 rounded-md p-3 bg-muted/20">
								<div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
									Rename{" "}
									{formatCategoryPath(
										renamingPath,
									)}
								</div>
								<div className="flex items-center gap-2">
									<input
										value={renameValue}
										onChange={(event) =>
											setRenameValue(
												event
													.target
													.value,
											)
										}
										onKeyDown={(
											event,
										) => {
											if (
												event.key ===
												"Enter"
											) {
												event.preventDefault();
												applyCategoryRename();
											}
											if (
												event.key ===
												"Escape"
											) {
												setRenamingPath(
													null,
												);
												setRenameError(
													null,
												);
											}
										}}
										className="min-w-0 flex-1 h-8 bg-transparent border border-border rounded-sm px-2 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20"
										autoFocus
									/>
									<button
										onClick={
											applyCategoryRename
										}
										disabled={
											isMapPending
										}
										className="h-8 px-3 rounded-sm border border-border text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50 cursor-pointer"
									>
										Save
									</button>
									<button
										onClick={() => {
											setRenamingPath(
												null,
											);
											setRenameError(
												null,
											);
										}}
										className="h-8 px-3 rounded-sm border border-border text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/40 cursor-pointer"
									>
										Cancel
									</button>
								</div>
								{renameError && (
									<p className="mt-2 text-xs text-destructive">
										{renameError}
									</p>
								)}
							</div>
						)}
						<div className="flex flex-wrap gap-5 items-start">
							{categoryTree.length === 0 ? (
								<p className="text-xs font-mono text-muted-foreground/60">
									Categorize issues in the
									queue to grow the map.
								</p>
							) : (
								categoryTree.map((node) => (
									<CategoryBubble
										key={formatCategoryPath(
											node.path,
										)}
										node={node}
										selectedPath={
											selectedCategory
										}
										onSelect={(path) =>
											setSelectedCategory(
												formatCategoryPath(
													path,
												),
											)
										}
										onStartRename={
											startRenameCategory
										}
									/>
								))
							)}
						</div>
					</div>
					<div className="border border-border rounded-md">
						<div className="px-3 py-2.5 border-b border-border/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
							Selected issues
						</div>
						<div className="divide-y divide-border/60">
							{filteredIssues.slice(0, 8).map((issue) => (
								<button
									key={issue.number}
									onClick={() => {
										setView("queue");
										setIssueParam(
											issue.number,
										);
									}}
									className="w-full text-left px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
								>
									<div className="text-xs font-medium line-clamp-2">
										{issue.title}
									</div>
									<div className="mt-1 text-[10px] font-mono text-muted-foreground/50">
										#{issue.number}
									</div>
								</button>
							))}
						</div>
					</div>
				</div>
			)}

			{view === "analytics" && (
				<div className="space-y-4">
					<div className="flex items-center gap-2">
						<BarChart3 className="w-4 h-4 text-muted-foreground" />
						<h2 className="text-sm font-medium">
							Triage analytics
						</h2>
						<span className="text-[10px] font-mono text-muted-foreground/50">
							current repo
						</span>
					</div>
					<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
						<StatCard
							label="Saved"
							value={analytics.summary.total}
						/>
						<StatCard
							label="Triaged"
							value={analytics.summary.triaged}
							accent
						/>
						<StatCard
							label="AI"
							value={analytics.summary.delegateAi}
						/>
						<StatCard
							label="Simple"
							value={analytics.summary.simple}
						/>
						<StatCard
							label="Hard"
							value={analytics.summary.hard}
						/>
						<StatCard
							label="v2 Yes"
							value={analytics.summary.v2Yes}
						/>
						<StatCard
							label="v2 Maybe"
							value={analytics.summary.v2Maybe}
						/>
						<StatCard
							label="Skipped"
							value={analytics.summary.skipped}
						/>
					</div>
					<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
						<div className="border border-border rounded-md p-4">
							<div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
								Effort distribution
							</div>
							<div className="space-y-2">
								{[
									[
										"simple",
										analytics.summary
											.simple,
									],
									[
										"delegate ai",
										analytics.summary
											.delegateAi,
									],
									[
										"hard",
										analytics.summary
											.hard,
									],
								].map(([label, value]) => (
									<div key={label as string}>
										<div className="flex justify-between text-[11px] font-mono text-muted-foreground mb-1">
											<span>
												{
													label
												}
											</span>
											<span>
												{
													value
												}
											</span>
										</div>
										<div className="h-2 rounded-full bg-muted overflow-hidden">
											<div
												className="h-full rounded-full bg-foreground/70"
												style={{
													width: `${analytics.summary.total ? (Number(value) / analytics.summary.total) * 100 : 0}%`,
												}}
											/>
										</div>
									</div>
								))}
							</div>
						</div>
						<div className="border border-border rounded-md overflow-hidden">
							<div className="px-3 py-2.5 border-b border-border/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
								Top categories
							</div>
							<div className="divide-y divide-border/60">
								{analytics.categories
									.slice(0, 8)
									.map((category) => (
										<button
											key={
												category.path
											}
											onClick={() => {
												setSelectedCategory(
													category.path,
												);
												setView(
													"map",
												);
											}}
											className="w-full px-3 py-2.5 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 text-left hover:bg-muted/30 cursor-pointer"
										>
											<span className="text-xs font-mono truncate">
												{
													category.path
												}
											</span>
											<span className="text-[10px] font-mono text-muted-foreground">
												{
													category.delegateAi
												}{" "}
												AI
											</span>
											<span className="text-[10px] font-mono text-muted-foreground">
												{
													category.v2Candidates
												}{" "}
												v2
											</span>
										</button>
									))}
							</div>
						</div>
					</div>
					<div className="border border-border rounded-md overflow-hidden">
						<div className="px-3 py-2.5 border-b border-border/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
							Action list
						</div>
						<div className="divide-y divide-border/60">
							{analytics.overlays
								.filter(
									(overlay) =>
										overlay.difficulty ===
											"delegate_ai" ||
										overlay.v2Fit ===
											"yes" ||
										overlay.v2Fit ===
											"maybe",
								)
								.slice(0, 8)
								.map((overlay) => (
									<Link
										key={overlay.id}
										href={`/${overlay.owner}/${overlay.repo}/issues/${overlay.issueNumber}`}
										target="_blank"
										rel="noreferrer"
										className="block w-full text-left px-3 py-2.5 hover:bg-muted/30 cursor-pointer"
									>
										<div className="flex items-center gap-2">
											<Sparkles className="w-3 h-3 text-muted-foreground" />
											<span className="text-xs font-medium truncate">
												#
												{
													overlay.issueNumber
												}{" "}
												{
													overlay.issueTitle
												}
											</span>
										</div>
										<div className="flex gap-1.5 mt-1.5">
											{overlay.difficulty && (
												<span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
													{overlay.difficulty.replace(
														"_",
														" ",
													)}
												</span>
											)}
											{overlay.v2Fit && (
												<span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
													v2{" "}
													{
														overlay.v2Fit
													}
												</span>
											)}
										</div>
									</Link>
								))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
