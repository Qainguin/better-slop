"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { OnboardingOverlayProps } from "./onboarding-overlay";

const OnboardingOverlay = dynamic(() =>
	import("./onboarding-overlay").then((module) => module.OnboardingOverlay),
);

export function LazyOnboardingOverlay(props: OnboardingOverlayProps) {
	const [shouldLoad, setShouldLoad] = useState(!props.onboardingDone);

	useEffect(() => {
		if (new URLSearchParams(window.location.search).has("onboarding")) {
			setShouldLoad(true);
		}
	}, []);

	return shouldLoad ? <OnboardingOverlay {...props} /> : null;
}
