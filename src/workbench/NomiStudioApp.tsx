import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ToastHost } from "../ui/toast";
import type { WorkbenchProjectPersistenceService } from "./project/projectPersistenceService";
import type { WorkbenchProjectSummary as LocalProjectSummary } from "./project/projectRecordSchema";
import { useWorkspaceEvents } from "./useWorkspaceEvents";
import { cn } from "../utils/cn";
import { toast } from "../ui/toast";
import { setDesktopActiveProjectId } from "../desktop/activeProject";
import { markStartup, markStartupProbe, timeStartupStepAsync } from "../utils/startupDiagnostics";

type AppView = "library" | "studio" | "loading";
type ProjectPersistenceModule = typeof import("./project/projectPersistenceService");

const ProjectLibraryRoute = React.lazy(
    () => import("./library/ProjectLibraryRoute"),
);
const WorkbenchShell = React.lazy(() =>
    timeStartupStepAsync("load WorkbenchShell chunk", () => import("./WorkbenchShell"), 250),
);
const OnboardingFloatingPanel = React.lazy(() =>
    import("../ui/onboarding/OnboardingFloatingPanel").then((module) => ({
        default: module.OnboardingFloatingPanel,
    })),
);
const MantineFeatureProvider = React.lazy(() =>
    import("../ui/mantine/MantineFeatureProvider").then((module) => ({
        default: module.MantineFeatureProvider,
    })),
);
const GenerationCanvas = React.lazy(() =>
    timeStartupStepAsync("load GenerationCanvas chunk", () => import("./generationCanvasV2/components/GenerationCanvas"), 250),
);
const CanvasAssistantEntry = React.lazy(() =>
    timeStartupStepAsync("load CanvasAssistantEntry chunk", () => import("./generationCanvasV2/components/CanvasAssistantEntry"), 250),
);
const FilePreviewPanel = React.lazy(() =>
    import("./explorer/FilePreviewPanel").then((module) => ({
        default: module.FilePreviewPanel,
    })),
);

function buildStudioUrl(projectId?: string | null): string {
    const normalizedProjectId = String(projectId || "").trim();
    return normalizedProjectId
        ? `/studio?projectId=${encodeURIComponent(normalizedProjectId)}`
        : "/studio";
}

function GenerationCanvasLoading(): JSX.Element {
    return (
        <div
            className={cn("w-full h-full bg-workbench-bg")}
            aria-label='生成画布加载中'
        />
    );
}

function StudioAppLoading(): JSX.Element {
    return (
        <div
            className={cn("grid h-screen w-screen place-items-center bg-nomi-bg")}
            aria-label='项目加载中'>
            <div className='h-6 w-6 rounded-full border border-nomi-line border-t-nomi-accent animate-spin' />
        </div>
    );
}

function readProjectIdFromSearch(search: string): string | null {
    try {
        const value = new URLSearchParams(search).get("projectId");
        return value && value.trim() ? value.trim() : null;
    } catch {
        return null;
    }
}

