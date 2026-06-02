import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import WorkbenchShell from "./WorkbenchShell";
import ProjectLibraryPage from "./library/ProjectLibraryPage";
import { ToastHost } from "../ui/toast";
import { OnboardingFloatingPanel } from "../ui/onboarding/OnboardingFloatingPanel";
import {
    createLocalProject,
    deleteLocalProject,
    useLocalProjects,
    type LocalProjectSummary,
} from "./library/localProjectStore";
import {
    buildStoryDocument,
    type TryNowExample,
} from "./library/tryNowExamples";
import { useWorkbenchStore } from "./workbenchStore";
import { requestStoryboardPlanning } from "./generationCanvasV2/agent/storyboardLauncher";
import {
    consumeCategoryMigrationDiagnostic,
    createWorkbenchProjectPersistenceService,
} from "./project/projectPersistenceService";
import { readCurrentWorkbenchProjectPayload } from "./project/workbenchProjectSession";
import { useWorkspaceEvents } from "./useWorkspaceEvents";
import { cn } from "../utils/cn";
import { toast } from "../ui/toast";
import { setDesktopActiveProjectId } from "../desktop/activeProject";
import { getDesktopBridge } from "../desktop/bridge";
import { buildStudioUrl } from "../utils/appRoutes";
import {
    openWorkspaceFromLibrary,
    openWorkspaceProjectFromPicker,
} from "./library/openWorkspaceFlow";
import { DesignDrawer } from "src/design";

type AppView = "library" | "studio";

const GenerationCanvas = React.lazy(
    () => import("./generationCanvasV2/components/GenerationCanvas"),
);
const CanvasAssistantPanel = React.lazy(
    () => import("./generationCanvasV2/components/CanvasAssistantPanel"),
);

