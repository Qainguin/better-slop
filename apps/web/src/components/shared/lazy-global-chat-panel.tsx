"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { useGlobalChat } from "@/components/shared/global-chat-provider";

const GlobalChatPanel = dynamic(() =>
	import("@/components/shared/global-chat-panel").then((module) => module.GlobalChatPanel),
);

export function LazyGlobalChatPanel() {
	const { state } = useGlobalChat();
	const [hasOpened, setHasOpened] = useState(state.isOpen);

	useEffect(() => {
		if (state.isOpen) setHasOpened(true);
	}, [state.isOpen]);

	return hasOpened ? <GlobalChatPanel /> : null;
}
