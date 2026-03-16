import { Redirect } from "expo-router";

import { useMobileAppStore } from "../src/mobileStore";

export default function IndexRoute() {
  const loaded = useMobileAppStore((state) => state.loaded);
  const activeProfileId = useMobileAppStore((state) => state.activeProfileId);
  const readModel = useMobileAppStore((state) => state.readModel);
  const profiles = useMobileAppStore((state) => state.profiles);
  const lastOpenedThreadIdByServerUrl = useMobileAppStore(
    (state) => state.lastOpenedThreadIdByServerUrl,
  );
  const lastOpenedProjectIdByServerUrl = useMobileAppStore(
    (state) => state.lastOpenedProjectIdByServerUrl,
  );

  if (!loaded) {
    return null;
  }

  if (!activeProfileId) {
    return <Redirect href="/connect" />;
  }

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
  if (!activeProfile || !readModel) {
    return <Redirect href="/connect" />;
  }

  const rememberedThreadId = lastOpenedThreadIdByServerUrl[activeProfile.serverUrl];
  if (
    rememberedThreadId &&
    readModel.threads.some(
      (thread) => thread.id === rememberedThreadId && thread.deletedAt === null,
    )
  ) {
    return <Redirect href={`/thread/${rememberedThreadId}`} />;
  }

  const rememberedProjectId = lastOpenedProjectIdByServerUrl[activeProfile.serverUrl];
  if (
    rememberedProjectId &&
    readModel.projects.some(
      (project) => project.id === rememberedProjectId && project.deletedAt === null,
    )
  ) {
    return <Redirect href={`/(drawer)/project/${rememberedProjectId}`} />;
  }

  const firstProject = readModel.projects.find((project) => project.deletedAt === null);
  if (firstProject) {
    return <Redirect href={`/(drawer)/project/${firstProject.id}`} />;
  }

  return <Redirect href="/connect" />;
}
