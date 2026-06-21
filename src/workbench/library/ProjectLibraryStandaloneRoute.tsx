import React from "react";
import { markStartupProbe } from "../../utils/startupDiagnostics";

const ProjectLibraryRoute = React.lazy(() => import("./ProjectLibraryRoute"));
const LazyToastHost = React.lazy(() =>
    import("../../ui/toast").then((module) => ({ default: module.ToastHost })),
);

function buildStudioHash(projectId?: string | null): string {
    const normalizedProjectId = String(projectId || "").trim();
    return normalizedProjectId
        ? `#/studio?projectId=${encodeURIComponent(normalizedProjectId)}`
        : "#/studio";
}

function readProjectIdFromHash(): string | null {
    if (typeof window === "undefined") return null;
    try {
        const hash = window.location.hash || "";
        const search = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
        const value = search ? new URLSearchParams(search).get("projectId") : "";
        return value && value.trim() ? value.trim() : null;
    } catch {
        return null;
    }
}

export default function ProjectLibraryStandaloneRoute(): JSX.Element {
    markStartupProbe("ProjectLibraryStandaloneRoute render");
    const [activeProjectId, setActiveProjectId] = React.useState<string | null>(
        () => readProjectIdFromHash(),
    );

    React.useEffect(() => {
        const handleHashChange = () => setActiveProjectId(readProjectIdFromHash());
        window.addEventListener("hashchange", handleHashChange);
        return () => window.removeEventListener("hashchange", handleHashChange);
    }, []);

    const hydrateProject = React.useCallback((projectId: string) => {
        window.location.hash = buildStudioHash(projectId);
        setActiveProjectId(projectId);
        return true;
    }, []);

    const handleActiveProjectDeleted = React.useCallback(() => {
        window.history.replaceState(null, "", buildStudioHash());
        setActiveProjectId(null);
    }, []);

    return (
        <>
            <React.Suspense fallback={null}>
                <ProjectLibraryRoute
                    activeProjectId={activeProjectId}
                    hydrateProject={hydrateProject}
                    onActiveProjectDeleted={handleActiveProjectDeleted}
                />
            </React.Suspense>
            <React.Suspense fallback={null}>
                <LazyToastHost />
            </React.Suspense>
        </>
    );
}