function GenerationCanvasLoading(): JSX.Element {
    return (
        <div
            className={cn("w-full h-full bg-workbench-bg")}
            aria-label='生成画布加载中'
        />
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
    const navigate = useNavigate();
    const location = useLocation();
    const [view, setView] = React.useState<AppView>("library");
    const { projects, refreshProjects } = useLocalProjects();
    const [activeProject, setActiveProject] =
        React.useState<LocalProjectSummary | null>(null);
    const [generationAiCollapsed, setGenerationAiCollapsed] =
        React.useState(true);
    const [modelCatalogOpened, setModelCatalogOpened] = React.useState(false);
    const hydratingProjectRef = React.useRef(false);
    const activeProjectIdRef = React.useRef<string | null>(null);
    const initialHydrationAttemptedRef = React.useRef(false);
    const projectPersistenceServiceRef = React.useRef<ReturnType<
        typeof createWorkbenchProjectPersistenceService
    > | null>(null);
    const routeProjectId = React.useMemo(
        () => readProjectIdFromSearch(location.search),
        [location.search],
    );
    const activeProjectPersistenceKey = activeProject
        ? `${activeProject.id}\u0000${activeProject.name}`
        : "";

    React.useEffect(() => {
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

    if (projectPersistenceServiceRef.current === null) {
        projectPersistenceServiceRef.current =
            createWorkbenchProjectPersistenceService({
                setActiveProject,
                setView,
                onSaveError: (error) => {
                    console.error("project save error", error);
                    toast("项目保存失败，请检查本地磁盘权限", "error");
                },
            });
    }

    React.useEffect(() => {
        setDesktopActiveProjectId(activeProject?.id);
    }, [activeProject?.id]);

    const hydrateProject = React.useCallback(
        async (projectId: string, options: { replaceUrl?: boolean } = {}) => {
            const service = projectPersistenceServiceRef.current;
            if (!service) return false;
            hydratingProjectRef.current = true;
            try {
                const hydrated = await service.hydrateProject(projectId);
                if (!hydrated) return false;
                activeProjectIdRef.current = hydrated.id;
                setActiveProject(hydrated);
                setView("studio");
                const migrationDiag = consumeCategoryMigrationDiagnostic();
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
        [navigate],
    );

    const openProject = React.useCallback(
        (projectId: string) => {
            void hydrateProject(projectId);
        },
        [hydrateProject],
    );

    const openWorkspaceFolder = React.useCallback(async () => {
        await openWorkspaceFromLibrary({
            bridge: getDesktopBridge(),
            hydrateProject,
            refreshProjects,
            confirmInitialize: async (rootPath) =>
                window.confirm(
                    `将此文件夹初始化为 Nomi 项目？\n\n${rootPath}\n\nNomi 会创建 .nomi/，并把生成的图片、视频保存到 assets/ 和 exports/。`,
                ),
            showMessage: (message, tone) => toast(message, tone || "error"),
        });
    }, [hydrateProject, refreshProjects]);

    const newProject = React.useCallback(async () => {
        const desktop = getDesktopBridge();
        if (desktop?.workspace) {
            await openWorkspaceFolder();
            return;
        }
        const project = createLocalProject();
        void hydrateProject(project.id);
    }, [hydrateProject, openWorkspaceFolder]);

    /**
     * Try-Now hero handler (C6). Creates a fresh project, hydrates it,
     * stuffs the example story into the creation workbench document, then
     * dispatches a storyboard request so the demo runs end-to-end with a
     * single click. We delay the storyboard event until after the project
     * has hydrated and the creation editor has mounted, otherwise the
     * canvas-assistant listener might not be attached yet.
     */
    const tryExample = React.useCallback(
        async (example: TryNowExample) => {
            const desktop = getDesktopBridge();
            let projectId: string | null = null;
            if (desktop?.workspace) {
                projectId = await openWorkspaceProjectFromPicker({
                    bridge: desktop,
                    name: example.projectName,
                    confirmInitialize: async (rootPath) =>
                        window.confirm(
                            `将此文件夹初始化为 Nomi 示例项目？\n\n${rootPath}\n\nNomi 会创建 .nomi/，并把生成的图片、视频保存到 assets/ 和 exports/。`,
                        ),
                    showMessage: (message, tone) =>
                        toast(message, tone || "error"),
                });
                if (!projectId) return;
                refreshProjects();
            } else {
                const project = createLocalProject(example.projectName);
                projectId = project.id;
            }
            const hydrated = await hydrateProject(projectId);
            if (!hydrated) return;
            const doc = buildStoryDocument(example.story, example.projectName);
            const store = useWorkbenchStore.getState();
            store.setWorkbenchDocument(doc);
            store.setWorkspaceMode("creation");
            // Allow the creation editor + canvas assistant panel to mount before
            // dispatching, so the storyboard listener actually picks up the event.
            window.setTimeout(() => {
                requestStoryboardPlanning({
                    storyText: example.story,
                    source: `library-try-now:${example.id}`,
                });
            }, 200);
        },
        [hydrateProject, refreshProjects],
    );

    const deleteProject = React.useCallback(
        (project: LocalProjectSummary) => {
            const confirmed = window.confirm(
                `确定删除「${project.name}」吗？项目文件夹和本地资源会一起删除。`,
            );
            if (!confirmed) return;
            try {
                deleteLocalProject(project.id);
                if (activeProjectIdRef.current === project.id) {
                    activeProjectIdRef.current = null;
                    setActiveProject(null);
                    setView("library");
                    navigate(buildStudioUrl(), { replace: true });
                }
                toast("项目已删除", "success");
            } catch (error: unknown) {
                const message =
                    error instanceof Error && error.message
                        ? error.message
                        : "项目删除失败";
                console.error(message);
                toast(message, "error");
            }
        },
        [navigate],
    );

    React.useEffect(() => {
        if (initialHydrationAttemptedRef.current) return;
        initialHydrationAttemptedRef.current = true;
        const service = projectPersistenceServiceRef.current;
        if (!service) return;
        hydratingProjectRef.current = true;
        void service
            .hydrateInitialProject(projects)
            .then((hydrated) => {
                if (hydrated) {
                    activeProjectIdRef.current = hydrated.id;
                    setActiveProject(hydrated);
                    setView("studio");
                    navigate(buildStudioUrl(hydrated.id), { replace: true });
                } else {
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
            })
            .finally(() => {
                hydratingProjectRef.current = false;
            });
    }, [navigate, projects, routeProjectId]);

    React.useEffect(() => {
        if (
            !initialHydrationAttemptedRef.current ||
            hydratingProjectRef.current
        )
            return;
        if (!routeProjectId || routeProjectId === activeProjectIdRef.current)
            return;
        void hydrateProject(routeProjectId, { replaceUrl: true }).then((ok) => {
            if (!ok) navigate(buildStudioUrl(), { replace: true });
        });
    }, [hydrateProject, navigate, routeProjectId]);

    React.useEffect(() => {
        if (!activeProject?.id) return;
        const service = projectPersistenceServiceRef.current;
        if (!service) return undefined;
        return service.bindProjectPersistence({
            project: activeProject,
            isHydrating: () => hydratingProjectRef.current,
            canPersist: () => activeProjectIdRef.current === activeProject.id,
            onSaved: (saved) => {
                setActiveProject(saved);
            },
            onSaveError: (error) => {
                console.error("project save error", error);
                toast("项目保存失败，请检查本地磁盘权限", "error");
            },
        });
    }, [activeProjectPersistenceKey]);

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
            const service = projectPersistenceServiceRef.current;
            if (service) {
                void service
                    .persistProject(
                        renamed,
                        readCurrentWorkbenchProjectPayload(),
                    )
                    .catch((error: unknown) => {
                        console.error("project rename save error", error);
                        toast("项目重命名保存失败", "error");
                    });
            }
        },
        [activeProject],
    );

    if (view === "library") {
        return (
            <>
                <ProjectLibraryPage
                    projects={projects}
                    onOpenProject={openProject}
                    onDeleteProject={deleteProject}
                    onNewProject={() => void newProject()}
                    onOpenFolder={() => void openWorkspaceFolder()}
                    onTryExample={(example) => void tryExample(example)}
                />
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
                        <CanvasAssistantPanel
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

            <OnboardingFloatingPanel
                opened={modelCatalogOpened}
                onClose={() => setModelCatalogOpened(false)}
                // position='right'
                // size={560}
                // zIndex={4000}
                // withinPortal
            />

            <ToastHost />
        </div>
    );
}
