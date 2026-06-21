import React from "react";
import { getDesktopBridge } from "../../desktop/bridge";
import { markStartupProbe } from "../../utils/startupDiagnostics";
import {
    openWorkspaceFromLibrary,
    openWorkspaceProjectFromPicker,
} from "./openWorkspaceFlow";
import {
    createLocalProjectAsync,
    deleteLocalProject,
    useLocalProjects,
    type LocalProjectSummary,
} from "./localProjectStore";
import ProjectLibraryPage from "./ProjectLibraryPage";
import type { TryNowExample } from "./tryNowExamples";
import type { ProjectTemplateId } from "./projectTemplates";

function buildStudioUrl(projectId?: string | null): string {
    const normalizedProjectId = String(projectId || "").trim();
    return normalizedProjectId
        ? `/studio?projectId=${encodeURIComponent(normalizedProjectId)}`
        : "/studio";
}

type ProjectLibraryRouteProps = {
    activeProjectId?: string | null;
    hydrateProject: (projectId: string) => Promise<boolean> | boolean;
    onActiveProjectDeleted: () => void;
};

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function showToast(message: string, tone?: "success" | "error"): void {
    void import("../../ui/toast")
        .then(({ toast }) => toast(message, tone))
        .catch((error: unknown) => {
            console.error("show toast failed", error);
            if (tone === "error") console.error(message);
        });
}

export default function ProjectLibraryRoute({
    activeProjectId,
    hydrateProject,
    onActiveProjectDeleted,
}: ProjectLibraryRouteProps): JSX.Element {
    const { projects, refreshProjects } = useLocalProjects();

    React.useEffect(() => {
        markStartupProbe("ProjectLibraryRoute mounted", { count: projects.length });
    }, [projects.length]);

    const openProject = React.useCallback(
        (projectId: string) => {
            void hydrateProject(projectId);
        },
        [hydrateProject],
    );

    const openWorkspaceFolder = React.useCallback(async () => {
        try {
            await openWorkspaceFromLibrary({
                bridge: getDesktopBridge(),
                hydrateProject,
                refreshProjects,
                confirmInitialize: async (rootPath) =>
                    window.confirm(
                        `将此文件夹初始化为 Nomi 项目？\n\n${rootPath}\n\nNomi 会创建 .nomi/，并把生成的图片、视频保存到 assets/ 和 exports/。`,
                    ),
                showMessage: (message, tone) =>
                    showToast(message, tone || "error"),
            });
        } catch (error: unknown) {
            const message = errorMessage(error, "打开文件夹失败");
            console.error("open workspace folder failed", error);
            showToast(message, "error");
        }
    }, [hydrateProject, refreshProjects]);

    const newProject = React.useCallback(
        async (templateId?: ProjectTemplateId) => {
            try {
                const desktop = getDesktopBridge();
                if (desktop?.workspace) {
                    await openWorkspaceFolder();
                    return;
                }
                const project = await createLocalProjectAsync(undefined, templateId);
                void hydrateProject(project.id);
            } catch (error: unknown) {
                const message = errorMessage(error, "新建项目失败");
                console.error("create project failed", error);
                showToast(message, "error");
            }
        },
        [hydrateProject, openWorkspaceFolder],
    );

    const tryExample = React.useCallback(
        async (example: TryNowExample) => {
            try {
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
                            showToast(message, tone || "error"),
                    });
                    if (!projectId) return;
                    refreshProjects();
                } else {
                    const project = await createLocalProjectAsync(
                        example.projectName,
                    );
                    projectId = project.id;
                }

                const hydrated = await hydrateProject(projectId);
                if (!hydrated) return;

                const { buildStoryDocument } = await import("./tryNowExamples");
                const doc = buildStoryDocument(example.story, example.projectName);
                const { useWorkbenchStore } = await import("../workbenchStore");
                const store = useWorkbenchStore.getState();
                store.setWorkbenchDocument(doc);
                store.setWorkspaceMode("creation");
                window.setTimeout(() => {
                    void import(
                        "../generationCanvasV2/agent/storyboardLauncher"
                    ).then(({ requestStoryboardPlanning }) => {
                        requestStoryboardPlanning({
                            storyText: example.story,
                            source: `library-try-now:${example.id}`,
                        });
                    });
                }, 200);
            } catch (error: unknown) {
                const message = errorMessage(error, "示例项目创建失败");
                console.error("try example failed", error);
                showToast(message, "error");
            }
        },
        [hydrateProject, refreshProjects],
    );

    const deleteProject = React.useCallback(
        (project: LocalProjectSummary) => {
            const confirmed = window.confirm(
                `确定删除「${project.name}」吗？项目文件夹和本地资源会一起删除。`,
            );
            if (!confirmed) return;
            void (async () => {
                try {
                    await deleteLocalProject(project.id);
                    if (activeProjectId === project.id) {
                        onActiveProjectDeleted();
                        window.history.replaceState(null, "", `#${buildStudioUrl()}`);
                    }
                    showToast("项目已删除", "success");
                } catch (error: unknown) {
                    const message =
                        error instanceof Error && error.message
                            ? error.message
                            : "项目删除失败";
                    console.error("delete project failed", error);
                    showToast(message, "error");
                }
            })();
        },
        [activeProjectId, onActiveProjectDeleted],
    );

    return (
        <ProjectLibraryPage
            projects={projects}
            onOpenProject={openProject}
            onDeleteProject={deleteProject}
            onNewProject={(templateId) => void newProject(templateId)}
            onOpenFolder={() => void openWorkspaceFolder()}
            onTryExample={(example) => void tryExample(example)}
        />
    );
}