export default function NomiStudioApp(): JSX.Element {
    markStartupProbe("NomiStudioApp render");
    const navigate = useNavigate();
    const location = useLocation();
    const routeProjectId = React.useMemo(
        () => readProjectIdFromSearch(location.search),
        [location.search],
    );
    const [view, setView] = React.useState<AppView>(() =>
        routeProjectId ? "loading" : "library",
    );
    const [activeProject, setActiveProject] =
        React.useState<LocalProjectSummary | null>(null);
    const [generationAiCollapsed, setGenerationAiCollapsed] =
        React.useState(true);
    const [modelCatalogOpened, setModelCatalogOpened] = React.useState(false);
    const hydratingProjectRef = React.useRef(false);
    const activeProjectIdRef = React.useRef<string | null>(null);
    const initialHydrationAttemptedRef = React.useRef(false);
    const projectPersistenceModuleRef =
        React.useRef<ProjectPersistenceModule | null>(null);
    const projectPersistenceServiceRef =
        React.useRef<WorkbenchProjectPersistenceService | null>(null);
    const activeProjectPersistenceKey = activeProject
        ? `${activeProject.id}\u0000${activeProject.name}`
        : "";

    React.useEffect(() => {
        markStartup("NomiStudioApp mounted");
        markStartupProbe("NomiStudioApp mounted", { view });
        document.documentElement.dataset.theme = "light";
        document.documentElement.setAttribute(
            "data-mantine-color-scheme",
            "light",
        );
    }, []);

    React.useEffect(() => {
        const handleOpenModelCatalog = () => setModelCatalogOpened(true);
        window.addEventListener(
            "nomi-open-model-catalog",
            handleOpenModelCatalog,
        );
        return () =>
            window.removeEventListener(
                "nomi-open-model-catalog",
                handleOpenModelCatalog,
            );
    }, []);

    const ensureProjectPersistenceService = React.useCallback(async () => {
        let module = projectPersistenceModuleRef.current;
        if (!module) {
            module = await timeStartupStepAsync(
                "load project persistence module",
                () => import("./project/projectPersistenceService"),
            );
            projectPersistenceModuleRef.current = module;
        }
        let service = projectPersistenceServiceRef.current;
        if (!service) {
            service = module.createWorkbenchProjectPersistenceService({
                onSaveError: (error) => {
                    console.error("project save error", error);
                    toast("项目保存失败，请检查本地磁盘权限", "error");
                },
            });
            projectPersistenceServiceRef.current = service;
        }
        return { module, service };
    }, []);

    React.useEffect(() => {
        setDesktopActiveProjectId(activeProject?.id);
    }, [activeProject?.id]);

    const hydrateProject = React.useCallback(
        async (projectId: string, options: { replaceUrl?: boolean } = {}) => {
            const { module, service } = await ensureProjectPersistenceService();
            hydratingProjectRef.current = true;
            try {
                const hydrated = await timeStartupStepAsync(
                    `hydrate route project ${projectId}`,
                    () => service.hydrateProject(projectId),
                    500,
                );
                if (!hydrated) return false;
                markStartupProbe("project-hydrated", { projectId: hydrated.id });
                activeProjectIdRef.current = hydrated.id;
                setActiveProject(hydrated);
                setView("studio");
                const migrationDiag =
                    module.consumeCategoryMigrationDiagnostic();
                if (
                    migrationDiag &&
                    (migrationDiag.migratedNodes > 0 ||
                        migrationDiag.categoriesSeeded)
                ) {
                    toast(
                        `项目已升级到目录树：${migrationDiag.migratedNodes} 个节点已归类`,
                        "success",
                    );
                }
                navigate(buildStudioUrl(hydrated.id), {
                    replace: options.replaceUrl ?? false,
                });
            } finally {
                hydratingProjectRef.current = false;
            }
            return true;
        },
        [ensureProjectPersistenceService, navigate],
    );

    React.useEffect(() => {
        if (initialHydrationAttemptedRef.current) return;
        initialHydrationAttemptedRef.current = true;
        if (!routeProjectId) return;
        let cancelled = false;
        hydratingProjectRef.current = true;
        void ensureProjectPersistenceService()
            .then(({ service }) =>
                timeStartupStepAsync(
                    "hydrate initial project",
                    () => service.hydrateInitialProject(),
                    500,
                ),
            )
            .then((hydrated) => {
                if (cancelled) return;
                if (hydrated) {
                    markStartupProbe("initial-project-hydrated", { projectId: hydrated.id });
                    activeProjectIdRef.current = hydrated.id;
                    setActiveProject(hydrated);
                    setView("studio");
                    navigate(buildStudioUrl(hydrated.id), { replace: true });
                } else {
                    setView("library");
                    if (routeProjectId)
                        navigate(buildStudioUrl(), { replace: true });
                }
            })
            .catch((error: unknown) => {
                const message =
                    error instanceof Error && error.message
                        ? error.message
                        : "项目恢复失败";
                console.error(message);
                setView("library");
            })
            .finally(() => {
                if (!cancelled) hydratingProjectRef.current = false;
            });
        return () => {
            cancelled = true;
            hydratingProjectRef.current = false;
        };
    }, [
        ensureProjectPersistenceService,
        navigate,
        routeProjectId,
    ]);

    React.useEffect(() => {
        if (
            !initialHydrationAttemptedRef.current ||
            hydratingProjectRef.current
        )
            return;
        if (!routeProjectId || routeProjectId === activeProjectIdRef.current)
            return;
        setView("loading");
        void hydrateProject(routeProjectId, { replaceUrl: true }).then((ok) => {
            if (!ok) {
                setView("library");
                navigate(buildStudioUrl(), { replace: true });
            }
        });
    }, [hydrateProject, navigate, routeProjectId]);

    React.useEffect(() => {
        if (!activeProject?.id) return;
        let disposed = false;
        let unbind: (() => void) | undefined;
        void ensureProjectPersistenceService().then(({ service }) => {
            if (disposed) return;
            unbind = service.bindProjectPersistence({
                project: activeProject,
                isHydrating: () => hydratingProjectRef.current,
                canPersist: () =>
                    activeProjectIdRef.current === activeProject.id,
                onSaved: (saved) => {
                    setActiveProject(saved);
                },
                onSaveError: (error) => {
                    console.error("project save error", error);
                    toast("项目保存失败，请检查本地磁盘权限", "error");
                },
            });
        });
        return () => {
            disposed = true;
            unbind?.();
        };
    }, [
        activeProject,
        activeProjectPersistenceKey,
        ensureProjectPersistenceService,
    ]);

    useWorkspaceEvents(view === "studio" ? activeProject?.id : null, (type) => {
        if (
            type === "canvas.updated" ||
            type === "timeline.updated" ||
            type === "creation.updated"
        ) {
            void hydrateProject(activeProject!.id);
        }
    });

    const backToLibrary = React.useCallback(() => {
        setView("library");
        navigate(buildStudioUrl(), { replace: false });
    }, [navigate]);

    const handleActiveProjectDeleted = React.useCallback(() => {
        activeProjectIdRef.current = null;
        setActiveProject(null);
        setView("library");
    }, []);

    const handleRenameProject = React.useCallback(
        (newName: string) => {
            if (!activeProject) return;
            const trimmed = newName.trim() || "未命名 Nomi 项目";
            if (trimmed === activeProject.name) return;
            const renamed: LocalProjectSummary = {
                ...activeProject,
                name: trimmed,
            };
            // Update React state so AppBar reflects the new name immediately
            setActiveProject(renamed);
            // Persist the new name with the current in-memory canvas/timeline/document
            // state (NOT a re-read from disk — that would be stale). This updates the
            // project file on disk AND publishes the new summary so the project library
            // card refreshes via SWR.
            void ensureProjectPersistenceService()
                .then(async ({ service }) => {
                    const { readCurrentWorkbenchProjectPayload } =
                        await import("./project/workbenchProjectSession");
                    return service.persistProject(
                        renamed,
                        readCurrentWorkbenchProjectPayload(),
                    );
                })
                .catch((error: unknown) => {
                    console.error("project rename save error", error);
                    toast("项目重命名保存失败", "error");
                });
        },
        [activeProject, ensureProjectPersistenceService],
    );

    if (view === "loading") {
        return <StudioAppLoading />;
    }

    if (view === "library") {
        return (
            <>
                <React.Suspense fallback={<StudioAppLoading />}>
                    <ProjectLibraryRoute
                        activeProjectId={activeProjectIdRef.current}
                        hydrateProject={hydrateProject}
                        onActiveProjectDeleted={handleActiveProjectDeleted}
                    />
                </React.Suspense>
                <ToastHost />
            </>
        );
    }

    return (
        <div
            className={cn("nomi-studio-app w-full h-screen min-h-0 bg-nomi-bg")}
            aria-label='Nomi Studio'>
            <WorkbenchShell
                generation={
                    <React.Suspense fallback={<GenerationCanvasLoading />}>
                        <GenerationCanvas />
                    </React.Suspense>
                }
                generationAiLayout={
                    generationAiCollapsed ? "overlay" : "sidebar"
                }
                generationAi={
                    <React.Suspense fallback={null}>
                        <CanvasAssistantEntry
                            defaultCollapsed
                            onCollapsedChange={setGenerationAiCollapsed}
                        />
                    </React.Suspense>
                }
                projectId={activeProject?.id ?? null}
                projectName={activeProject?.name}
                onBackToLibrary={backToLibrary}
                onOpenModelCatalog={() => setModelCatalogOpened(true)}
                onRenameProject={handleRenameProject}
            />

            {modelCatalogOpened ? (
                <React.Suspense fallback={null}>
                    <MantineFeatureProvider>
                        <OnboardingFloatingPanel
                            opened
                            onClose={() => setModelCatalogOpened(false)}
                        />
                    </MantineFeatureProvider>
                </React.Suspense>
            ) : null}

            <FilePreviewPanel />

            <ToastHost />
        </div>
    );
}
